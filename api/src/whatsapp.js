import crypto from 'node:crypto';
import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, texto } from './comum.js';

// Módulo WhatsApp: conversas, chamados em kanban e o código de "Esqueci a senha".
// O envio usa a API oficial da Meta (WhatsApp Cloud API). As chaves ficam só no
// servidor (api/.env), nunca no app:
//   WHATSAPP_PROVEDOR=meta          (sem isso fica no modo teste: nada sai de verdade)
//   WHATSAPP_TOKEN=...              token permanente do usuário do sistema no Meta Business
//   WHATSAPP_APP_SECRET=...         chave secreta do app (confere se o webhook veio mesmo da Meta)
//   WHATSAPP_VERIFY_TOKEN=...       senha que você inventa e repete no cadastro do webhook
//   WHATSAPP_MODELO_CODIGO=codigo_acesso   modelo de autenticação aprovado (código da senha)
// O número de cada grupo (phone_number_id) é cadastrado na tela WhatsApp > Configurar.

const provedor = () => (process.env.WHATSAPP_PROVEDOR === 'meta' ? 'meta' : 'teste');
const GRAPH = process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v21.0';
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

// Celular do Brasil (11 dígitos) -> internacional (5511987654321)
export function internacional(tel) {
  const d = digitos(tel);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}
// Internacional -> nacional com o 9 (para o cadastro de clientes)
export function nacional(tel) {
  let d = digitos(tel);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
}

class ErroWhatsApp extends Error {}

async function chamarMeta(phoneNumberId, corpo) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new ErroWhatsApp('O WhatsApp ainda não foi configurado. Coloque o WHATSAPP_TOKEN no arquivo api/.env.');
  if (!phoneNumberId) throw new ErroWhatsApp('Cadastre o número do WhatsApp deste grupo em WhatsApp > Configurar.');
  const r = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => { throw new ErroWhatsApp('Não foi possível falar com o WhatsApp agora. Tente de novo.'); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const cod = d?.error?.code;
    if (cod === 131047 || cod === 131026) throw new ErroWhatsApp('O cliente não mandou mensagem nas últimas 24 horas. Pela regra do WhatsApp, só dá para responder dentro desse prazo (fora dele, só com modelo aprovado).');
    if (cod === 190) throw new ErroWhatsApp('O token do WhatsApp venceu ou está errado. Confira o WHATSAPP_TOKEN.');
    throw new ErroWhatsApp(`O WhatsApp recusou a mensagem${d?.error?.message ? `: ${d.error.message}` : '.'}`);
  }
  return d?.messages?.[0]?.id || null;
}

// Devolve { id_externo, status }
export async function enviarTexto(phoneNumberId, para, corpo) {
  if (provedor() === 'teste') return { id_externo: `teste-${crypto.randomUUID()}`, status: 'simulada' };
  const id = await chamarMeta(phoneNumberId, { to: para, type: 'text', text: { body: corpo, preview_url: false } });
  return { id_externo: id, status: 'enviada' };
}

async function enviarCodigo(phoneNumberId, para, codigo) {
  if (provedor() === 'teste') {
    // modo teste: o código aparece só no terminal da API (quem tem acesso ao servidor)
    console.log(`[WhatsApp modo teste] código de senha para ${para}: ${codigo}`);
    return;
  }
  await chamarMeta(phoneNumberId, {
    to: para, type: 'template',
    template: {
      name: process.env.WHATSAPP_MODELO_CODIGO || 'codigo_acesso',
      language: { code: process.env.WHATSAPP_IDIOMA || 'pt_BR' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: codigo }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: codigo }] },
      ],
    },
  });
}

// Grupo em que a pessoa mexe no WhatsApp: o único que ela tem, ou o escolhido no topo (master)
async function grupoDoWhatsApp(db, permissao) {
  const grupos = (await db.query(
    'select distinct l.empresa_id from lojas l where l.ativo and pode(l.id, $1) and (grupo_ativo() is null or l.empresa_id = grupo_ativo())',
    [permissao])).rows.map((r) => r.empresa_id);
  if (!grupos.length) throw new Recusa(403, 'Seu perfil não tem acesso ao WhatsApp.');
  if (grupos.length > 1) throw new Recusa(400, 'Escolha um grupo no topo da tela para ver o WhatsApp dele.');
  return grupos[0];
}

const podeEnviar = (db, empresa) =>
  db.query("select exists (select 1 from lojas l where l.empresa_id = $1 and pode(l.id, 'whatsapp.enviar')) as ok", [empresa]).then((r) => r.rows[0].ok);

export function rotasWhatsApp(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);
  const comErroZap = (fn) => comRecusa(async (req, res) => {
    try { await fn(req, res); } catch (e) { if (e instanceof ErroWhatsApp) throw new Recusa(502, e.message); throw e; }
  });

  // ------------------------------------------------------------ esqueci a senha (sem login)
  const tentativasIp = new Map();
  const limitarIp = (req) => {
    const agora = Date.now(), ip = req.ip;
    const lista = (tentativasIp.get(ip) || []).filter((t) => agora - t < 15 * 60 * 1000);
    if (lista.length >= 10) throw new Recusa(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
    lista.push(agora); tentativasIp.set(ip, lista);
  };

  app.post('/api/senha/codigo', comErroZap(async (req, res) => {
    limitarIp(req);
    const login = texto(req.body?.usuario, 120);
    if (!login) throw new Recusa(400, 'Informe seu e-mail ou usuário.');
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const destino = await comoUsuario(null, async (db) => (await db.query('select * from app_senha_pedir_codigo($1, $2)', [login, codigo])).rows[0]);
    if (destino) {
      try { await enviarCodigo(destino.phone_number_id, internacional(destino.telefone), codigo); } catch (e) { console.error('[senha]', e.message); }
    }
    // a resposta é sempre a mesma, para não revelar quem tem cadastro
    res.json({ ok: true });
  }));

  app.post('/api/senha/redefinir', comRecusa(async (req, res) => {
    limitarIp(req);
    const { usuario, codigo, senha } = req.body || {};
    if (!/^\d{6}$/.test(String(codigo || ''))) throw new Recusa(400, 'O código tem 6 números.');
    const ok = await comoUsuario(null, async (db) => (await db.query('select app_senha_redefinir($1, $2, $3) as ok', [usuario, codigo, senha])).rows[0].ok);
    if (!ok) throw new Recusa(400, 'Código errado ou vencido. Peça um código novo.');
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ webhook da Meta (sem login)
  app.get('/api/whatsapp/webhook', (req, res) => {
    const esperado = process.env.WHATSAPP_VERIFY_TOKEN;
    if (esperado && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === esperado) {
      return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
  });

  app.post('/api/whatsapp/webhook', rota(async (req, res) => {
    const segredo = process.env.WHATSAPP_APP_SECRET;
    const assinatura = String(req.headers['x-hub-signature-256'] || '');
    const esperada = segredo && req.corpoBruto ? `sha256=${crypto.createHmac('sha256', segredo).update(req.corpoBruto).digest('hex')}` : '';
    if (!esperada || assinatura.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) {
      return res.sendStatus(401);
    }
    const STATUS = { delivered: 'entregue', read: 'lida', failed: 'falhou' };
    await comoUsuario(null, async (db) => {
      for (const entrada of req.body?.entry || []) {
        for (const mudanca of entrada.changes || []) {
          const v = mudanca.value || {};
          const phoneId = v.metadata?.phone_number_id;
          const nomes = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
          for (const m of v.messages || []) {
            const corpo = m.type === 'text' ? m.text?.body
              : m.type === 'button' ? m.button?.text
              : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title)
              : `[${m.type === 'image' ? 'Imagem' : m.type === 'audio' ? 'Áudio' : m.type === 'document' ? 'Documento' : m.type === 'video' ? 'Vídeo' : m.type === 'location' ? 'Localização' : 'Mensagem'} recebida: abra no celular]`;
            await db.query('select app_whatsapp_receber($1, $2, $3, $4, $5, to_timestamp($6))',
              [phoneId, digitos(m.from), nomes[m.from] || null, String(corpo || '').slice(0, 4000), m.id, Number(m.timestamp) || Date.now() / 1000]);
          }
          for (const s of v.statuses || []) {
            if (STATUS[s.status]) await db.query('select app_whatsapp_status($1, $2, $3)', [s.id, STATUS[s.status], s.errors?.[0]?.title || null]);
          }
        }
      }
    });
    res.sendStatus(200);
  }));

  // ------------------------------------------------------------ situação e número do grupo
  app.get('/api/whatsapp/situacao', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      // o número de mentira do modo teste não conta como configurado
      const numero = (await db.query("select phone_number_id, numero, ativo from whatsapp_numeros where empresa_id = $1 and phone_number_id not like 'teste-%'", [empresa])).rows[0] || null;
      const master = (await db.query('select eh_admin_rede() as m')).rows[0].m;
      return { provedor: provedor(), token: Boolean(process.env.WHATSAPP_TOKEN), numero, master, pode_enviar: await podeEnviar(db, empresa) };
    }));
  }));

  app.put('/api/whatsapp/numero', exigeLogin, comRecusa(async (req, res) => {
    const phoneId = digitos(req.body?.phone_number_id);
    const numero = digitos(req.body?.numero) || null;
    await comoUsuario(req.usuarioId, async (db) => {
      if (!(await db.query('select eh_admin_rede() as m')).rows[0].m) throw new Recusa(403, 'Só o master configura o número do WhatsApp.');
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      if (!phoneId) { await db.query('delete from whatsapp_numeros where empresa_id = $1', [empresa]); return; }
      if (phoneId.length < 8) throw new Recusa(400, 'Confira o ID do número (Phone number ID) no painel da Meta.');
      if ((await db.query('select 1 from whatsapp_numeros where phone_number_id = $1 and empresa_id <> $2', [phoneId, empresa])).rowCount) {
        throw new Recusa(400, 'Este número já está ligado a outro grupo.');
      }
      await db.query(
        `insert into whatsapp_numeros (empresa_id, phone_number_id, numero) values ($1, $2, $3)
         on conflict (empresa_id) do update set phone_number_id = $2, numero = $3, ativo = true, atualizado_em = now()`, [empresa, phoneId, numero]);
    });
    res.json({ ok: true });
  }));

  // Modo teste: finge que um cliente mandou mensagem (para conhecer o módulo sem provedor)
  app.post('/api/whatsapp/simular', exigeLogin, comRecusa(async (req, res) => {
    if (provedor() !== 'teste') throw new Recusa(400, 'A simulação só funciona no modo teste.');
    const tel = internacional(req.body?.telefone);
    const corpo = texto(req.body?.texto, 4000);
    if (tel.length < 12 || !corpo) throw new Recusa(400, 'Informe o celular com DDD e a mensagem.');
    const contato = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.enviar');
      // no modo teste o grupo ganha um número de mentira, só para a simulação
      await db.query(`insert into whatsapp_numeros (empresa_id, phone_number_id, numero) values ($1, $2, null) on conflict (empresa_id) do nothing`,
        [empresa, `teste-${empresa}`]);
      const phoneId = (await db.query('select phone_number_id from whatsapp_numeros where empresa_id = $1', [empresa])).rows[0].phone_number_id;
      return (await db.query('select app_whatsapp_receber($1, $2, $3, $4, null, now()) as id',
        [phoneId, tel, texto(req.body?.nome, 80)?.toUpperCase() || null, corpo])).rows[0].id;
    });
    res.json({ contato_id: contato });
  }));

  // ------------------------------------------------------------ quadro de chamados
  app.get('/api/whatsapp/quadro', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      await db.query('select app_whatsapp_colunas_padrao($1)', [empresa]);
      const colunas = (await db.query('select id, nome, ordem, finaliza from whatsapp_colunas where empresa_id = $1 order by ordem, nome', [empresa])).rows;
      const chamados = (await db.query(
        `select h.id, h.coluna_id, h.titulo, h.ordem, h.aberto, h.criado_em, h.atualizado_em, h.responsavel_id, u.nome as responsavel,
                k.id as contato_id, coalesce(k.nome, k.telefone) as contato, k.telefone, k.nao_lidas, k.cliente_id, cl.nome as cliente,
                (select m.texto from whatsapp_conversa m where m.contato_id = k.id order by m.criado_em desc limit 1) as ultima
           from whatsapp_chamados h
           join whatsapp_contatos k on k.id = h.contato_id
           left join usuarios u on u.id = h.responsavel_id
           left join clientes cl on cl.id = k.cliente_id
          where h.empresa_id = $1 and (h.aberto or h.concluido_em > now() - interval '30 days')
          order by h.ordem, h.atualizado_em desc`, [empresa])).rows;
      const responsaveis = (await db.query('select * from app_responsaveis($1)', [empresa]).catch(() => ({ rows: [] }))).rows;
      return { empresa, colunas, chamados, responsaveis, pode_enviar: await podeEnviar(db, empresa) };
    }));
  }));

  const exigirEnvio = async (db, empresa) => {
    if (!(await podeEnviar(db, empresa))) throw new Recusa(403, 'Seu perfil só pode ver o WhatsApp.');
  };

  app.post('/api/whatsapp/colunas', exigeLogin, comRecusa(async (req, res) => {
    const nome = texto(req.body?.nome, 40)?.toUpperCase();
    if (!nome) throw new Recusa(400, 'Informe o nome da coluna.');
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      await exigirEnvio(db, empresa);
      if ((await db.query('select 1 from whatsapp_colunas where empresa_id = $1 and lower(nome) = lower($2)', [empresa, nome])).rowCount) {
        throw new Recusa(400, 'Já existe uma coluna com esse nome.');
      }
      // entra antes da coluna que conclui
      const ordem = (await db.query('select coalesce(max(ordem) filter (where not finaliza), 0) + 1 as o from whatsapp_colunas where empresa_id = $1', [empresa])).rows[0].o;
      await db.query('update whatsapp_colunas set ordem = ordem + 1 where empresa_id = $1 and ordem >= $2', [empresa, ordem]);
      return (await db.query('insert into whatsapp_colunas (empresa_id, nome, ordem) values ($1, $2, $3) returning id', [empresa, nome, ordem])).rows[0].id;
    });
    res.json({ id });
  }));

  app.put('/api/whatsapp/colunas/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Coluna não encontrada.');
    await comoUsuario(req.usuarioId, async (db) => {
      const col = (await db.query('select * from whatsapp_colunas where id = $1', [req.params.id])).rows[0];
      if (!col) throw new Recusa(404, 'Coluna não encontrada.');
      await exigirEnvio(db, col.empresa_id);
      const nome = texto(req.body?.nome, 40)?.toUpperCase() || col.nome;
      if ((await db.query('select 1 from whatsapp_colunas where empresa_id = $1 and lower(nome) = lower($2) and id <> $3', [col.empresa_id, nome, col.id])).rowCount) {
        throw new Recusa(400, 'Já existe uma coluna com esse nome.');
      }
      await db.query('update whatsapp_colunas set nome = $2 where id = $1', [col.id, nome]);
      // mover para a esquerda/direita: troca de lugar com a vizinha
      if (req.body?.mover === -1 || req.body?.mover === 1) {
        const viz = (await db.query(
          `select id, ordem from whatsapp_colunas where empresa_id = $1 and ${req.body.mover < 0 ? 'ordem < $2 order by ordem desc' : 'ordem > $2 order by ordem'} limit 1`,
          [col.empresa_id, col.ordem])).rows[0];
        if (viz) {
          await db.query('update whatsapp_colunas set ordem = $2 where id = $1', [col.id, viz.ordem]);
          await db.query('update whatsapp_colunas set ordem = $2 where id = $1', [viz.id, col.ordem]);
        }
      }
    });
    res.json({ ok: true });
  }));

  app.delete('/api/whatsapp/colunas/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Coluna não encontrada.');
    await comoUsuario(req.usuarioId, async (db) => {
      const col = (await db.query('select * from whatsapp_colunas where id = $1', [req.params.id])).rows[0];
      if (!col) throw new Recusa(404, 'Coluna não encontrada.');
      await exigirEnvio(db, col.empresa_id);
      if (col.finaliza) throw new Recusa(400, 'A coluna de concluídos não pode ser excluída (é ela que fecha os chamados).');
      if ((await db.query('select 1 from whatsapp_chamados where coluna_id = $1', [col.id])).rowCount) {
        throw new Recusa(400, 'Esta coluna tem chamados. Mova os chamados antes de excluir.');
      }
      if ((await db.query('select count(*)::int as n from whatsapp_colunas where empresa_id = $1 and not finaliza', [col.empresa_id])).rows[0].n <= 1) {
        throw new Recusa(400, 'O quadro precisa de pelo menos uma coluna de chamados abertos.');
      }
      await db.query('delete from whatsapp_colunas where id = $1', [col.id]);
    });
    res.json({ ok: true });
  }));

  // Chamado novo pelo atendente (ex.: cliente ligou ou veio na loja)
  app.post('/api/whatsapp/chamados', exigeLogin, comRecusa(async (req, res) => {
    const tel = internacional(req.body?.telefone);
    if (tel.length < 12) throw new Recusa(400, 'Informe o celular com DDD.');
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      await exigirEnvio(db, empresa);
      const contato = (await db.query(
        `insert into whatsapp_contatos (empresa_id, telefone, nome) values ($1, $2, $3)
         on conflict (empresa_id, telefone) do update set nome = coalesce(excluded.nome, whatsapp_contatos.nome) returning id`,
        [empresa, tel, texto(req.body?.nome, 80)?.toUpperCase() || null])).rows[0].id;
      const ch = (await db.query('select app_whatsapp_chamado_do_contato($1, $2, $3) as id', [empresa, contato, req.usuarioId])).rows[0].id;
      const titulo = texto(req.body?.titulo, 120)?.toUpperCase();
      if (titulo) await db.query('update whatsapp_chamados set titulo = $2 where id = $1', [ch, titulo]);
      return ch;
    });
    res.json({ id });
  }));

  app.put('/api/whatsapp/chamados/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Chamado não encontrado.');
    const b = req.body || {};
    await comoUsuario(req.usuarioId, async (db) => {
      const ch = (await db.query('select * from whatsapp_chamados where id = $1', [req.params.id])).rows[0];
      if (!ch) throw new Recusa(404, 'Chamado não encontrado.');
      await exigirEnvio(db, ch.empresa_id);
      let { coluna_id: coluna, aberto, concluido_em: concluido } = ch;
      if (UUID.test(b.coluna_id || '') && b.coluna_id !== ch.coluna_id) {
        const col = (await db.query('select id, finaliza from whatsapp_colunas where id = $1 and empresa_id = $2', [b.coluna_id, ch.empresa_id])).rows[0];
        if (!col) throw new Recusa(400, 'Coluna não encontrada.');
        // reabrir um concluído: se o contato já tem outro chamado aberto, não deixa ter dois
        if (!col.finaliza && !ch.aberto && (await db.query('select 1 from whatsapp_chamados where contato_id = $1 and aberto and id <> $2', [ch.contato_id, ch.id])).rowCount) {
          throw new Recusa(400, 'Este contato já tem outro chamado aberto.');
        }
        coluna = col.id; aberto = !col.finaliza; concluido = col.finaliza ? new Date() : null;
      }
      const ordem = Number.isFinite(Number(b.ordem)) && b.ordem !== null && b.ordem !== '' ? Number(b.ordem) : ch.ordem;
      const titulo = 'titulo' in b ? texto(b.titulo, 120)?.toUpperCase() || null : ch.titulo;
      const resp = 'responsavel_id' in b ? (UUID.test(b.responsavel_id || '') ? b.responsavel_id : null) : ch.responsavel_id;
      await db.query(
        `update whatsapp_chamados set coluna_id = $2, aberto = $3, concluido_em = $4, ordem = $5, titulo = $6, responsavel_id = $7, atualizado_em = now()
          where id = $1`, [ch.id, coluna, aberto, concluido, ordem, titulo, resp]);
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ conversas
  app.get('/api/whatsapp/contatos', exigeLogin, comRecusa(async (req, res) => {
    const busca = texto(req.query.busca, 60);
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      return (await db.query(
        `select k.id, coalesce(k.nome, k.telefone) as nome, k.telefone, k.nao_lidas, k.ultima_em, k.cliente_id, c.nome as cliente,
                (select m.texto from whatsapp_conversa m where m.contato_id = k.id order by m.criado_em desc limit 1) as ultima
           from whatsapp_contatos k left join clientes c on c.id = k.cliente_id
          where k.empresa_id = $1
            and ($2::text is null or k.nome ilike '%' || $2 || '%' or c.nome ilike '%' || $2 || '%'
                 or (regexp_replace($2, '\\D', '', 'g') <> '' and k.telefone like '%' || regexp_replace($2, '\\D', '', 'g') || '%'))
          order by k.ultima_em desc nulls last, k.criado_em desc limit 200`, [empresa, busca])).rows;
    }));
  }));

  app.get('/api/whatsapp/contatos/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Conversa não encontrada.');
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const k = (await db.query(
        `select k.id, k.empresa_id, k.nome, k.telefone, k.cliente_id, c.nome as cliente, c.cpf_cnpj
           from whatsapp_contatos k left join clientes c on c.id = k.cliente_id where k.id = $1`, [req.params.id])).rows[0];
      if (!k) throw new Recusa(404, 'Conversa não encontrada.');
      const ve = (await db.query("select exists (select 1 from lojas l where l.empresa_id = $1 and pode(l.id, 'whatsapp.ver')) as ok", [k.empresa_id])).rows[0].ok;
      if (!ve) throw new Recusa(403, 'Seu perfil não tem acesso ao WhatsApp.');
      const mensagens = (await db.query(
        `select m.id, m.direcao, m.texto, m.status, m.erro, m.criado_em, u.nome as enviado_por
           from whatsapp_conversa m left join usuarios u on u.id = m.enviado_por
          where m.contato_id = $1 order by m.criado_em desc limit 300`, [k.id])).rows.reverse();
      const chamado = (await db.query(
        `select h.id, h.coluna_id, h.titulo, h.responsavel_id, h.aberto from whatsapp_chamados h
          where h.contato_id = $1 order by h.aberto desc, h.criado_em desc limit 1`, [k.id])).rows[0] || null;
      if (req.query.ler === '1') await db.query('update whatsapp_contatos set nao_lidas = 0 where id = $1', [k.id]);
      return { ...k, mensagens, chamado, pode_enviar: await podeEnviar(db, k.empresa_id) };
    }));
  }));

  // Nome do contato e ligação com o cadastro de clientes
  app.put('/api/whatsapp/contatos/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Conversa não encontrada.');
    await comoUsuario(req.usuarioId, async (db) => {
      const k = (await db.query('select * from whatsapp_contatos where id = $1', [req.params.id])).rows[0];
      if (!k) throw new Recusa(404, 'Conversa não encontrada.');
      await exigirEnvio(db, k.empresa_id);
      const cliente = 'cliente_id' in (req.body || {}) ? (UUID.test(req.body.cliente_id || '') ? req.body.cliente_id : null) : k.cliente_id;
      if (cliente && !(await db.query('select 1 from clientes where id = $1 and empresa_id = $2', [cliente, k.empresa_id])).rowCount) {
        throw new Recusa(400, 'Cliente não encontrado neste grupo.');
      }
      const nome = 'nome' in (req.body || {}) ? texto(req.body.nome, 80)?.toUpperCase() || null : k.nome;
      await db.query('update whatsapp_contatos set nome = $2, cliente_id = $3 where id = $1', [k.id, nome, cliente]);
    });
    res.json({ ok: true });
  }));

  app.post('/api/whatsapp/contatos/:id/mensagens', exigeLogin, comErroZap(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Conversa não encontrada.');
    const corpo = texto(req.body?.texto, 4000);
    if (!corpo) throw new Recusa(400, 'Escreva a mensagem.');
    // 1) confere e pega o número; 2) envia fora da transação; 3) grava o resultado
    const k = await comoUsuario(req.usuarioId, async (db) => {
      const c = (await db.query(
        `select k.*, n.phone_number_id from whatsapp_contatos k left join whatsapp_numeros n on n.empresa_id = k.empresa_id and n.ativo
          where k.id = $1`, [req.params.id])).rows[0];
      if (!c) throw new Recusa(404, 'Conversa não encontrada.');
      await exigirEnvio(db, c.empresa_id);
      return c;
    });
    let envio, falha = null;
    try { envio = await enviarTexto(k.phone_number_id, k.telefone, corpo); } catch (e) { falha = e; }
    const msg = await comoUsuario(req.usuarioId, async (db) => {
      const ch = (await db.query('select app_whatsapp_chamado_do_contato($1, $2, $3) as id', [k.empresa_id, k.id, req.usuarioId])).rows[0].id;
      await db.query('update whatsapp_chamados set atualizado_em = now(), responsavel_id = coalesce(responsavel_id, $2) where id = $1', [ch, req.usuarioId]);
      await db.query('update whatsapp_contatos set ultima_em = now(), nao_lidas = 0 where id = $1', [k.id]);
      return (await db.query(
        `insert into whatsapp_conversa (empresa_id, contato_id, chamado_id, direcao, texto, status, erro, id_externo, enviado_por)
         values ($1, $2, $3, 'saida', $4, $5, $6, $7, $8) returning id, status`,
        [k.empresa_id, k.id, ch, corpo, falha ? 'falhou' : envio.status, falha?.message || null, envio?.id_externo || null, req.usuarioId])).rows[0];
    });
    if (falha) throw falha;
    res.json(msg);
  }));
}
