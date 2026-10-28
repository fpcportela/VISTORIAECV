import express from 'express';
import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, exigir, texto } from './comum.js';

// Contas a pagar e a receber, com plano de contas (grupos e categorias de
// receitas e despesas) e centros de custo. Cada parcela é um lançamento.

const TIPOS = ['receber', 'pagar'];
const FORMAS = ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'faturado'];
const FUSO = 'America/Sao_Paulo';
const dataValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : null);
// Aceita 150, "150.5" ou "1.234,56"
const dinheiro = (v) => {
  const t = String(v ?? '').trim();
  const n = typeof v === 'number' ? v : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return t !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
// Soma meses mantendo o dia (31/01 + 1 mês = 28/02)
function somarMeses(data, meses) {
  const [a, m, d] = data.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

async function empresaDaLoja(db, loja) {
  if (!UUID.test(loja || '')) throw new Recusa(400, 'Escolha a loja.');
  const e = (await db.query('select empresa_id from lojas where id = $1', [loja])).rows[0]?.empresa_id;
  if (!e) throw new Recusa(403, 'Você não tem acesso a esta loja.');
  return e;
}

async function lancamento(db, id) {
  if (!UUID.test(id || '')) throw new Recusa(404, 'Lançamento não encontrado.');
  const l = (await db.query('select * from lancamentos where id = $1', [id])).rows[0];
  if (!l) throw new Recusa(404, 'Lançamento não encontrado.');
  return l;
}

// Pode configurar o plano de contas deste grupo? (precisa da permissão em alguma loja dele)
async function exigirPlano(db, empresa) {
  const ok = (await db.query(
    "select eh_admin_rede() or exists (select 1 from lojas l where l.empresa_id = $1 and pode(l.id, 'financeiro.plano')) as ok", [empresa])).rows[0].ok;
  if (!ok) throw new Recusa(403, 'Seu perfil não pode alterar o plano de contas.');
}

export function rotasFinanceiro(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  // ------------------------------------------------------------ plano de contas
  app.get('/api/financeiro/plano', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, req.query.loja);
      return (await db.query(
        `select c.id, c.tipo, c.nome, c.codigo, c.grupo, c.pai_id, c.ativo,
                (select count(*)::int from lancamentos l where l.categoria_id = c.id) as usos
           from categorias_financeiras c where c.empresa_id = $1
          order by c.tipo desc, coalesce(c.codigo, '9999'), c.nome`, [empresa])).rows;
    }));
  }));

  const salvarCategoria = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 80);
    if (!nome) throw new Recusa(400, 'Informe o nome.');
    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, b.loja_id);
      await exigirPlano(db, empresa);
      const codigo = texto(b.codigo, 12);
      if (id) {
        const r = await db.query(
          'update categorias_financeiras set nome = $3, codigo = $4, ativo = $5 where id = $1 and empresa_id = $2',
          [id, empresa, nome, codigo, b.ativo !== false]);
        if (!r.rowCount) throw new Recusa(404, 'Categoria não encontrada.');
        return id;
      }
      const grupo = b.grupo === true;
      let tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
      let pai = null;
      if (!grupo) {
        const g = (await db.query('select id, tipo from categorias_financeiras where id = $1 and empresa_id = $2 and grupo',
          [UUID.test(b.pai_id || '') ? b.pai_id : null, empresa])).rows[0];
        if (!g) throw new Recusa(400, 'Escolha o grupo da categoria.');
        pai = g.id; tipo = g.tipo;
      }
      if (!tipo) throw new Recusa(400, 'Escolha se é receita ou despesa.');
      if ((await db.query('select 1 from categorias_financeiras where empresa_id = $1 and tipo = $2 and lower(nome) = lower($3)',
        [empresa, tipo, nome])).rowCount) throw new Recusa(400, 'Já existe uma categoria ou grupo com este nome.');
      return (await db.query(
        `insert into categorias_financeiras (empresa_id, tipo, nome, codigo, grupo, pai_id)
         values ($1, $2, $3, $4, $5, $6) returning id`, [empresa, tipo, nome, codigo, grupo, pai])).rows[0].id;
    });
    res.json({ id: novoId });
  });
  app.post('/api/financeiro/categorias', exigeLogin, salvarCategoria(null));
  app.put('/api/financeiro/categorias/:id', exigeLogin, (req, res) =>
    (UUID.test(req.params.id) ? salvarCategoria(req.params.id)(req, res) : res.status(404).json({ erro: 'Categoria não encontrada.' })));

  // ------------------------------------------------------------ centros de custo
  app.get('/api/financeiro/centros', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, req.query.loja);
      return (await db.query(
        `select c.id, c.nome, c.loja_id, c.ativo, (select count(*)::int from lancamentos l where l.centro_custo_id = c.id) as usos
           from centros_custo c where c.empresa_id = $1 order by c.ativo desc, c.nome`, [empresa])).rows;
    }));
  }));

  const salvarCentro = (id) => comRecusa(async (req, res) => {
    const nome = texto(req.body?.nome, 80);
    if (!nome) throw new Recusa(400, 'Informe o nome do centro de custo.');
    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, req.body?.loja_id);
      await exigirPlano(db, empresa);
      if ((await db.query('select 1 from centros_custo where empresa_id = $1 and lower(nome) = lower($2) and id is distinct from $3',
        [empresa, nome, id ?? null])).rowCount) throw new Recusa(400, 'Já existe um centro de custo com este nome.');
      if (id) {
        const r = await db.query('update centros_custo set nome = $3, ativo = $4 where id = $1 and empresa_id = $2',
          [id, empresa, nome, req.body?.ativo !== false]);
        if (!r.rowCount) throw new Recusa(404, 'Centro de custo não encontrado.');
        return id;
      }
      return (await db.query('insert into centros_custo (empresa_id, nome) values ($1, $2) returning id', [empresa, nome])).rows[0].id;
    });
    res.json({ id: novoId });
  });
  app.post('/api/financeiro/centros', exigeLogin, salvarCentro(null));
  app.put('/api/financeiro/centros/:id', exigeLogin, (req, res) =>
    (UUID.test(req.params.id) ? salvarCentro(req.params.id)(req, res) : res.status(404).json({ erro: 'Centro de custo não encontrado.' })));

  // ------------------------------------------------------------ contas (caixa/banco) para receber e pagar
  app.get('/api/financeiro/contas', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const loja = req.query.loja;
      await empresaDaLoja(db, loja);
      let contas = (await db.query("select id, nome, tipo from contas_financeiras where loja_id = $1 and ativo and tipo <> 'adquirente' order by nome", [loja])).rows;
      // toda loja tem pelo menos o caixa
      if (!contas.length && (await db.query("select pode($1, 'financeiro.lancar') as ok", [loja])).rows[0].ok) {
        contas = (await db.query(
          "insert into contas_financeiras (loja_id, tipo, nome) select $1, 'caixa', 'Caixa ' || nome from lojas where id = $1 returning id, nome, tipo", [loja])).rows;
      }
      return contas;
    }));
  }));

  // ------------------------------------------------------------ lançamentos
  // situacao: aberto (em aberto/parcial), vencido, pago, cancelado
  app.get('/api/financeiro/lancamentos', exigeLogin, comRecusa(async (req, res) => {
    const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : null;
    const loja = UUID.test(req.query.loja || '') ? req.query.loja : null;
    const situacao = ['aberto', 'vencido', 'pago', 'cancelado'].includes(req.query.situacao) ? req.query.situacao : null;
    const categoria = UUID.test(req.query.categoria || '') ? req.query.categoria : null;
    const centro = UUID.test(req.query.centro || '') ? req.query.centro : null;
    const de = dataValida(req.query.de);
    const ate = dataValida(req.query.ate);
    const busca = texto(req.query.busca, 60);
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select l.id, l.tipo, l.descricao, l.vencimento, l.competencia, l.valor, l.valor_pago, l.status, l.parcela, l.total_parcelas,
              l.documento, l.loja_id, lj.nome as loja, l.categoria_id, c.nome as categoria, c.codigo as categoria_codigo,
              l.centro_custo_id, cc.nome as centro, l.pago_em, l.venda_id,
              l.status in ('em_aberto', 'pago_parcial') and l.vencimento < (now() at time zone '${FUSO}')::date as vencido
         from lancamentos l
         join lojas lj on lj.id = l.loja_id
         left join categorias_financeiras c on c.id = l.categoria_id
         left join centros_custo cc on cc.id = l.centro_custo_id
        where pode(l.loja_id, 'financeiro.ver')
          and ($1::tipo_lancamento is null or l.tipo = $1)
          and ($2::uuid is null or l.loja_id = $2)
          and ($3::text is null
               or ($3 = 'aberto' and l.status in ('em_aberto', 'pago_parcial'))
               or ($3 = 'vencido' and l.status in ('em_aberto', 'pago_parcial') and l.vencimento < (now() at time zone '${FUSO}')::date)
               or ($3 = 'pago' and l.status = 'pago')
               or ($3 = 'cancelado' and l.status = 'cancelado'))
          and ($4::uuid is null or l.categoria_id = $4 or c.pai_id = $4)
          and ($5::uuid is null or l.centro_custo_id = $5)
          and ($6::date is null or l.vencimento >= $6)
          and ($7::date is null or l.vencimento <= $7)
          and ($8::text is null or l.descricao ilike '%' || $8 || '%' or l.documento ilike '%' || $8 || '%'
               or l.observacoes ilike '%' || $8 || '%' or l.cv ilike '%' || $8 || '%'
               -- nº da venda: a própria venda do lançamento ou uma das vendas da fatura
               or ($8 ~ '^\\d+$' and exists (select 1 from vendas v where v.numero::text = $8
                     and (v.id = l.venda_id or v.id in (select venda_id from lancamento_vendas where lancamento_id = l.id)))))
        order by l.vencimento, l.descricao
        limit 2000`, [tipo, loja, situacao, categoria, centro, de, ate, busca])).rows));
  }));

  app.get('/api/financeiro/lancamentos/:id', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const l = await lancamento(db, req.params.id);
      await exigir(db, l.loja_id, 'financeiro.ver', 'Seu perfil não pode ver o financeiro.');
      l.baixas = (await db.query(
        `select b.id, b.data, b.valor, b.juros, b.multa, b.desconto, b.forma_pagamento, c.nome as conta, u.nome as usuario, b.criado_em
           from lancamento_baixas b join contas_financeiras c on c.id = b.conta_id left join usuarios u on u.id = b.criado_por
          where b.lancamento_id = $1 order by b.data, b.criado_em`, [l.id])).rows;
      l.pode = (await db.query(
        "select pode($1, 'financeiro.lancar') as lancar, pode($1, 'financeiro.excluir') as excluir", [l.loja_id])).rows[0];
      // vendas do lançamento (a da própria venda ou as da fatura do Faturar cliente), para abrir na tela Vendas
      l.vendas = (await db.query(
        `select v.id, v.numero from vendas v
          where v.id = $2 or v.id in (select venda_id from lancamento_vendas where lancamento_id = $1) order by v.numero`, [l.id, l.venda_id])).rows;
      l.arquivos = (await db.query(
        `select a.id, a.nome, a.nome_arquivo, a.mime, a.tamanho, a.criado_em, u.nome as enviado_por
           from lancamento_arquivos a left join usuarios u on u.id = a.enviado_por
          where a.lancamento_id = $1 order by a.criado_em`, [l.id])).rows;
      return l;
    }));
  }));

  // Valida e normaliza os campos comuns de criação e edição
  async function campos(db, b, empresa, tipo) {
    const descricao = texto(b.descricao, 200);
    if (!descricao) throw new Recusa(400, 'Informe a descrição.');
    const vencimento = dataValida(b.vencimento);
    if (!vencimento) throw new Recusa(400, 'Informe o vencimento.');
    // competência é só mês/ano: guarda o primeiro dia do mês
    const competencia = `${(/^\d{4}-\d{2}$/.test(b.competencia || '') ? b.competencia : (dataValida(b.competencia) || vencimento).slice(0, 7))}-01`;
    const cat = (await db.query('select id, tipo, grupo from categorias_financeiras where id = $1 and empresa_id = $2 and ativo',
      [UUID.test(b.categoria_id || '') ? b.categoria_id : null, empresa])).rows[0];
    if (!cat || cat.grupo) throw new Recusa(400, 'Escolha a categoria do plano de contas.');
    if (cat.tipo !== tipo) throw new Recusa(400, tipo === 'receber' ? 'Escolha uma categoria de receita.' : 'Escolha uma categoria de despesa.');
    let centro = null;
    if (b.centro_custo_id) {
      centro = (await db.query('select id from centros_custo where id = $1 and empresa_id = $2',
        [UUID.test(b.centro_custo_id) ? b.centro_custo_id : null, empresa])).rows[0]?.id;
      if (!centro) throw new Recusa(400, 'Centro de custo não encontrado.');
    }
    const forma = FORMAS.includes(b.forma_pagamento) ? b.forma_pagamento : null;
    const cv = forma === 'cartao_credito' || forma === 'cartao_debito' ? texto(b.cv, 40) : null;
    return { descricao, vencimento, competencia, categoria: cat.id, centro, documento: texto(b.documento, 60), observacoes: texto(b.observacoes, 1000), forma, cv };
  }

  app.post('/api/financeiro/lancamentos', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
    if (!tipo) throw new Recusa(400, 'Escolha se é a receber ou a pagar.');
    const total = dinheiro(b.valor);
    if (!(total > 0)) throw new Recusa(400, 'Informe o valor.');
    const parcelas = Math.trunc(Number(b.parcelas || 1));
    if (!(parcelas >= 1 && parcelas <= 60)) throw new Recusa(400, 'Parcelas: de 1 a 60.');
    const ids = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, b.loja_id);
      await exigir(db, b.loja_id, 'financeiro.lancar', 'Seu perfil não pode lançar contas nesta loja.');
      const c = await campos(db, b, empresa, tipo);
      // divide o total em parcelas mensais; a última leva a diferença de centavos
      const base = Math.floor((total / parcelas) * 100) / 100;
      const grupo = parcelas > 1 ? (await db.query('select gen_random_uuid() as id')).rows[0].id : null;
      const criados = [];
      for (let n = 1; n <= parcelas; n++) {
        const valor = n === parcelas ? Math.round((total - base * (parcelas - 1)) * 100) / 100 : base;
        criados.push((await db.query(
          `insert into lancamentos (loja_id, tipo, categoria_id, centro_custo_id, descricao, competencia, vencimento, valor,
                                    parcela, total_parcelas, grupo_parcelas, documento, observacoes, criado_por)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
          [b.loja_id, tipo, c.categoria, c.centro, c.descricao, somarMeses(c.competencia, n - 1), somarMeses(c.vencimento, n - 1),
           valor, n, parcelas, grupo, c.documento, c.observacoes, req.usuarioId])).rows[0].id);
      }
      return criados;
    });
    res.json({ ids });
  }));

  app.put('/api/financeiro/lancamentos/:id', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    await comoUsuario(req.usuarioId, async (db) => {
      const l = await lancamento(db, req.params.id);
      await exigir(db, l.loja_id, 'financeiro.lancar', 'Seu perfil não pode alterar lançamentos.');
      if (l.status === 'cancelado') throw new Recusa(400, 'Lançamento cancelado não pode ser alterado.');
      const empresa = await empresaDaLoja(db, l.loja_id);
      const c = await campos(db, b, empresa, l.tipo);
      const valor = dinheiro(b.valor);
      if (!(valor > 0)) throw new Recusa(400, 'Informe o valor.');
      if (valor < l.valor_pago) throw new Recusa(400, 'O valor não pode ser menor que o já pago.');
      // venda: "faturado" é do Faturar cliente (cobraria duas vezes)
      if (l.origem === 'venda' && c.forma === 'faturado') throw new Recusa(400, 'Venda faturada vai pelo Relatórios > Faturar cliente. Escolha outra forma.');
      await db.query(
        `update lancamentos set descricao = $2, vencimento = $3, competencia = $4, categoria_id = $5, centro_custo_id = $6,
                documento = $7, observacoes = $8, valor = $9, forma_pagamento = coalesce($10, forma_pagamento), cv = $11,
                status = case when valor_pago >= $9 then 'pago' when valor_pago > 0 then 'pago_parcial' else 'em_aberto' end::status_lancamento
          where id = $1`,
        [l.id, c.descricao, c.vencimento, c.competencia, c.categoria, c.centro, c.documento, c.observacoes, valor, c.forma, c.forma ? c.cv : l.cv]);
    });
    res.json({ ok: true });
  }));

  // Recebe ou paga (total ou parcial)
  app.post('/api/financeiro/lancamentos/:id/baixar', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const data = dataValida(b.data);
    if (!data) throw new Recusa(400, 'Informe a data do pagamento.');
    const valor = dinheiro(b.valor);
    if (!(valor > 0)) throw new Recusa(400, 'Informe o valor pago.');
    if (!FORMAS.includes(b.forma_pagamento)) throw new Recusa(400, 'Escolha a forma de pagamento.');
    const extras = ['juros', 'multa', 'desconto'].map((k) => dinheiro(b[k] || 0));
    if (extras.some((v) => v === null || v < 0)) throw new Recusa(400, 'Juros, multa e desconto devem ser valores positivos.');
    await comoUsuario(req.usuarioId, async (db) => {
      const l = await lancamento(db, req.params.id);
      await exigir(db, l.loja_id, 'financeiro.lancar', 'Seu perfil não pode receber ou pagar contas.');
      if (!['em_aberto', 'pago_parcial'].includes(l.status)) throw new Recusa(400, 'Este lançamento não está em aberto.');
      if (valor > Math.round((l.valor - l.valor_pago) * 100) / 100) throw new Recusa(400, 'O valor passa do saldo em aberto.');
      const conta = (await db.query('select id from contas_financeiras where id = $1 and loja_id = $2 and ativo',
        [UUID.test(b.conta_id || '') ? b.conta_id : null, l.loja_id])).rows[0];
      if (!conta) throw new Recusa(400, 'Escolha a conta (caixa ou banco).');
      await db.query(
        `insert into lancamento_baixas (lancamento_id, data, valor, juros, multa, desconto, forma_pagamento, conta_id, criado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [l.id, data, valor, ...extras, b.forma_pagamento, conta.id, req.usuarioId]);
      if (l.origem === 'venda' && b.forma_pagamento === 'faturado') throw new Recusa(400, 'Venda faturada vai pelo Relatórios > Faturar cliente. Escolha outra forma.');
      const cartao = ['cartao_credito', 'cartao_debito'].includes(b.forma_pagamento);
      await db.query('update lancamentos set forma_pagamento = $2, conta_id = $3, cv = $4 where id = $1',
        [l.id, b.forma_pagamento, conta.id, cartao ? (texto(b.cv, 40) || l.cv) : null]);
    });
    res.json({ ok: true });
  }));

  // Desfaz um pagamento lançado errado
  app.delete('/api/financeiro/lancamentos/:id/baixas/:baixa', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.baixa)) throw new Recusa(404, 'Pagamento não encontrado.');
    await comoUsuario(req.usuarioId, async (db) => {
      const l = await lancamento(db, req.params.id);
      await exigir(db, l.loja_id, 'financeiro.excluir', 'Seu perfil não pode desfazer pagamentos.');
      const r = await db.query('delete from lancamento_baixas where id = $1 and lancamento_id = $2', [req.params.baixa, l.id]);
      if (!r.rowCount) throw new Recusa(404, 'Pagamento não encontrado.');
    });
    res.json({ ok: true });
  }));

  app.post('/api/financeiro/lancamentos/:id/cancelar', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const l = await lancamento(db, req.params.id);
      await exigir(db, l.loja_id, 'financeiro.lancar', 'Seu perfil não pode cancelar lançamentos.');
      if (l.valor_pago > 0) throw new Recusa(400, 'Este lançamento já tem pagamento. Desfaça o pagamento antes de cancelar.');
      await db.query("update lancamentos set status = 'cancelado' where id = $1", [l.id]);
    });
    res.json({ ok: true });
  }));

  app.delete('/api/financeiro/lancamentos/:id', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const l = await lancamento(db, req.params.id);
      await exigir(db, l.loja_id, 'financeiro.excluir', 'Seu perfil não pode excluir lançamentos.');
      if (l.valor_pago > 0) throw new Recusa(400, 'Este lançamento já tem pagamento. Desfaça o pagamento antes de excluir.');
      await db.query('delete from lancamentos where id = $1', [l.id]);
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ documentos do lançamento
  // O corpo é o próprio arquivo; o nome dado pela pessoa, o nome original e o tipo vão na URL
  app.post('/api/financeiro/lancamentos/:id/arquivos', exigeLogin,
    express.raw({ type: () => true, limit: 15 * 1024 * 1024 }),
    comRecusa(async (req, res) => {
      const conteudo = req.body;
      if (!Buffer.isBuffer(conteudo) || !conteudo.length) throw new Recusa(400, 'Escolha o arquivo.');
      const arquivo = texto(req.query.arquivo, 150) || 'arquivo';
      const nome = (texto(req.query.nome, 120) || arquivo.replace(/\.[^.]+$/, '')).toUpperCase();
      const mime = /^[\w.+-]+\/[\w.+-]+$/.test(req.query.mime || '') ? req.query.mime : 'application/octet-stream';
      const id = await comoUsuario(req.usuarioId, async (db) => {
        const l = await lancamento(db, req.params.id);
        await exigir(db, l.loja_id, 'financeiro.lancar', 'Seu perfil não pode anexar documentos.');
        return (await db.query(
          `insert into lancamento_arquivos (lancamento_id, nome, nome_arquivo, mime, tamanho, conteudo, enviado_por)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`, [l.id, nome, arquivo, mime, conteudo.length, conteudo, req.usuarioId])).rows[0].id;
      });
      res.json({ id });
    }));

  const arquivoLancamento = async (db, id, permissao, mensagem) => {
    if (!UUID.test(id || '')) throw new Recusa(404, 'Arquivo não encontrado.');
    const a = (await db.query('select a.*, l.loja_id from lancamento_arquivos a join lancamentos l on l.id = a.lancamento_id where a.id = $1', [id])).rows[0];
    if (!a) throw new Recusa(404, 'Arquivo não encontrado.');
    await exigir(db, a.loja_id, permissao, mensagem);
    return a;
  };

  app.get('/api/financeiro/arquivos/:id', exigeLogin, comRecusa(async (req, res) => {
    const a = await comoUsuario(req.usuarioId, (db) => arquivoLancamento(db, req.params.id, 'financeiro.ver', 'Seu perfil não pode ver o financeiro.'));
    // baixa com o nome dado + a extensão do arquivo original
    const ext = /\.[A-Za-z0-9]{1,6}$/.exec(a.nome_arquivo)?.[0] || '';
    const nome = /\.[A-Za-z0-9]{1,6}$/.test(a.nome) ? a.nome : `${a.nome}${ext}`;
    res.set('Content-Type', a.mime);
    res.set('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.send(a.conteudo);
  }));

  app.put('/api/financeiro/arquivos/:id', exigeLogin, comRecusa(async (req, res) => {
    const nome = texto(req.body?.nome, 120)?.toUpperCase();
    if (!nome) throw new Recusa(400, 'Informe o nome do documento.');
    await comoUsuario(req.usuarioId, async (db) => {
      const a = await arquivoLancamento(db, req.params.id, 'financeiro.lancar', 'Seu perfil não pode alterar documentos.');
      await db.query('update lancamento_arquivos set nome = $2 where id = $1', [a.id, nome]);
    });
    res.json({ ok: true });
  }));

  app.delete('/api/financeiro/arquivos/:id', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const a = await arquivoLancamento(db, req.params.id, 'financeiro.lancar', 'Seu perfil não pode excluir documentos.');
      await db.query('delete from lancamento_arquivos where id = $1', [a.id]);
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ contas de recebimento e pagamento (caixa e bancos)
  // Todas as contas das lojas do grupo, com o saldo (saldo inicial + recebido − pago desde a data do saldo inicial)
  app.get('/api/financeiro/contas/todas', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, req.query.loja);
      return (await db.query(
        `select c.id, c.loja_id, lj.nome as loja, c.tipo, c.nome, c.banco_codigo, c.agencia, c.conta, c.saldo_inicial,
                c.data_saldo_inicial, c.ativo, pode(c.loja_id, 'financeiro.lancar') as pode_editar,
                c.saldo_inicial + coalesce((select sum(case when l.tipo = 'receber' then 1 else -1 end * (b.valor + b.juros + b.multa - b.desconto))
                                              from lancamento_baixas b join lancamentos l on l.id = b.lancamento_id
                                             where b.conta_id = c.id and b.data >= c.data_saldo_inicial), 0) as saldo
           from contas_financeiras c join lojas lj on lj.id = c.loja_id
          where lj.empresa_id = $1 and c.tipo <> 'adquirente' and pode(c.loja_id, 'financeiro.ver')
          order by c.ativo desc, lj.nome, c.nome`, [empresa])).rows;
    }));
  }));

  const salvarConta = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 80)?.toUpperCase();
    if (!nome) throw new Recusa(400, 'Informe o nome da conta.');
    const tipo = ['caixa', 'conta_corrente', 'poupanca'].includes(b.tipo) ? b.tipo : 'conta_corrente';
    const saldo = dinheiro(b.saldo_inicial ?? 0);
    if (saldo === null) throw new Recusa(400, 'Saldo inicial inválido.');
    const desde = dataValida(b.data_saldo_inicial) || new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
    const dados = [nome, tipo, texto(b.banco_codigo, 10), texto(b.agencia, 20), texto(b.conta, 30), saldo, desde, b.ativo !== false];
    const novo = await comoUsuario(req.usuarioId, async (db) => {
      if (id) {
        if (!UUID.test(id)) throw new Recusa(404, 'Conta não encontrada.');
        const c = (await db.query('select loja_id from contas_financeiras where id = $1', [id])).rows[0];
        if (!c) throw new Recusa(404, 'Conta não encontrada.');
        await exigir(db, c.loja_id, 'financeiro.lancar', 'Seu perfil não pode alterar contas.');
        await db.query(
          `update contas_financeiras set nome = $2, tipo = $3, banco_codigo = $4, agencia = $5, conta = $6, saldo_inicial = $7,
                  data_saldo_inicial = $8, ativo = $9 where id = $1`, [id, ...dados]);
        return id;
      }
      await exigir(db, b.loja_id, 'financeiro.lancar', 'Seu perfil não pode criar contas nesta loja.');
      return (await db.query(
        `insert into contas_financeiras (loja_id, nome, tipo, banco_codigo, agencia, conta, saldo_inicial, data_saldo_inicial, ativo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [b.loja_id, ...dados])).rows[0].id;
    });
    res.json({ id: novo });
  });
  app.post('/api/financeiro/contas', exigeLogin, salvarConta(null));
  app.put('/api/financeiro/contas/:id', exigeLogin, (req, res) => salvarConta(req.params.id)(req, res));
}
