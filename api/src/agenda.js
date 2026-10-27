import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, exigir, resolverCliente, texto } from './comum.js';
import { normalizarPlaca } from './placas.js';
import { enviarTexto, internacional } from './whatsapp.js';
import { textoConfirmacao } from './agendaTexto.js';

// Agenda de vistorias por loja: horários de atendimento, bloqueios e agendamentos.
// O robô do WhatsApp agenda nos horários livres (ver robo.js); aqui ficam as telas.

const SITUACOES = ['agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado'];
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const instante = (v) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

async function config(db, loja) {
  await db.query('insert into agenda_config (loja_id) values ($1) on conflict do nothing', [loja]);
  return (await db.query('select * from agenda_config where loja_id = $1', [loja])).rows[0];
}

// Confere se cabe no horário (ou aceita o encaixe) e devolve o fim
async function horarioValido(db, { loja, inicio, encaixe, ignorar }) {
  const c = await config(db, loja);
  const fim = new Date(new Date(inicio).getTime() + c.duracao_min * 60000).toISOString();
  if (encaixe) return fim;
  await db.query("select pg_advisory_xact_lock(hashtext('agenda:' || $1))", [loja]);
  const dia = new Date(inicio).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const livre = (await db.query(
    `select 1 from agenda_livres($1, $2::date, $2::date) f where f.inicio = $3
      union all
     select 1 from agendamentos a where a.id = $4 and a.inicio = $3 and a.situacao <> 'cancelado'`,
    [loja, dia, inicio, ignorar || null])).rowCount;
  if (!livre) throw new Recusa(409, 'Esse horário não está livre (lotado, fora do expediente ou bloqueado). Para agendar mesmo assim, marque "Encaixe".');
  return fim;
}

async function dadosAgendamento(db, b, empresa, loja) {
  const nome = texto(b.nome, 120)?.toUpperCase();
  if (!nome) throw new Recusa(400, 'Informe o nome do cliente.');
  const tel = String(b.telefone || '').replace(/\D/g, '') || null;
  if (tel && tel.length < 10) throw new Recusa(400, 'Confira o celular (com DDD).');
  const placa = b.placa ? normalizarPlaca(b.placa) : null;
  if (b.placa && !placa) throw new Recusa(400, 'Confira a placa.');
  let servico = null;
  if (UUID.test(b.servico_id || '')) {
    servico = (await db.query('select id from servicos where id = $1 and empresa_id = $2', [b.servico_id, empresa])).rows[0]?.id || null;
  }
  // cliente: o escolhido na busca, ou pelo CPF/CNPJ (o já cadastrado ou um novo; nunca duplica). Sem documento, não cadastra.
  let cliente = null;
  if (UUID.test(b.cliente_id || '')) {
    cliente = (await db.query('select id from clientes where id = $1 and empresa_id = $2', [b.cliente_id, empresa])).rows[0]?.id || null;
  } else if (String(b.cpf_cnpj || '').replace(/\D/g, '')) {
    cliente = await resolverCliente(db, { empresa, loja, cliente_novo: { nome, cpf_cnpj: b.cpf_cnpj, whatsapp: tel } });
  }
  return { nome, tel, placa, servico, cliente, obs: texto(b.observacao, 1000) };
}

// Põe o agendamento num chamado do kanban do WhatsApp, na coluna escolhida (o chamado aberto do contato muda de coluna)
async function ligarChamado(db, ag, colunaId, usuarioId) {
  if (!ag.telefone) throw new Recusa(400, 'Para mandar para o WhatsApp, informe o celular do cliente.');
  const col = (await db.query('select id from whatsapp_colunas where id = $1 and empresa_id = $2 and not finaliza', [colunaId, ag.empresa_id])).rows[0];
  if (!col) throw new Recusa(400, 'Escolha a coluna do chamado.');
  const contato = (await db.query(
    `insert into whatsapp_contatos (empresa_id, telefone, nome) values ($1, $2, $3)
     on conflict (empresa_id, telefone) do update set nome = coalesce(whatsapp_contatos.nome, excluded.nome) returning id`,
    [ag.empresa_id, internacional(ag.telefone), ag.nome])).rows[0].id;
  const ordem = `coalesce((select min(ordem) from whatsapp_chamados where coluna_id = $1), 1) - 1`;
  let chamado = (await db.query('select id from whatsapp_chamados where contato_id = $1 and aberto order by criado_em desc limit 1', [contato])).rows[0]?.id;
  if (chamado) {
    await db.query(`update whatsapp_chamados set coluna_id = $1, ordem = ${ordem}, atualizado_em = now() where id = $2`, [col.id, chamado]);
  } else {
    chamado = (await db.query(
      `insert into whatsapp_chamados (empresa_id, contato_id, coluna_id, ordem, titulo, criado_por)
       values ($2, $3, $1, ${ordem}, $4, $5) returning id`,
      [col.id, ag.empresa_id, contato, 'AGENDAMENTO', usuarioId])).rows[0].id;
  }
  await db.query('select app_robo_atribuir($1, $2)', [chamado, ag.loja_id]);
  await db.query('update agendamentos set chamado_id = $1 where id = $2', [chamado, ag.id]);
}

// Manda a confirmação pelo WhatsApp do grupo e grava na conversa do contato
async function mandarConfirmacao(usuarioId, agendamentoId) {
  const a = await comoUsuario(usuarioId, async (db) => {
    const x = (await db.query(
      `select a.*, to_jsonb(l) as loja, n.phone_number_id from agendamentos a join lojas l on l.id = a.loja_id
         left join whatsapp_numeros n on n.empresa_id = a.empresa_id and n.ativo where a.id = $1`, [agendamentoId])).rows[0];
    if (!x) throw new Recusa(404, 'Agendamento não encontrado.');
    if (!x.telefone) throw new Recusa(400, 'O agendamento não tem celular.');
    if (!x.phone_number_id) throw new Recusa(400, 'O WhatsApp deste grupo ainda não está ligado (WhatsApp > Configurar).');
    return x;
  });
  const para = internacional(a.telefone);
  const corpo = textoConfirmacao(a, a.loja);
  let envio, falha = null;
  try { envio = await enviarTexto(a.phone_number_id, para, corpo); } catch (e) { falha = e; }
  await comoUsuario(usuarioId, async (db) => {
    const contato = (await db.query(
      `insert into whatsapp_contatos (empresa_id, telefone, nome) values ($1, $2, $3)
       on conflict (empresa_id, telefone) do update set nome = coalesce(whatsapp_contatos.nome, excluded.nome) returning id`,
      [a.empresa_id, para, a.nome])).rows[0].id;
    await db.query(
      `insert into whatsapp_conversa (empresa_id, contato_id, chamado_id, direcao, texto, status, erro, id_externo, enviado_por)
       values ($1, $2, $3, 'saida', $4, $5, $6, $7, $8)`,
      [a.empresa_id, contato, a.chamado_id, corpo, falha ? 'falhou' : envio.status, falha?.message || null, envio?.id_externo || null, usuarioId]);
    if (!falha) await db.query('update agendamentos set confirmacao_em = now() where id = $1', [a.id]);
  });
  if (falha) throw new Recusa(502, falha.message);
}

export function rotasAgenda(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);
  const lojaDe = async (db, id) => {
    if (!UUID.test(id || '')) throw new Recusa(400, 'Escolha a loja.');
    const l = (await db.query('select id, empresa_id, nome from lojas where id = $1', [id])).rows[0];
    if (!l) throw new Recusa(404, 'Loja não encontrada.');
    return l;
  };
  const agendamentoDe = async (db, id) => {
    if (!UUID.test(id || '')) throw new Recusa(404, 'Agendamento não encontrado.');
    const a = (await db.query('select * from agendamentos where id = $1', [id])).rows[0];
    if (!a) throw new Recusa(404, 'Agendamento não encontrado.');
    return a;
  };

  // A agenda de um período: agendamentos, bloqueios e os horários livres
  app.get('/api/agenda', exigeLogin, comRecusa(async (req, res) => {
    const de = DIA.test(req.query.de || '') ? req.query.de : null;
    const ate = DIA.test(req.query.ate || '') ? req.query.ate : de;
    if (!de || ate < de) throw new Recusa(400, 'Período inválido.');
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const l = await lojaDe(db, req.query.loja);
      await exigir(db, l.id, 'agenda.ver', 'Seu perfil não pode ver a agenda.');
      const fimPeriodo = `(($2::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;
      const iniPeriodo = `($1::date::timestamp at time zone 'America/Sao_Paulo')`;
      const agendamentos = (await db.query(
        `select a.*, s.nome as servico, v.numero as venda_numero, v.situacao as venda_situacao,
                c.nome as cliente_nome, c.cpf_cnpj as cliente_doc
           from agendamentos a left join servicos s on s.id = a.servico_id left join vendas v on v.id = a.venda_id
           left join clientes c on c.id = a.cliente_id
          where a.loja_id = $3 and a.inicio < ${fimPeriodo} and a.fim > ${iniPeriodo}
          order by a.inicio, a.criado_em`, [de, ate, l.id])).rows;
      const bloqueios = (await db.query(
        `select * from agenda_bloqueios where loja_id = $3 and inicio < ${fimPeriodo} and fim > ${iniPeriodo} order by inicio`, [de, ate, l.id])).rows;
      const livres = (await db.query('select * from agenda_livres($1, $2::date, $3::date)', [l.id, de, ate])).rows;
      const servicos = (await db.query('select id, nome from servicos where empresa_id = $1 and ativo order by nome', [l.empresa_id])).rows;
      const gerenciar = (await db.query("select pode($1, 'agenda.gerenciar') as ok", [l.id])).rows[0].ok;
      // colunas do kanban de chamados, para escolher onde vai o chamado do agendamento novo
      await db.query('select app_whatsapp_colunas_padrao($1)', [l.empresa_id]);
      const colunas = (await db.query('select id, nome from whatsapp_colunas where empresa_id = $1 and not finaliza order by ordem, nome', [l.empresa_id])).rows;
      return { config: await config(db, l.id), agendamentos, bloqueios, livres, servicos, colunas, pode_gerenciar: gerenciar };
    }));
  }));

  app.post('/api/agenda', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const inicio = instante(b.inicio);
    if (!inicio) throw new Recusa(400, 'Escolha o horário.');
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const l = await lojaDe(db, b.loja_id);
      await exigir(db, l.id, 'agenda.gerenciar', 'Seu perfil não pode agendar.');
      const d = await dadosAgendamento(db, b, l.empresa_id, l.id);
      const fim = await horarioValido(db, { loja: l.id, inicio, encaixe: b.encaixe === true });
      const novo = (await db.query(
        `insert into agendamentos (empresa_id, loja_id, inicio, fim, nome, telefone, placa, servico_id, cliente_id, observacao, criado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [l.empresa_id, l.id, inicio, fim, d.nome, d.tel, d.placa, d.servico, d.cliente, d.obs, req.usuarioId])).rows[0];
      if (UUID.test(b.coluna_id || '')) await ligarChamado(db, novo, b.coluna_id, req.usuarioId);
      return novo.id;
    });
    let aviso = null;
    if (b.enviar_whatsapp) {
      try { await mandarConfirmacao(req.usuarioId, id); } catch (e) { aviso = `Agendado, mas a confirmação não foi pelo WhatsApp: ${e.message}`; }
    }
    res.json({ id, aviso });
  }));

  // Horário de atendimento da loja
  app.put('/api/agenda/config', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const horarios = {};
    for (const [dia, h] of Object.entries(b.horarios || {})) {
      if (!/^[0-6]$/.test(dia) || !h) continue;
      if (!HORA.test(h.abre || '') || !HORA.test(h.fecha || '') || h.fecha <= h.abre) {
        throw new Recusa(400, 'Confira os horários de abrir e fechar (HH:MM, e o fechamento depois da abertura).');
      }
      horarios[dia] = { abre: h.abre, fecha: h.fecha };
    }
    const almocoIni = b.almoco_inicio ? String(b.almoco_inicio).slice(0, 5) : null;
    const almocoFim = b.almoco_fim ? String(b.almoco_fim).slice(0, 5) : null;
    if ((almocoIni && !HORA.test(almocoIni)) || (almocoFim && !HORA.test(almocoFim)) || (almocoIni && almocoFim && almocoFim <= almocoIni)) {
      throw new Recusa(400, 'Confira o horário de almoço.');
    }
    const num = (v, min, max, nome) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw new Recusa(400, `${nome}: use um número entre ${min} e ${max}.`);
      return n;
    };
    const duracao = num(b.duracao_min, 5, 480, 'Duração de cada vistoria');
    const vagas = num(b.vagas, 1, 50, 'Vistorias ao mesmo tempo');
    const antecedencia = num(b.antecedencia_min, 0, 10080, 'Antecedência mínima');
    const dias = num(b.dias_a_frente, 1, 365, 'Dias abertos para agendar');
    await comoUsuario(req.usuarioId, async (db) => {
      const l = await lojaDe(db, b.loja_id);
      await exigir(db, l.id, 'agenda.gerenciar', 'Seu perfil não pode configurar a agenda.');
      await db.query(
        `insert into agenda_config (loja_id, ativo, horarios, almoco_inicio, almoco_fim, duracao_min, vagas, antecedencia_min, dias_a_frente)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (loja_id) do update set ativo = $2, horarios = $3, almoco_inicio = $4, almoco_fim = $5, duracao_min = $6,
                 vagas = $7, antecedencia_min = $8, dias_a_frente = $9, atualizado_em = now()`,
        [l.id, b.ativo !== false, JSON.stringify(horarios), (almocoIni && almocoFim) ? almocoIni : null, (almocoIni && almocoFim) ? almocoFim : null,
          duracao, vagas, antecedencia, dias]);
    });
    res.json({ ok: true });
  }));

  // Altera dados, remarca (inicio) ou muda a situação
  app.put('/api/agenda/:id', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    await comoUsuario(req.usuarioId, async (db) => {
      const a = await agendamentoDe(db, req.params.id);
      await exigir(db, a.loja_id, 'agenda.gerenciar', 'Seu perfil não pode mexer na agenda.');
      if (b.situacao !== undefined) {
        if (!SITUACOES.includes(b.situacao)) throw new Recusa(400, 'Situação inválida.');
        await db.query('update agendamentos set situacao = $2, atualizado_em = now() where id = $1', [a.id, b.situacao]);
      }
      if (b.nome !== undefined) {
        const d = await dadosAgendamento(db, b, a.empresa_id, a.loja_id);
        await db.query(
          `update agendamentos set nome = $2, telefone = $3, placa = $4, servico_id = $5, observacao = $6,
                  cliente_id = coalesce($7, cliente_id), atualizado_em = now() where id = $1`,
          [a.id, d.nome, d.tel, d.placa, d.servico, d.obs, d.cliente]);
      }
      if (b.inicio !== undefined) {
        const inicio = instante(b.inicio);
        if (!inicio) throw new Recusa(400, 'Escolha o horário.');
        if (inicio !== new Date(a.inicio).toISOString()) {
          const fim = await horarioValido(db, { loja: a.loja_id, inicio, encaixe: b.encaixe === true, ignorar: a.id });
          await db.query(
            `update agendamentos set inicio = $2, fim = $3, confirmacao_em = null,
                    situacao = case when situacao = 'cancelado' then 'agendado' else situacao end, atualizado_em = now() where id = $1`,
            [a.id, inicio, fim]);
          if (a.venda_id) {
            await db.query(`update vendas set data_venda = ($2::timestamptz at time zone 'America/Sao_Paulo')::date
                             where id = $1 and situacao in ('futuro', 'aberta')`, [a.venda_id, inicio]);
          }
        }
      }
    });
    let aviso = null;
    if (b.enviar_whatsapp) {
      try { await mandarConfirmacao(req.usuarioId, req.params.id); } catch (e) { aviso = `Salvo, mas a mensagem não foi pelo WhatsApp: ${e.message}`; }
    }
    res.json({ ok: true, aviso });
  }));

  app.post('/api/agenda/:id/confirmacao', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const a = await agendamentoDe(db, req.params.id);
      await exigir(db, a.loja_id, 'agenda.gerenciar', 'Seu perfil não pode mexer na agenda.');
    });
    await mandarConfirmacao(req.usuarioId, req.params.id);
    res.json({ ok: true });
  }));

  // Bloqueios (feriado, folga, manutenção)
  app.post('/api/agenda/bloqueios', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const inicio = instante(b.inicio), fim = instante(b.fim);
    if (!inicio || !fim || fim <= inicio) throw new Recusa(400, 'Confira o início e o fim do bloqueio.');
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const l = await lojaDe(db, b.loja_id);
      await exigir(db, l.id, 'agenda.gerenciar', 'Seu perfil não pode bloquear a agenda.');
      return (await db.query('insert into agenda_bloqueios (loja_id, inicio, fim, motivo, criado_por) values ($1, $2, $3, $4, $5) returning id',
        [l.id, inicio, fim, texto(b.motivo, 200)?.toUpperCase() || null, req.usuarioId])).rows[0].id;
    });
    res.json({ id });
  }));

  app.delete('/api/agenda/bloqueios/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Bloqueio não encontrado.');
    await comoUsuario(req.usuarioId, async (db) => {
      const x = (await db.query('select * from agenda_bloqueios where id = $1', [req.params.id])).rows[0];
      if (!x) throw new Recusa(404, 'Bloqueio não encontrado.');
      await exigir(db, x.loja_id, 'agenda.gerenciar', 'Seu perfil não pode mexer na agenda.');
      await db.query('delete from agenda_bloqueios where id = $1', [x.id]);
    });
    res.json({ ok: true });
  }));
}
