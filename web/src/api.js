// Chamadas à API. O token de login fica guardado no navegador.

const CHAVE = 'vistoria-ecv-token';
const CHAVE_GRUPO = 'vistoria-ecv-grupo';

// Grupo que o master escolheu no topo (vazio = todos os grupos)
export const grupoEscolhido = {
  ler: () => { try { return localStorage.getItem(CHAVE_GRUPO) || ''; } catch { return ''; } },
  salvar: (id) => { try { if (id) localStorage.setItem(CHAVE_GRUPO, id); else localStorage.removeItem(CHAVE_GRUPO); } catch { /* sem armazenamento */ } },
};

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
      ...(grupoEscolhido.ler() ? { 'X-Grupo': grupoEscolhido.ler() } : {}),
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
