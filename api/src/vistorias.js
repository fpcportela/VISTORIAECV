import { comoUsuario } from './db.js';
import { normalizarPlaca } from './placas.js';

const UUID = /^[0-9a-f-]{36}$/i;
const TIPOS = ['carro', 'moto', 'caminhao', 'outro'];
const SITUACOES = ['conforme', 'nao_conforme', 'nao_se_aplica'];
const RESULTADOS = ['aprovado', 'aprovado_com_apontamentos', 'reprovado'];

// Erro com status HTTP, devolvido como { erro } pela rota
class Recusa extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

async function exigir(db, loja, permissao, mensagem) {
  const ok = (await db.query('select pode($1, $2) as ok', [loja, permissao])).rows[0].ok;
  if (!ok) throw new Recusa(403, mensagem || 'Seu perfil não tem permissão para isso.');
}

// Vistoria visível para o usuário (as regras por loja do banco filtram)
async function buscarVistoria(db, id) {
  if (!UUID.test(id)) throw new Recusa(404, 'Vistoria não encontrada.');
  const v = (await db.query('select * from vistorias where id = $1', [id])).rows[0];
  if (!v) throw new Recusa(404, 'Vistoria não encontrada.');
  await exigir(db, v.loja_id, 'vistorias.ver');
  return v;
}

const texto = (v, max = 500) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

// Módulo Vistorias: abrir, preencher o checklist, concluir e cancelar
export function rotasVistorias(app, { exigeLogin, rota }) {
  const comRecusa = (fn) => rota(async (req, res) => {
    try {
      await fn(req, res);
    } catch (erro) {
      if (erro instanceof Recusa) return res.status(erro.status).json({ erro: erro.message });
      throw erro;
    }
  });

  // Lista com filtros: ?loja, ?status, ?periodo (hoje|mes|todos), ?busca (placa, cliente ou número)
  app.get('/api/vistorias', exigeLogin, comRecusa(async (req, res) => {
    const loja = UUID.test(req.query.loja || '') ? req.query.loja : null;
    const status = ['agendada', 'em_andamento', 'concluida', 'cancelada'].includes(req.query.status) ? req.query.status : null;
    const periodo = ['hoje', 'mes'].includes(req.query.periodo) ? req.query.periodo : null;
    const busca = texto(req.query.busca, 60);
    const lista = await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select vi.id, vi.numero, vi.loja_id, l.nome as loja, vi.status, vi.resultado, vi.criado_em, vi.concluida_em,
              ve.placa, ve.tipo, ve.marca, ve.modelo, c.nome as cliente, s.nome as servico, u.nome as vistoriador
         from vistorias vi
         join lojas l on l.id = vi.loja_id
         join veiculos ve on ve.id = vi.veiculo_id
         join clientes c on c.id = vi.cliente_id
         join servicos s on s.id = vi.servico_id
         left join usuarios u on u.id = vi.vistoriador_id
        where pode(vi.loja_id, 'vistorias.ver')
          and ($1::uuid is null or vi.loja_id = $1)
          and ($2::status_vistoria is null or vi.status = $2)
          and ($3::text is null
               or ($3 = 'hoje' and vi.criado_em >= current_date)
               or ($3 = 'mes' and vi.criado_em >= date_trunc('month', current_date)))
          and ($4::text is null or ve.placa ilike '%' || regexp_replace($4, '[^A-Za-z0-9]', '', 'g') || '%'
               or c.nome ilike '%' || $4 || '%' or vi.numero::text = $4)
        order by vi.criado_em desc
        limit 200`, [loja, status, periodo, busca])).rows);
    res.json(lista);
  }));

  // Serviços da loja com o preço por tipo de veículo (o da loja vale mais que o geral)
  app.get('/api/servicos', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.query.loja || '')) throw new Recusa(400, 'Escolha a loja.');
    const lista = await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select s.id, s.nome, s.descricao,
              coalesce((select jsonb_object_agg(tipo_veiculo, valor) from (
                 select distinct on (p.tipo_veiculo) p.tipo_veiculo, p.valor
                   from servico_precos p
                  where p.servico_id = s.id and (p.loja_id is null or p.loja_id = $1)
                  order by p.tipo_veiculo, p.loja_id nulls last) x), '{}') as precos
         from servicos s join lojas l on l.empresa_id = s.empresa_id
        where l.id = $1 and s.ativo and s.gera_vistoria
        order by s.nome`, [req.query.loja])).rows);
    res.json(lista);
  }));

  // Busca de clientes do grupo da loja (nome, CPF/CNPJ ou telefone)
  app.get('/api/clientes', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.query.loja || '')) throw new Recusa(400, 'Escolha a loja.');
    const busca = texto(req.query.busca, 60);
    const lista = await comoUsuario(req.usuarioId, async (db) => {
      await exigir(db, req.query.loja, 'clientes.ver', 'Seu perfil não pode ver clientes.');
      return (await db.query(
        `select c.id, c.tipo, c.nome, c.cpf_cnpj, c.whatsapp, c.telefone
           from clientes c join lojas l on l.empresa_id = c.empresa_id
          where l.id = $1 and c.ativo
            and ($2::text is null or c.nome ilike '%' || $2 || '%'
                 or regexp_replace(coalesce(c.cpf_cnpj, ''), '\\D', '', 'g') like regexp_replace($2, '\\D', '', 'g') || '%'
                    and regexp_replace($2, '\\D', '', 'g') <> ''
                 or regexp_replace(coalesce(c.whatsapp, c.telefone, ''), '\\D', '', 'g') like '%' || nullif(regexp_replace($2, '\\D', '', 'g'), '') || '%')
          order by c.tipo = 'avulso' desc, c.nome
          limit 20`, [req.query.loja, busca])).rows;
    });
    res.json(lista);
  }));

  // Abre a vistoria: garante o veículo e o cliente, copia o checklist e já
  // deixa "em andamento" com quem abriu como vistoriador.
  app.post('/api/vistorias', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const placa = normalizarPlaca(b.placa);
    if (!UUID.test(b.loja_id || '')) throw new Recusa(400, 'Escolha a loja.');
    if (!placa) throw new Recusa(400, 'Placa inválida. Use o formato ABC1234 ou ABC1D23.');
    if (!UUID.test(b.servico_id || '')) throw new Recusa(400, 'Escolha o serviço.');

    const id = await comoUsuario(req.usuarioId, async (db) => {
      await exigir(db, b.loja_id, 'vistorias.criar', 'Seu perfil não pode abrir vistorias.');
      const empresa = (await db.query('select empresa_id from lojas where id = $1', [b.loja_id])).rows[0]?.empresa_id;
      if (!empresa) throw new Recusa(403, 'Você não tem acesso a esta loja.');

      // Veículo: o que veio da consulta de placa ou os dados digitados
      const m = b.veiculo || {};
      const tipo = TIPOS.includes(m.tipo) ? m.tipo : null;
      const veiculo = (await db.query(
        `insert into veiculos (placa, tipo, marca, modelo, cor, ano_modelo)
         values ($1, coalesce($2::tipo_veiculo, 'carro'), $3, $4, $5, $6)
         on conflict (placa) do update set
           tipo = coalesce($2::tipo_veiculo, veiculos.tipo),
           marca = coalesce(veiculos.marca, excluded.marca), modelo = coalesce(veiculos.modelo, excluded.modelo),
           cor = coalesce(veiculos.cor, excluded.cor), ano_modelo = coalesce(veiculos.ano_modelo, excluded.ano_modelo)
         returning id, tipo`,
        [placa, tipo, texto(m.marca, 60), texto(m.modelo, 80), texto(m.cor, 30),
         /^\d{4}$/.test(String(m.ano || '')) ? Number(m.ano) : null])).rows[0];

      // Cliente: um existente, um novo, ou o "particular / avulso" do grupo
      let cliente = UUID.test(b.cliente_id || '') ? b.cliente_id : null;
      if (cliente) {
        const ok = (await db.query('select 1 from clientes where id = $1 and empresa_id = $2', [cliente, empresa])).rowCount;
        if (!ok) throw new Recusa(400, 'Cliente não encontrado.');
      } else if (b.cliente_novo?.nome) {
        await exigir(db, b.loja_id, 'clientes.editar', 'Seu perfil não pode cadastrar clientes.');
        const n = b.cliente_novo;
        const doc = texto(n.cpf_cnpj, 20)?.replace(/\D/g, '') || null;
        if (doc && ![11, 14].includes(doc.length)) throw new Recusa(400, 'CPF ou CNPJ inválido.');
        cliente = (await db.query(
          `insert into clientes (empresa_id, tipo, nome, cpf_cnpj, whatsapp)
           values ($1, $2, $3, $4, $5) returning id`,
          [empresa, doc ? (doc.length === 14 ? 'pj' : 'pf') : 'avulso', texto(n.nome, 120).toUpperCase(), doc,
           texto(n.whatsapp, 20)?.replace(/\D/g, '') || null])).rows[0].id;
      } else {
        cliente = (await db.query(
          "select id from clientes where empresa_id = $1 and tipo = 'avulso' and nome = 'CLIENTE PARTICULAR / AVULSO'", [empresa])).rows[0]?.id
          || (await db.query(
            "insert into clientes (empresa_id, tipo, nome) values ($1, 'avulso', 'CLIENTE PARTICULAR / AVULSO') returning id", [empresa])).rows[0].id;
      }

      const servico = (await db.query('select id from servicos where id = $1 and empresa_id = $2 and ativo', [b.servico_id, empresa])).rows[0];
      if (!servico) throw new Recusa(400, 'Serviço não encontrado.');

      // Checklist: o do tipo do veículo, senão o geral do grupo
      const modelo = (await db.query(
        `select id from checklist_modelos
          where empresa_id = $1 and ativo and (tipo_veiculo is null or tipo_veiculo = $2)
          order by tipo_veiculo nulls last limit 1`, [empresa, veiculo.tipo])).rows[0]?.id || null;

      const nova = (await db.query(
        `insert into vistorias (loja_id, empresa_id, numero, servico_id, cliente_id, veiculo_id, checklist_id,
                                vistoriador_id, status, iniciada_em, km)
         values ($1, $2, 0, $3, $4, $5, $6, $7, 'em_andamento', now(), $8) returning id`,
        [b.loja_id, empresa, servico.id, cliente, veiculo.id, modelo, req.usuarioId,
         Number.isInteger(Number(b.km)) && b.km !== '' && b.km !== null ? Number(b.km) : null])).rows[0].id;

      if (modelo) {
        await db.query(
          `insert into vistoria_itens (vistoria_id, modelo_item_id, grupo, descricao)
           select $1, id, grupo, descricao from checklist_modelo_itens where modelo_id = $2 order by ordem`, [nova, modelo]);
      }
      return nova;
    });
    res.status(201).json({ id });
  }));

  app.get('/api/vistorias/:id', exigeLogin, comRecusa(async (req, res) => {
    const dados = await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVistoria(db, req.params.id);
      const extra = (await db.query(
        `select l.nome as loja, s.nome as servico, u.nome as vistoriador,
                to_jsonb(c) - 'consulta_serasa' as cliente,
                to_jsonb(ve) - 'dados_consulta' as veiculo,
                (select valor from servico_precos p where p.servico_id = s.id and p.tipo_veiculo = ve.tipo
                   and (p.loja_id is null or p.loja_id = l.id) order by p.loja_id nulls last limit 1) as preco
           from lojas l, servicos s, clientes c, veiculos ve
           left join usuarios u on u.id = $5
          where l.id = $1 and s.id = $2 and c.id = $3 and ve.id = $4`,
        [v.loja_id, v.servico_id, v.cliente_id, v.veiculo_id, v.vistoriador_id])).rows[0];
      const itens = (await db.query(
        `select i.id, i.grupo, i.descricao, i.situacao, i.observacao, coalesce(m.exige_foto, false) as exige_foto
           from vistoria_itens i left join checklist_modelo_itens m on m.id = i.modelo_item_id
          where i.vistoria_id = $1 order by coalesce(m.ordem, 9999), i.descricao`, [v.id])).rows;
      const pode = (await db.query(
        `select pode($1, 'vistorias.criar') as editar, pode($1, 'vistorias.concluir') as concluir,
                pode($1, 'vistorias.cancelar') as cancelar`, [v.loja_id])).rows[0];
      return { ...v, ...extra, itens, pode };
    });
    res.json(dados);
  }));

  // Salva o andamento: km, parecer e a situação/observação de cada item
  app.put('/api/vistorias/:id', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVistoria(db, req.params.id);
      await exigir(db, v.loja_id, 'vistorias.criar', 'Seu perfil não pode alterar vistorias.');
      if (!['agendada', 'em_andamento'].includes(v.status)) throw new Recusa(400, 'Esta vistoria já foi encerrada e não pode mais ser alterada.');
      const km = b.km === '' || b.km === null || b.km === undefined ? null : Number(b.km);
      if (km !== null && (!Number.isInteger(km) || km < 0)) throw new Recusa(400, 'Quilometragem inválida.');
      await db.query(
        `update vistorias set km = $2, parecer = $3, status = 'em_andamento',
                iniciada_em = coalesce(iniciada_em, now()), atualizado_em = now() where id = $1`,
        [v.id, km, texto(b.parecer, 4000)]);
      for (const i of Array.isArray(b.itens) ? b.itens : []) {
        if (!UUID.test(i?.id || '')) continue;
        await db.query(
          'update vistoria_itens set situacao = $3, observacao = $4 where id = $2 and vistoria_id = $1',
          [v.id, i.id, SITUACOES.includes(i.situacao) ? i.situacao : null, texto(i.observacao, 500)]);
      }
    });
    res.json({ ok: true });
  }));

  // Conclui com o resultado. Todos os itens precisam estar respondidos.
  app.post('/api/vistorias/:id/concluir', exigeLogin, comRecusa(async (req, res) => {
    const resultado = req.body?.resultado;
    if (!RESULTADOS.includes(resultado)) throw new Recusa(400, 'Escolha o resultado da vistoria.');
    await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVistoria(db, req.params.id);
      await exigir(db, v.loja_id, 'vistorias.concluir', 'Seu perfil não pode concluir vistorias.');
      if (!['agendada', 'em_andamento'].includes(v.status)) throw new Recusa(400, 'Esta vistoria já foi encerrada.');
      const faltam = (await db.query('select count(*)::int as n from vistoria_itens where vistoria_id = $1 and situacao is null', [v.id])).rows[0].n;
      if (faltam) throw new Recusa(400, `Faltam ${faltam} item(ns) do checklist para responder.`);
      await db.query(
        `update vistorias set status = 'concluida', resultado = $2, parecer = coalesce($3, parecer),
                concluida_em = now(), atualizado_em = now() where id = $1`,
        [v.id, resultado, texto(req.body?.parecer, 4000)]);
    });
    res.json({ ok: true });
  }));

  app.post('/api/vistorias/:id/cancelar', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVistoria(db, req.params.id);
      await exigir(db, v.loja_id, 'vistorias.cancelar', 'Seu perfil não pode cancelar vistorias.');
      if (v.status === 'cancelada') return;
      if (v.status === 'concluida') throw new Recusa(400, 'Vistoria concluída não pode ser cancelada.');
      const motivo = texto(req.body?.motivo, 500);
      await db.query(
        `update vistorias set status = 'cancelada', atualizado_em = now(),
                parecer = concat_ws(E'\n', parecer, 'Cancelada: ' || coalesce($2, 'sem motivo informado')) where id = $1`,
        [v.id, motivo]);
    });
    res.json({ ok: true });
  }));
}
