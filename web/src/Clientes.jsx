import { useEffect, useState } from 'react';
import { api, moeda } from './api.js';
import { criarTem } from './modulos.js';
import { cnpjValido, cpfValido, formatarDoc, mascaraCnpj, mascaraCpf, mascaraTelefone } from './documentos.js';

// Cadastro de clientes: pessoa física, empresa e grupo de empresas (vários CNPJs).

const TIPOS = { pf: 'Pessoa física', pj: 'Empresa', grupo: 'Grupo de empresas' };
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const mascaraCep = (v) => String(v || '').replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

export default function Clientes({ perfil, loja }) {
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(undefined); // undefined = fechado; { id } ou { novo: tipo, grupo }
  const [recarga, setRecarga] = useState(0);

  const lojasEditar = perfil.lojas.filter((l) => criarTem(perfil, l.id)('clientes.editar'));

  useEffect(() => {
    const q = new URLSearchParams({ ...(loja && { loja }), ...(tipo && { tipo }), ...(busca.trim() && { busca: busca.trim() }), ...(inativos && { inativos: '1' }) });
    const t = setTimeout(() => api(`/clientes?${q}`).then((l) => { setLista(l.filter((c) => c.tipo !== 'avulso')); setErro(''); }).catch((f) => setErro(f.message)), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [loja, tipo, busca, inativos, recarga]);

  return (
    <>
      <div className="cabecalho">
        <h1>Clientes</h1>
        {lojasEditar.length > 0 && <button className="botao-primario" onClick={() => setAberto({ novo: 'pf' })}>+ Novo cliente</button>}
      </div>
      <div className="filtros">
        <div className="abas" role="tablist">
          {[['', 'Todos'], ...Object.entries(TIPOS)].map(([v, n]) => (
            <button key={v} role="tab" aria-selected={tipo === v} className={tipo === v ? 'ativa' : ''} onClick={() => setTipo(v)}>{n}</button>
          ))}
        </div>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, CPF, CNPJ, telefone ou grupo" aria-label="Buscar cliente" />
        <label className="linha-check filtro-check"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? (
        <p className="cinza vazio">Nenhum cliente encontrado.</p>
      ) : (
        <>
          <small className="cinza">{lista.length} cliente(s)</small>
          <div className="lista-cadastro">
            {lista.map((c) => (
              <button key={c.id} className="cartao item-cadastro" onClick={() => setAberto({ id: c.id })}>
                <span className="item-titulo">
                  <strong>{c.nome}</strong>
                  <span className={`etiqueta tipo-cliente ${c.tipo}`}>{TIPOS[c.tipo]}</span>
                  {!c.ativo && <span className="etiqueta inativa">Inativo</span>}
                </span>
                <small className="cinza">
                  {c.tipo === 'grupo'
                    ? `${c.empresas} empresa(s)`
                    : [c.cpf_cnpj && formatarDoc(c.cpf_cnpj), c.nome_fantasia, (c.whatsapp || c.telefone) && mascaraTelefone(c.whatsapp || c.telefone),
                      c.cidade && `${c.cidade}${c.uf ? `/${c.uf}` : ''}`].filter(Boolean).join(' · ')}
                </small>
                {c.grupo_nome && <small className="grupo-do-cliente">Grupo {c.grupo_nome}</small>}
              </button>
            ))}
          </div>
        </>
      )}
      {aberto && (
        <EditorCliente key={aberto.id || `novo-${aberto.novo}-${aberto.grupo?.id || ''}`} id={aberto.id} tipoInicial={aberto.novo} grupoInicial={aberto.grupo}
          lojas={lojasEditar} lojaInicial={loja}
          aoAbrir={setAberto}
          aoFechar={() => { setAberto(undefined); setRecarga((n) => n + 1); }} />
      )}
    </>
  );
}

const vazio = (tipo, grupo) => ({ tipo, nome: '', nome_fantasia: '', cpf_cnpj: '', telefone: '', whatsapp: '', email: '', cep: '', endereco: '',
  cidade: '', uf: '', observacoes: '', ativo: true, grupo_cliente_id: grupo?.id || '' });

function EditorCliente({ id, tipoInicial = 'pf', grupoInicial, lojas, lojaInicial, aoAbrir, aoFechar }) {
  const [c, setC] = useState(id ? null : vazio(tipoInicial, grupoInicial));
  const [extra, setExtra] = useState(null); // empresas do grupo, vendas, pode_editar
  const [grupos, setGrupos] = useState([]);
  const [loja, setLoja] = useState(lojas.some((l) => l.id === lojaInicial) ? lojaInicial : lojas[0]?.id || '');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!id) return;
    api(`/clientes/${id}`).then((d) => {
      setC({ ...vazio(d.tipo), ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? ''])),
        cpf_cnpj: d.cpf_cnpj ? formatarDoc(d.cpf_cnpj) : '', telefone: d.telefone ? mascaraTelefone(d.telefone) : '',
        whatsapp: d.whatsapp ? mascaraTelefone(d.whatsapp) : '', cep: mascaraCep(d.cep), ativo: d.ativo });
      setExtra({ empresas: d.empresas, vendas: d.vendas, pode_editar: d.pode_editar, grupo_nome: d.grupo_nome });
    }).catch((f) => setErro(f.message));
  }, [id]);

  // grupos de clientes, para ligar uma empresa a um grupo
  useEffect(() => {
    if (c?.tipo === 'pj') api(`/clientes?tipo=grupo${lojaInicial ? `&loja=${lojaInicial}` : ''}`).then(setGrupos).catch(() => {});
  }, [c?.tipo]);

  if (!c) return <Janela titulo="Cliente" aoFechar={aoFechar}>{erro ? <p className="erro">{erro}</p> : <p className="cinza">Carregando…</p>}</Janela>;

  const somenteLeitura = id && extra && !extra.pode_editar;
  const muda = (campo) => (e) => setC({ ...c, [campo]: e.target.value });

  // CNPJ completo: busca razão social, fantasia e endereço nos dados públicos da Receita
  async function mudarDoc(valor) {
    const doc = c.tipo === 'pj' ? mascaraCnpj(valor) : mascaraCpf(valor);
    setC((x) => ({ ...x, cpf_cnpj: doc })); setAviso('');
    if (c.tipo !== 'pj' || doc.replace(/\D/g, '').length < 14) return;
    if (!cnpjValido(doc)) return setAviso('CNPJ inválido. Confira os números.');
    setAviso('Buscando na Receita…');
    try {
      const r = await api(`/cnpj/${doc.replace(/\D/g, '')}`);
      setC((x) => ({ ...x, nome: x.nome || r.razao_social || '', nome_fantasia: x.nome_fantasia || r.nome_fantasia || '',
        telefone: x.telefone || (r.telefone ? mascaraTelefone(r.telefone) : ''), email: x.email || r.email || '',
        cep: x.cep || mascaraCep(r.cep), endereco: x.endereco || r.endereco || '', cidade: x.cidade || r.cidade || '', uf: x.uf || r.uf || '' }));
      setAviso(`Encontrado na Receita${r.situacao ? ` · situação: ${r.situacao}` : ''}`);
    } catch (falha) { setAviso(falha.message); }
  }

  async function salvar(e) {
    e.preventDefault();
    if (c.tipo === 'pf' && !cpfValido(c.cpf_cnpj)) return setErro('CPF inválido. Confira os números.');
    if (c.tipo === 'pj' && !cnpjValido(c.cpf_cnpj)) return setErro('CNPJ inválido. Confira os números.');
    setSalvando(true); setErro('');
    try {
      const r = await api(id ? `/clientes/${id}` : '/clientes', { metodo: id ? 'PUT' : 'POST', corpo: { ...c, loja_id: loja } });
      // grupo novo: já abre para adicionar as empresas
      if (!id && c.tipo === 'grupo') aoAbrir({ id: r.id }); else aoFechar();
    } catch (falha) { setErro(falha.message); setSalvando(false); }
  }

  const titulo = id ? c.nome : c.tipo === 'grupo' ? 'Novo grupo de empresas' : grupoInicial ? `Nova empresa do grupo ${grupoInicial.nome}` : 'Novo cliente';
  return (
    <Janela titulo={titulo} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <fieldset className="sem-borda" disabled={somenteLeitura}>
          {!grupoInicial && (
            <div className="opcoes">
              {Object.entries(TIPOS).map(([v, n]) => (
                <label key={v} className={c.tipo === v ? 'opcao marcada' : 'opcao'}>
                  <input type="radio" name="tipo-cliente" checked={c.tipo === v} onChange={() => setC({ ...c, tipo: v, cpf_cnpj: '' })} /><strong>{n}</strong>
                </label>
              ))}
            </div>
          )}
          {!id && lojas.length > 1 && (
            <label>Loja (grupo do sistema)
              <select value={loja} onChange={(e) => setLoja(e.target.value)}>{lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}</select>
            </label>
          )}
          {c.tipo !== 'grupo' && (
            <label>{c.tipo === 'pj' ? 'CNPJ' : 'CPF'}
              <input value={c.cpf_cnpj} inputMode="numeric" required onChange={(e) => mudarDoc(e.target.value)} placeholder={c.tipo === 'pj' ? '12.345.678/0001-90' : '123.456.789-10'} />
            </label>
          )}
          {aviso && <small className="aviso-receita">{aviso}</small>}
          <label>{c.tipo === 'pj' ? 'Razão social' : c.tipo === 'grupo' ? 'Nome do grupo' : 'Nome completo'}<input value={c.nome} onChange={muda('nome')} required /></label>
          {c.tipo === 'pj' && <label>Nome fantasia<input value={c.nome_fantasia} onChange={muda('nome_fantasia')} placeholder="Opcional" /></label>}
          {c.tipo === 'pj' && !grupoInicial && (
            <label>Grupo de empresas
              <select value={c.grupo_cliente_id} onChange={muda('grupo_cliente_id')}>
                <option value="">Nenhum (empresa sozinha)</option>
                {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
              </select>
            </label>
          )}
          <div className="linha-campos dois">
            <label>WhatsApp<input value={c.whatsapp} inputMode="tel" onChange={(e) => setC({ ...c, whatsapp: mascaraTelefone(e.target.value) })} /></label>
            <label>Telefone<input value={c.telefone} inputMode="tel" onChange={(e) => setC({ ...c, telefone: mascaraTelefone(e.target.value) })} /></label>
          </div>
          <label>E-mail<input type="email" value={c.email} onChange={muda('email')} placeholder="Opcional" /></label>
          {c.tipo !== 'grupo' && (
            <>
              <div className="linha-campos cep">
                <label>CEP<input value={c.cep} inputMode="numeric" onChange={(e) => setC({ ...c, cep: mascaraCep(e.target.value) })} /></label>
                <label>Endereço<input value={c.endereco} onChange={muda('endereco')} /></label>
              </div>
              <div className="linha-campos">
                <label>Cidade<input value={c.cidade} onChange={muda('cidade')} /></label>
                <label className="campo-uf">UF<input value={c.uf} maxLength={2} onChange={(e) => setC({ ...c, uf: e.target.value.replace(/[^A-Za-z]/g, '') })} /></label>
              </div>
            </>
          )}
          <label>Observações<textarea rows={2} value={c.observacoes} onChange={muda('observacoes')} /></label>
          {id && <label className="linha-check"><input type="checkbox" checked={c.ativo} onChange={(e) => setC({ ...c, ativo: e.target.checked })} /> Cliente ativo</label>}
        </fieldset>

        {id && c.tipo === 'grupo' && extra && (
          <section className="empresas-grupo">
            <div className="titulo-secao">
              <strong>Empresas do grupo ({extra.empresas.length})</strong>
              {!somenteLeitura && <button type="button" className="botao-texto" onClick={() => aoAbrir({ novo: 'pj', grupo: { id, nome: c.nome } })}>+ Adicionar empresa</button>}
            </div>
            {extra.empresas.length === 0 ? <p className="cinza">Nenhuma empresa ainda. Adicione os CNPJs deste grupo.</p> : (
              <ul className="lista-arquivos">
                {extra.empresas.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="botao-link" onClick={() => aoAbrir({ id: e.id })}>{e.nome}</button>
                    <small className="cinza">{formatarDoc(e.cpf_cnpj)}{e.cidade && ` · ${e.cidade}/${e.uf || ''}`}{!e.ativo && ' · inativa'}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {id && extra?.vendas?.qtd > 0 && (
          <p className="cinza ajuda">{extra.vendas.qtd} venda(s){c.tipo === 'grupo' ? ' das empresas do grupo' : ''}, total R$ {moeda(extra.vendas.total)}, última em {dataBR(extra.vendas.ultima)}.</p>
        )}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>{somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
          {!somenteLeitura && <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
        </div>
      </form>
    </Janela>
  );
}

function Janela({ titulo, aoFechar, children }) {
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal largo" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}
