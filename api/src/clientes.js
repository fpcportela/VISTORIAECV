import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, texto } from './comum.js';
import { cnpjValido, cpfValido } from './documentos.js';

// Cadastro de clientes do grupo (do sistema): pessoa física, empresa e grupo de
// empresas. Um grupo de clientes reúne várias empresas (CNPJs); a venda é
// sempre feita para uma pessoa ou empresa, nunca para o grupo em si.

const TIPOS = ['pf', 'pj', 'grupo'];
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

// Pode fazer X com os clientes de algum grupo do sistema? (a permissão é por loja)
const podeNaEmpresa = (db, empresa, permissao) =>
  db.query('select exists (select 1 from lojas l where l.empresa_id = $1 and pode(l.id, $2)) as ok', [empresa, permissao])
    .then((r) => r.rows[0].ok);

export function rotasClientes(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  // Lista e busca (nome, fantasia, CPF/CNPJ, telefone ou nome do grupo).
  // ?loja= limita ao grupo da loja; ?tipo=pf|pj|grupo; ?venda=1 tira os grupos (venda é para uma empresa).
  app.get('/api/clientes', exigeLogin, comRecusa(async (req, res) => {
    const loja = UUID.test(req.query.loja || '') ? req.query.loja : null;
    const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : null;
    const busca = texto(req.query.busca, 60);
    const lista = await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select c.id, c.tipo, c.nome, c.nome_fantasia, c.cpf_cnpj, c.whatsapp, c.telefone, c.email, c.cidade, c.uf, c.ativo,
              c.grupo_cliente_id, g.nome as grupo_nome,
              (select count(*)::int from clientes m where m.grupo_cliente_id = c.id and m.ativo) as empresas
         from clientes c
         left join clientes g on g.id = c.grupo_cliente_id
        where exists (select 1 from lojas l where l.empresa_id = c.empresa_id and ($1::uuid is null or l.id = $1)
                        and pode(l.id, 'clientes.ver'))
          and (c.ativo or $5)
          and ($2::text is null or c.tipo::text = $2)
          and (not $4 or c.tipo::text <> 'grupo')
          and ($3::text is null or c.nome ilike '%' || $3 || '%' or c.nome_fantasia ilike '%' || $3 || '%'
               or g.nome ilike '%' || $3 || '%'
               or (regexp_replace($3, '\\D', '', 'g') <> '' and (
                    coalesce(c.cpf_cnpj, '') like regexp_replace($3, '\\D', '', 'g') || '%'
                    or regexp_replace(coalesce(c.whatsapp, c.telefone, ''), '\\D', '', 'g') like '%' || regexp_replace($3, '\\D', '', 'g') || '%')))
        order by c.tipo = 'avulso' desc, coalesce(g.nome, c.nome), c.tipo <> 'grupo', c.nome
        limit 300`, [loja, tipo, busca, req.query.venda === '1', req.query.inativos === '1'])).rows);
    res.json(lista);
  }));

  app.get('/api/clientes/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Cliente não encontrado.');
    const dados = await comoUsuario(req.usuarioId, async (db) => {
      const c = (await db.query(
        `select c.id, c.empresa_id, c.tipo, c.nome, c.nome_fantasia, c.cpf_cnpj, c.telefone, c.whatsapp, c.email, c.cep, c.endereco,
                c.cidade, c.uf, c.observacoes, c.ativo, c.grupo_cliente_id, g.nome as grupo_nome
           from clientes c left join clientes g on g.id = c.grupo_cliente_id where c.id = $1`, [req.params.id])).rows[0];
      if (!c || !(await podeNaEmpresa(db, c.empresa_id, 'clientes.ver'))) throw new Recusa(404, 'Cliente não encontrado.');
      const empresas = c.tipo === 'grupo' ? (await db.query(
        `select id, nome, nome_fantasia, cpf_cnpj, cidade, uf, ativo from clientes where grupo_cliente_id = $1 order by nome`, [c.id])).rows : [];
      const vendas = (await db.query(
        `select count(*)::int as qtd, coalesce(sum(valor_total), 0) as total, max(data_venda) as ultima
           from vendas where situacao <> 'cancelada'
            and (cliente_id = $1 or cliente_id in (select id from clientes where grupo_cliente_id = $1))`, [c.id])).rows[0];
      const precos = (await db.query('select servico_id, valor from cliente_precos where cliente_id = $1', [c.id])).rows;
      return { ...c, empresas, vendas, precos, pode_editar: await podeNaEmpresa(db, c.empresa_id, 'clientes.editar') };
    });
    res.json(dados);
  }));

  // Preços que valem na venda para o cliente: os dele e, para o que não tiver, os do grupo de clientes
  app.get('/api/clientes/:id/precos', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Cliente não encontrado.');
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select distinct on (p.servico_id) p.servico_id, p.valor
         from clientes c join cliente_precos p on p.cliente_id in (c.id, c.grupo_cliente_id)
        where c.id = $1
        order by p.servico_id, p.cliente_id = c.id desc`, [req.params.id])).rows));
  }));

  // Troca a tabela de preços especiais do cliente (só serviços do grupo dele)
  async function gravarPrecos(db, cliente, lista) {
    if (!Array.isArray(lista)) return;
    const precos = new Map();
    for (const p of lista.slice(0, 500)) {
      if (!UUID.test(p?.servico_id || '')) continue;
      const bruto = String(p.valor ?? '').trim();
      if (!bruto) continue;
      const valor = Math.round(Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto) * 100) / 100;
      if (!(valor >= 0)) throw new Recusa(400, 'Confira os preços especiais do cliente.');
      precos.set(p.servico_id, valor);
    }
    await db.query('delete from cliente_precos where cliente_id = $1', [cliente]);
    for (const [servico, valor] of precos) {
      await db.query(
        `insert into cliente_precos (cliente_id, servico_id, valor)
         select c.id, s.id, $3 from clientes c join servicos s on s.empresa_id = c.empresa_id where c.id = $1 and s.id = $2`,
        [cliente, servico, valor]);
    }
  }

  const salvar = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
    if (!tipo) throw new Recusa(400, 'Escolha o tipo de cliente.');
    const nome = texto(b.nome, 150)?.toUpperCase();
    if (!nome) throw new Recusa(400, tipo === 'pj' ? 'Informe a razão social.' : tipo === 'grupo' ? 'Informe o nome do grupo.' : 'Informe o nome completo.');
    let doc = null;
    if (tipo !== 'grupo') {
      doc = digitos(b.cpf_cnpj);
      if (tipo === 'pf' && !cpfValido(doc)) throw new Recusa(400, 'CPF inválido. Confira os números.');
      if (tipo === 'pj' && !cnpjValido(doc)) throw new Recusa(400, 'CNPJ inválido. Confira os números.');
    }
    const grupoCliente = tipo === 'pj' && UUID.test(b.grupo_cliente_id || '') ? b.grupo_cliente_id : null;
    const uf = /^[A-Za-z]{2}$/.test(b.uf || '') ? b.uf.toUpperCase() : null;
    const campos = [tipo, nome, tipo === 'pj' ? texto(b.nome_fantasia, 120)?.toUpperCase() || null : null, doc,
      digitos(b.telefone) || null, digitos(b.whatsapp) || null, texto(b.email, 120)?.toLowerCase() || null,
      digitos(b.cep) || null, texto(b.endereco, 200)?.toUpperCase() || null, texto(b.cidade, 80)?.toUpperCase() || null, uf,
      texto(b.observacoes, 2000), b.ativo !== false, grupoCliente];

    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      let empresa;
      if (id) {
        const atual = (await db.query('select empresa_id, tipo from clientes where id = $1', [id])).rows[0];
        if (!atual) throw new Recusa(404, 'Cliente não encontrado.');
        if (atual.tipo === 'avulso') throw new Recusa(400, 'O cliente avulso não pode ser alterado.');
        if (atual.tipo === 'grupo' && tipo !== 'grupo'
            && (await db.query('select 1 from clientes where grupo_cliente_id = $1', [id])).rowCount) {
          throw new Recusa(400, 'Este grupo tem empresas. Tire as empresas do grupo antes de mudar o tipo.');
        }
        empresa = atual.empresa_id;
      } else {
        if (!UUID.test(b.loja_id || '')) throw new Recusa(400, 'Escolha a loja.');
        empresa = (await db.query('select empresa_id from lojas where id = $1 and tem_loja(id)', [b.loja_id])).rows[0]?.empresa_id;
        if (!empresa) throw new Recusa(403, 'Você não tem acesso a esta loja.');
      }
      if (!(await podeNaEmpresa(db, empresa, 'clientes.editar'))) throw new Recusa(403, 'Seu perfil não pode cadastrar clientes.');
      if (grupoCliente && !(await db.query("select 1 from clientes where id = $1 and empresa_id = $2 and tipo::text = 'grupo'", [grupoCliente, empresa])).rowCount) {
        throw new Recusa(400, 'Grupo de clientes não encontrado.');
      }
      try {
        if (id) {
          await db.query(
            `update clientes set tipo = $2::tipo_pessoa, nome = $3, nome_fantasia = $4, cpf_cnpj = $5, telefone = $6, whatsapp = $7,
                    email = $8, cep = $9, endereco = $10, cidade = $11, uf = $12, observacoes = $13, ativo = $14, grupo_cliente_id = $15
              where id = $1`, [id, ...campos]);
          await gravarPrecos(db, id, b.precos);
          return id;
        }
        const novo = (await db.query(
          `insert into clientes (empresa_id, tipo, nome, nome_fantasia, cpf_cnpj, telefone, whatsapp, email, cep, endereco, cidade, uf,
                                 observacoes, ativo, grupo_cliente_id)
           values ($1, $2::tipo_pessoa, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`, [empresa, ...campos])).rows[0].id;
        await gravarPrecos(db, novo, b.precos);
        return novo;
      } catch (e) {
        if (e.code === '23505') throw new Recusa(400, `Já existe um cliente com esse ${tipo === 'pj' ? 'CNPJ' : 'CPF'}.`);
        throw e;
      }
    });
    res.json({ id: novoId });
  });
  app.post('/api/clientes', exigeLogin, (req, res) => salvar(null)(req, res));
  app.put('/api/clientes/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvar(req.params.id)(req, res) : res.status(404).json({ erro: 'Cliente não encontrado.' }));
}
