import { useState } from 'react';

// Placa no padrão Mercosul (faixa azul "BRASIL", bandeira, "BR") ou no modelo
// antigo (cinza, ABC-1234). Serve para mostrar (Placa) e para digitar (PlacaInput).

const MERCOSUL = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
const ANTIGA = /^[A-Z]{3}[0-9]{4}$/;

export const limparPlaca = (texto) => String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
export const ehAntiga = (placa) => ANTIGA.test(placa);
export const placaValida = (placa) => MERCOSUL.test(placa) || ANTIGA.test(placa);
export const formatarPlaca = (placa, antiga = ehAntiga(placa)) =>
  placa.length > 3 ? `${placa.slice(0, 3)}${antiga ? '-' : ' '}${placa.slice(3)}` : placa;

// Aceita só o caractere certo em cada posição: Mercosul ABC1D23, antiga ABC1234
export function filtrarPlaca(texto, antiga) {
  let saida = '';
  for (const c of String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    const i = saida.length;
    if (i >= 7) break;
    const letra = /[A-Z]/.test(c);
    const querLetra = i < 3 || (i === 4 && !antiga);
    if (querLetra === letra) saida += c;
  }
  return saida;
}

const Bandeira = () => (
  <svg className="bandeira" viewBox="0 0 20 14" aria-hidden="true">
    <rect width="20" height="14" fill="#009b3a" />
    <path d="M10 1.5 18.5 7 10 12.5 1.5 7z" fill="#fedf00" />
    <circle cx="10" cy="7" r="3" fill="#002776" />
  </svg>
);

function Moldura({ tamanho = 'media', antiga, children, rotulo }) {
  return (
    <div className={`placa-br ${tamanho}${antiga ? ' antiga' : ''}`} aria-label={rotulo}>
      <div className="placa-br-faixa">
        {antiga ? <span>BRASIL</span> : <><small>MERCOSUL</small><span>BRASIL</span><Bandeira /></>}
      </div>
      <div className="placa-br-corpo">
        {!antiga && <small className="placa-br-pais">BR</small>}
        {children}
      </div>
    </div>
  );
}

export function Placa({ placa, tamanho }) {
  return (
    <Moldura tamanho={tamanho} antiga={ehAntiga(placa)} rotulo={`Placa ${placa}`}>
      <strong>{formatarPlaca(placa)}</strong>
    </Moldura>
  );
}

// Padrão Mercosul (ABC1D23). A caixa "Placa antiga" troca para ABC1234.
export function PlacaInput({ valor, aoMudar, tamanho, disabled, ...props }) {
  const [antiga, setAntiga] = useState(ehAntiga(valor));
  const trocar = (marcado) => { setAntiga(marcado); aoMudar(filtrarPlaca(valor, marcado)); };
  return (
    <div className={`placa-campo ${tamanho || ''}`}>
      <Moldura tamanho={tamanho} antiga={antiga}>
        <input value={formatarPlaca(valor, antiga)} onChange={(e) => aoMudar(filtrarPlaca(e.target.value, antiga))}
          placeholder={antiga ? 'ABC-1234' : 'ABC 1D23'} aria-label="Placa" autoComplete="off" autoCapitalize="characters"
          spellCheck={false} maxLength={8} disabled={disabled} {...props} />
      </Moldura>
      <label className="placa-antiga">
        <input type="checkbox" checked={antiga} disabled={disabled} onChange={(e) => trocar(e.target.checked)} /> Placa antiga
      </label>
    </div>
  );
}
