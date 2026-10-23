// Gera os tons do sistema a partir de uma única cor escolhida na paleta

export const COR_PADRAO = '#0774B8';

export const PALETA = [
  ['Azul', '#0774B8'], ['Azul-marinho', '#1E3A8A'], ['Verde', '#0F7B4F'], ['Laranja', '#C2410C'],
  ['Vermelho', '#B91C1C'], ['Roxo', '#6D28D9'], ['Rosa', '#BE185D'], ['Grafite', '#334155'],
];

function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function misturar(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function luminancia(hex) {
  const c = rgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function aplicarTema(cor) {
  // "forte" = tom escuro o bastante para texto branco em botões e texto sobre branco
  let forte = cor;
  for (let i = 0; i < 12 && luminancia(forte) > 0.17; i++) forte = misturar(forte, '#000000', 0.12);
  const raiz = document.documentElement.style;
  raiz.setProperty('--primaria', cor);
  raiz.setProperty('--forte', forte);
  raiz.setProperty('--sobre-primaria', luminancia(cor) <= 0.199 ? '#ffffff' : '#111827');
  raiz.setProperty('--clara', misturar(cor, '#ffffff', 0.9));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cor);
}
