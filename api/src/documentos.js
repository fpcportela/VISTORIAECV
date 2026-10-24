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

export async function consultarCnpj(cnpj) {
  let resposta;
  try {
    resposta = await fetch(`${BRASILAPI}/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(12000) });
  } catch {
    return { erro: 'Não foi possível consultar a Receita agora. Preencha a razão social manualmente.', status: 502 };
  }
  if (resposta.status === 404) return { erro: 'CNPJ não encontrado na Receita.', status: 404 };
  if (!resposta.ok) return { erro: 'A consulta de CNPJ não respondeu. Preencha a razão social manualmente.', status: 502 };
  const d = await resposta.json();
  const telefone = String(d.ddd_telefone_1 || '').replace(/\D/g, '');
  return {
    cnpj,
    razao_social: d.razao_social || null,
    nome_fantasia: d.nome_fantasia || null,
    situacao: d.descricao_situacao_cadastral || null,
    telefone: telefone.length >= 10 ? telefone : null,
    email: d.email ? String(d.email).toLowerCase() : null,
    cep: d.cep ? String(d.cep).replace(/\D/g, '') : null,
    endereco: [d.descricao_tipo_de_logradouro, d.logradouro, d.numero, d.complemento, d.bairro].filter(Boolean).join(', ') || null,
    cidade: d.municipio || null,
    uf: d.uf || null,
  };
}
