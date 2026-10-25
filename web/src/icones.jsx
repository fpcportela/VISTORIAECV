// Ícones em traço (mesmos do layout aprovado)
const caminhos = {
  inicio: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  vistorias: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="m9 14 2 2 4-4" /></>,
  vendas: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  servicos: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  ordenar: <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />,
  busca: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  clientes: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.3 2.5 3.5 5.2" /></>,
  financeiro: <><circle cx="12" cy="12" r="9" /><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v12" /></>,
  royalties: <><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /><path d="M19 5 5 19" /></>,
  maquininha: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M9 6h6v4H9z" /><path d="M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01" /></>,
  lojas: <path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6" />,
  usuarios: <><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><circle cx="12" cy="10" r="2.5" /><path d="M8 16c.6-1.8 2.2-3 4-3s3.4 1.2 4 3" /></>,
  colaboradores: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.5" /><path d="M5.5 16.5c.5-1.6 1.8-2.5 3.5-2.5s3 .9 3.5 2.5M15 10h3M15 13h3" /></>,
  calendario: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  ponto: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  relatorios: <><path d="M4 4v16h16" /><path d="m8 15 4-4 3 3 5-6" /></>,
  whatsapp: <path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z" />,
  config: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  escudo: <><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  paleta: <><path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-.8 2-1.8 0-1.3-1-1.7-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  ajuda: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01" /></>,
  olho: <><path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" /><circle cx="12" cy="12" r="3" /></>,
  olhoFechado: <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6-.4.9-1.2 2.1-2.4 3.2M6.6 7.6C4.6 8.8 3.2 10.6 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1" />,
  mais: <path d="M12 5v14M5 12h14" />,
  direita: <path d="m9 6 6 6-6 6" />,
  baixo: <path d="m6 9 6 6 6-6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  sair: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  carro: <><path d="M3 16v-4l2-5h11l3 5h2v4z" /><circle cx="7.5" cy="16.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></>,
  moto: <><circle cx="5.5" cy="16" r="3" /><circle cx="18.5" cy="16" r="3" /><path d="M5.5 16 9 10h5l4.5 6M14 10l-1.5-4H10" /></>,
  caminhao: <><path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" /><circle cx="6" cy="17.5" r="2" /><circle cx="17" cy="17.5" r="2" /></>,
};

export function Icone({ nome, tamanho = 20, traco = 2 }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={traco} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {caminhos[nome]}
    </svg>
  );
}
