import { moeda } from './api.js';

// Regras de digitação para o sistema inteiro:
// - textos sempre em MAIÚSCULAS e sem acento (e-mail, senha, datas e campos com data-livre ficam como estão);
// - campos de valor (data-moeda) com a vírgula automática: digitar 15000 vira 150,00.

export const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// "15000" -> "150,00"; "1.234,5" -> "123,45" (só os dígitos contam, os dois últimos são os centavos)
export function mascaraMoeda(t) {
  const d = String(t ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
  return d ? moeda(Number(d) / 100) : '';
}
// número (ou texto do servidor) -> texto do campo: 150 -> "150,00"
export const paraMoeda = (v) => (v === '' || v === null || v === undefined ? '' : moeda(v));
// texto do campo -> número: "1.234,56" -> 1234.56
export const lerMoeda = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0);

const TEXTO = new Set(['text', 'search', 'tel', '']);
const setterInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
const setterArea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

function ajustar(e) {
  const el = e.target;
  const area = el instanceof HTMLTextAreaElement;
  if (!area && !(el instanceof HTMLInputElement)) return;
  if (!area && !TEXTO.has(el.getAttribute('type') || '')) return;
  if (el.hasAttribute('data-livre')) return;
  const antes = el.value;
  const depois = el.hasAttribute('data-moeda') ? mascaraMoeda(antes) : semAcento(antes);
  if (depois === antes) return;
  const fim = el.selectionEnd;
  // grava pelo setter nativo: o React enxerga o valor novo no mesmo evento
  (area ? setterArea : setterInput).call(el, depois);
  if (el.hasAttribute('data-moeda')) el.setSelectionRange(depois.length, depois.length);
  else if (depois.length === antes.length && fim !== null) el.setSelectionRange(fim, fim);
}

// fase de captura: roda antes do React tratar o evento
window.addEventListener('input', ajustar, true);
