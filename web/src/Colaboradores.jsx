import { useEffect, useState } from 'react';
import { api, sessao } from './api.js';
import { criarTem } from './modulos.js';
import { cpfValido, mascaraCpf, mascaraTelefone } from './documentos.js';

// Cadastro de colaboradores (funcionários das lojas), com arquivos anexados
// por tipo (RG, CNH, Contrato… e outros que o grupo criar).

const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const tamanhoArquivo = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// Busca um arquivo protegido pelo login e abre numa aba nova
export async function abrirArquivo(caminho) {
  const janela = window.open('', '_blank');
  const r = await fetch(`/api${caminho}`, { headers: { Authorization: `Bearer ${sessao.token()}` } });
  if (!r.ok) { janela?.close(); throw new Error((await r.json().catch(() => ({}))).erro || 'Não foi possível abrir o arquivo.'); }
  const url = URL.createObjectURL(await r.blob());
  if (janela) janela.location.href = url; else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function Colaboradores({ perfil, loja }) {
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [aberto, setAberto] = useState(undefined); // undefined = fechado; null = novo; id
  const [erro, setErro] = useState('');

  const lojasEditar = perfil.lojas.filter((l) => criarTem(perfil, l.id)('colaboradores.editar'));

  const carregar = () => {
    const q = new URLSearchParams({ ...(loja && { loja }), ...(busca.trim() && { busca: busca.trim() }), ...(inativos && { inativos: '1' }) });
    api(`/colaboradores?${q}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message));
  };
  useEffect(() => { const t = setTimeout(carregar, busca ? 300 : 0); return () => clearTimeout(t); }, [loja, busca, inativos]);

  return (
    <>
      <div className="cabecalho">
        <h1>Colaboradores</h1>
        {lojasEditar.length > 0 && <button className="botao-primario" onClick={() => setAberto(null)}>+ Novo colaborador</button>}
      </div>
      <div className="filtros">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CPF" aria-label="Buscar colaborador" />
        <label className="linha-check filtro-check"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? (
        <p className="cinza vazio">Nenhum colaborador encontrado.</p>
      ) : (
        <div className="lista-cadastro">
          {lista.map((c) => (
            <button key={c.id} className="cartao item-cadastro" onClick={() => setAberto(c.id)}>
              <span className="item-titulo">
                <strong>{c.nome}</strong>
                {c.cargo && <span className="etiqueta">{c.cargo}</span>}
                {!c.ativo && <span className="etiqueta inativa">Inativo</span>}
              </span>
              <small className="cinza">
                {[c.cpf && mascaraCpf(c.cpf), c.data_nascimento && `Nasc. ${dataBR(c.data_nascimento)}`, c.celular && mascaraTelefone(c.celular)].filter(Boolean).join(' · ')}
              </small>
              <small>{c.loja} · {c.arquivos} arquivo(s)</small>
            </button>
          ))}
        </div>
      )}
      {aberto !== undefined && (
        <EditorColaborador id={aberto} perfil={perfil} lojaPadrao={loja} lojasEditar={lojasEditar}
          aoFechar={() => { setAberto(undefined); carregar(); }} aoSalvar={(id) => { setAberto(id); carregar(); }} />
      )}
    </>
  );
}

function EditorColaborador({ id, perfil, lojaPadrao, lojasEditar, aoFechar, aoSalvar }) {
  const [c, setC] = useState(null);
  const [f, setF] = useState({ nome: '', data_nascimento: '', cpf: '', celular: '', cargo: '', cargo_id: '',
    loja_ids: [lojasEditar.some((l) => l.id === lojaPadrao) ? lojaPadrao : lojasEditar[0]?.id].filter(Boolean), ativo: true });
  const [cargos, setCargos] = useState([]);
  useEffect(() => { api('/cargos').then((l) => setCargos(l.filter((x) => x.ativo))).catch(() => {}); }, []);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try {
      const d = await api(`/colaboradores/${id}`);
      setC(d);
      setF({ nome: d.nome, data_nascimento: d.data_nascimento || '', cpf: d.cpf ? mascaraCpf(d.cpf) : '',
        celular: d.celular ? mascaraTelefone(d.celular) : '', cargo: d.cargo || '', cargo_id: d.cargo_id || '',
        loja_ids: d.loja_ids?.length ? d.loja_ids : [d.loja_id], ativo: d.ativo });
    } catch (falha) {
      setErro(falha.message);
    }
  }
  useEffect(() => { if (id) carregar(); }, [id]);

  const podeEditar = id ? c?.pode_editar : lojasEditar.length > 0;
  const muda = (campo, mascara) => (e) => setF({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : mascara ? mascara(e.target.value) : e.target.value });

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (f.cpf && !cpfValido(f.cpf)) return setErro('CPF inválido. Confira os números.');
    if (!f.loja_ids.length) return setErro('Marque pelo menos uma unidade.');
    setSalvando(true);
    try {
      const r = await (id ? api(`/colaboradores/${id}`, { metodo: 'PUT', corpo: f }) : api('/colaboradores', { metodo: 'POST', corpo: f }));
      aoSalvar(r.id);
      if (id) await carregar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setSalvando(false);
    }
  }

  // Unidades que aparecem: as que pode editar, mais as que o colaborador já tem (se forem só consulta)
  const lojasCampo = [...lojasEditar, ...f.loja_ids.filter((id) => !lojasEditar.some((l) => l.id === id))
    .map((id) => perfil.lojas.find((l) => l.id === id) || { id, nome: 'OUTRA UNIDADE' })];
  // as unidades precisam ser do mesmo grupo: mostra só as do grupo da primeira marcada
  const grupoDe = (id) => perfil.lojas.find((l) => l.id === id)?.empresa_id;
  const grupoAtual = grupoDe(f.loja_ids[0]);
  const lojasDoGrupo = grupoAtual ? lojasCampo.filter((l) => !l.empresa_id || l.empresa_id === grupoAtual || !grupoDe(l.id)) : lojasCampo;
  const editaveis = lojasDoGrupo.filter((l) => lojasEditar.some((x) => x.id === l.id));
  const todas = editaveis.length > 0 && editaveis.every((l) => f.loja_ids.includes(l.id));
  const marcar = (id, sim) => setF({ ...f, loja_ids: sim ? [...f.loja_ids, id] : f.loja_ids.filter((x) => x !== id) });
  const cargosDoGrupo = cargos.filter((x) => !grupoAtual || x.empresa_id === grupoAtual);

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal largo" role="dialog" aria-modal="true" aria-label="Colaborador">
        <div className="modal-topo">
          <h2>{id ? (c?.nome || 'Colaborador') : 'Novo colaborador'}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {id && !c && !erro ? <p className="cinza">Carregando…</p> : (
          <>
            <form className="formulario" onSubmit={salvar}>
              <fieldset className="sem-borda" disabled={!podeEditar}>
                <label>Nome completo<input value={f.nome} onChange={muda('nome')} required autoComplete="off" /></label>
                <div className="dados-veiculo">
                  <label>Data de nascimento<input type="date" value={f.data_nascimento} onChange={muda('data_nascimento')} /></label>
                  <label>CPF<input value={f.cpf} inputMode="numeric" placeholder="123.456.789-10" onChange={muda('cpf', mascaraCpf)} /></label>
                  <label>Celular<input value={f.celular} inputMode="tel" placeholder="(11) 99999-9999" onChange={muda('celular', mascaraTelefone)} /></label>
                  {cargosDoGrupo.length > 0 ? (
                    <label>Cargo
                      <select value={f.cargo_id} onChange={(e) => setF({ ...f, cargo_id: e.target.value })}>
                        <option value="">{f.cargo && !f.cargo_id ? f.cargo : 'Sem cargo'}</option>
                        {cargosDoGrupo.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label>Cargo / função<input value={f.cargo} onChange={muda('cargo')} placeholder="Cadastre cargos em Usuários e permissões" /></label>
                  )}
                </div>
                <fieldset className="grupo-permissoes">
                  <legend>Unidades em que trabalha</legend>
                  {editaveis.length > 1 && (
                    <label className="linha-check"><input type="checkbox" checked={todas}
                      onChange={(e) => setF({ ...f, loja_ids: e.target.checked ? [...new Set([...f.loja_ids, ...editaveis.map((l) => l.id)])] : f.loja_ids.filter((id) => !editaveis.some((l) => l.id === id)) })} /> <strong>Todas as unidades</strong></label>
                  )}
                  {lojasDoGrupo.map((l) => (
                    <label key={l.id} className="linha-check">
                      <input type="checkbox" checked={f.loja_ids.includes(l.id)} disabled={!lojasEditar.some((x) => x.id === l.id)}
                        onChange={(e) => marcar(l.id, e.target.checked)} /> {l.nome}
                    </label>
                  ))}
                </fieldset>
                {id && <label className="linha-check"><input type="checkbox" checked={f.ativo} onChange={muda('ativo')} /> Colaborador ativo (aparece no ponto)</label>}
              </fieldset>
              {erro && <p className="erro" role="alert">{erro}</p>}
              {podeEditar && (
                <div className="acoes-modal">
                  <button type="button" className="botao-contorno" onClick={aoFechar}>Fechar</button>
                  <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : id ? 'Salvar' : 'Cadastrar'}</button>
                </div>
              )}
            </form>
            {id ? c && <Arquivos colaborador={c} podeEditar={podeEditar} aoMudar={carregar} />
              : <p className="cinza ajuda">Depois de cadastrar, você pode anexar os arquivos do colaborador.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function Arquivos({ colaborador, podeEditar, aoMudar }) {
  const [tipos, setTipos] = useState([]);
  const [tipo, setTipo] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [gerenciando, setGerenciando] = useState(false);
  const [erro, setErro] = useState('');
  const [chaveInput, setChaveInput] = useState(0);

  const carregarTipos = () => api(`/tipos-arquivo?loja=${colaborador.loja_id}`).then(setTipos).catch((f) => setErro(f.message));
  useEffect(() => { carregarTipos(); }, [colaborador.loja_id]);

  async function enviar(e) {
    e.preventDefault();
    if (!arquivo) return setErro('Escolha o arquivo.');
    if (arquivo.size > 15 * 1024 * 1024) return setErro('O arquivo passa de 15 MB.');
    setEnviando(true); setErro('');
    try {
      const q = new URLSearchParams({ nome: arquivo.name, mime: arquivo.type || 'application/octet-stream', ...(tipo && { tipo }), ...(obs.trim() && { obs: obs.trim() }) });
      const r = await fetch(`/api/colaboradores/${colaborador.id}/arquivos?${q}`, {
        method: 'POST', body: arquivo,
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${sessao.token()}` },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || (r.status === 413 ? 'O arquivo passa de 15 MB.' : 'Não foi possível enviar o arquivo.'));
      setArquivo(null); setObs(''); setChaveInput((k) => k + 1);
      aoMudar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(a) {
    if (!confirm(`Excluir o arquivo "${a.nome_arquivo}"?`)) return;
    try {
      await api(`/colaboradores/${colaborador.id}/arquivos/${a.id}`, { metodo: 'DELETE' });
      aoMudar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  return (
    <fieldset className="grupo-permissoes arquivos-colaborador">
      <legend>Arquivos</legend>
      {colaborador.arquivos.length === 0 ? <small className="cinza">Nenhum arquivo anexado.</small> : (
        <ul className="lista-arquivos">
          {colaborador.arquivos.map((a) => (
            <li key={a.id}>
              <span className="etiqueta">{a.tipo || 'Sem tipo'}</span>
              <button type="button" className="botao-texto" onClick={() => abrirArquivo(`/colaboradores/${colaborador.id}/arquivos/${a.id}`).catch((f) => setErro(f.message))}>
                {a.nome_arquivo}
              </button>
              <small className="cinza">{tamanhoArquivo(a.tamanho)} · {dataBR(a.enviado_em)}{a.enviado_por && ` · ${a.enviado_por}`}{a.observacao && ` · ${a.observacao}`}</small>
              {podeEditar && <button type="button" className="fechar" aria-label={`Excluir ${a.nome_arquivo}`} onClick={() => excluir(a)}>×</button>}
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <form className="envio-arquivo" onSubmit={enviar}>
          <select value={tipo} onChange={(e) => (e.target.value === '__gerenciar' ? setGerenciando(true) : setTipo(e.target.value))} aria-label="Tipo do arquivo">
            <option value="">Tipo do arquivo…</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            <option value="__gerenciar">+ Criar ou renomear tipos…</option>
          </select>
          <input key={chaveInput} type="file" onChange={(e) => setArquivo(e.target.files[0] || null)} aria-label="Arquivo" />
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" aria-label="Observação" />
          <button className="botao-primario" disabled={enviando || !arquivo}>{enviando ? 'Enviando…' : 'Anexar'}</button>
        </form>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {gerenciando && <TiposArquivo loja={colaborador.loja_id} tipos={tipos} aoMudar={carregarTipos} aoFechar={() => setGerenciando(false)} />}
    </fieldset>
  );
}

// Tipos de arquivo do grupo: o usuário dá o nome que quiser
function TiposArquivo({ loja, tipos, aoMudar, aoFechar }) {
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState(null); // { id, nome }
  const [erro, setErro] = useState('');

  const acao = async (fn) => {
    setErro('');
    try { await fn(); await aoMudar(); } catch (falha) { setErro(falha.message); }
  };
  const criar = (e) => { e.preventDefault(); acao(async () => { await api('/tipos-arquivo', { metodo: 'POST', corpo: { loja_id: loja, nome: novo } }); setNovo(''); }); };
  const renomear = (e) => { e.preventDefault(); acao(async () => { await api(`/tipos-arquivo/${editando.id}`, { metodo: 'PUT', corpo: { loja_id: loja, nome: editando.nome } }); setEditando(null); }); };
  const excluir = (t) => confirm(`Excluir o tipo "${t.nome}"?${t.usos ? ` Os ${t.usos} arquivo(s) dele ficam "Sem tipo".` : ''}`)
    && acao(() => api(`/tipos-arquivo/${t.id}?loja=${loja}`, { metodo: 'DELETE' }));

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Tipos de arquivo">
        <div className="modal-topo">
          <h2>Tipos de arquivo</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <ul className="lista-tipos">
          {tipos.map((t) => (
            <li key={t.id}>
              {editando?.id === t.id ? (
                <form onSubmit={renomear} className="linha-tipo">
                  <input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} autoFocus aria-label="Novo nome" />
                  <button className="botao-primario pequeno">Salvar</button>
                  <button type="button" className="botao-contorno pequeno" onClick={() => setEditando(null)}>Cancelar</button>
                </form>
              ) : (
                <span className="linha-tipo">
                  <strong>{t.nome}</strong><small className="cinza">{t.usos} arquivo(s)</small>
                  <button type="button" className="botao-contorno pequeno" onClick={() => setEditando({ id: t.id, nome: t.nome })}>Renomear</button>
                  <button type="button" className="botao-contorno pequeno perigo" onClick={() => excluir(t)}>Excluir</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <form className="linha-tipo" onSubmit={criar}>
          <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Nome do novo tipo (ex.: Título de eleitor)" aria-label="Novo tipo" />
          <button className="botao-primario" disabled={!novo.trim()}>Criar tipo</button>
        </form>
        {erro && <p className="erro" role="alert">{erro}</p>}
      </section>
    </div>
  );
}
