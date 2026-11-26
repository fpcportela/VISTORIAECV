import { useEffect, useRef, useState } from 'react';
import { Icone } from './icones.jsx';

// Campo de data do sistema inteiro: sempre DD/MM/AAAA, só números (as barras entram sozinhas),
// no máximo 10 caracteres. Por fora continua trabalhando com AAAA-MM-DD, como o servidor espera.
// onChange recebe { target: { value } } com a data completa e válida, ou '' enquanto não estiver.

// "25102026" -> "25/10/2026"
export function mascaraData(t) {
  const d = String(t ?? '').replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}
// "2026-10-25" -> "25/10/2026"
export const paraData = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
// "25/10/2026" -> "2026-10-25" (null se a data não existe, ex.: 31/02)
export function lerData(t) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t || '');
  if (!m) return null;
  const [, d, mes, a] = m.map(Number);
  if (a < 1900 || a > 2100 || mes < 1 || mes > 12 || d < 1 || d > new Date(a, mes, 0).getDate()) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function CampoData({ value, onChange, required, min, max, className, ...resto }) {
  const [texto, setTexto] = useState(paraData(value));
  const campo = useRef(null);
  const seletor = useRef(null);

  // valor trocado por fora (limpar filtro, abrir outro lançamento…)
  useEffect(() => {
    if ((lerData(texto) || '') !== (value || '')) setTexto(paraData(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const iso = lerData(texto);
  const foraDoLimite = iso && ((min && iso < min) || (max && iso > max));
  const invalida = texto.length === 10 && (!iso || foraDoLimite);
  useEffect(() => {
    campo.current?.setCustomValidity(
      invalida ? (iso ? 'Data fora do período permitido.' : 'Data inválida. Use DD/MM/AAAA.')
        : texto && texto.length < 10 ? 'Complete a data: DD/MM/AAAA.' : '');
  }, [invalida, iso, texto]);

  function mudar(t) {
    setTexto(t);
    const novo = lerData(t) || '';
    if (novo !== (value || '')) onChange?.({ target: { value: novo, type: 'date' } });
  }

  function abrirCalendario() {
    try { seletor.current?.showPicker(); } catch { campo.current?.focus(); }
  }

  return (
    <span className={`campo-data${className ? ` ${className}` : ''}`}>
      <input
        {...resto}
        ref={campo}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        data-livre
        placeholder="DD/MM/AAAA"
        maxLength={10}
        value={texto}
        required={required}
        aria-invalid={invalida || undefined}
        onChange={(e) => mudar(mascaraData(e.target.value))}
      />
      <button type="button" className="campo-data-cal" onClick={abrirCalendario} aria-label="Abrir calendário" tabIndex={-1}>
        <Icone nome="calendario" tamanho={16} />
      </button>
      <input
        ref={seletor}
        type="date"
        className="campo-data-nativo"
        tabIndex={-1}
        aria-hidden="true"
        min={min || '1900-01-01'}
        max={max || '2100-12-31'}
        value={iso || ''}
        onChange={(e) => e.target.value && mudar(paraData(e.target.value))}
      />
    </span>
  );
}

// Campo de mês (competência): sempre MM/AAAA, só números (a barra entra sozinha).
// Por fora trabalha com AAAA-MM-01 (primeiro dia do mês), como o servidor guarda.
export const mascaraMes = (t) => {
  const d = String(t ?? '').replace(/\D/g, '').slice(0, 6);
  return [d.slice(0, 2), d.slice(2)].filter(Boolean).join('/');
};
export const paraMes = (iso) => (/^\d{4}-\d{2}/.test(iso || '') ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export function lerMes(t) {
  const m = /^(\d{2})\/(\d{4})$/.exec(t || '');
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1900 || Number(m[2]) > 2100) return null;
  return `${m[2]}-${m[1]}-01`;
}

export function CampoMes({ value, onChange, required, className, ...resto }) {
  const [texto, setTexto] = useState(paraMes(value));
  const campo = useRef(null);
  useEffect(() => {
    if ((lerMes(texto) || '') !== (value ? `${value.slice(0, 7)}-01` : '')) setTexto(paraMes(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const invalido = texto.length === 7 && !lerMes(texto);
  useEffect(() => {
    campo.current?.setCustomValidity(invalido ? 'Mês inválido. Use MM/AAAA.' : texto && texto.length < 7 ? 'Complete o mês: MM/AAAA.' : '');
  }, [invalido, texto]);
  function mudar(t) {
    setTexto(t);
    const novo = lerMes(t) || '';
    if (novo !== (value || '')) onChange?.({ target: { value: novo } });
  }
  return (
    <input {...resto} ref={campo} className={className} type="text" inputMode="numeric" autoComplete="off" data-livre
      placeholder="MM/AAAA" maxLength={7} value={texto} required={required} aria-invalid={invalido || undefined}
      onChange={(e) => mudar(mascaraMes(e.target.value))} />
  );
}
