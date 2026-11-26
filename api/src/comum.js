// Peças usadas pelas rotas dos módulos
import { cnpjValido, cpfValido } from './documentos.js';

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

// Clientes que a unidade enxerga: os dela, os sem unidade (avulso) e, se o grupo compartilha
// os clientes (Grupos e unidades), os de todas as unidades. Usa $1 = empresa e $2 = loja.
export const CLIENTE_DA_LOJA = "(c.loja_id is null or c.loja_id = $2 or compartilha($1, 'clientes'))";

// Cliente da venda/vistoria: um existente da unidade (ou do grupo), um novo, ou o "particular / avulso"
export async function resolverCliente(db, { empresa, loja, cliente_id, cliente_novo }) {
  if (UUID.test(cliente_id || '')) {
    const ok = (await db.query(`select 1 from clientes c where c.empresa_id = $1 and ${CLIENTE_DA_LOJA} and c.id = $3`,
      [empresa, loja, cliente_id])).rowCount;
    if (!ok) throw new Recusa(400, 'Cliente não encontrado.');
    return cliente_id;
  }
  if (cliente_novo?.nome) {
    // cadastro sempre pelo CPF/CNPJ: se já existe na unidade (ou no grupo, se compartilhado), usa o mesmo (nunca duplica)
    const n = cliente_novo;
    const doc = texto(n.cpf_cnpj, 20)?.replace(/\D/g, '') || null;
    if (!doc) throw new Recusa(400, 'Informe o CPF ou CNPJ para cadastrar o cliente.');
    if (![11, 14].includes(doc.length)) throw new Recusa(400, 'CPF deve ter 11 números e CNPJ 14.');
    if (doc.length === 11 && !cpfValido(doc)) throw new Recusa(400, 'CPF inválido. Confira os números.');
    if (doc.length === 14 && !cnpjValido(doc)) throw new Recusa(400, 'CNPJ inválido. Confira os números.');
    const existe = (await db.query(
      `select c.id from clientes c where c.empresa_id = $1 and ${CLIENTE_DA_LOJA} and c.cpf_cnpj = $3
        order by c.loja_id = $2 desc nulls last limit 1`, [empresa, loja, doc])).rows[0];
    if (existe) return existe.id;
    await exigir(db, loja, 'clientes.editar', 'Seu perfil não pode cadastrar clientes.');
    const tipo = doc.length === 14 ? 'pj' : 'pf';
    return (await db.query(
      `insert into clientes (empresa_id, loja_id, tipo, nome, cpf_cnpj, whatsapp, email, cep, endereco, cidade, uf)
       values ($1, $11, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [empresa, tipo, texto(n.nome, 120).toUpperCase(), doc,
       texto(n.whatsapp, 20)?.replace(/\D/g, '') || null, texto(n.email, 120)?.toLowerCase() || null,
       texto(n.cep, 9)?.replace(/\D/g, '') || null, texto(n.endereco, 200), texto(n.cidade, 80),
       /^[A-Z]{2}$/i.test(n.uf || '') ? n.uf.toUpperCase() : null, loja])).rows[0].id;
  }
  return (await db.query(
    "select id from clientes where empresa_id = $1 and tipo = 'avulso' and nome = 'CLIENTE PARTICULAR / AVULSO'", [empresa])).rows[0]?.id
    || (await db.query(
      "insert into clientes (empresa_id, tipo, nome) values ($1, 'avulso', 'CLIENTE PARTICULAR / AVULSO') returning id", [empresa])).rows[0].id;
}
