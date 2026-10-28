import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, exigir, texto } from './comum.js';

// Relatórios: dados das vendas e do financeiro para o relatório que a pessoa monta
// (colunas, filtros e agrupamento ficam na tela), modelos salvos e o faturamento:
// vendas de um cliente que ainda não foram pagas viram uma conta a receber (previsão).

const FUSO = 'America/Sao_Paulo';
const dataValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : null);
const uuid = (v) => (UUID.test(v || '') ? v : null);

// Quanto falta receber da venda: total menos o que já foi pago (o "faturado" ainda não foi pago)
const A_FATURAR = `greatest(v.valor_total - coalesce((select sum(p.valor) from venda_pagamentos p
                     where p.venda_id = v.id and p.forma <> 'faturado'), 0), 0)`;

export function rotasRelatorios(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  // Vendas, uma linha por venda. Cliente: a própria pessoa/empresa ou todas as empresas do grupo de clientes.
  app.get('/api/relatorios/vendas', exigeLogin, comRecusa(async (req, res) => {
    const q = req.query;
    const situacao = ['aberta', 'futuro', 'finalizada', 'cancelada'].includes(q.situacao) ? q.situacao : null;
    const faturar = q.faturar === '1';  // só as que ainda têm valor a faturar e não foram faturadas
    const params = [uuid(q.loja), uuid(q.cliente), dataValida(q.de), dataValida(q.ate), situacao, faturar, uuid(q.vendedor)];
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select v.id, v.numero, v.data_venda, v.situacao, v.valor_bruto, v.desconto, v.valor_total, v.loja_id, l.nome as loja,
              v.empresa_id, c.id as cliente_id, c.nome as cliente, c.cpf_cnpj, g.nome as grupo_cliente, u.nome as vendedor,
              (select string_agg(distinct ve.placa, ', ') from venda_itens i join veiculos ve on ve.id = i.veiculo_id where i.venda_id = v.id) as placas,
              (select string_agg(distinct nullif(concat_ws(' ', ve.marca, ve.modelo), ''), ', ') from venda_itens i join veiculos ve on ve.id = i.veiculo_id
                where i.venda_id = v.id) as veiculos,
              (select string_agg(distinct coalesce(s.nome, i.descricao), ', ') from venda_itens i left join servicos s on s.id = i.servico_id
                where i.venda_id = v.id) as servicos,
              (select string_agg(distinct p.forma::text, ',') from venda_pagamentos p where p.venda_id = v.id) as formas,
              ${A_FATURAR} as a_faturar,
              lv.lancamento_id as faturada_em
         from vendas v
         join lojas l on l.id = v.loja_id
         join clientes c on c.id = v.cliente_id
         left join clientes g on g.id = c.grupo_cliente_id
         left join usuarios u on u.id = v.vendedor_id
         left join lancamento_vendas lv on lv.venda_id = v.id
        where pode(v.loja_id, 'relatorios.ver')
          and ($1::uuid is null or v.loja_id = $1)
          and ($2::uuid is null or c.id = $2 or c.grupo_cliente_id = $2)
          and ($3::date is null or v.data_venda >= $3)
          and ($4::date is null or v.data_venda <= $4)
          and ($5::situacao_venda is null or v.situacao = $5)
          and (not $6 or (v.situacao not in ('cancelada', 'futuro') and lv.venda_id is null and ${A_FATURAR} > 0))
          and ($7::uuid is null or v.vendedor_id = $7)
        order by v.data_venda, v.numero
        limit 5000`, params)).rows));
  }));

  // Contas a pagar e a receber
  app.get('/api/relatorios/financeiro', exigeLogin, comRecusa(async (req, res) => {
    const q = req.query;
    const tipo = ['receber', 'pagar'].includes(q.tipo) ? q.tipo : null;
    const situacao = ['aberto', 'vencido', 'pago', 'cancelado'].includes(q.situacao) ? q.situacao : null;
    const campoData = q.data === 'competencia' ? 'competencia' : q.data === 'pagamento' ? 'pago_em' : 'vencimento';
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select f.id, f.tipo, f.descricao, f.vencimento, f.competencia, f.pago_em, f.valor, f.valor_pago, f.valor - f.valor_pago as saldo,
              f.status, f.parcela, f.total_parcelas, f.documento, l.nome as loja, cat.nome as categoria, cc.nome as centro,
              c.nome as cliente, c.cpf_cnpj,
              f.status in ('em_aberto', 'pago_parcial') and f.vencimento < (now() at time zone '${FUSO}')::date as vencido,
              (select count(*)::int from lancamento_vendas lv where lv.lancamento_id = f.id) as vendas
         from lancamentos f
         join lojas l on l.id = f.loja_id
         left join categorias_financeiras cat on cat.id = f.categoria_id
         left join centros_custo cc on cc.id = f.centro_custo_id
         left join clientes c on c.id = f.cliente_id
        where pode(f.loja_id, 'relatorios.ver') and pode(f.loja_id, 'financeiro.ver')
          and ($1::tipo_lancamento is null or f.tipo = $1)
          and ($2::uuid is null or f.loja_id = $2)
          and ($3::uuid is null or c.id = $3 or c.grupo_cliente_id = $3)
          and ($4::date is null or f.${campoData} >= $4)
          and ($5::date is null or f.${campoData} <= $5)
          and ($6::text is null
               or ($6 = 'aberto' and f.status in ('em_aberto', 'pago_parcial'))
               or ($6 = 'vencido' and f.status in ('em_aberto', 'pago_parcial') and f.vencimento < (now() at time zone '${FUSO}')::date)
               or ($6 = 'pago' and f.status = 'pago')
               or ($6 = 'cancelado' and f.status = 'cancelado'))
        order by f.${campoData} nulls last, f.descricao
        limit 5000`, [tipo, uuid(q.loja), uuid(q.cliente), dataValida(q.de), dataValida(q.ate), situacao])).rows));
  }));

  // ------------------------------------------------------------ modelos salvos
  app.get('/api/relatorios/modelos', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) =>
      (await db.query('select id, nome, fonte, config from relatorio_modelos order by nome')).rows));
  }));

  app.post('/api/relatorios/modelos', exigeLogin, comRecusa(async (req, res) => {
    const nome = texto(req.body?.nome, 60)?.toUpperCase();
    const fonte = ['vendas', 'financeiro', 'faturar'].includes(req.body?.fonte) ? req.body.fonte : null;
    if (!nome || !fonte) throw new Recusa(400, 'Dê um nome ao modelo.');
    const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
    if (JSON.stringify(config).length > 5000) throw new Recusa(400, 'Modelo grande demais.');
    const id = await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `insert into relatorio_modelos (nome, fonte, config) values ($1, $2, $3)
       on conflict (usuario_id, lower(nome)) do update set fonte = excluded.fonte, config = excluded.config returning id`,
      [nome, fonte, config])).rows[0].id);
    res.json({ id });
  }));

  app.delete('/api/relatorios/modelos/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Modelo não encontrado.');
    await comoUsuario(req.usuarioId, (db) => db.query('delete from relatorio_modelos where id = $1', [req.params.id]));
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ gerar recebimento
  // Junta as vendas escolhidas numa conta a receber por loja (centro de custo), em aberto:
  // é a previsão de recebimento no financeiro. Cada venda só entra uma vez.
  app.post('/api/relatorios/faturar', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.vendas) ? b.vendas : []).filter((i) => UUID.test(String(i))))].slice(0, 1000);
    if (!ids.length) throw new Recusa(400, 'Marque as vendas que vão para o recebimento.');
    const vencimento = dataValida(b.vencimento);
    if (!vencimento) throw new Recusa(400, 'Informe a data prevista do recebimento.');
    const criados = await comoUsuario(req.usuarioId, async (db) => {
      const vendas = (await db.query(
        `select v.id, v.numero, v.loja_id, v.empresa_id, v.cliente_id, c.nome as cliente, c.grupo_cliente_id, v.situacao,
                ${A_FATURAR} as a_faturar, lv.venda_id is not null as faturada
           from vendas v join clientes c on c.id = v.cliente_id left join lancamento_vendas lv on lv.venda_id = v.id
          where v.id = any($1)`, [ids])).rows;
      if (vendas.length !== ids.length) throw new Recusa(400, 'Alguma venda não foi encontrada.');
      const ruins = vendas.filter((v) => v.faturada || v.situacao === 'cancelada' || v.situacao === 'futuro' || !(Number(v.a_faturar) > 0));
      if (ruins.length) throw new Recusa(400, `Estas vendas já foram faturadas, pagas ou canceladas: ${ruins.map((v) => `nº ${v.numero}`).join(', ')}. Atualize a lista.`);
      if (new Set(vendas.map((v) => v.empresa_id)).size > 1) throw new Recusa(400, 'As vendas precisam ser do mesmo grupo.');
      const empresa = vendas[0].empresa_id;
      // cliente da conta: o grupo de clientes, se todas forem dele; senão, o cliente da venda (precisa ser um só)
      const grupos = new Set(vendas.map((v) => v.grupo_cliente_id || v.cliente_id));
      const clientes = new Set(vendas.map((v) => v.cliente_id));
      if (grupos.size > 1) throw new Recusa(400, 'Marque vendas de um cliente só (ou das empresas de um mesmo grupo).');
      const clienteConta = clientes.size === 1 ? [...clientes][0] : [...grupos][0];
      const nomeCliente = (await db.query('select nome from clientes where id = $1', [clienteConta])).rows[0]?.nome;

      const categoria = uuid(b.categoria_id);
      const cat = (await db.query("select id from categorias_financeiras where id = $1 and empresa_id = $2 and tipo = 'receber' and not grupo and ativo",
        [categoria, empresa])).rows[0];
      if (!cat) throw new Recusa(400, 'Escolha a categoria de receita.');
      const descricao = texto(b.descricao, 200)?.toUpperCase() || `FATURA ${nomeCliente}`;

      const porLoja = new Map();
      for (const v of vendas) (porLoja.get(v.loja_id) || porLoja.set(v.loja_id, []).get(v.loja_id)).push(v);
      const novos = [];
      for (const [loja, lista] of porLoja) {
        await exigir(db, loja, 'financeiro.lancar', 'Seu perfil não pode lançar contas a receber numa das lojas destas vendas.');
        const centro = (await db.query('select id from centros_custo where empresa_id = $1 and loja_id = $2 and ativo order by criado_em limit 1', [empresa, loja])).rows[0]?.id || null;
        const total = Math.round(lista.reduce((t, v) => t + Number(v.a_faturar), 0) * 100) / 100;
        const numeros = lista.map((v) => v.numero).sort((a, b2) => a - b2);
        const lid = (await db.query(
          `insert into lancamentos (loja_id, tipo, categoria_id, centro_custo_id, cliente_id, descricao, competencia, vencimento, valor,
                                    documento, observacoes, criado_por)
           values ($1, 'receber', $2, $3, $4, $5, (now() at time zone '${FUSO}')::date, $6, $7, $8, $9, $10) returning id`,
          [loja, cat.id, centro, clienteConta, descricao, vencimento, total, texto(b.documento, 60),
           `Vendas nº ${numeros.join(', ')}`, req.usuarioId])).rows[0].id;
        for (const v of lista) {
          await db.query('insert into lancamento_vendas (lancamento_id, venda_id, valor) values ($1, $2, $3)', [lid, v.id, v.a_faturar]);
          await db.query("insert into venda_historico (venda_id, usuario_id, acao, detalhe) values ($1, $2, 'alterada', $3)",
            [v.id, req.usuarioId, `Faturada: conta a receber de ${vencimento.split('-').reverse().join('/')}`]);
        }
        novos.push({ id: lid, loja_id: loja });
      }
      return novos;
    }).catch((e) => { if (e.code === '23505') throw new Recusa(400, 'Alguma venda já foi faturada agora há pouco. Atualize a lista.'); throw e; });
    res.json({ lancamentos: criados });
  }));
}
