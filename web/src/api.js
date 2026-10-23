// Chamadas à API. O token de login fica guardado no navegador.

const CHAVE = 'vistoria-ecv-token';

export const sessao = {
  token: () => localStorage.getItem(CHAVE),
  salvar: (t) => localStorage.setItem(CHAVE, t),
  sair: () => localStorage.removeItem(CHAVE),
};

export async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(sessao.token() ? { Authorization: `Bearer ${sessao.token()}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401) sessao.sair();
  if (!resposta.ok) {
    const erro = new Error(dados.erro || 'Não foi possível falar com o servidor.');
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

export const moeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
