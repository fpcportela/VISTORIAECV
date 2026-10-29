import { useEffect, useState } from 'react';
import { api, moeda } from './api.js';
import { paraMoeda } from './entrada.js';
import { TIPOS } from './Vistorias.jsx';

// Cadastro de serviços e produtos do grupo, com preço por tipo de veículo
export default function Servicos({ loja, podeEditar }) {
  const [lista, setLista] = useState(null);
  const [editando, setEditando] = useState(undefined); // undefined = fechado; null = novo
  const [erro, setErro] = useState('');

  const carregar = () => api(`/servicos?loja=${loja}&uso=cadastro`).then(setLista).catch((f) => setErro(f.message));
  useEffect(() => { if (loja) carregar(); }, [loja]);

  return (
    <>
      <div className="cabecalho">
        <h1>Serviços e produtos</h1>
        {podeEditar && <button className="botao-primario" onClick={() => setEditando(null)}>+ Novo</button>}
      </div>
      <p className="cinza ajuda">O cadastro vale para todas as lojas do grupo. Na venda, o valor vem do preço do tipo de veículo da placa; sem preço específico, usa o valor padrão.</p>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {lista === null ? <p className="cinza">Carregando…</p> : (
        <div className="lista-cadastro">
          {lista.map((s) => (
            <button key={s.id} className="cartao item-cadastro" onClick={() => setEditando(s)}>
              <span className="item-titulo">
                <strong>{s.nome}</strong>
                <span className="etiqueta">{s.tipo === 'produto' ? 'Produto' : 'Serviço'}</span>
                {!s.ativo && <span className="etiqueta inativa">Inativo</span>}
              </span>
              {s.descricao && <small className="cinza">{s.descricao}</small>}
              <small>
                Padrão R$ {moeda(s.valor_padrao)}
                {Object.entries(s.precos).map(([t, v]) => ` · ${TIPOS[t]} R$ ${moeda(v)}`).join('')}
              </small>
              {s.tipo === 'servico' && <small className="cinza">{s.gera_vistoria ? 'Gera vistoria' : 'Não gera vistoria'}</small>}
            </button>
          ))}
        </div>
      )}
      {editando !== undefined && (
        <EditorServico item={editando} loja={loja} somenteLeitura={!podeEditar} aoFechar={() => setEditando(undefined)}
          aoSalvar={() => { setEditando(undefined); carregar(); }} />
      )}
    </>
  );
}

function EditorServico({ item, loja, somenteLeitura, aoFechar, aoSalvar }) {
  const [f, setF] = useState({
    nome: item?.nome || '', tipo: item?.tipo || 'servico', descricao: item?.descricao || '',
    valor_padrao: item ? paraMoeda(item.valor_padrao) : '', gera_vistoria: item?.gera_vistoria ?? true, ativo: item?.ativo ?? true,
    precos: Object.fromEntries(Object.keys(TIPOS).map((t) => [t, item?.precos?.[t] !== undefined ? paraMoeda(item.precos[t]) : ''])),
  });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const muda = (campo) => (e) => setF({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      const corpo = { ...f, loja_id: loja };
      await (item ? api(`/servicos/${item.id}`, { metodo: 'PUT', corpo }) : api('/servicos', { metodo: 'POST', corpo }));
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Serviço ou produto">
        <div className="modal-topo">
          <h2>{somenteLeitura ? 'Ver' : item ? 'Editar' : 'Novo'} {f.tipo === 'produto' ? 'produto' : 'serviço'}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={salvar}>
          <fieldset className="sem-borda" disabled={somenteLeitura}>
          <div className="opcoes">
            {[['servico', 'Serviço'], ['produto', 'Produto']].map(([v, n]) => (
              <label key={v} className={f.tipo === v ? 'opcao marcada' : 'opcao'}>
                <input type="radio" checked={f.tipo === v} onChange={() => setF({ ...f, tipo: v })} /><strong>{n}</strong>
              </label>
            ))}
          </div>
          <label>Nome<input value={f.nome} onChange={muda('nome')} required placeholder="Ex.: CAUTELAR" /></label>
          <label>Descrição<input value={f.descricao} onChange={muda('descricao')} placeholder="Opcional" /></label>
          <label>Valor padrão (R$)<input value={f.valor_padrao} onChange={muda('valor_padrao')} inputMode="numeric" data-moeda placeholder="0,00" /></label>
          <fieldset className="grupo-permissoes">
            <legend>Preço por tipo de veículo (opcional)</legend>
            <div className="dados-veiculo">
              {Object.entries(TIPOS).map(([t, n]) => (
                <label key={t}>{n}
                  <input value={f.precos[t]} inputMode="numeric" data-moeda placeholder="Padrão"
                    onChange={(e) => setF({ ...f, precos: { ...f.precos, [t]: e.target.value } })} />
                </label>
              ))}
            </div>
          </fieldset>
          {f.tipo === 'servico' && (
            <label className="linha-check"><input type="checkbox" checked={f.gera_vistoria} onChange={muda('gera_vistoria')} /> Aparece na abertura de vistoria</label>
          )}
          <label className="linha-check"><input type="checkbox" checked={f.ativo} onChange={muda('ativo')} /> Ativo</label>
          </fieldset>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>{somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
            {!somenteLeitura && <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
          </div>
        </form>
      </section>
    </div>
  );
}
