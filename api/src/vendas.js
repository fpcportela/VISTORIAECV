import { comoUsuario } from './db.js';
import { normalizarPlaca } from './placas.js';
import { Recusa, UUID, criarComRecusa, exigir, resolverCliente, texto } from './comum.js';
import { cnpjValido, consultarCnpj } from './documentos.js';

const TIPOS_VEICULO = ['carro', 'moto', 'caminhao', 'outro'];
const FORMAS = ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'faturado'];
const reais = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (v) => {
  // aceita 150, "150.5" ou "1.234,56"
  const t = String(v ?? '').trim();
  const n = typeof v === 'number' ? v : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const dataValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);

async function empresaDaLoja(db, loja) {
  if (!UUID.test(loja || '')) throw new Recusa(400, 'Escolha a loja.');
  const e = (await db.query('select empresa_id from lojas where id = $1', [loja])).rows[0]?.empresa_id;
  if (!e) throw new Recusa(403, 'Você não tem acesso a esta loja.');
  return e;
}

// Serviços/produtos com o preço por tipo de veículo (o da loja vale mais que o geral)
const SQL_SERVICOS = `
  select s.id, s.nome, s.tipo, s.descricao, s.valor_padrao, s.gera_vistoria, s.ativo,
         coalesce((select jsonb_object_agg(tipo_veiculo, valor) from (
            select distinct on (p.tipo_veiculo) p.tipo_veiculo, p.valor
              from servico_precos p
             where p.servico_id = s.id and (p.loja_id is null or p.loja_id = $1)
             order by p.tipo_veiculo, p.loja_id nulls last) x), '{}') as precos
    from servicos s join lojas l on l.empresa_id = s.empresa_id
   where l.id = $1`;

export function rotasVendas(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  // ?uso=vistoria (só os que geram vistoria) | venda (ativos) | cadastro (todos)
  app.get('/api/servicos', exigeLogin, comRecusa(async (req, res) => {
    const uso = req.query.uso || 'vistoria';
    const lista = await comoUsuario(req.usuarioId, async (db) => {
      await empresaDaLoja(db, req.query.loja);
      return (await db.query(`${SQL_SERVICOS}
        ${uso === 'cadastro' ? '' : 'and s.ativo'} ${uso === 'vistoria' ? "and s.gera_vistoria and s.tipo = 'servico'" : ''}
        order by s.tipo desc, s.nome`, [req.query.loja])).rows;
    });
    res.json(lista);
  }));

  // Cadastro de serviços e produtos (vale para o grupo da loja)
  const salvarServico = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 80)?.toUpperCase();
    if (!nome) throw new Recusa(400, 'Informe o nome.');
    const tipo = b.tipo === 'produto' ? 'produto' : 'servico';
    const valor = dinheiro(b.valor_padrao ?? 0);
    if (valor === null) throw new Recusa(400, 'Valor inválido.');
    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, b.loja_id);
      await exigir(db, b.loja_id, 'servicos.gerenciar', 'Seu perfil não pode cadastrar serviços e produtos.');
      const campos = [nome, tipo, texto(b.descricao, 300), valor, tipo === 'servico' && b.gera_vistoria !== false, b.ativo !== false];
      let sid = id;
      if (sid) {
        const ok = (await db.query(
          `update servicos set nome = $3, tipo = $4, descricao = $5, valor_padrao = $6, gera_vistoria = $7, ativo = $8
            where id = $1 and empresa_id = $2`, [sid, empresa, ...campos])).rowCount;
        if (!ok) throw new Recusa(404, 'Serviço não encontrado.');
      } else {
        sid = (await db.query(
          `insert into servicos (empresa_id, nome, tipo, descricao, valor_padrao, gera_vistoria, ativo)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`, [empresa, ...campos])).rows[0].id;
      }
      // Preços gerais por tipo de veículo (vazio = usa o valor padrão)
      await db.query('delete from servico_precos where servico_id = $1 and loja_id is null', [sid]);
      for (const t of TIPOS_VEICULO) {
        const v = b.precos?.[t];
        if (v === '' || v === null || v === undefined) continue;
        const n = dinheiro(v);
        if (n === null) throw new Recusa(400, 'Preço inválido.');
        await db.query('insert into servico_precos (servico_id, tipo_veiculo, valor) values ($1, $2, $3)', [sid, t, n]);
      }
      return sid;
    });
    res.json({ id: novoId });
  });
  app.post('/api/servicos', exigeLogin, (req, res) => salvarServico(null)(req, res));
  app.put('/api/servicos/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvarServico(req.params.id)(req, res) : res.status(404).json({ erro: 'Serviço não encontrado.' }));

  // ---------------------------------------------------------------- vendas
  app.get('/api/vendas', exigeLogin, comRecusa(async (req, res) => {
    const loja = UUID.test(req.query.loja || '') ? req.query.loja : null;
    const situacao = ['aberta', 'finalizada', 'cancelada'].includes(req.query.situacao) ? req.query.situacao : null;
    const tipo = ['orcamento', 'venda_avulsa'].includes(req.query.tipo) ? req.query.tipo : null;
    const periodo = ['hoje', 'mes'].includes(req.query.periodo) ? req.query.periodo : null;
    const busca = texto(req.query.busca, 60);
    // Cliente: nome, CPF ou CNPJ (com ou sem pontuação)
    const cliente = texto(req.query.cliente, 60);
    const docCliente = cliente?.replace(/\D/g, '') || '';
    const de = dataValida(req.query.de), ate = dataValida(req.query.ate);
    const lista = await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select v.id, v.numero, v.tipo, v.situacao, v.data_venda, v.valor_bruto, v.desconto, v.valor_total, v.loja_id, l.nome as loja,
              c.nome as cliente, c.cpf_cnpj, u.nome as vendedor,
              (select string_agg(distinct ve.placa, ', ') from venda_itens i join veiculos ve on ve.id = i.veiculo_id
                where i.venda_id = v.id) as placas,
              (select ve.tipo from venda_itens i join veiculos ve on ve.id = i.veiculo_id where i.venda_id = v.id order by i.ctid limit 1) as tipo_veiculo,
              (select json_agg(x order by x.placa) from (select distinct ve.placa, nullif(concat_ws(' ', ve.marca, ve.modelo), '') as modelo
                 from venda_itens i join veiculos ve on ve.id = i.veiculo_id where i.venda_id = v.id) x) as veiculos
         from vendas v
         join lojas l on l.id = v.loja_id
         join clientes c on c.id = v.cliente_id
         left join usuarios u on u.id = v.vendedor_id
        where pode(v.loja_id, 'vendas.ver')
          and ($1::uuid is null or v.loja_id = $1)
          and ($2::situacao_venda is null or v.situacao = $2)
          and ($3::tipo_venda is null or v.tipo = $3)
          and ($4::text is null or ($4 = 'hoje' and v.data_venda = current_date)
               or ($4 = 'mes' and v.data_venda >= date_trunc('month', current_date)))
          and ($5::text is null or c.nome ilike '%' || $5 || '%' or v.numero::text = $5
               or c.cpf_cnpj like regexp_replace($5, '\\D', '', 'g') || '%' and regexp_replace($5, '\\D', '', 'g') <> ''
               or exists (select 1 from venda_itens i join veiculos ve on ve.id = i.veiculo_id
                           where i.venda_id = v.id and ve.placa ilike '%' || regexp_replace($5, '[^A-Za-z0-9]', '', 'g') || '%'))
          and ($6::text is null or c.nome ilike '%' || $6 || '%' or ($7 <> '' and length($7) >= 3 and c.cpf_cnpj like $7 || '%'))
          and ($8::date is null or v.data_venda >= $8)
          and ($9::date is null or v.data_venda <= $9)
        order by v.data_venda desc, v.numero desc
        limit 1000`, [loja, situacao, tipo, periodo, busca, cliente, docCliente, de, ate])).rows);
    res.json(lista);
  }));

  async function buscarVenda(db, id) {
    if (!UUID.test(id)) throw new Recusa(404, 'Venda não encontrada.');
    const v = (await db.query('select * from vendas where id = $1', [id])).rows[0];
    if (!v) throw new Recusa(404, 'Venda não encontrada.');
    await exigir(db, v.loja_id, 'vendas.ver');
    return v;
  }

  app.get('/api/vendas/:id', exigeLogin, comRecusa(async (req, res) => {
    const dados = await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVenda(db, req.params.id);
      const extra = (await db.query(
        `select l.nome as loja, to_jsonb(c) - 'consulta_serasa' || jsonb_build_object('grupo_nome', (select g.nome from clientes g where g.id = c.grupo_cliente_id)) as cliente, u.nome as vendedor
           from lojas l, clientes c left join usuarios u on u.id = $3
          where l.id = $1 and c.id = $2`, [v.loja_id, v.cliente_id, v.vendedor_id])).rows[0];
      const itens = (await db.query(
        `select i.id, i.servico_id, s.nome as servico, i.descricao, i.quantidade, i.valor_unit, i.valor_total,
                ve.placa, ve.tipo as tipo_veiculo, ve.marca, ve.modelo,
                -- dados da consulta de placa, que aparecem como relatório anexado na venda
                case when ve.consultado_em is not null then to_jsonb(ve) - 'dados_consulta' - 'id' end as consulta
           from venda_itens i join servicos s on s.id = i.servico_id
           left join veiculos ve on ve.id = i.veiculo_id
          where i.venda_id = $1 order by i.ctid`, [v.id])).rows;
      const historico = (await db.query(
        `select h.acao, h.detalhe, h.criado_em, u.nome as usuario, a.nome as autorizado_por
           from venda_historico h left join usuarios u on u.id = h.usuario_id left join usuarios a on a.id = h.autorizado_por
          where h.venda_id = $1 order by h.criado_em, h.id`, [v.id])).rows;
      const pagamentos = (await db.query(
        `select id, data_pagamento, forma, valor, detalhe, cv, bandeira from venda_pagamentos where venda_id = $1 order by criado_em, id`, [v.id])).rows;
      const pode = (await db.query(
        `select pode($1, 'vendas.criar') as editar, pode($1, 'vendas.finalizar') as finalizar,
                pode($1, 'vendas.cancelar') as cancelar, pode($1, 'vendas.desconto') as desconto,
                pode($1, 'vendas.autorizar') as autorizar`, [v.loja_id])).rows[0];
      return { ...v, ...extra, itens, historico, pagamentos, pode };
    });
    res.json(dados);
  }));

  // Grava cabeçalho e itens (troca todos os itens). Só com a venda aberta.
  async function gravarVenda(db, req, existente) {
    const b = req.body || {};
    const loja = existente?.loja_id || b.loja_id;
    const empresa = await empresaDaLoja(db, loja);
    await exigir(db, loja, 'vendas.criar', 'Seu perfil não pode criar ou alterar vendas.');
    const tipo = 'venda_avulsa'; // orçamento não é usado: toda venda é avulsa
    const data = dataValida(b.data_venda) || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const desconto = dinheiro(b.desconto || 0);
    if (desconto === null) throw new Recusa(400, 'Desconto inválido.');
    // Desconto novo ou alterado só passa com e-mail e senha de quem pode autorizar
    let autorizadorDesconto = null;
    if (desconto > 0 && desconto !== Number(existente?.desconto || 0)) {
      const a = b.autorizacao_desconto || {};
      if (!a.email || !a.senha) throw new Recusa(428, 'O desconto precisa da senha de quem autoriza (sênior ou administrador).');
      autorizadorDesconto = (await db.query('select app_autorizar_desconto($1, $2, $3) as id', [loja, a.email, a.senha])).rows[0].id;
    }

    const itens = Array.isArray(b.itens) ? b.itens : [];
    if (!itens.length) throw new Recusa(400, 'Inclua pelo menos um item.');
    const prontos = [];
    for (const [n, i] of itens.entries()) {
      const linha = `Item ${n + 1}:`;
      if (!UUID.test(i?.servico_id || '')) throw new Recusa(400, `${linha} escolha o serviço ou produto.`);
      const servico = (await db.query('select id, nome from servicos where id = $1 and empresa_id = $2', [i.servico_id, empresa])).rows[0];
      if (!servico) throw new Recusa(400, `${linha} serviço não encontrado.`);
      const qtd = Number(String(i.quantidade ?? 1).replace(',', '.'));
      if (!(qtd > 0)) throw new Recusa(400, `${linha} quantidade inválida.`);
      const unit = dinheiro(i.valor_unit);
      if (unit === null) throw new Recusa(400, `${linha} valor unitário inválido.`);
      let veiculo = null, descricao = servico.nome;
      if (texto(i.placa)) {
        const placa = normalizarPlaca(i.placa);
        if (!placa) throw new Recusa(400, `${linha} placa inválida.`);
        const tv = TIPOS_VEICULO.includes(i.tipo_veiculo) ? i.tipo_veiculo : null;
        const ve = (await db.query(
          `insert into veiculos (placa, tipo, marca, modelo) values ($1, coalesce($2::tipo_veiculo, 'carro'), $3, $4)
           on conflict (placa) do update set tipo = coalesce($2::tipo_veiculo, veiculos.tipo),
                  marca = coalesce($3, veiculos.marca), modelo = coalesce($4, veiculos.modelo)
           returning id, placa, marca, modelo`, [placa, tv, texto(i.marca, 60)?.toUpperCase() ?? null, texto(i.modelo, 120)?.toUpperCase() ?? null])).rows[0];
        veiculo = ve.id;
        descricao = [[ve.marca, ve.modelo].filter(Boolean).join(' '), ve.placa].filter(Boolean).join(' // ');
      }
      prontos.push([i.servico_id, veiculo, descricao, qtd, unit]);
    }
    const bruto = prontos.reduce((t, [, , , q, u]) => t + q * u, 0);
    if (desconto > bruto) throw new Recusa(400, 'O desconto não pode ser maior que o total dos itens.');

    // Pagamentos: uma ou mais formas, cada uma com data, valor e detalhe
    const pagamentos = [];
    for (const [n, pg] of (Array.isArray(b.pagamentos) ? b.pagamentos : []).entries()) {
      const linha = `Pagamento ${n + 1}:`;
      const valor = dinheiro(pg?.valor);
      if (!valor) throw new Recusa(400, `${linha} informe o valor.`);
      if (!FORMAS.includes(pg.forma)) throw new Recusa(400, `${linha} escolha a forma de pagamento.`);
      const quando = dataValida(pg.data_pagamento) || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const cartao = pg.forma === 'cartao_credito' || pg.forma === 'cartao_debito';
      pagamentos.push([quando, pg.forma, valor, texto(pg.detalhe, 200),
        cartao ? texto(pg.cv, 40)?.toUpperCase() || null : null, cartao ? texto(pg.bandeira, 30)?.toUpperCase() || null : null]);
    }
    const pago = pagamentos.reduce((t, [, , v]) => t + v, 0);
    if (pago - (bruto - desconto) > 0.005) {
      throw new Recusa(400, `Os pagamentos (${reais(pago)}) passam do total da venda (${reais(bruto - desconto)}).`);
    }

    // Na alteração, sem cliente informado, mantém o atual
    const cliente = existente && !b.cliente_id && !b.cliente_novo?.nome && !b.cliente_avulso
      ? existente.cliente_id
      : await resolverCliente(db, { empresa, loja, cliente_id: b.cliente_id, cliente_novo: b.cliente_novo });
    const categoria = (await db.query(
      "select id from categorias_financeiras where empresa_id = $1 and tipo = 'receber' and ativo order by nome = 'Receitas de Serviços' desc, nome limit 1",
      [empresa])).rows[0]?.id || null;

    let id = existente?.id;
    if (id) {
      await db.query(
        `update vendas set tipo = $2, cliente_id = $3, data_venda = $4, desconto = $5, observacoes = $6 where id = $1`,
        [id, tipo, cliente, data, desconto, texto(b.observacoes, 2000)]);
      await db.query('delete from venda_itens where venda_id = $1', [id]);
      await db.query('delete from venda_pagamentos where venda_id = $1', [id]);
    } else {
      id = (await db.query(
        `insert into vendas (loja_id, empresa_id, numero, tipo, situacao, cliente_id, data_venda, categoria_id,
                             vendedor_id, desconto, observacoes, criado_por)
         values ($1, $2, 0, $3, 'aberta', $4, $5, $6, $7, $8, $9, $7) returning id`,
        [loja, empresa, tipo, cliente, data, categoria, req.usuarioId, desconto, texto(b.observacoes, 2000)])).rows[0].id;
    }
    for (const p of prontos) {
      await db.query(
        'insert into venda_itens (venda_id, servico_id, veiculo_id, descricao, quantidade, valor_unit) values ($1, $2, $3, $4, $5, $6)',
        [id, ...p]);
    }
    for (const p of pagamentos) {
      await db.query('insert into venda_pagamentos (venda_id, data_pagamento, forma, valor, detalhe, cv, bandeira) values ($1, $2, $3, $4, $5, $6, $7)', [id, ...p]);
    }
    const total = reais(bruto - desconto);
    await db.query('insert into venda_historico (venda_id, usuario_id, acao, detalhe) values ($1, $2, $3, $4)',
      [id, req.usuarioId, existente ? 'alterada' : 'criada', `${prontos.length} item(ns), total ${total}`]);
    if (autorizadorDesconto) {
      await db.query("insert into venda_historico (venda_id, usuario_id, acao, detalhe, autorizado_por) values ($1, $2, 'desconto', $3, $4)",
        [id, req.usuarioId, `Desconto de ${reais(desconto)}`, autorizadorDesconto]);
    }
    return id;
  }

  app.post('/api/vendas', exigeLogin, comRecusa(async (req, res) => {
    const id = await comoUsuario(req.usuarioId, (db) => gravarVenda(db, req, null));
    res.status(201).json({ id });
  }));

  app.put('/api/vendas/:id', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVenda(db, req.params.id);
      if (v.situacao !== 'aberta') throw new Recusa(400, 'Esta venda não está aberta. Peça a liberação para alterar.');
      await gravarVenda(db, req, v);
    });
    res.json({ ok: true });
  }));

  app.post('/api/vendas/:id/finalizar', exigeLogin, comRecusa(async (req, res) => {
    await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVenda(db, req.params.id);
      await exigir(db, v.loja_id, 'vendas.finalizar', 'Seu perfil não pode finalizar vendas.');
      if (v.situacao !== 'aberta') throw new Recusa(400, 'Esta venda não está aberta.');
      const pago = Number((await db.query('select coalesce(sum(valor), 0) as t from venda_pagamentos where venda_id = $1', [v.id])).rows[0].t);
      const total = Number(v.valor_total);
      if (Math.abs(pago - total) > 0.005) {
        throw new Recusa(400, `Para finalizar, os pagamentos precisam fechar o total da venda: total ${reais(total)}, pagamentos ${reais(pago)}.`);
      }
      await db.query("update vendas set situacao = 'finalizada', finalizada_em = now(), finalizada_por = $2 where id = $1", [v.id, req.usuarioId]);
      await db.query("insert into venda_historico (venda_id, usuario_id, acao) values ($1, $2, 'finalizada')", [v.id, req.usuarioId]);
    });
    res.json({ ok: true });
  }));

  // Quem pode ser o responsável de uma venda do grupo da loja
  app.get('/api/vendas-responsaveis', exigeLogin, comRecusa(async (req, res) => {
    const lista = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = await empresaDaLoja(db, req.query.loja);
      return (await db.query('select * from app_responsaveis($1)', [empresa])).rows;
    });
    res.json(lista);
  }));

  // Edição em lote: responsável, data do serviço e centro de custo (loja) de várias vendas.
  // Só muda vendas abertas; finalizadas e canceladas ficam como estão (precisam ser liberadas antes).
  app.post('/api/vendas/lote', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((i) => UUID.test(String(i))).slice(0, 500);
    if (!ids.length) throw new Recusa(400, 'Selecione as vendas.');
    const data = b.data_venda ? dataValida(b.data_venda) : null;
    if (b.data_venda && !data) throw new Recusa(400, 'Data do serviço inválida.');
    const vendedor = b.vendedor_id && UUID.test(b.vendedor_id) ? b.vendedor_id : null;
    const loja = b.loja_id && UUID.test(b.loja_id) ? b.loja_id : null;
    if (!data && !vendedor && !loja) throw new Recusa(400, 'Escolha o que alterar.');

    const resultado = await comoUsuario(req.usuarioId, async (db) => {
      let lojaNova = null;
      if (loja) {
        lojaNova = (await db.query('select id, empresa_id, nome from lojas where id = $1 and tem_loja(id)', [loja])).rows[0];
        if (!lojaNova) throw new Recusa(400, 'Centro de custo não encontrado.');
        if (!(await db.query("select pode($1, 'vendas.criar') as ok", [loja])).rows[0].ok) {
          throw new Recusa(403, `Seu perfil não pode lançar vendas em ${lojaNova.nome}.`);
        }
      }
      const nomeVendedor = vendedor ? (await db.query('select nome from usuarios where id = $1', [vendedor])).rows[0]?.nome : null;
      let alteradas = 0;
      const puladas = [];
      for (const id of ids) {
        const v = (await db.query('select id, numero, loja_id, empresa_id, situacao from vendas where id = $1', [id])).rows[0];
        if (!v) continue;
        if (!(await db.query("select pode($1, 'vendas.criar') as ok", [v.loja_id])).rows[0].ok) {
          puladas.push({ numero: v.numero, motivo: 'sem permissão na loja' }); continue;
        }
        if (v.situacao !== 'aberta') { puladas.push({ numero: v.numero, motivo: v.situacao }); continue; }
        if (lojaNova && lojaNova.empresa_id !== v.empresa_id) { puladas.push({ numero: v.numero, motivo: 'é de outro grupo' }); continue; }
        if (vendedor && !(await db.query('select 1 from app_responsaveis($1) where id = $2', [v.empresa_id, vendedor])).rowCount) {
          puladas.push({ numero: v.numero, motivo: 'responsável não trabalha nesse grupo' }); continue;
        }
        await db.query(
          `update vendas set vendedor_id = coalesce($2, vendedor_id), data_venda = coalesce($3::date, data_venda),
                  loja_id = coalesce($4, loja_id) where id = $1`, [v.id, vendedor, data, lojaNova?.id || null]);
        const detalhe = `Edição em lote: ${[nomeVendedor && `responsável ${nomeVendedor}`,
          data && `data do serviço ${data.split('-').reverse().join('/')}`, lojaNova && `centro de custo ${lojaNova.nome}`].filter(Boolean).join(', ')}`;
        await db.query("insert into venda_historico (venda_id, usuario_id, acao, detalhe) values ($1, $2, 'alterada', $3)", [v.id, req.usuarioId, detalhe]);
        alteradas += 1;
      }
      return { alteradas, puladas };
    });
    res.json(resultado);
  }));

  // Trocar a unidade (centro de custo) de uma venda aberta: só com a senha de um supervisor/administrador
  app.post('/api/vendas/:id/unidade', exigeLogin, comRecusa(async (req, res) => {
    const { loja_id: loja, email, senha } = req.body || {};
    if (!UUID.test(loja || '')) throw new Recusa(400, 'Escolha a nova unidade.');
    await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVenda(db, req.params.id);
      if (v.situacao !== 'aberta') throw new Recusa(400, 'Esta venda não está aberta. Peça a liberação antes.');
      const nova = (await db.query('select id, empresa_id, nome from lojas where id = $1 and tem_loja(id)', [loja])).rows[0];
      if (!nova || nova.empresa_id !== v.empresa_id) throw new Recusa(400, 'A nova unidade precisa ser do mesmo grupo.');
      const autorizador = (await db.query("select app_autorizar_permissao($1, $2, $3, 'vendas.autorizar') as id", [v.loja_id, email, senha])).rows[0].id;
      const antiga = (await db.query('select nome from lojas where id = $1', [v.loja_id])).rows[0]?.nome;
      await db.query('update vendas set loja_id = $2 where id = $1', [v.id, nova.id]);
      await db.query("insert into venda_historico (venda_id, usuario_id, acao, detalhe, autorizado_por) values ($1, $2, 'alterada', $3, $4)",
        [v.id, req.usuarioId, `Unidade trocada de ${antiga} para ${nova.nome}`, autorizador]);
    });
    res.json({ ok: true });
  }));

  // Reabrir venda finalizada: master/autorizador direto; os demais com e-mail e senha de quem autoriza
  app.post('/api/vendas/:id/reabrir', exigeLogin, comRecusa(async (req, res) => {
    const { email, senha, motivo } = req.body || {};
    await comoUsuario(req.usuarioId, async (db) => {
      await buscarVenda(db, req.params.id);
      await db.query('select app_reabrir_venda($1, $2, $3, $4)', [req.params.id, email || null, senha || null, motivo || null]);
    });
    res.json({ ok: true });
  }));

  app.post('/api/vendas/:id/cancelar', exigeLogin, comRecusa(async (req, res) => {
    const motivo = texto(req.body?.motivo, 500);
    if (!motivo) throw new Recusa(400, 'Informe o motivo do cancelamento.');
    await comoUsuario(req.usuarioId, async (db) => {
      const v = await buscarVenda(db, req.params.id);
      await exigir(db, v.loja_id, 'vendas.cancelar', 'Seu perfil não pode cancelar vendas.');
      if (v.situacao !== 'aberta') throw new Recusa(400, 'Só uma venda aberta pode ser cancelada. Se estiver finalizada, peça a liberação antes.');
      await db.query("update vendas set situacao = 'cancelada' where id = $1", [v.id]);
      await db.query("insert into venda_historico (venda_id, usuario_id, acao, detalhe) values ($1, $2, 'cancelada', $3)", [v.id, req.usuarioId, motivo]);
    });
    res.json({ ok: true });
  }));

  // Razão social e contato pelo CNPJ (dados públicos da Receita via BrasilAPI)
  app.get('/api/cnpj/:cnpj', exigeLogin, comRecusa(async (req, res) => {
    const cnpj = String(req.params.cnpj).replace(/\D/g, '');
    if (!cnpjValido(cnpj)) throw new Recusa(400, 'CNPJ inválido. Confira os números.');
    const r = await consultarCnpj(cnpj);
    if (r.erro) throw new Recusa(r.status, r.erro);
    res.json(r);
  }));

  // ---------------------------------------------------------------- pesquisa geral
  // Placa, cliente (nome, CPF/CNPJ) ou empresa: devolve clientes, vistorias e vendas
  app.get('/api/busca', exigeLogin, comRecusa(async (req, res) => {
    const q = texto(req.query.q, 60);
    if (!q || q.length < 2) return res.json({ clientes: [], vistorias: [], vendas: [] });
    const loja = UUID.test(req.query.loja || '') ? req.query.loja : null;
    const placa = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const digitos = q.replace(/\D/g, '');
    const dados = await comoUsuario(req.usuarioId, async (db) => {
      const clientes = (await db.query(
        `select c.id, c.tipo, c.nome, c.cpf_cnpj, c.whatsapp
           from clientes c
          where c.ativo and c.tipo <> 'avulso'
            and exists (select 1 from lojas l where l.empresa_id = c.empresa_id and ($1::uuid is null or l.id = $1)
                          and pode(l.id, 'clientes.ver'))
            and (c.nome ilike '%' || $2 || '%' or ($3 <> '' and c.cpf_cnpj like $3 || '%'))
          order by c.nome limit 8`, [loja, q, digitos])).rows;
      const vistorias = (await db.query(
        `select vi.id, vi.numero, vi.status, vi.resultado, vi.criado_em, ve.placa, ve.marca, ve.modelo, c.nome as cliente
           from vistorias vi join veiculos ve on ve.id = vi.veiculo_id join clientes c on c.id = vi.cliente_id
          where pode(vi.loja_id, 'vistorias.ver') and ($1::uuid is null or vi.loja_id = $1)
            and (($2 <> '' and length($2) >= 3 and ve.placa like '%' || $2 || '%') or c.nome ilike '%' || $3 || '%'
                 or ($4 <> '' and c.cpf_cnpj like $4 || '%'))
          order by vi.criado_em desc limit 8`, [loja, placa, q, digitos])).rows;
      const vendas = (await db.query(
        `select v.id, v.numero, v.tipo, v.situacao, v.data_venda, v.valor_total, c.nome as cliente
           from vendas v join clientes c on c.id = v.cliente_id
          where pode(v.loja_id, 'vendas.ver') and ($1::uuid is null or v.loja_id = $1)
            and (c.nome ilike '%' || $3 || '%' or ($4 <> '' and c.cpf_cnpj like $4 || '%')
                 or ($2 <> '' and length($2) >= 3 and exists (select 1 from venda_itens i join veiculos ve on ve.id = i.veiculo_id
                             where i.venda_id = v.id and ve.placa like '%' || $2 || '%')))
          order by v.data_venda desc, v.numero desc limit 8`, [loja, placa, q, digitos])).rows;
      return { clientes, vistorias, vendas };
    });
    res.json({ ...dados, placa: normalizarPlaca(q) });
  }));
}
