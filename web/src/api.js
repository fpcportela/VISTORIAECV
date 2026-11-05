// Chamadas à API. O token de login fica guardado no navegador.

const CHAVE = 'vistoria-ecv-token';
const CHAVE_GRUPO = 'vistoria-ecv-grupo';

// Grupo que o master escolheu no topo (vazio = todos os grupos)
export const grupoEscolhido = {
  ler: () => { try { return localStorage.getItem(CHAVE_GRUPO) || ''; } catch { return ''; } },
  salvar: (id) => { try { if (id) localStorage.setItem(CHAVE_GRUPO, id); else localStorage.removeItem(CHAVE_GRUPO); } catch { /* sem armazenamento */ } },
};

// Unidade escolhida no topo (vazio = "Todas as lojas"). Vai em toda chamada: quem vê uma
// unidade por vez só recebe os dados dela (o servidor confere).
const CHAVE_LOJA = 'vistoria-ecv-loja';
let lojaAtual = '';
export const lojaEscolhida = {
  ler: () => lojaAtual,
  lembrada: () => { try { return localStorage.getItem(CHAVE_LOJA) || ''; } catch { return ''; } },
  usar: (id) => { lojaAtual = id || ''; },
  salvar: (id) => { lojaAtual = id || ''; try { if (id) localStorage.setItem(CHAVE_LOJA, id); else localStorage.removeItem(CHAVE_LOJA); } catch { /* sem armazenamento */ } },
};

export const sessao = {
  token: () => localStorage.getItem(CHAVE),
  salvar: (t) => localStorage.setItem(CHAVE, t),
  sair: () => localStorage.removeItem(CHAVE),
};

// Login, grupo (master) e unidade escolhida: para as chamadas feitas com fetch direto também
export function cabecalhos() {
  return {
    ...(sessao.token() ? { Authorization: `Bearer ${sessao.token()}` } : {}),
    ...(grupoEscolhido.ler() ? { 'X-Grupo': grupoEscolhido.ler() } : {}),
    ...(lojaAtual ? { 'X-Loja': lojaAtual } : {}),
  };
}

export async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...cabecalhos(),
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
