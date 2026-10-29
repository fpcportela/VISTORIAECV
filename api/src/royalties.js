import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, exigir, texto } from './comum.js';
import { cnpjValido, cpfValido } from './documentos.js';

// Royalties: fornecedores do grupo, cada um com o valor que recebe por serviço
// vendido, e o relatório que soma os serviços das vendas finalizadas no período
// e vira conta a pagar (uma por fornecedor e loja). Cada item de venda só entra
// uma vez na conta de cada fornecedor.

const FUSO = 'America/Sao_Paulo';
const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const dataValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : null);
const uuid = (v) => (UUID.test(v || '') ? v : null);
// Aceita 150, "150.5" ou "1.234,56"
const dinheiro = (v) => {
  const t = String(v ?? '').trim();
  const n = typeof v === 'number' ? v : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return t !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// Pode fazer X com os fornecedores deste grupo do sistema? (a permissão é por loja)
const podeNaEmpresa = (db, empresa, permissao) =>
  db.query('select exists (select 1 from lojas l where l.empresa_id = $1 and pode(l.id, $2)) as ok', [empresa, permissao])
    .then((r) => r.rows[0].ok);

// Uma linha por item de venda e fornecedor que tem valor para o serviço do item.
// Só vendas finalizadas (aberta, agendada e cancelada ficam de fora).
const SQL_ITENS = `
  select i.id as venda_item_id, f.id as fornecedor_id, f.nome as fornecedor, v.id as venda_id, v.numero, v.data_venda,
         v.loja_id, lj.nome as loja, v.empresa_id, c.nome as cliente, ve.placa, s.id as servico_id, s.nome as servico,
         i.quantidade, p.valor as valor_unit, round(i.quantidade * p.valor, 2) as valor,
         ri.lancamento_id, l.vencimento as lancado_vencimento
    from venda_itens i
    join vendas v on v.id = i.venda_id
    join lojas lj on lj.id = v.loja_id
    join clientes c on c.id = v.cliente_id
    join servicos s on s.id = i.servico_id
    join fornecedor_precos p on p.servico_id = i.servico_id
    join fornecedores f on f.id = p.fornecedor_id and f.empresa_id = v.empresa_id
    left join veiculos ve on ve.id = i.veiculo_id
    left join royalty_itens ri on ri.venda_item_id = i.id and ri.fornecedor_id = f.id
    left join lancamentos l on l.id = ri.lancamento_id
   where v.situacao = 'finalizada' and (f.ativo or ri.lancamento_id is not null)`;

export function rotasRoyalties(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  // ------------------------------------------------------------ fornecedores
  // ?loja= limita ao grupo da loja; ?busca= nome, fantasia ou CPF/CNPJ; ?inativos=1 mostra os inativos
  app.get('/api/royalties/fornecedores', exigeLogin, comRecusa(async (req, res) => {
    const busca = texto(req.query.busca, 60);
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select f.id, f.empresa_id, f.tipo, f.nome, f.nome_fantasia, f.cpf_cnpj, f.whatsapp, f.telefone, f.email, f.cidade, f.uf, f.ativo,
              f.categoria_id, f.centro_custo_id, f.dia_vencimento,
              (select count(*)::int from fornecedor_precos p where p.fornecedor_id = f.id) as servicos
         from fornecedores f
        where exists (select 1 from lojas l where l.empresa_id = f.empresa_id and ($1::uuid is null or l.id = $1)
                        and pode(l.id, 'royalties.ver'))
          and (f.ativo or $3)
          and ($2::text is null or f.nome ilike '%' || $2 || '%' or f.nome_fantasia ilike '%' || $2 || '%'
               or (regexp_replace($2, '\\D', '', 'g') <> '' and coalesce(f.cpf_cnpj, '') like regexp_replace($2, '\\D', '', 'g') || '%'))
        order by f.ativo desc, f.nome
        limit 300`, [uuid(req.query.loja), busca, req.query.inativos === '1'])).rows));
  }));

  app.get('/api/royalties/fornecedores/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Fornecedor não encontrado.');
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const f = (await db.query('select * from fornecedores where id = $1', [req.params.id])).rows[0];
      if (!f || !(await podeNaEmpresa(db, f.empresa_id, 'royalties.ver'))) throw new Recusa(404, 'Fornecedor não encontrado.');
      const precos = (await db.query('select servico_id, valor from fornecedor_precos where fornecedor_id = $1', [f.id])).rows;
      return { ...f, precos, pode_editar: await podeNaEmpresa(db, f.empresa_id, 'royalties.configurar') };
    }));
  }));

  // Troca a tabela de valores do fornecedor (só serviços do grupo dele)
  async function gravarPrecos(db, fornecedor, lista) {
    if (!Array.isArray(lista)) return;
    const precos = new Map();
    for (const p of lista.slice(0, 500)) {
      if (!UUID.test(p?.servico_id || '')) continue;
      if (String(p.valor ?? '').trim() === '') continue;
      const valor = dinheiro(p.valor);
      if (!(valor >= 0)) throw new Recusa(400, 'Confira os valores por serviço do fornecedor.');
      precos.set(p.servico_id, valor);
    }
    await db.query('delete from fornecedor_precos where fornecedor_id = $1', [fornecedor]);
    for (const [servico, valor] of precos) {
      await db.query(
        `insert into fornecedor_precos (fornecedor_id, servico_id, valor)
         select f.id, s.id, $3 from fornecedores f join servicos s on s.empresa_id = f.empresa_id where f.id = $1 and s.id = $2`,
        [fornecedor, servico, valor]);
    }
  }

  const salvar = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const tipo = b.tipo === 'pf' ? 'pf' : 'pj';
    const nome = texto(b.nome, 150)?.toUpperCase();
    if (!nome) throw new Recusa(400, tipo === 'pj' ? 'Informe a razão social.' : 'Informe o nome completo.');
    const doc = digitos(b.cpf_cnpj) || null;
    if (doc && tipo === 'pf' && !cpfValido(doc)) throw new Recusa(400, 'CPF inválido. Confira os números.');
    if (doc && tipo === 'pj' && !cnpjValido(doc)) throw new Recusa(400, 'CNPJ inválido. Confira os números.');
    const dia = b.dia_vencimento ? Math.trunc(Number(b.dia_vencimento)) : null;
    if (dia !== null && !(dia >= 1 && dia <= 31)) throw new Recusa(400, 'Dia de vencimento: de 1 a 31.');
    const campos = [tipo, nome, tipo === 'pj' ? texto(b.nome_fantasia, 120)?.toUpperCase() || null : null, doc,
      digitos(b.telefone) || null, digitos(b.whatsapp) || null, texto(b.email, 120)?.toLowerCase() || null,
      digitos(b.cep) || null, texto(b.endereco, 200)?.toUpperCase() || null, texto(b.cidade, 80)?.toUpperCase() || null,
      /^[A-Za-z]{2}$/.test(b.uf || '') ? b.uf.toUpperCase() : null, texto(b.chave_pix, 120),
      texto(b.observacoes, 2000), b.ativo !== false, dia];

    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      let empresa;
      if (id) {
        empresa = (await db.query('select empresa_id from fornecedores where id = $1', [id])).rows[0]?.empresa_id;
        if (!empresa) throw new Recusa(404, 'Fornecedor não encontrado.');
      } else {
        if (!UUID.test(b.loja_id || '')) throw new Recusa(400, 'Escolha a loja.');
        empresa = (await db.query('select empresa_id from lojas where id = $1 and tem_loja(id)', [b.loja_id])).rows[0]?.empresa_id;
        if (!empresa) throw new Recusa(403, 'Você não tem acesso a esta loja.');
      }
      if (!(await podeNaEmpresa(db, empresa, 'royalties.configurar'))) throw new Recusa(403, 'Seu perfil não pode cadastrar fornecedores.');
      // padrões da conta a pagar: só do mesmo grupo
      const categoria = uuid(b.categoria_id) && (await db.query(
        "select id from categorias_financeiras where id = $1 and empresa_id = $2 and tipo = 'pagar' and not grupo", [b.categoria_id, empresa])).rows[0]?.id || null;
      const centro = uuid(b.centro_custo_id) && (await db.query(
        'select id from centros_custo where id = $1 and empresa_id = $2', [b.centro_custo_id, empresa])).rows[0]?.id || null;
      try {
        if (id) {
          await db.query(
            `update fornecedores set tipo = $2, nome = $3, nome_fantasia = $4, cpf_cnpj = $5, telefone = $6, whatsapp = $7, email = $8,
                    cep = $9, endereco = $10, cidade = $11, uf = $12, chave_pix = $13, observacoes = $14, ativo = $15, dia_vencimento = $16,
                    categoria_id = $17, centro_custo_id = $18
              where id = $1`, [id, ...campos, categoria, centro]);
          await gravarPrecos(db, id, b.precos);
          return id;
        }
        const novo = (await db.query(
          `insert into fornecedores (empresa_id, tipo, nome, nome_fantasia, cpf_cnpj, telefone, whatsapp, email, cep, endereco, cidade, uf,
                                     chave_pix, observacoes, ativo, dia_vencimento, categoria_id, centro_custo_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning id`,
          [empresa, ...campos, categoria, centro])).rows[0].id;
        await gravarPrecos(db, novo, b.precos);
        return novo;
      } catch (e) {
        if (e.code === '23505') throw new Recusa(400, `Já existe um fornecedor com esse ${tipo === 'pj' ? 'CNPJ' : 'CPF'}.`);
        throw e;
      }
    });
    res.json({ id: novoId });
  });
  app.post('/api/royalties/fornecedores', exigeLogin, (req, res) => salvar(null)(req, res));
  app.put('/api/royalties/fornecedores/:id', exigeLogin, (req, res) =>
    (UUID.test(req.params.id) ? salvar(req.params.id)(req, res) : res.status(404).json({ erro: 'Fornecedor não encontrado.' })));

  // ------------------------------------------------------------ relatório
  // ?de=&ate= (data da venda), ?loja=, ?servico=, ?fornecedor=, ?situacao=pendente|lancado (vazio = todos)
  app.get('/api/royalties/relatorio', exigeLogin, comRecusa(async (req, res) => {
    const q = req.query;
    const situacao = ['pendente', 'lancado'].includes(q.situacao) ? q.situacao : null;
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `${SQL_ITENS}
         and pode(v.loja_id, 'royalties.ver')
         and ($1::uuid is null or v.loja_id = $1)
         and ($2::date is null or v.data_venda >= $2)
         and ($3::date is null or v.data_venda <= $3)
         and ($4::uuid is null or s.id = $4)
         and ($5::uuid is null or f.id = $5)
         and ($6::text is null or ($6 = 'pendente' and ri.lancamento_id is null) or ($6 = 'lancado' and ri.lancamento_id is not null))
       order by f.nome, v.data_venda, v.numero, s.nome
       limit 10000`,
      [uuid(q.loja), dataValida(q.de), dataValida(q.ate), uuid(q.servico), uuid(q.fornecedor), situacao])).rows));
  }));

  // ------------------------------------------------------------ gerar contas a pagar
  // itens: ["<fornecedor_id>:<venda_item_id>", ...]. Uma conta para cada fornecedor e loja.
  // centro_custo_id vazio = o centro de custo de cada loja.
  app.post('/api/royalties/gerar', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const pares = [...new Set((Array.isArray(b.itens) ? b.itens : []).map(String))]
      .map((p) => p.split(':')).filter(([f, i]) => UUID.test(f || '') && UUID.test(i || '')).slice(0, 10000);
    if (!pares.length) throw new Recusa(400, 'Marque os serviços que vão para a conta a pagar.');
    const vencimento = dataValida(b.vencimento);
    if (!vencimento) throw new Recusa(400, 'Informe a data de pagamento.');
    const criados = await comoUsuario(req.usuarioId, async (db) => {
      // o valor é recalculado aqui, com a tabela atual do fornecedor
      const itens = (await db.query(
        `${SQL_ITENS} and (f.id, i.id) in (select x::uuid, y::uuid from unnest($1::text[], $2::text[]) as t(x, y))`,
        [pares.map((p) => p[0]), pares.map((p) => p[1])])).rows;
      if (itens.length !== pares.length) throw new Recusa(400, 'Algum serviço não foi encontrado (venda reaberta ou valor do fornecedor apagado). Atualize o relatório.');
      if (itens.some((i) => i.lancamento_id)) throw new Recusa(400, 'Algum serviço já foi lançado em conta a pagar. Atualize o relatório.');
      if (new Set(itens.map((i) => i.empresa_id)).size > 1) throw new Recusa(400, 'Os serviços precisam ser do mesmo grupo.');
      const empresa = itens[0].empresa_id;

      const cat = (await db.query("select id from categorias_financeiras where id = $1 and empresa_id = $2 and tipo = 'pagar' and not grupo and ativo",
        [uuid(b.categoria_id), empresa])).rows[0];
      if (!cat) throw new Recusa(400, 'Escolha a categoria de despesa.');
      let centroEscolhido = null;
      if (b.centro_custo_id) {
        centroEscolhido = (await db.query('select id from centros_custo where id = $1 and empresa_id = $2', [uuid(b.centro_custo_id), empresa])).rows[0]?.id;
        if (!centroEscolhido) throw new Recusa(400, 'Centro de custo não encontrado.');
      }
      const br = (d) => d.split('-').reverse().join('/');

      const grupos = new Map();
      for (const i of itens) {
        const chave = `${i.fornecedor_id}|${i.loja_id}`;
        (grupos.get(chave) || grupos.set(chave, []).get(chave)).push(i);
      }
      const novos = [];
      for (const lista of grupos.values()) {
        const { fornecedor_id: fornecedor, fornecedor: nomeFornecedor, loja_id: loja } = lista[0];
        await exigir(db, loja, 'royalties.fechar', 'Seu perfil não pode gerar a conta a pagar dos royalties numa destas lojas.');
        await exigir(db, loja, 'financeiro.lancar', 'Seu perfil não pode lançar contas a pagar numa destas lojas.');
        const centro = centroEscolhido
          || (await db.query('select id from centros_custo where empresa_id = $1 and loja_id = $2 and ativo order by criado_em limit 1', [empresa, loja])).rows[0]?.id || null;
        const total = Math.round(lista.reduce((t, i) => t + Number(i.valor), 0) * 100) / 100;
        if (!(total > 0)) continue; // serviço com valor zero não gera conta
        const qtd = lista.reduce((t, i) => t + Number(i.quantidade), 0);
        const datas = lista.map((i) => i.data_venda).sort();
        const periodo = datas[0] === datas.at(-1) ? br(datas[0]) : `${br(datas[0])} a ${br(datas.at(-1))}`;
        const lid = (await db.query(
          `insert into lancamentos (loja_id, tipo, categoria_id, centro_custo_id, fornecedor_id, descricao, competencia, vencimento, valor,
                                    documento, observacoes, criado_por)
           values ($1, 'pagar', $2, $3, $4, $5, date_trunc('month', $6::date)::date, $7, $8, $9, $10, $11) returning id`,
          [loja, cat.id, centro, fornecedor, texto(b.descricao, 200)?.toUpperCase() || `ROYALTIES ${nomeFornecedor}`,
           datas.at(-1), vencimento, total, texto(b.documento, 60),
           `Royalties de ${periodo}: ${qtd} serviço(s), vendas nº ${[...new Set(lista.map((i) => i.numero))].sort((x, y) => x - y).join(', ')}`,
           req.usuarioId])).rows[0].id;
        for (const i of lista) {
          await db.query('insert into royalty_itens (lancamento_id, fornecedor_id, venda_item_id, valor) values ($1, $2, $3, $4)',
            [lid, i.fornecedor_id, i.venda_item_id, i.valor]);
        }
        novos.push({ id: lid, fornecedor: nomeFornecedor, loja: lista[0].loja, valor: total });
      }
      if (!novos.length) throw new Recusa(400, 'Os serviços marcados estão com valor zero: nada a pagar.');
      // guarda a categoria e o centro de custo escolhidos como padrão dos fornecedores (se pode configurar)
      if (b.salvar_padrao && await podeNaEmpresa(db, empresa, 'royalties.configurar')) {
        await db.query('update fornecedores set categoria_id = $2, centro_custo_id = $3 where id = any($1)',
          [[...new Set(itens.map((i) => i.fornecedor_id))], cat.id, centroEscolhido]);
      }
      return novos;
    }).catch((e) => { if (e.code === '23505') throw new Recusa(400, 'Algum serviço acabou de ser lançado. Atualize o relatório.'); throw e; });
    res.json({ lancamentos: criados });
  }));
}

// Total de royalties do mês (vendas finalizadas do mês corrente), para a tela inicial
export async function royaltiesDoMes(db, loja) {
  return (await db.query(
    `select coalesce(sum(round(i.quantidade * p.valor, 2)), 0) as total
       from venda_itens i
       join vendas v on v.id = i.venda_id
       join fornecedor_precos p on p.servico_id = i.servico_id
       join fornecedores f on f.id = p.fornecedor_id and f.empresa_id = v.empresa_id
      where v.situacao = 'finalizada' and v.data_venda >= date_trunc('month', (now() at time zone '${FUSO}')::date)
        and ($1::uuid is null or v.loja_id = $1) and pode(v.loja_id, 'royalties.ver')`, [loja])).rows[0].total;
}
