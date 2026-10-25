// CPF e CNPJ: validação dos dígitos e consulta da razão social.
// O site da Receita tem captcha e não pode ser automatizado; a BrasilAPI
// devolve os dados públicos do CNPJ vindos da própria Receita.

const BRASILAPI = process.env.BRASILAPI_URL || 'https://brasilapi.com.br/api';

export function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

export function cnpjValido(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((t, p, i) => t + Number(cnpj[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}

// Formato da BrasilAPI e da Minha Receita (os dois vêm do mesmo projeto)
const deBrasilApi = (d) => ({
  razao_social: d.razao_social, nome_fantasia: d.nome_fantasia, situacao: d.descricao_situacao_cadastral,
  telefone: d.ddd_telefone_1, email: d.email, cep: d.cep,
  endereco: [d.descricao_tipo_de_logradouro, d.logradouro, d.numero, d.complemento, d.bairro],
  cidade: d.municipio, uf: d.uf,
});
// Formato do CNPJ.ws
const deCnpjWs = (d) => {
  const e = d.estabelecimento || {};
  return {
    razao_social: d.razao_social, nome_fantasia: e.nome_fantasia, situacao: e.situacao_cadastral,
    telefone: `${e.ddd1 || ''}${e.telefone1 || ''}`, email: e.email, cep: e.cep,
    endereco: [e.tipo_logradouro, e.logradouro, e.numero, e.complemento, e.bairro],
    cidade: e.cidade?.nome, uf: e.estado?.sigla,
  };
};

// Fontes públicas dos dados da Receita, na ordem: se uma estiver fora do ar ou
// limitando consultas, tenta a próxima.
const FONTES = [
  { nome: 'BrasilAPI', url: (c) => `${BRASILAPI}/cnpj/v1/${c}`, ler: deBrasilApi },
  { nome: 'Minha Receita', url: (c) => `${process.env.MINHARECEITA_URL || 'https://minhareceita.org'}/${c}`, ler: deBrasilApi },
  { nome: 'CNPJ.ws', url: (c) => `${process.env.CNPJWS_URL || 'https://publica.cnpj.ws/cnpj'}/${c}`, ler: deCnpjWs },
];

export async function consultarCnpj(cnpj) {
  let naoAchou = 0;
  for (const fonte of FONTES) {
    let resposta;
    try {
      resposta = await fetch(fonte.url(cnpj), {
        headers: { Accept: 'application/json', 'User-Agent': 'VistoriaECV/1.0' },
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      console.error(`[cnpj] ${fonte.nome}: ${e.cause?.code || e.message}`);
      continue;
    }
    if (resposta.status === 404) { naoAchou++; continue; }
    if (!resposta.ok) { console.error(`[cnpj] ${fonte.nome}: HTTP ${resposta.status}`); continue; }
    const bruto = await resposta.json().catch(() => null);
    if (!bruto) continue;
    const d = fonte.ler(bruto);
    if (!d.razao_social) continue;
    const telefone = String(d.telefone || '').replace(/\D/g, '');
    return {
      cnpj,
      razao_social: d.razao_social || null,
      nome_fantasia: d.nome_fantasia || null,
      situacao: d.situacao || null,
      telefone: telefone.length >= 10 ? telefone : null,
      email: d.email ? String(d.email).toLowerCase() : null,
      cep: d.cep ? String(d.cep).replace(/\D/g, '') : null,
      endereco: d.endereco.filter(Boolean).join(', ') || null,
      cidade: d.cidade || null,
      uf: d.uf || null,
    };
  }
  if (naoAchou) return { erro: 'CNPJ não encontrado na Receita.', status: 404 };
  return { erro: 'Não foi possível consultar a Receita agora. Preencha a razão social manualmente.', status: 502 };
}
