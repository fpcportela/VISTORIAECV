import { useEffect, useId, useState } from 'react';
import { api } from './api.js';
import { TIPOS } from './Vistorias.jsx';

// Tipo, marca e modelo do veículo. As listas vêm da tabela FIPE (marcas e modelos
// vendidos no Brasil); dá para digitar para filtrar, e sem internet vale o texto digitado.

const memoria = new Map(); // listas já carregadas nesta sessão
async function lista(caminho) {
  if (!memoria.has(caminho)) memoria.set(caminho, api(caminho).catch((e) => { memoria.delete(caminho); throw e; }));
  return memoria.get(caminho);
}
const igual = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

export function SeletorVeiculo({ tipo, marca, modelo, aoMudar, disabled }) {
  const id = useId();
  const tipoLista = tipo || 'carro';
  const [marcas, setMarcas] = useState([]);
  const [modelos, setModelos] = useState([]);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (disabled) return;
    lista(`/fipe/marcas?tipo=${tipoLista}`).then((l) => { setMarcas(l); setAviso(''); }).catch((f) => setAviso(f.message));
  }, [tipoLista, disabled]);

  const marcaFipe = marcas.find((m) => igual(m.nome, marca));
  useEffect(() => {
    setModelos([]);
    if (disabled || !marcaFipe) return;
    lista(`/fipe/modelos?tipo=${tipoLista}&marca=${marcaFipe.codigo}`).then(setModelos).catch((f) => setAviso(f.message));
  }, [marcaFipe?.codigo, tipoLista, disabled]);

  return (
    <div className="seletor-veiculo">
      <select value={tipo || ''} disabled={disabled} aria-label="Tipo de veículo"
        onChange={(e) => aoMudar({ tipo_veiculo: e.target.value || null })}>
        <option value="">Tipo…</option>
        {Object.entries(TIPOS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
      </select>
      <input list={`${id}-marcas`} value={marca || ''} disabled={disabled} placeholder="Marca" aria-label="Marca"
        onChange={(e) => aoMudar({ marca: e.target.value, ...(igual(e.target.value, marca) ? {} : { modelo: '' }) })} />
      <datalist id={`${id}-marcas`}>{marcas.map((m) => <option key={m.codigo} value={m.nome} />)}</datalist>
      <input list={`${id}-modelos`} value={modelo || ''} disabled={disabled} placeholder={marcaFipe ? 'Modelo' : 'Modelo (escolha a marca)'} aria-label="Modelo"
        onChange={(e) => aoMudar({ modelo: e.target.value })} />
      <datalist id={`${id}-modelos`}>{modelos.map((m) => <option key={m.codigo} value={m.nome} />)}</datalist>
      {aviso && <small className="cinza aviso-fipe">{aviso}</small>}
    </div>
  );
}
