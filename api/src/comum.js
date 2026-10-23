// Peças usadas pelas rotas dos módulos

export const UUID = /^[0-9a-f-]{36}$/i;

// Erro com status HTTP, devolvido como { erro } pela rota
export class Recusa extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

export async function exigir(db, loja, permissao, mensagem) {
  const ok = (await db.query('select pode($1, $2) as ok', [loja, permissao])).rows[0].ok;
  if (!ok) throw new Recusa(403, mensagem || 'Seu perfil não tem permissão para isso.');
}

export const texto = (v, max = 500) =>
  (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

// Envolve a rota: Recusa vira { erro } com o status certo; o resto segue para `rota`
export const criarComRecusa = (rota) => (fn) => rota(async (req, res) => {
  try {
    await fn(req, res);
  } catch (erro) {
    if (erro instanceof Recusa) return res.status(erro.status).json({ erro: erro.message });
    throw erro;
  }
});

// Cliente da venda/vistoria: um existente do grupo, um novo, ou o "particular / avulso"
export async function resolverCliente(db, { empresa, loja, cliente_id, cliente_novo }) {
  if (UUID.test(cliente_id || '')) {
    const ok = (await db.query('select 1 from clientes where id = $1 and empresa_id = $2', [cliente_id, empresa])).rowCount;
    if (!ok) throw new Recusa(400, 'Cliente não encontrado.');
    return cliente_id;
  }
  if (cliente_novo?.nome) {
    await exigir(db, loja, 'clientes.editar', 'Seu perfil não pode cadastrar clientes.');
    const n = cliente_novo;
    const doc = texto(n.cpf_cnpj, 20)?.replace(/\D/g, '') || null;
    if (doc && ![11, 14].includes(doc.length)) throw new Recusa(400, 'CPF deve ter 11 números e CNPJ 14.');
    let tipo = ['pf', 'pj'].includes(n.tipo) ? n.tipo : (doc?.length === 14 ? 'pj' : doc ? 'pf' : 'avulso');
    if (tipo !== 'avulso' && !doc) tipo = 'avulso';
    if (doc) {
      const existe = (await db.query('select id from clientes where empresa_id = $1 and cpf_cnpj = $2', [empresa, doc])).rows[0];
      if (existe) return existe.id;
    }
    return (await db.query(
      `insert into clientes (empresa_id, tipo, nome, cpf_cnpj, whatsapp, email)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [empresa, tipo, texto(n.nome, 120).toUpperCase(), doc,
       texto(n.whatsapp, 20)?.replace(/\D/g, '') || null, texto(n.email, 120)?.toLowerCase() || null])).rows[0].id;
  }
  return (await db.query(
    "select id from clientes where empresa_id = $1 and tipo = 'avulso' and nome = 'CLIENTE PARTICULAR / AVULSO'", [empresa])).rows[0]?.id
    || (await db.query(
      "insert into clientes (empresa_id, tipo, nome) values ($1, 'avulso', 'CLIENTE PARTICULAR / AVULSO') returning id", [empresa])).rows[0].id;
}
