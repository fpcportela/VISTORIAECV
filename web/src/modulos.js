// Módulos do sistema: aparecem no menu e nos atalhos só para quem tem a
// permissão no perfil da loja (o master vê todos).
export const MODULOS = [
  { id: 'vistorias', nome: 'Vistorias', curto: 'Vistorias', permissao: 'vistorias.ver', sub: true },
  { id: 'busca', nome: 'Consulta de placa', curto: 'Placa', permissao: 'placa.consultar' },
  { id: 'camera', nome: 'Ler placa por foto', curto: 'Foto da placa', permissao: 'placa.foto' },
  { id: 'vendas', nome: 'Vendas', curto: 'Vendas', permissao: 'vendas.ver' },
  { id: 'clientes', nome: 'Clientes', curto: 'Clientes', permissao: 'clientes.ver' },
  { id: 'financeiro', nome: 'Financeiro', curto: 'Financeiro', permissao: 'financeiro.ver', sub: true },
  { id: 'royalties', nome: 'Royalties', curto: 'Royalties', permissao: 'royalties.ver' },
  { id: 'maquininha', nome: 'Maquininhas e bancos', curto: 'Maquininhas', permissao: 'maquininhas.ver', sub: true },
  { id: 'servicos', nome: 'Serviços e produtos', curto: 'Serviços', permissao: 'servicos.gerenciar' },
  { id: 'lojas', nome: 'Lojas', curto: 'Lojas', permissao: 'lojas.gerenciar' },
  { id: 'usuarios', nome: 'Usuários e permissões', curto: 'Usuários', permissao: 'usuarios.gerenciar' },
  { id: 'ponto', nome: 'Controle de ponto', curto: 'Ponto', permissao: 'ponto.registrar' },
  { id: 'relatorios', nome: 'Relatórios', curto: 'Relatórios', permissao: 'relatorios.ver' },
  { id: 'whatsapp', nome: 'WhatsApp', curto: 'WhatsApp', permissao: 'whatsapp.enviar' },
  { id: 'config', nome: 'Configurações', curto: 'Configurações', permissao: 'config.gerenciar' },
];

// Devolve tem(permissao): na loja escolhida, ou em qualquer loja quando "Todas as lojas"
export function criarTem(perfil, loja) {
  return (permissao) => {
    if (perfil.master) return true;
    if (loja) return (perfil.acessos[loja] || []).includes(permissao);
    return Object.values(perfil.acessos).some((lista) => lista.includes(permissao));
  };
}

// Módulos na ordem escolhida pelo usuário; os que não estão na lista vão no fim
export function ordenar(modulos, ordem) {
  if (!ordem?.length) return modulos;
  const pos = (id) => { const i = ordem.indexOf(id); return i < 0 ? 999 : i; };
  return [...modulos].sort((a, b) => pos(a.id) - pos(b.id));
}
