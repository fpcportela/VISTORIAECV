import crypto from 'node:crypto';
import express from 'express';
import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, texto } from './comum.js';
import { BLOCOS, CAMPOS, ROBO_PADRAO, atenderComRobo, esquecerConhecimento, fluxoDe, iaDisponivel, normalizarFluxo } from './robo.js';

// Módulo WhatsApp: conversas, chamados em kanban e o código de "Esqueci a senha".
// O envio usa a API oficial da Meta (WhatsApp Cloud API). As chaves ficam só no
// servidor (api/.env), nunca no app:
//   WHATSAPP_PROVEDOR=meta          (sem isso fica no modo teste: nada sai de verdade)
//   WHATSAPP_TOKEN=...              token permanente do usuário do sistema no Meta Business
//   WHATSAPP_APP_SECRET=...         chave secreta do app (confere se o webhook veio mesmo da Meta)
//   WHATSAPP_VERIFY_TOKEN=...       senha que você inventa e repete no cadastro do webhook
//   WHATSAPP_MODELO_CODIGO=codigo_acesso   modelo de autenticação aprovado (código da senha)
// O número de cada grupo (phone_number_id) é cadastrado na tela WhatsApp > Configurar.
//
// Opção sem a Meta (não oficial, por QR code): a Evolution API, que roda no Docker ao lado do banco.
//   WHATSAPP_PROVEDOR=evolution
//   EVOLUTION_URL=http://localhost:8080
//   EVOLUTION_API_KEY=...           a mesma chave do serviço da Evolution (docker-compose)
//   EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3001/api/whatsapp/evolution
// Cada grupo vira uma "instância" da Evolution; o celular é ligado lendo o QR code em WhatsApp > Configurar.

const provedor = () => (['meta', 'evolution'].includes(process.env.WHATSAPP_PROVEDOR) ? process.env.WHATSAPP_PROVEDOR : 'teste');
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

// ------------------------------------------------------------ Evolution API (QR code)
const EVO = () => (process.env.EVOLUTION_URL || 'http://localhost:8080').replace(/\/+$/, '');
const instanciaDoGrupo = (empresa) => `vistoria-${empresa}`;
// Senha que a Evolution manda no cabeçalho do webhook (vem da própria chave, sem outra configuração)
const chaveWebhook = () => crypto.createHash('sha256').update(`webhook:${process.env.EVOLUTION_API_KEY || ''}`).digest('hex');

function textoErroEvo(d) {
  const m = d?.response?.message ?? d?.message ?? d?.error;
  const lista = Array.isArray(m) ? m : [m];
  if (lista.some((x) => x && typeof x === 'object' && x.exists === false)) return 'este número não tem WhatsApp';
  return lista.map((x) => (typeof x === 'string' ? x : x ? JSON.stringify(x) : '')).filter(Boolean).join('; ') || 'erro desconhecido';
}

async function chamarEvolution(caminho, { metodo = 'GET', corpo } = {}) {
  const chave = process.env.EVOLUTION_API_KEY;
  if (!chave) throw new ErroWhatsApp('O WhatsApp por QR code ainda não foi configurado. Coloque a EVOLUTION_API_KEY no arquivo api/.env.');
  const r = await fetch(`${EVO()}${caminho}`, {
    method: metodo,
    headers: { apikey: chave, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30000),
  }).catch(() => { throw new ErroWhatsApp('O serviço do WhatsApp (Evolution) não está ligado. No Mac, rode: npm run whatsapp:ligar'); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new ErroWhatsApp(`O WhatsApp recusou: ${textoErroEvo(d)}.`);
    e.status = r.status;
    throw e;
  }
  return d;
}

async function enviarEvolution(instancia, caminho, corpo) {
  if (!instancia) throw new ErroWhatsApp('Ligue o WhatsApp deste grupo em WhatsApp > Configurar (ler o QR code).');
  const d = await chamarEvolution(`/message/${caminho}/${encodeURIComponent(instancia)}`, { metodo: 'POST', corpo });
  return { id_externo: d?.key?.id || null, status: 'enviada' };
}

// Situação da instância do grupo: sem_instancia | close | connecting | open
async function estadoEvolution(instancia) {
  try {
    const d = await chamarEvolution(`/instance/connectionState/${encodeURIComponent(instancia)}`);
    return d?.instance?.state || d?.state || 'close';
  } catch (e) {
    if (e.status === 404) return 'sem_instancia';
    throw e;
  }
}

async function prepararInstancia(instancia) {
  const webhook = {
    enabled: true,
    url: process.env.EVOLUTION_WEBHOOK_URL || 'http://host.docker.internal:3001/api/whatsapp/evolution',
    headers: { 'x-vistoria-chave': chaveWebhook() },
    byEvents: false,
    base64: false,
    events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
  };
  if ((await estadoEvolution(instancia)) === 'sem_instancia') {
    await chamarEvolution('/instance/create', {
      metodo: 'POST',
      corpo: { instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, rejectCall: false, alwaysOnline: false, readMessages: false, webhook },
    });
  } else {
    // confere o endereço do webhook a cada ligação (pode ter mudado no .env)
    await chamarEvolution(`/webhook/set/${encodeURIComponent(instancia)}`, { metodo: 'POST', corpo: { webhook } });
  }
}

// Devolve { id_externo, status }
export async function enviarTexto(phoneNumberId, para, corpo) {
  if (provedor() === 'teste') return { id_externo: `teste-${crypto.randomUUID()}`, status: 'simulada' };
  if (provedor() === 'evolution') return enviarEvolution(phoneNumberId, 'sendText', { number: para, text: corpo });
  const id = await chamarMeta(phoneNumberId, { to: para, type: 'text', text: { body: corpo, preview_url: false } });
  return { id_externo: id, status: 'enviada' };
}

// Documento (PDF) por modelo aprovado: serve para mandar a quem não falou com a loja nas últimas
// 24 horas (ex.: comprovante do ponto). O modelo precisa ter cabeçalho de DOCUMENTO e o corpo com
// {{1}} = nome e {{2}} = data. Devolve { id_externo, status }.
//   WHATSAPP_MODELO_PONTO=comprovante_ponto
export async function enviarDocumento(phoneNumberId, para, { bytes, nome, mime = 'application/pdf', parametros = [], legenda }) {
  if (provedor() === 'teste') {
    console.log(`[WhatsApp modo teste] documento ${nome} (${bytes.length} bytes) para ${para}`);
    return { id_externo: `teste-${crypto.randomUUID()}`, status: 'simulada' };
  }
  if (provedor() === 'evolution') {
    // sem modelo aprovado: o arquivo vai direto, com a legenda
    return enviarEvolution(phoneNumberId, 'sendMedia', {
      number: para, mediatype: 'document', mimetype: mime, fileName: nome, caption: legenda || nome, media: Buffer.from(bytes).toString('base64'),
    });
  }
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new ErroWhatsApp('O WhatsApp ainda não foi configurado. Coloque o WHATSAPP_TOKEN no arquivo api/.env.');
  if (!phoneNumberId) throw new ErroWhatsApp('Cadastre o número do WhatsApp deste grupo em WhatsApp > Configurar.');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([bytes], { type: mime }), nome);
  const up = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(30000),
  }).catch(() => { throw new ErroWhatsApp('Não foi possível enviar o arquivo ao WhatsApp agora.'); });
  const midia = await up.json().catch(() => ({}));
  if (!up.ok || !midia.id) throw new ErroWhatsApp(`O WhatsApp recusou o arquivo${midia?.error?.message ? `: ${midia.error.message}` : '.'}`);
  const id = await chamarMeta(phoneNumberId, {
    to: para, type: 'template',
    template: {
      name: process.env.WHATSAPP_MODELO_PONTO || 'comprovante_ponto',
      language: { code: process.env.WHATSAPP_IDIOMA || 'pt_BR' },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: midia.id, filename: nome } }] },
        ...(parametros.length ? [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: String(t) })) }] : []),
      ],
    },
  });
  return { id_externo: id, status: 'enviada' };
}

// Número de WhatsApp do grupo da loja (para mensagens que não são de uma conversa)
export const numeroDoGrupo = async (db, loja) =>
  (await db.query('select n.phone_number_id from whatsapp_numeros n join lojas l on l.empresa_id = n.empresa_id where l.id = $1 and n.ativo', [loja])).rows[0]?.phone_number_id || null;

async function enviarCodigo(phoneNumberId, para, codigo) {
  if (provedor() === 'teste') {
    // modo teste: o código aparece só no terminal da API (quem tem acesso ao servidor)
    console.log(`[WhatsApp modo teste] código de senha para ${para}: ${codigo}`);
    return;
  }
  if (provedor() === 'evolution') {
    await enviarEvolution(phoneNumberId, 'sendText', {
      number: para, text: `Seu código para trocar a senha do Vistoria ECV é *${codigo}*. Ele vale por 15 minutos. Não passe este código para ninguém.`,
    });
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
    const recebidos = new Set();
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
            const c = (await db.query('select app_whatsapp_receber($1, $2, $3, $4, $5, to_timestamp($6)) as id',
              [phoneId, digitos(m.from), nomes[m.from] || null, String(corpo || '').slice(0, 4000), m.id, Number(m.timestamp) || Date.now() / 1000])).rows[0].id;
            if (c) recebidos.add(c);
          }
          for (const s of v.statuses || []) {
            if (STATUS[s.status]) await db.query('select app_whatsapp_status($1, $2, $3)', [s.id, STATUS[s.status], s.errors?.[0]?.title || null]);
          }
        }
      }
    });
    res.sendStatus(200);
    // o robô responde depois (a Meta quer o 200 rápido)
    for (const c of recebidos) atenderComRobo(c, { enviarTexto, nacional });
  }));

  // ------------------------------------------------------------ webhook da Evolution (sem login)
  const TIPOS_EVO = {
    imageMessage: 'Imagem', audioMessage: 'Áudio', documentMessage: 'Documento', documentWithCaptionMessage: 'Documento',
    videoMessage: 'Vídeo', locationMessage: 'Localização', stickerMessage: 'Figurinha', contactMessage: 'Contato',
  };
  const STATUS_EVO = { DELIVERY_ACK: 'entregue', READ: 'lida', PLAYED: 'lida', ERROR: 'falhou' };
  app.post('/api/whatsapp/evolution', rota(async (req, res) => {
    const recebida = String(req.headers['x-vistoria-chave'] || '');
    const esperada = process.env.EVOLUTION_API_KEY ? chaveWebhook() : '';
    if (!esperada || recebida.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada))) {
      return res.sendStatus(401);
    }
    const { event, instance, data } = req.body || {};
    const lista = Array.isArray(data) ? data : data ? [data] : [];
    const recebidos = new Set();
    await comoUsuario(null, async (db) => {
      if (event === 'messages.upsert') {
        for (const m of lista) {
          const jid = String(m?.key?.remoteJid || '');
          // só conversas de pessoas (sem grupos, status e o que a própria loja mandou)
          if (m?.key?.fromMe || !jid.endsWith('@s.whatsapp.net')) continue;
          const msg = m.message || {};
          const corpo = msg.conversation || msg.extendedTextMessage?.text
            || msg.buttonsResponseMessage?.selectedDisplayText || msg.listResponseMessage?.title
            || msg.imageMessage?.caption || msg.videoMessage?.caption
            || `[${TIPOS_EVO[m.messageType] || 'Mensagem'} recebida: abra no celular]`;
          const c = (await db.query('select app_whatsapp_receber($1, $2, $3, $4, $5, to_timestamp($6)) as id',
            [instance, digitos(jid.split('@')[0]), m.pushName || null, String(corpo).slice(0, 4000), m.key.id || null,
              Number(m.messageTimestamp) || Date.now() / 1000])).rows[0].id;
          if (c) recebidos.add(c);
        }
      } else if (event === 'messages.update') {
        for (const s of lista) {
          const st = STATUS_EVO[s?.status];
          if (st && (s.keyId || s.messageId)) await db.query('select app_whatsapp_status($1, $2, null)', [s.keyId || s.messageId, st]);
        }
      }
    });
    res.sendStatus(200);
    for (const c of recebidos) atenderComRobo(c, { enviarTexto, nacional });
  }));

  // ------------------------------------------------------------ ligar o celular por QR code (Evolution)
  const grupoDoMaster = async (db) => {
    if (!(await db.query('select eh_admin_rede() as m')).rows[0].m) throw new Recusa(403, 'Só o master liga o WhatsApp do grupo.');
    return grupoDoWhatsApp(db, 'whatsapp.ver');
  };
  const exigirEvolution = () => {
    if (provedor() !== 'evolution') throw new Recusa(400, 'O WhatsApp por QR code não está ativo. Coloque WHATSAPP_PROVEDOR=evolution no api/.env.');
  };

  app.get('/api/whatsapp/evolution/estado', exigeLogin, comErroZap(async (req, res) => {
    exigirEvolution();
    const empresa = await comoUsuario(req.usuarioId, (db) => grupoDoWhatsApp(db, 'whatsapp.ver'));
    const instancia = instanciaDoGrupo(empresa);
    const estado = await estadoEvolution(instancia);
    let numero = null, nome = null;
    if (estado === 'open') {
      const d = await chamarEvolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`).catch(() => null);
      const i = Array.isArray(d) ? d[0] : d;
      numero = digitos(String(i?.ownerJid || i?.instance?.owner || '').split('@')[0]) || null;
      nome = i?.profileName || i?.instance?.profileName || null;
      if (numero) {
        await comoUsuario(req.usuarioId, (db) => db.query(
          'update whatsapp_numeros set numero = $2, atualizado_em = now() where phone_number_id = $1 and numero is distinct from $2', [instancia, numero]));
      }
    }
    res.json({ estado, numero, nome });
  }));

  app.post('/api/whatsapp/evolution/conectar', exigeLogin, comErroZap(async (req, res) => {
    exigirEvolution();
    const empresa = await comoUsuario(req.usuarioId, async (db) => {
      const e = await grupoDoMaster(db);
      const instancia = instanciaDoGrupo(e);
      if ((await db.query('select 1 from whatsapp_numeros where phone_number_id = $1 and empresa_id <> $2', [instancia, e])).rowCount) {
        throw new Recusa(400, 'Este número já está ligado a outro grupo.');
      }
      await db.query(
        `insert into whatsapp_numeros (empresa_id, phone_number_id, numero) values ($1, $2, null)
         on conflict (empresa_id) do update set phone_number_id = $2, ativo = true, atualizado_em = now()`, [e, instancia]);
      return e;
    });
    const instancia = instanciaDoGrupo(empresa);
    await prepararInstancia(instancia);
    if ((await estadoEvolution(instancia)) === 'open') return res.json({ estado: 'open' });
    const d = await chamarEvolution(`/instance/connect/${encodeURIComponent(instancia)}`);
    res.json({ estado: 'connecting', qr: d?.base64 || null, codigo: d?.pairingCode || null });
  }));

  app.post('/api/whatsapp/evolution/desconectar', exigeLogin, comErroZap(async (req, res) => {
    exigirEvolution();
    const empresa = await comoUsuario(req.usuarioId, grupoDoMaster);
    await chamarEvolution(`/instance/logout/${encodeURIComponent(instanciaDoGrupo(empresa))}`, { metodo: 'DELETE' }).catch((e) => {
      if (e.status !== 404 && e.status !== 400) throw e;
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ números da barra lateral
  // Conversas com mensagem não lida e chamados em aberto (do grupo escolhido, ou de todos que a pessoa vê)
  app.get('/api/whatsapp/contadores', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select (select count(*)::int from whatsapp_contatos k
                where k.nao_lidas > 0 and (grupo_ativo() is null or k.empresa_id = grupo_ativo())
                  and exists (select 1 from lojas l where l.empresa_id = k.empresa_id and pode(l.id, 'whatsapp.ver'))) as nao_lidas,
              (select count(*)::int from whatsapp_chamados h
                where h.aberto and (grupo_ativo() is null or h.empresa_id = grupo_ativo())
                  and exists (select 1 from lojas l where l.empresa_id = h.empresa_id and pode(l.id, 'whatsapp.ver'))) as abertos`)).rows[0]));
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
    await atenderComRobo(contato, { enviarTexto, nacional });
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
                h.robo_estado, h.venda_id, (select v.numero from vendas v where v.id = h.venda_id) as venda_numero,
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

  // ------------------------------------------------------------ robô de atendimento
  app.get('/api/whatsapp/robo', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      const salvo = (await db.query('select * from whatsapp_robo where empresa_id = $1', [empresa])).rows[0];
      const g = (await db.query('select ia_liberada, eh_admin_rede() as master from empresas where id = $1', [empresa])).rows[0];
      const lojas = (await db.query('select id, nome from lojas where empresa_id = $1 and ativo order by nome', [empresa])).rows;
      const servicos = (await db.query('select id, nome from servicos where empresa_id = $1 and ativo order by nome', [empresa])).rows;
      const usuarios = (await db.query('select * from app_responsaveis($1)', [empresa])).rows;
      const robo = { ...ROBO_PADRAO, ...(salvo || {}) };
      return {
        robo: { ...robo, fluxo: fluxoDe(robo) }, campos: CAMPOS, blocos: BLOCOS, lojas, servicos, usuarios,
        ia_liberada: g.ia_liberada, ia_configurada: iaDisponivel(), master: g.master, pode_enviar: await podeEnviar(db, empresa),
      };
    }));
  }));

  app.put('/api/whatsapp/robo', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const etapas = (Array.isArray(b.etapas) ? b.etapas : []).slice(0, 20).map((e) => ({
      campo: CAMPOS[e?.campo] ? e.campo : 'livre',
      pergunta: texto(e?.pergunta, 500) || '',
      obrigatorio: Boolean(e?.obrigatorio),
    }));
    if (etapas.some((e) => !e.pergunta)) throw new Recusa(400, 'Escreva a pergunta de cada etapa.');
    // fluxo em blocos (a tela nova sempre manda); as perguntas dele também ficam em "etapas"
    let fluxo = null;
    if (b.fluxo !== undefined) {
      const r = normalizarFluxo(b.fluxo);
      if (r.erro) throw new Recusa(400, r.erro);
      fluxo = r.fluxo;
      etapas.splice(0, etapas.length, ...fluxo.filter((x) => x.tipo === 'pergunta').map((x) => ({ campo: x.campo, pergunta: x.texto, obrigatorio: x.obrigatorio })));
    }
    await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      await exigirEnvio(db, empresa);
      const ia = (await db.query('select ia_liberada from empresas where id = $1', [empresa])).rows[0].ia_liberada;
      const usaIA = fluxo ? fluxo.some((x) => x.tipo === 'ia') : Boolean(b.ia_ativa);
      if (usaIA && !ia) throw new Recusa(403, 'A IA ainda não foi liberada para este grupo. Tire o bloco "Conversa com IA" ou fale com o master (depende do contrato).');
      const loja = UUID.test(b.loja_id || '') && (await db.query('select 1 from lojas where id = $1 and empresa_id = $2', [b.loja_id, empresa])).rowCount ? b.loja_id : null;
      const servico = UUID.test(b.servico_id || '') && (await db.query('select 1 from servicos where id = $1 and empresa_id = $2', [b.servico_id, empresa])).rowCount ? b.servico_id : null;
      // responsável pelos chamados do robô: padrão e por unidade (só usuários do grupo)
      const doGrupo = new Set((await db.query('select id from app_responsaveis($1)', [empresa])).rows.map((u) => u.id));
      const lojasGrupo = new Set((await db.query('select id from lojas where empresa_id = $1', [empresa])).rows.map((l) => l.id));
      const responsavel = doGrupo.has(b.responsavel_id) ? b.responsavel_id : null;
      const responsaveis = Object.fromEntries(Object.entries(b.responsaveis && typeof b.responsaveis === 'object' ? b.responsaveis : {})
        .filter(([l, u]) => lojasGrupo.has(l) && doGrupo.has(u)));
      await db.query(
        `insert into whatsapp_robo (empresa_id, ativo, saudacao, etapas, mensagem_final, loja_id, servico_id, ia_ativa, ia_instrucoes, fluxo,
                                    responsavel_id, responsaveis, atualizado_em)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
         on conflict (empresa_id) do update set ativo = $2, saudacao = $3, etapas = $4, mensagem_final = $5, loja_id = $6,
                servico_id = $7, ia_ativa = $8, ia_instrucoes = $9, fluxo = coalesce($10, whatsapp_robo.fluxo),
                responsavel_id = $11, responsaveis = $12, atualizado_em = now()`,
        [empresa, Boolean(b.ativo), texto(b.saudacao, 1000), JSON.stringify(etapas), texto(b.mensagem_final, 1000),
         loja, servico, usaIA && ia, texto(b.ia_instrucoes, 30000), fluxo && JSON.stringify(fluxo), responsavel, JSON.stringify(responsaveis)]);
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ base de conhecimento da IA
  // Textos digitados e arquivos (PDF ou TXT) que a IA do robô consulta para responder
  const MAX_DOC = 10 * 1024 * 1024, MAX_BASE = 30 * 1024 * 1024;
  const docDoGrupo = async (db, id) => {
    if (!UUID.test(id || '')) throw new Recusa(404, 'Documento não encontrado.');
    const k = (await db.query('select id, empresa_id from whatsapp_conhecimento where id = $1', [id])).rows[0];
    if (!k) throw new Recusa(404, 'Documento não encontrado.');
    return k;
  };
  const caberNaBase = async (db, empresa, mais) => {
    const usado = Number((await db.query('select coalesce(sum(tamanho), 0) as t from whatsapp_conhecimento where empresa_id = $1', [empresa])).rows[0].t);
    if (usado + mais > MAX_BASE) throw new Recusa(400, 'A base de conhecimento passou de 30 MB. Tire algum documento antes.');
  };

  app.get('/api/whatsapp/conhecimento', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      return (await db.query(
        `select id, titulo, tipo, case when tipo = 'texto' then conteudo end as conteudo, nome_arquivo, tamanho, ativo, criado_em
           from whatsapp_conhecimento where empresa_id = $1 order by criado_em`, [empresa])).rows;
    }));
  }));

  app.post('/api/whatsapp/conhecimento', exigeLogin, comRecusa(async (req, res) => {
    const titulo = texto(req.body?.titulo, 120);
    const conteudo = texto(req.body?.conteudo, 200000);
    if (!titulo || !conteudo) throw new Recusa(400, 'Dê um título e escreva o texto.');
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      await exigirEnvio(db, empresa);
      const tam = Buffer.byteLength(conteudo);
      await caberNaBase(db, empresa, tam);
      esquecerConhecimento(empresa);
      return (await db.query(
        `insert into whatsapp_conhecimento (empresa_id, titulo, tipo, conteudo, tamanho, criado_por)
         values ($1, $2, 'texto', $3, $4, $5) returning id`, [empresa, titulo, conteudo, tam, req.usuarioId])).rows[0].id;
    });
    res.json({ id });
  }));

  // O corpo é o próprio arquivo; título e nome do arquivo vão na URL
  app.post('/api/whatsapp/conhecimento/arquivo', exigeLogin, express.raw({ type: () => true, limit: MAX_DOC }), comRecusa(async (req, res) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Recusa(400, 'Escolha o arquivo.');
    const arquivo = texto(req.query.arquivo, 150) || 'arquivo';
    const titulo = texto(req.query.titulo, 120) || arquivo.replace(/\.[^.]+$/, '');
    const pdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    const ehTexto = /\.(txt|md|csv)$/i.test(arquivo);
    if (!pdf && !ehTexto) throw new Recusa(400, 'Envie PDF ou TXT. Documento do Word: salve como PDF antes de enviar.');
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      await exigirEnvio(db, empresa);
      await caberNaBase(db, empresa, bytes.length);
      esquecerConhecimento(empresa);
      return (await db.query(
        `insert into whatsapp_conhecimento (empresa_id, titulo, tipo, conteudo, arquivo, nome_arquivo, tamanho, criado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [empresa, titulo, pdf ? 'pdf' : 'texto', pdf ? null : bytes.toString('utf8').replace(/\u0000/g, ''), pdf ? bytes : null, arquivo,
         bytes.length, req.usuarioId])).rows[0].id;
    });
    res.json({ id });
  }));

  app.get('/api/whatsapp/conhecimento/:id/arquivo', exigeLogin, comRecusa(async (req, res) => {
    const k = await comoUsuario(req.usuarioId, async (db) => {
      await docDoGrupo(db, req.params.id);
      return (await db.query('select titulo, tipo, conteudo, arquivo, nome_arquivo from whatsapp_conhecimento where id = $1', [req.params.id])).rows[0];
    });
    const nome = k.nome_arquivo || `${k.titulo}.${k.tipo === 'pdf' ? 'pdf' : 'txt'}`;
    res.set('Content-Type', k.tipo === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.send(k.tipo === 'pdf' ? k.arquivo : k.conteudo);
  }));

  app.put('/api/whatsapp/conhecimento/:id', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    await comoUsuario(req.usuarioId, async (db) => {
      const k = await docDoGrupo(db, req.params.id);
      await exigirEnvio(db, k.empresa_id);
      const titulo = texto(b.titulo, 120);
      if ('titulo' in b && !titulo) throw new Recusa(400, 'Dê um título ao documento.');
      const conteudo = 'conteudo' in b ? texto(b.conteudo, 200000) : null;
      if ('conteudo' in b && !conteudo) throw new Recusa(400, 'O texto não pode ficar vazio.');
      await db.query(
        `update whatsapp_conhecimento set titulo = coalesce($2, titulo), ativo = coalesce($3, ativo),
                conteudo = case when tipo = 'texto' and $4::text is not null then $4 else conteudo end,
                tamanho = case when tipo = 'texto' and $4::text is not null then octet_length($4) else tamanho end,
                atualizado_em = now()
          where id = $1`, [k.id, titulo, typeof b.ativo === 'boolean' ? b.ativo : null, conteudo]);
      esquecerConhecimento(k.empresa_id);
    });
    res.json({ ok: true });
  }));

  app.delete('/api/whatsapp/conhecimento/:id', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const k = await docDoGrupo(db, req.params.id);
      await exigirEnvio(db, k.empresa_id);
      await db.query('delete from whatsapp_conhecimento where id = $1', [k.id]);
      esquecerConhecimento(k.empresa_id);
    });
    res.json({ ok: true });
  }));

  // Liberar a IA para o grupo: só o master (depende do contrato de prestação)
  app.put('/api/whatsapp/robo/ia', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      if (!(await db.query('select eh_admin_rede() as m')).rows[0].m) throw new Recusa(403, 'Só o master libera a IA.');
      const empresa = await grupoDoWhatsApp(db, 'whatsapp.ver');
      const liberada = Boolean(req.body?.liberada);
      await db.query('update empresas set ia_liberada = $2 where id = $1', [empresa, liberada]);
      if (!liberada) await db.query('update whatsapp_robo set ia_ativa = false where empresa_id = $1', [empresa]);
    });
    res.json({ ok: true });
  }));

  // Atendente assume a conversa (o robô para) ou devolve para o robô continuar
  app.post('/api/whatsapp/chamados/:id/robo', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Chamado não encontrado.');
    await comoUsuario(req.usuarioId, async (db) => {
      const ch = (await db.query('select * from whatsapp_chamados where id = $1', [req.params.id])).rows[0];
      if (!ch) throw new Recusa(404, 'Chamado não encontrado.');
      await exigirEnvio(db, ch.empresa_id);
      if (ch.venda_id) throw new Recusa(400, 'O robô já abriu a venda deste atendimento.');
      const estado = req.body?.acao === 'devolver' ? 'coletando' : 'humano';
      await db.query('update whatsapp_chamados set robo_estado = $2, atualizado_em = now() where id = $1', [ch.id, estado]);
      return ch.contato_id;
    }).then((contato) => req.body?.acao === 'devolver' && atenderComRobo(contato, { enviarTexto, nacional, retomar: true }));
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
      // contato ainda sem ligação: se o celular é de um (e só um) cliente cadastrado, liga sozinho
      if (!k.cliente_id) {
        const achados = (await db.query(
          `select c.id, c.nome, c.cpf_cnpj from clientes c
            where c.empresa_id = $1 and c.ativo and c.tipo in ('pf', 'pj') and c.cpf_cnpj is not null
              and tel_chave($2) is not null and tel_chave($2) in (tel_chave(c.whatsapp), tel_chave(c.telefone))
            limit 2`, [k.empresa_id, k.telefone])).rows;
        if (achados.length === 1) {
          await db.query('update whatsapp_contatos set cliente_id = $2 where id = $1', [k.id, achados[0].id]);
          Object.assign(k, { cliente_id: achados[0].id, cliente: achados[0].nome, cpf_cnpj: achados[0].cpf_cnpj });
        }
      }
      const mensagens = (await db.query(
        `select m.id, m.direcao, m.texto, m.status, m.erro, m.criado_em, m.robo, u.nome as enviado_por
           from whatsapp_conversa m left join usuarios u on u.id = m.enviado_por
          where m.contato_id = $1 order by m.criado_em desc limit 300`, [k.id])).rows.reverse();
      const chamado = (await db.query(
        `select h.id, h.coluna_id, h.titulo, h.responsavel_id, h.aberto, h.robo_estado, h.venda_id,
                (select v.numero from vendas v where v.id = h.venda_id) as venda_numero,
                (select v.situacao from vendas v where v.id = h.venda_id) as venda_situacao from whatsapp_chamados h
          where h.contato_id = $1 order by h.aberto desc, h.criado_em desc limit 1`, [k.id])).rows[0] || null;
      if (req.query.ler === '1') await db.query('update whatsapp_contatos set nao_lidas = 0 where id = $1', [k.id]);
      const robo = (await db.query('select ativo from whatsapp_robo where empresa_id = $1', [k.empresa_id])).rows[0]?.ativo || false;
      return { ...k, mensagens, chamado, robo, pode_enviar: await podeEnviar(db, k.empresa_id) };
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
      // atendente respondeu: o robô para neste atendimento
      await db.query(`update whatsapp_chamados set atualizado_em = now(), responsavel_id = coalesce(responsavel_id, $2),
                             robo_estado = case when venda_id is null and coalesce(robo_estado, 'coletando') = 'coletando' then 'humano' else robo_estado end
                       where id = $1`, [ch, req.usuarioId]);
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
