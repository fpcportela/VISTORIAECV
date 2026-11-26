import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, texto } from './comum.js';

// Abas Férias e Atestados do cadastro do colaborador, e o banco de horas.
// Férias e banco de horas: ver com quem vê o colaborador; alterar com "colaboradores.editar".
// Atestados: alterar com "ponto.justificar", igual à justificativa do espelho, porque cada dia
// do atestado é a justificativa do dia na folha de ponto.

const FUSO = 'America/Sao_Paulo';
const MAX_DIAS = 366;
const dataValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : null);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dataBR = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function periodo(b) {
  const inicio = dataValida(b.inicio);
  const fim = dataValida(b.fim);
  if (!inicio || !fim) throw new Recusa(400, 'Informe as datas de início e fim.');
  if (fim < inicio) throw new Recusa(400, 'A data de fim é antes do início.');
  if ((Date.parse(fim) - Date.parse(inicio)) / 86400000 + 1 > MAX_DIAS) throw new Recusa(400, 'O período passa de um ano.');
  return { inicio, fim };
}

async function colaborador(db, id) {
  if (!UUID.test(id || '')) throw new Recusa(404, 'Colaborador não encontrado.');
  const c = (await db.query('select * from colaboradores where id = $1', [id])).rows[0];
  if (!c) throw new Recusa(404, 'Colaborador não encontrado.');
  return c;
}

async function poderes(db, c) {
  return (await db.query(
    `select pode_ver_colaborador($1, 'colaboradores.ver') or pode_colaborador($1, 'colaboradores.editar')
              or pode_ver_colaborador($1, 'ponto.ver_equipe') as ver,
            pode_colaborador($1, 'colaboradores.editar') as editar,
            pode_colaborador($1, 'ponto.justificar') as justificar`, [c.id])).rows[0];
}

async function colabCom(db, id, acao) {
  const c = await colaborador(db, id);
  const p = await poderes(db, c);
  if (!p.ver) throw new Recusa(403, 'Seu perfil não pode ver este colaborador.');
  if (acao === 'editar' && !p.editar) throw new Recusa(403, 'Seu perfil não pode alterar as férias e o banco de horas.');
  if (acao === 'justificar' && !p.justificar) throw new Recusa(403, 'Seu perfil não pode lançar atestados.');
  return { c, p };
}

// Banco de horas do colaborador: configuração e saldo até ontem
export async function bancoDoColaborador(db, c) {
  const s = (await db.query('select * from banco_horas_saldo($1)', [c.id])).rows[0];
  return { ativo: c.banco_horas, inicio: c.banco_horas_inicio, jornada: c.jornada_minutos, ...s };
}

// Dias do banco num mês (só do início do banco até ontem)
export async function bancoDoMes(db, c, mes) {
  if (!c.banco_horas || !c.banco_horas_inicio) return [];
  const [a, m] = mes.split('-').map(Number);
  const de = [`${mes}-01`, c.banco_horas_inicio].sort().at(-1);
  const ate = [`${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`, somaDias(hoje(), -1)].sort()[0];
  if (ate < de) return [];
  return (await db.query('select * from banco_horas_dias($1, $2, $3)', [c.id, de, ate])).rows;
}

// Atestado com cada dia na folha de ponto (justificativa do dia todo ligada a ele)
export async function criarAtestado(db, c, { inicio, fim, textoJ, usuario }) {
  const dias = [];
  for (let d = inicio; d <= fim; d = somaDias(d, 1)) dias.push(d);
  const ocupado = (await db.query(
    `select data from ponto_justificativas where colaborador_id = $1 and tipo is null and atestado_id is not null
        and data between $2 and $3 order by data limit 1`, [c.id, inicio, fim])).rows[0];
  if (ocupado) throw new Recusa(400, `Já existe atestado em ${dataBR(ocupado.data)}.`);
  const id = (await db.query('insert into colaborador_atestados (colaborador_id, inicio, fim, criado_por) values ($1, $2, $3, $4) returning id',
    [c.id, inicio, fim, usuario])).rows[0].id;
  for (const d of dias) {
    await db.query(
      `insert into ponto_justificativas (colaborador_id, data, tipo, texto, criado_por, atestado_id) values ($1, $2, null, $3, $4, $5)
       on conflict (colaborador_id, data) where tipo is null
       do update set texto = excluded.texto, criado_por = excluded.criado_por, criado_em = now(), atestado_id = excluded.atestado_id`,
      [c.id, d, textoJ, usuario, id]);
  }
  return id;
}

export function rotasFeriasAtestados(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  // ------------------------------------------------------------ férias e banco de horas
  app.get('/api/colaboradores/:id/ferias', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const { c, p } = await colabCom(db, req.params.id);
      const ferias = (await db.query(
        `select f.id, f.inicio, f.fim, f.dias, f.abono_minutos, f.observacao, u.nome as criado_por, f.criado_em
           from colaborador_ferias f left join usuarios u on u.id = f.criado_por
          where f.colaborador_id = $1 order by f.inicio desc`, [c.id])).rows;
      return { ferias, banco: await bancoDoColaborador(db, c), pode_editar: p.editar };
    }));
  }));

  const salvarFerias = (novo) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const { inicio, fim } = periodo(b);
    const abono = Math.round(Number(b.abono_minutos) || 0);
    if (Math.abs(abono) > 100000) throw new Recusa(400, 'Abono do banco de horas inválido.');
    const obs = texto(b.observacao, 300);
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const { c } = await colabCom(db, req.params.id, 'editar');
      const fid = novo ? null : req.params.fid;
      if (!novo && !UUID.test(fid || '')) throw new Recusa(404, 'Férias não encontradas.');
      const choque = (await db.query(
        `select inicio, fim from colaborador_ferias where colaborador_id = $1 and id is distinct from $2::uuid
            and inicio <= $4 and fim >= $3 limit 1`, [c.id, fid, inicio, fim])).rows[0];
      if (choque) throw new Recusa(400, `Já existem férias de ${dataBR(choque.inicio)} a ${dataBR(choque.fim)} neste período.`);
      if (novo) {
        return (await db.query(
          `insert into colaborador_ferias (colaborador_id, inicio, fim, abono_minutos, observacao, criado_por)
           values ($1, $2, $3, $4, $5, $6) returning id`, [c.id, inicio, fim, abono, obs, req.usuarioId])).rows[0].id;
      }
      const r = await db.query(
        `update colaborador_ferias set inicio = $3, fim = $4, abono_minutos = $5, observacao = $6
          where id = $2 and colaborador_id = $1 returning id`, [c.id, fid, inicio, fim, abono, obs]);
      if (!r.rowCount) throw new Recusa(404, 'Férias não encontradas.');
      return fid;
    });
    res.json({ id });
  });
  app.post('/api/colaboradores/:id/ferias', exigeLogin, salvarFerias(true));
  app.put('/api/colaboradores/:id/ferias/:fid', exigeLogin, salvarFerias(false));

  app.delete('/api/colaboradores/:id/ferias/:fid', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const { c } = await colabCom(db, req.params.id, 'editar');
      if (!UUID.test(req.params.fid || '')) throw new Recusa(404, 'Férias não encontradas.');
      await db.query('delete from colaborador_ferias where id = $1 and colaborador_id = $2', [req.params.fid, c.id]);
    });
    res.json({ ok: true });
  }));

  // Liga/desliga o banco de horas e grava a jornada prevista (minutos de domingo a sábado)
  app.put('/api/colaboradores/:id/banco-horas', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const ativo = Boolean(b.ativo);
    const inicio = b.inicio ? dataValida(b.inicio) : null;
    if (b.inicio && !inicio) throw new Recusa(400, 'Data de início do banco de horas inválida.');
    if (ativo && !inicio) throw new Recusa(400, 'Informe a partir de que dia o banco de horas conta.');
    const jornada = Array.isArray(b.jornada) ? b.jornada.map((v) => Math.round(Number(v))) : null;
    if (!jornada || jornada.length !== 7 || jornada.some((v) => !Number.isFinite(v) || v < 0 || v > 1440)) {
      throw new Recusa(400, 'Jornada inválida: informe as horas de domingo a sábado.');
    }
    await comoUsuario(req.usuarioId, async (db) => {
      const { c } = await colabCom(db, req.params.id, 'editar');
      await db.query('update colaboradores set banco_horas = $2, banco_horas_inicio = $3, jornada_minutos = $4 where id = $1',
        [c.id, ativo, inicio, jornada]);
    });
    res.json({ ok: true });
  }));

  // Extrato do banco de horas num mês, dia a dia
  app.get('/api/colaboradores/:id/banco-horas', exigeLogin, comRecusa(async (req, res) => {
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : null;
    if (!mes) throw new Recusa(400, 'Mês inválido.');
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const { c } = await colabCom(db, req.params.id);
      return { banco: await bancoDoColaborador(db, c), dias: await bancoDoMes(db, c, mes) };
    }));
  }));

  // ------------------------------------------------------------ atestados
  app.get('/api/colaboradores/:id/atestados', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const { c, p } = await colabCom(db, req.params.id);
      const atestados = (await db.query(
        `select a.id, a.inicio, a.fim, u.nome as criado_por, a.criado_em,
                (select count(*)::int from ponto_justificativas j where j.atestado_id = a.id) as dias,
                (select j.texto from ponto_justificativas j where j.atestado_id = a.id order by j.data limit 1) as texto,
                coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome_arquivo, 'tamanho', x.tamanho) order by x.criado_em)
                            from ponto_justificativa_arquivos x join ponto_justificativas j on j.id = x.justificativa_id
                           where j.atestado_id = a.id), '[]') as arquivos
           from colaborador_atestados a left join usuarios u on u.id = a.criado_por
          where a.colaborador_id = $1 order by a.inicio desc`, [c.id])).rows;
      return { atestados, pode_justificar: p.justificar };
    }));
  }));

  app.post('/api/colaboradores/:id/atestados', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const { inicio, fim } = periodo(b);
    const textoJ = texto(b.texto, 500) || 'ATESTADO MÉDICO';
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const { c } = await colabCom(db, req.params.id, 'justificar');
      return criarAtestado(db, c, { inicio, fim, textoJ, usuario: req.usuarioId });
    });
    res.json({ id });
  }));

  // Apaga o atestado e os dias dele na folha de ponto (com os documentos)
  app.delete('/api/colaboradores/:id/atestados/:aid', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const { c } = await colabCom(db, req.params.id, 'justificar');
      if (!UUID.test(req.params.aid || '')) throw new Recusa(404, 'Atestado não encontrado.');
      await db.query('delete from colaborador_atestados where id = $1 and colaborador_id = $2', [req.params.aid, c.id]);
    });
    res.json({ ok: true });
  }));
}
