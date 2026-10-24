import { useEffect, useRef, useState } from 'react';
import { api, moeda } from './api.js';
import { Icone } from './icones.jsx';
import { formatarDoc } from './documentos.js';

// Pesquisa geral do topo: placa, cliente (nome, CPF) ou empresa (razão social, CNPJ).
// Mostra vistorias, vendas e clientes; com placa completa, oferece a consulta na API.
export default function Pesquisa({ loja, podeConsultarPlaca, aoVistoria, aoVenda, aoCliente, aoConsultarPlaca, classe = '' }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState(null);
  const [aberta, setAberta] = useState(false);
  const caixa = useRef();

  useEffect(() => {
    if (q.trim().length < 2) { setR(null); return; }
    const t = setTimeout(() => api(`/busca?q=${encodeURIComponent(q.trim())}${loja ? `&loja=${loja}` : ''}`).then(setR).catch(() => setR(null)), 300);
    return () => clearTimeout(t);
  }, [q, loja]);

  useEffect(() => {
    const fora = (e) => caixa.current && !caixa.current.contains(e.target) && setAberta(false);
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, []);

  const ir = (fn) => () => { setAberta(false); setQ(''); fn(); };
  const vazio = r && !r.clientes.length && !r.vistorias.length && !r.vendas.length;

  return (
    <div className={`pesquisa ${classe}`} ref={caixa}>
      <label>
        <Icone nome="busca" />
        <input type="search" enterKeyHint="search" value={q} placeholder="Pesquisar placa, cliente ou empresa" aria-label="Pesquisar placa, cliente ou empresa"
          onChange={(e) => { setQ(e.target.value); setAberta(true); }} onFocus={() => setAberta(true)}
          onKeyDown={(e) => e.key === 'Escape' && setAberta(false)} />
      </label>
      {aberta && r && (
        <div className="resultados-pesquisa" role="listbox">
          {r.placa && podeConsultarPlaca && (
            <button onClick={ir(() => aoConsultarPlaca(r.placa))}><Icone nome="busca" tamanho={18} /> Consultar a placa <strong>{r.placa}</strong> na API</button>
          )}
          {r.vistorias.length > 0 && <h3>Vistorias</h3>}
          {r.vistorias.map((v) => (
            <button key={v.id} onClick={ir(() => aoVistoria(v.id))}>
              <strong>{v.placa}</strong> · Nº {v.numero} · {[v.marca, v.modelo].filter(Boolean).join(' ')} <small className="cinza">{v.cliente}</small>
            </button>
          ))}
          {r.vendas.length > 0 && <h3>Vendas</h3>}
          {r.vendas.map((v) => (
            <button key={v.id} onClick={ir(() => aoVenda(v.id))}>
              <strong>Nº {v.numero}</strong> · {v.cliente} · R$ {moeda(v.valor_total)} <small className="cinza">{v.situacao}</small>
            </button>
          ))}
          {r.clientes.length > 0 && <h3>Clientes e empresas</h3>}
          {r.clientes.map((c) => (
            <button key={c.id} onClick={ir(() => aoCliente(c))}>
              <strong>{c.nome}</strong> <small className="cinza">{c.tipo === 'pj' ? 'Empresa' : 'Pessoa física'}{c.cpf_cnpj && ` · ${formatarDoc(c.cpf_cnpj)}`}</small>
            </button>
          ))}
          {vazio && !(r.placa && podeConsultarPlaca) && <p className="cinza">Nada encontrado para “{q}”.</p>}
        </div>
      )}
    </div>
  );
}
