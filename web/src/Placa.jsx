// Placa no padrão Mercosul: faixa azul "BRASIL" com bandeira, "BR" e os
// caracteres grandes. Serve para mostrar (Placa) e para digitar (PlacaInput).

export const limparPlaca = (texto) => String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
export const formatarPlaca = (placa) => (placa.length > 3 ? `${placa.slice(0, 3)} ${placa.slice(3)}` : placa);
export const placaValida = (placa) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa);

const Bandeira = () => (
  <svg className="bandeira" viewBox="0 0 20 14" aria-hidden="true">
    <rect width="20" height="14" fill="#009b3a" />
    <path d="M10 1.5 18.5 7 10 12.5 1.5 7z" fill="#fedf00" />
    <circle cx="10" cy="7" r="3" fill="#002776" />
  </svg>
);

function Moldura({ tamanho = 'media', children, rotulo }) {
  return (
    <div className={`placa-br ${tamanho}`} aria-label={rotulo}>
      <div className="placa-br-faixa">
        <small>MERCOSUL</small><span>BRASIL</span><Bandeira />
      </div>
      <div className="placa-br-corpo">
        <small className="placa-br-pais">BR</small>
        {children}
      </div>
    </div>
  );
}

export function Placa({ placa, tamanho }) {
  return (
    <Moldura tamanho={tamanho} rotulo={`Placa ${placa}`}>
      <strong>{formatarPlaca(placa)}</strong>
    </Moldura>
  );
}

export function PlacaInput({ valor, aoMudar, tamanho, ...props }) {
  return (
    <Moldura tamanho={tamanho}>
      <input value={formatarPlaca(valor)} onChange={(e) => aoMudar(limparPlaca(e.target.value))}
        placeholder="ABC 1D23" aria-label="Placa" autoComplete="off" autoCapitalize="characters" spellCheck={false}
        maxLength={8} {...props} />
    </Moldura>
  );
}
