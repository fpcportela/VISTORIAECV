import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { criarTem } from './modulos.js';
import { mascaraTelefone } from './documentos.js';
import { EditorCliente } from './Clientes.jsx';

// Módulo WhatsApp: chamados em kanban (colunas do grupo) e as conversas.
// Um chamado é aberto sozinho quando um contato manda mensagem e não tem chamado aberto.

const ATUALIZAR_MS = 8000;

// 5511987654321 -> (11) 98765-4321
const nacional = (tel) => {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
};
const telefoneBR = (tel) => mascaraTelefone(nacional(tel));
const quando = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const STATUS = { simulada: 'modo teste', enviada: 'enviada', entregue: 'entregue', lida: 'lida', falhou: 'não enviada' };

export default function WhatsApp({ perfil, loja, aoVenda }) {
  const [aba, setAba] = useState('chamados');
  const [situacao, setSituacao] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);      // contato da conversa aberta (no quadro)
  const [janela, setJanela] = useState(null);      // 'chamado' | 'simular' | 'configurar'
  const [recarga, setRecarga] = useState(0);
  const recarregar = () => setRecarga((n) => n + 1);

  useEffect(() => { api('/whatsapp/situacao').then((s) => { setSituacao(s); setErro(''); }).catch((f) => setErro(f.message)); }, [recarga]);

  if (erro) return (<><div className="cabecalho"><h1>WhatsApp</h1></div><p className="erro" role="alert">{erro}</p></>);
  if (!situacao) return <p className="cinza">Carregando…</p>;

  return (
    <>
      <div className="cabecalho">
        <h1>WhatsApp</h1>
        <div className="acoes-cabecalho">
          {situacao.provedor === 'teste' && situacao.pode_enviar && <button className="botao-contorno" onClick={() => setJanela('simular')}>Simular mensagem recebida</button>}
          {situacao.master && <button className="botao-contorno" onClick={() => setJanela('configurar')}>Configurar</button>}
          {situacao.pode_enviar && <button className="botao-primario" onClick={() => setJanela('chamado')}>+ Chamado</button>}
        </div>
      </div>
      {situacao.provedor === 'teste' ? (
        <p className="aviso-zap"><strong>Modo teste:</strong> as mensagens ficam só no sistema e não saem pelo WhatsApp. Para ligar de verdade, coloque as chaves da API oficial no servidor (veja o LEIA-ME, parte WhatsApp).</p>
      ) : !situacao.numero ? (
        <p className="aviso-zap"><strong>Falta o número:</strong> {situacao.provedor === 'evolution'
          ? (situacao.master ? 'clique em Configurar e leia o QR code com o celular do WhatsApp deste grupo.' : 'peça ao master para ligar o celular do WhatsApp deste grupo.')
          : (situacao.master ? 'clique em Configurar e informe o ID do número do WhatsApp deste grupo.' : 'peça ao master para cadastrar o número do WhatsApp deste grupo.')}</p>
      ) : null}
      <div className="abas" role="tablist">
        <button role="tab" aria-selected={aba === 'chamados'} className={aba === 'chamados' ? 'ativa' : ''} onClick={() => setAba('chamados')}>Chamados</button>
        <button role="tab" aria-selected={aba === 'conversas'} className={aba === 'conversas' ? 'ativa' : ''} onClick={() => setAba('conversas')}>Conversas</button>
        <button role="tab" aria-selected={aba === 'robo'} className={aba === 'robo' ? 'ativa' : ''} onClick={() => setAba('robo')}>Robô de atendimento</button>
      </div>
      {aba === 'chamados' ? <Quadro recarga={recarga} aoAbrir={setAberto} />
        : aba === 'conversas' ? <Conversas recarga={recarga} perfil={perfil} loja={loja} aoMudar={recarregar} aoVenda={aoVenda} />
        : <Robo />}
      {aberto && (
        <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && setAberto(null)}>
          <section className="modal largo modal-conversa" role="dialog" aria-modal="true" aria-label="Conversa">
            <Conversa contatoId={aberto} perfil={perfil} loja={loja} aoFechar={() => { setAberto(null); recarregar(); }} aoMudar={recarregar} aoVenda={aoVenda} />
          </section>
        </div>
      )}
      {janela === 'chamado' && <NovoChamado aoFechar={() => setJanela(null)} aoCriar={() => { setJanela(null); setAba('chamados'); recarregar(); }} />}
      {janela === 'simular' && <Simular aoFechar={() => setJanela(null)} aoEnviar={() => { setJanela(null); recarregar(); }} />}
      {janela === 'configurar' && <Configurar situacao={situacao} aoFechar={() => setJanela(null)} aoSalvar={() => { setJanela(null); recarregar(); }} />}
    </>
  );
}

// ------------------------------------------------------------ kanban
function Quadro({ recarga, aoAbrir }) {
  const [q, setQ] = useState(null);
  const [erro, setErro] = useState('');
  const [arrastando, setArrastando] = useState(null);
  const [sobre, setSobre] = useState(null);
  const [editandoColuna, setEditandoColuna] = useState(null);

  const carregar = () => api('/whatsapp/quadro').then((d) => { setQ(d); setErro(''); }).catch((f) => setErro(f.message));
  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (!document.hidden) carregar(); }, ATUALIZAR_MS);
    return () => clearInterval(t);
  }, [recarga]);

  if (erro && !q) return <p className="erro" role="alert">{erro}</p>;
  if (!q) return <p className="cinza">Carregando…</p>;

  async function mover(chamado, coluna, antesDe) {
    const daColuna = q.chamados.filter((c) => c.coluna_id === coluna && c.id !== chamado.id);
    let ordem;
    if (antesDe) {
      const i = daColuna.findIndex((c) => c.id === antesDe);
      const anterior = daColuna[i - 1];
      ordem = anterior ? (anterior.ordem + daColuna[i].ordem) / 2 : daColuna[i].ordem - 1;
    } else {
      ordem = daColuna.length ? daColuna[daColuna.length - 1].ordem + 1 : 1;
    }
    // já mostra no lugar novo; o servidor confirma em seguida
    setQ({ ...q, chamados: q.chamados.map((c) => (c.id === chamado.id ? { ...c, coluna_id: coluna, ordem } : c)).sort((a, b) => a.ordem - b.ordem) });
    try { await api(`/whatsapp/chamados/${chamado.id}`, { metodo: 'PUT', corpo: { coluna_id: coluna, ordem } }); } catch (f) { setErro(f.message); }
    carregar();
  }

  async function acaoColuna(col, acao) {
    setErro('');
    try {
      if (acao === 'excluir') {
        if (!window.confirm(`Excluir a coluna ${col.nome}?`)) return;
        await api(`/whatsapp/colunas/${col.id}`, { metodo: 'DELETE' });
      } else {
        await api(`/whatsapp/colunas/${col.id}`, { metodo: 'PUT', corpo: { mover: acao } });
      }
      carregar();
    } catch (f) { setErro(f.message); }
  }

  return (
    <>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="kanban" role="list" aria-label="Chamados">
        {q.colunas.map((col, i) => {
          const cartoes = q.chamados.filter((c) => c.coluna_id === col.id);
          return (
            <section key={col.id} className={`kanban-coluna${sobre === col.id ? ' sobre' : ''}${col.finaliza ? ' finaliza' : ''}`} role="listitem" aria-label={col.nome}
              onDragOver={(e) => { if (arrastando) { e.preventDefault(); setSobre(col.id); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSobre(null); }}
              onDrop={(e) => { e.preventDefault(); setSobre(null); if (arrastando) mover(arrastando, col.id, null); setArrastando(null); }}>
              <header className="kanban-topo">
                <strong>{col.nome}</strong>
                <span className="kanban-qtd">{cartoes.length}</span>
                {q.pode_enviar && (
                  <span className="kanban-acoes">
                    {i > 0 && <button type="button" onClick={() => acaoColuna(col, -1)} aria-label={`Mover ${col.nome} para a esquerda`} title="Mover para a esquerda">‹</button>}
                    {i < q.colunas.length - 1 && <button type="button" onClick={() => acaoColuna(col, 1)} aria-label={`Mover ${col.nome} para a direita`} title="Mover para a direita">›</button>}
                    <button type="button" onClick={() => setEditandoColuna(col)} aria-label={`Renomear ${col.nome}`} title="Renomear">✎</button>
                    {!col.finaliza && <button type="button" onClick={() => acaoColuna(col, 'excluir')} aria-label={`Excluir ${col.nome}`} title="Excluir">×</button>}
                  </span>
                )}
              </header>
              {col.finaliza && <small className="cinza kanban-dica">Chamado que entra aqui fica concluído (aparece por 30 dias).</small>}
              <div className="kanban-cartoes">
                {cartoes.map((c) => (
                  <article key={c.id} className={`kanban-cartao${arrastando?.id === c.id ? ' arrastando' : ''}`} draggable={q.pode_enviar}
                    onDragStart={(e) => { setArrastando(c); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }}
                    onDragEnd={() => { setArrastando(null); setSobre(null); }}
                    onDragOver={(e) => { if (arrastando && arrastando.id !== c.id) { e.preventDefault(); e.stopPropagation(); setSobre(col.id); } }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setSobre(null); if (arrastando && arrastando.id !== c.id) mover(arrastando, col.id, c.id); setArrastando(null); }}>
                    <button type="button" className="kanban-abrir" onClick={() => aoAbrir(c.contato_id)}>
                      <span className="kanban-nome">
                        <strong>{c.cliente || (c.contato === c.telefone ? telefoneBR(c.telefone) : c.contato)}</strong>
                        {c.nao_lidas > 0 && <span className="selo-nao-lidas" aria-label={`${c.nao_lidas} não lida(s)`}>{c.nao_lidas}</span>}
                      </span>
                      {c.titulo && <span className="kanban-titulo">{c.titulo}</span>}
                      {c.robo_estado === 'coletando' && !c.venda_id && <span className="selo-robo">🤖 Robô atendendo</span>}
                      {c.venda_numero && <span className="selo-robo venda">Venda nº {c.venda_numero} aberta pelo robô</span>}
                      <small className="cinza">{telefoneBR(c.telefone)}{c.cliente ? ' · cliente' : ''}</small>
                      {c.ultima && <span className="kanban-ultima">{c.ultima}</span>}
                      <small className="cinza kanban-rodape">
                        <span>{c.responsavel ? `👤 ${c.responsavel}` : 'Sem responsável'}</span>
                        <span>{quando(c.atualizado_em)}</span>
                      </small>
                    </button>
                    {q.pode_enviar && (
                      <select className="kanban-mover so-celular-ou-teclado" value={c.coluna_id} aria-label={`Mover chamado de ${c.contato}`}
                        onChange={(e) => mover(c, e.target.value, null)}>
                        {q.colunas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                    )}
                  </article>
                ))}
                {cartoes.length === 0 && <p className="cinza kanban-vazio">Nenhum chamado</p>}
              </div>
            </section>
          );
        })}
        {q.pode_enviar && <NovaColuna aoCriar={carregar} />}
      </div>
      {editandoColuna && <RenomearColuna coluna={editandoColuna} aoFechar={() => setEditandoColuna(null)} aoSalvar={() => { setEditandoColuna(null); carregar(); }} />}
    </>
  );
}

function NovaColuna({ aoCriar }) {
  const [aberta, setAberta] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  if (!aberta) return <button type="button" className="kanban-nova" onClick={() => setAberta(true)}>+ Coluna</button>;
  return (
    <form className="kanban-coluna kanban-form" onSubmit={async (e) => {
      e.preventDefault(); setErro('');
      try { await api('/whatsapp/colunas', { metodo: 'POST', corpo: { nome } }); setNome(''); setAberta(false); aoCriar(); } catch (f) { setErro(f.message); }
    }}>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da coluna" autoFocus required maxLength={40} aria-label="Nome da coluna" />
      {erro && <small className="erro">{erro}</small>}
      <div className="acoes-modal">
        <button type="button" className="botao-contorno pequeno" onClick={() => setAberta(false)}>Cancelar</button>
        <button className="botao-primario pequeno">Criar</button>
      </div>
    </form>
  );
}

function RenomearColuna({ coluna, aoFechar, aoSalvar }) {
  const [nome, setNome] = useState(coluna.nome);
  const [erro, setErro] = useState('');
  return (
    <Janela titulo="Renomear coluna" aoFechar={aoFechar}>
      <form className="formulario" onSubmit={async (e) => {
        e.preventDefault(); setErro('');
        try { await api(`/whatsapp/colunas/${coluna.id}`, { metodo: 'PUT', corpo: { nome } }); aoSalvar(); } catch (f) { setErro(f.message); }
      }}>
        <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={40} autoFocus /></label>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario">Salvar</button>
        </div>
      </form>
    </Janela>
  );
}

// ------------------------------------------------------------ conversas
function Conversas({ recarga, perfil, loja, aoMudar, aoVenda }) {
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    const carregar = () => api(`/whatsapp/contatos${busca ? `?busca=${encodeURIComponent(busca)}` : ''}`)
      .then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message));
    const t0 = setTimeout(carregar, busca ? 300 : 0);
    const t = setInterval(() => { if (!document.hidden) carregar(); }, ATUALIZAR_MS);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [busca, recarga]);

  return (
    <div className={`conversas${aberto ? ' com-aberta' : ''}`}>
      <aside className="conversas-lista">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou telefone" aria-label="Buscar conversa" />
        {erro && <p className="erro">{erro}</p>}
        {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? <p className="cinza">Nenhuma conversa ainda.</p> : (
          <ul>
            {lista.map((k) => (
              <li key={k.id}>
                <button type="button" className={aberto === k.id ? 'ativa' : ''} onClick={() => setAberto(k.id)}>
                  <span className="kanban-nome"><strong>{k.cliente || (k.nome === k.telefone ? telefoneBR(k.telefone) : k.nome)}</strong>{k.nao_lidas > 0 && <span className="selo-nao-lidas">{k.nao_lidas}</span>}</span>
                  <small className="cinza">{telefoneBR(k.telefone)} · {quando(k.ultima_em)}</small>
                  {k.ultima && <span className="kanban-ultima">{k.ultima}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="conversas-painel">
        {aberto ? <Conversa key={aberto} contatoId={aberto} perfil={perfil} loja={loja} aoFechar={() => setAberto(null)} aoMudar={aoMudar} aoVenda={aoVenda} />
          : <p className="cinza conversas-vazio">Escolha uma conversa.</p>}
      </section>
    </div>
  );
}

function Conversa({ contatoId, perfil, loja, aoFechar, aoMudar, aoVenda }) {
  const [k, setK] = useState(null);
  const [colunas, setColunas] = useState([]);
  const [responsaveis, setResponsaveis] = useState([]);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cadastrar, setCadastrar] = useState(false);
  const [ligar, setLigar] = useState(false);
  const fim = useRef(null);

  const carregar = (ler) => api(`/whatsapp/contatos/${contatoId}${ler ? '?ler=1' : ''}`).then((d) => { setK(d); }).catch((f) => setErro(f.message));
  useEffect(() => {
    carregar(true);
    api('/whatsapp/quadro').then((q) => { setColunas(q.colunas); setResponsaveis(q.responsaveis); }).catch(() => {});
    const t = setInterval(() => { if (!document.hidden) carregar(true); }, ATUALIZAR_MS);
    return () => clearInterval(t);
  }, [contatoId]);
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [k?.mensagens?.length]);

  if (!k) return erro ? <p className="erro">{erro}</p> : <p className="cinza">Carregando…</p>;

  async function enviar(e) {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true); setErro('');
    try { await api(`/whatsapp/contatos/${k.id}/mensagens`, { metodo: 'POST', corpo: { texto } }); setTexto(''); }
    catch (f) { setErro(f.message); }
    finally { setEnviando(false); carregar(true); aoMudar?.(); }
  }

  async function mudarChamado(campos) {
    setErro('');
    try { await api(`/whatsapp/chamados/${k.chamado.id}`, { metodo: 'PUT', corpo: campos }); carregar(); aoMudar?.(); } catch (f) { setErro(f.message); }
  }

  async function robo(acao) {
    setErro('');
    try { await api(`/whatsapp/chamados/${k.chamado.id}/robo`, { metodo: 'POST', corpo: { acao } }); carregar(); aoMudar?.(); } catch (f) { setErro(f.message); }
  }

  async function ligarCliente(clienteId) {
    setErro('');
    try { await api(`/whatsapp/contatos/${k.id}`, { metodo: 'PUT', corpo: { cliente_id: clienteId } }); setLigar(false); setCadastrar(false); carregar(); aoMudar?.(); }
    catch (f) { setErro(f.message); }
  }

  const lojasCliente = perfil.lojas.filter((l) => l.empresa_id === k.empresa_id && criarTem(perfil, l.id)('clientes.editar'));

  return (
    <div className="conversa">
      <header className="conversa-topo">
        <div>
          <h2>{k.cliente || k.nome || telefoneBR(k.telefone)}</h2>
          <small className="cinza">{telefoneBR(k.telefone)}{k.cliente && k.nome && k.nome !== k.cliente ? ` · no WhatsApp: ${k.nome}` : ''}</small>
        </div>
        <div className="conversa-cliente">
          {k.cliente_id ? (
            <>
              <span className="selo-cliente">Cliente cadastrado</span>
              {k.pode_enviar && <button type="button" className="botao-texto" onClick={() => ligarCliente(null)}>Desligar</button>}
            </>
          ) : k.pode_enviar && (
            <>
              {lojasCliente.length > 0 && <button type="button" className="botao-contorno pequeno" onClick={() => setCadastrar(true)}>Salvar contato como cliente</button>}
              <button type="button" className="botao-texto" onClick={() => setLigar(!ligar)}>Ligar a cliente já cadastrado</button>
            </>
          )}
        </div>
        <button className="fechar" onClick={aoFechar} aria-label="Fechar conversa">×</button>
      </header>
      {ligar && <BuscarCliente empresa={k.empresa_id} aoEscolher={ligarCliente} />}
      {k.chamado && (
        <div className="conversa-chamado">
          <label>Etapa
            <select value={k.chamado.coluna_id} disabled={!k.pode_enviar} onChange={(e) => mudarChamado({ coluna_id: e.target.value })}>
              {colunas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Responsável
            <select value={k.chamado.responsavel_id || ''} disabled={!k.pode_enviar} onChange={(e) => mudarChamado({ responsavel_id: e.target.value || null })}>
              <option value="">Ninguém</option>
              {responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          </label>
          <label className="conversa-assunto">Assunto
            <input defaultValue={k.chamado.titulo || ''} key={k.chamado.id + (k.chamado.titulo || '')} disabled={!k.pode_enviar} placeholder="Ex.: ORÇAMENTO CAUTELAR"
              onBlur={(e) => e.target.value !== (k.chamado.titulo || '') && mudarChamado({ titulo: e.target.value })} />
          </label>
        </div>
      )}
      {k.chamado?.venda_id ? (
        <p className="aviso-robo">
          🤖 O robô abriu a <strong>venda nº {k.chamado.venda_numero}</strong>{k.chamado.venda_situacao === 'futuro' ? ' (FUTURO, falta confirmar)' : ''}.
          {aoVenda && <button type="button" className="botao-texto" onClick={() => { aoFechar(); aoVenda(k.chamado.venda_id); }}>Abrir a venda</button>}
        </p>
      ) : k.robo && k.chamado?.aberto && (
        <p className="aviso-robo">
          {k.chamado.robo_estado === 'coletando' ? <>🤖 O robô está atendendo esta conversa. Se você responder, ele para.</>
            : k.chamado.robo_estado === 'humano' ? <>👤 Atendimento com a equipe (robô parado).</>
            : <>🤖 O robô responde a próxima mensagem deste contato.</>}
          {k.pode_enviar && (k.chamado.robo_estado === 'humano'
            ? <button type="button" className="botao-texto" onClick={() => robo('devolver')}>Devolver ao robô</button>
            : <button type="button" className="botao-texto" onClick={() => robo('assumir')}>Assumir atendimento</button>)}
        </p>
      )}
      <div className="conversa-mensagens" aria-live="polite">
        {k.mensagens.length === 0 && <p className="cinza">Nenhuma mensagem ainda.</p>}
        {k.mensagens.map((m) => (
          <div key={m.id} className={`balao ${m.direcao}${m.status === 'falhou' ? ' falhou' : ''}`}>
            <p>{m.texto}</p>
            <small>
              {m.direcao === 'saida' && m.robo ? '🤖 Robô · ' : m.direcao === 'saida' && m.enviado_por ? `${m.enviado_por} · ` : ''}{quando(m.criado_em)}
              {m.direcao === 'saida' && ` · ${STATUS[m.status] || m.status}`}
            </small>
            {m.status === 'falhou' && m.erro && <small className="erro">{m.erro}</small>}
          </div>
        ))}
        <div ref={fim} />
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {k.pode_enviar && (
        <form className="conversa-envio" onSubmit={enviar}>
          <textarea rows={2} value={texto} data-livre onChange={(e) => setTexto(e.target.value)} placeholder="Escreva a mensagem…" aria-label="Mensagem"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(e); } }} />
          <button className="botao-primario" disabled={enviando || !texto.trim()}>{enviando ? 'Enviando…' : 'Enviar'}</button>
        </form>
      )}
      {cadastrar && (
        <EditorCliente lojas={lojasCliente} lojaInicial={lojasCliente.some((l) => l.id === loja) ? loja : lojasCliente[0]?.id}
          inicial={{ nome: k.nome || '', whatsapp: telefoneBR(k.telefone) }}
          aoAbrir={() => {}} aoFechar={() => setCadastrar(false)} aoSalvar={(id) => ligarCliente(id)} />
      )}
    </div>
  );
}

function BuscarCliente({ empresa, aoEscolher }) {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState([]);
  useEffect(() => {
    if (busca.trim().length < 2) { setLista([]); return undefined; }
    const t = setTimeout(() => api(`/clientes?venda=1&busca=${encodeURIComponent(busca)}`).then(setLista).catch(() => setLista([])), 300);
    return () => clearTimeout(t);
  }, [busca, empresa]);
  return (
    <div className="buscar-cliente-zap">
      <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, CPF ou CNPJ do cliente" autoFocus aria-label="Buscar cliente" />
      {lista.filter((c) => c.tipo !== 'avulso').slice(0, 8).map((c) => (
        <button key={c.id} type="button" className="botao-link" onClick={() => aoEscolher(c.id)}>{c.nome}{c.cpf_cnpj ? ` · ${c.cpf_cnpj}` : ''}</button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ janelas
function NovoChamado({ aoFechar, aoCriar }) {
  const [f, setF] = useState({ telefone: '', nome: '', titulo: '' });
  const [erro, setErro] = useState('');
  return (
    <Janela titulo="Novo chamado" aoFechar={aoFechar}>
      <form className="formulario" onSubmit={async (e) => {
        e.preventDefault(); setErro('');
        try { await api('/whatsapp/chamados', { metodo: 'POST', corpo: f }); aoCriar(); } catch (falha) { setErro(falha.message); }
      }}>
        <label>WhatsApp do cliente<input value={f.telefone} inputMode="tel" required placeholder="(11) 99999-9999" onChange={(e) => setF({ ...f, telefone: mascaraTelefone(e.target.value) })} /></label>
        <label>Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Opcional" /></label>
        <label>Assunto<input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: ORÇAMENTO CAUTELAR" /></label>
        <p className="cinza ajuda">Se o contato já tiver um chamado aberto, o sistema usa o mesmo.</p>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario">Criar chamado</button>
        </div>
      </form>
    </Janela>
  );
}

function Simular({ aoFechar, aoEnviar }) {
  const [f, setF] = useState({ telefone: '', nome: '', texto: '' });
  const [erro, setErro] = useState('');
  return (
    <Janela titulo="Simular mensagem recebida" aoFechar={aoFechar}>
      <form className="formulario" onSubmit={async (e) => {
        e.preventDefault(); setErro('');
        try { await api('/whatsapp/simular', { metodo: 'POST', corpo: f }); aoEnviar(); } catch (falha) { setErro(falha.message); }
      }}>
        <p className="cinza ajuda">Só no modo teste: finge que um cliente mandou esta mensagem, para você ver o chamado aparecer no quadro.</p>
        <label>Celular de quem mandou<input value={f.telefone} inputMode="tel" required placeholder="(11) 99999-9999" onChange={(e) => setF({ ...f, telefone: mascaraTelefone(e.target.value) })} /></label>
        <label>Nome no WhatsApp<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Opcional" /></label>
        <label>Mensagem<textarea rows={3} data-livre value={f.texto} required onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="Bom dia, quanto custa a cautelar?" /></label>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario">Simular</button>
        </div>
      </form>
    </Janela>
  );
}

// WhatsApp por QR code (Evolution): o master lê o QR code com o celular do grupo, como no WhatsApp Web
const ESTADOS_QR = { open: 'ligado', connecting: 'esperando a leitura do QR code', close: 'desligado', sem_instancia: 'desligado' };
function ConectarQr({ aoFechar, aoSalvar }) {
  const [e, setE] = useState(null);
  const [qr, setQr] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const ligou = useRef(false);

  const ver = () => api('/whatsapp/evolution/estado').then((r) => {
    setE(r); setErro('');
    if (r.estado === 'open') { setQr(null); ligou.current = true; }
  }).catch((f) => setErro(f.message));
  useEffect(() => { ver(); }, []);
  // enquanto o QR code está na tela, confere a cada 3 segundos e troca o código a cada 30 (ele vence)
  useEffect(() => {
    if (!qr) return undefined;
    const t = setInterval(ver, 3000);
    const n = setInterval(() => conectar(true), 30000);
    return () => { clearInterval(t); clearInterval(n); };
  }, [qr?.desde]);

  async function conectar(renovar) {
    if (!renovar) setOcupado(true);
    setErro('');
    try {
      const r = await api('/whatsapp/evolution/conectar', { metodo: 'POST' });
      if (r.estado === 'open') { setQr(null); await ver(); } else { setQr({ imagem: r.qr, codigo: r.codigo, desde: renovar ? qr?.desde : Date.now() }); setE((x) => ({ ...x, estado: 'connecting' })); }
    } catch (f) { setErro(f.message); } finally { setOcupado(false); }
  }
  async function desligar() {
    if (!confirm('Desligar o WhatsApp deste grupo? As mensagens param de chegar até ler o QR code de novo.')) return;
    setOcupado(true);
    try { await api('/whatsapp/evolution/desconectar', { metodo: 'POST' }); await ver(); } catch (f) { setErro(f.message); } finally { setOcupado(false); }
  }
  const fechar = () => (ligou.current ? aoSalvar() : aoFechar());

  return (
    <Janela titulo="Ligar o WhatsApp do grupo" aoFechar={fechar}>
      <div className="formulario conectar-qr">
        <p className="cinza ajuda">
          WhatsApp por QR code (não oficial). Use de preferência um número que não seja o principal da loja:
          o WhatsApp pode bloquear números que mandam muitas mensagens para quem não falou com eles antes.
        </p>
        {!e && !erro && <p className="cinza">Carregando…</p>}
        {e && <p>Situação: <strong>{ESTADOS_QR[e.estado] || e.estado}</strong>
          {e.estado === 'open' && e.numero && <> · número {mascaraTelefone(String(e.numero).replace(/^55/, ''))}{e.nome ? ` (${e.nome})` : ''}</>}</p>}
        {qr && (
          <div className="qr-caixa">
            {qr.imagem ? <img src={qr.imagem} alt="QR code para ligar o WhatsApp" width="260" height="260" /> : <p className="cinza">Gerando o QR code…</p>}
            <ol className="cinza ajuda">
              <li>No celular, abra o WhatsApp.</li>
              <li>Toque em <strong>Configurações</strong> (ou nos três pontinhos) e depois em <strong>Dispositivos conectados</strong>.</li>
              <li>Toque em <strong>Conectar dispositivo</strong> e aponte a câmera para este QR code.</li>
            </ol>
          </div>
        )}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          {e?.estado === 'open'
            ? <button type="button" className="botao-contorno" disabled={ocupado} onClick={desligar}>Desligar</button>
            : !qr && <button type="button" className="botao-primario" disabled={ocupado || !e} onClick={() => conectar(false)}>{ocupado ? 'Preparando…' : 'Mostrar QR code'}</button>}
          <button type="button" className="botao-contorno" onClick={fechar}>{e?.estado === 'open' ? 'Pronto' : 'Fechar'}</button>
        </div>
      </div>
    </Janela>
  );
}

function Configurar({ situacao, aoFechar, aoSalvar }) {
  if (situacao.provedor === 'evolution') return <ConectarQr aoFechar={aoFechar} aoSalvar={aoSalvar} />;
  return <ConfigurarMeta situacao={situacao} aoFechar={aoFechar} aoSalvar={aoSalvar} />;
}

function ConfigurarMeta({ situacao, aoFechar, aoSalvar }) {
  const n = situacao.numero;
  const [f, setF] = useState({ phone_number_id: n?.phone_number_id || '', numero: n?.numero ? mascaraTelefone(String(n.numero).replace(/^55/, '')) : '' });
  const [erro, setErro] = useState('');
  return (
    <Janela titulo="Configurar WhatsApp do grupo" aoFechar={aoFechar}>
      <form className="formulario" onSubmit={async (e) => {
        e.preventDefault(); setErro('');
        try { await api('/whatsapp/numero', { metodo: 'PUT', corpo: f }); aoSalvar(); } catch (falha) { setErro(falha.message); }
      }}>
        <p className="cinza ajuda">
          Situação: {situacao.provedor === 'meta' ? 'API oficial da Meta ligada' : 'modo teste (nada sai pelo WhatsApp)'}
          {situacao.provedor === 'meta' && !situacao.token && ', mas falta o WHATSAPP_TOKEN no servidor'}.
        </p>
        <label>ID do número (Phone number ID)<input value={f.phone_number_id} inputMode="numeric" data-livre placeholder="Copie do painel da Meta, em WhatsApp > Configuração da API"
          onChange={(e) => setF({ ...f, phone_number_id: e.target.value.replace(/\D/g, '') })} /></label>
        <label>Número (só para mostrar)<input value={f.numero} inputMode="tel" placeholder="(11) 99999-9999" onChange={(e) => setF({ ...f, numero: mascaraTelefone(e.target.value) })} /></label>
        <p className="cinza ajuda">Deixe o ID em branco e salve para desligar o WhatsApp deste grupo.</p>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario">Salvar</button>
        </div>
      </form>
    </Janela>
  );
}

// ------------------------------------------------------------ robô de atendimento
// Fluxo de perguntas que o robô faz a quem manda mensagem; no fim abre uma venda FUTURO.
// Com IA (só se o master liberar para o grupo), o robô conversa livre e junta os mesmos dados.
function Robo() {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = () => api('/whatsapp/robo').then((r) => { setD(r); setF(r.robo); }).catch((x) => setErro(x.message));
  useEffect(() => { carregar(); }, []);
  if (!f) return erro ? <p className="erro" role="alert">{erro}</p> : <p className="cinza">Carregando…</p>;

  const pode = d.pode_enviar;
  const mudar = (campos) => { setF({ ...f, ...campos }); setOk(''); };
  const mudarEtapa = (n, campos) => mudar({ etapas: f.etapas.map((e, i) => (i === n ? { ...e, ...campos } : e)) });
  const moverEtapa = (n, para) => {
    const l = [...f.etapas]; const [e] = l.splice(n, 1); l.splice(para, 0, e); mudar({ etapas: l });
  };

  async function salvar(e) {
    e.preventDefault(); setErro(''); setOk(''); setSalvando(true);
    try { await api('/whatsapp/robo', { metodo: 'PUT', corpo: f }); setOk('Robô salvo.'); carregar(); } catch (x) { setErro(x.message); }
    finally { setSalvando(false); }
  }
  async function liberarIA(liberada) {
    setErro('');
    try { await api('/whatsapp/robo/ia', { metodo: 'PUT', corpo: { liberada } }); carregar(); } catch (x) { setErro(x.message); }
  }

  return (
    <form className="cartao painel formulario robo-config" onSubmit={salvar}>
      <fieldset className="sem-borda" disabled={!pode}>
        <label className="linha-check robo-ligar">
          <input type="checkbox" checked={f.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} />
          <span><strong>Robô ligado</strong><br /><small className="cinza">Responde quem manda mensagem e abre uma venda FUTURO com os dados do cliente e do veículo. Se um atendente responder, o robô para naquela conversa.</small></span>
        </label>

        <div className="grade-2">
          <label>Loja em que a venda abre
            <select value={f.loja_id || ''} onChange={(e) => mudar({ loja_id: e.target.value || null })}>
              <option value="">A primeira loja do grupo</option>
              {d.lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </label>
          <label>Serviço, se o fluxo não perguntar
            <select value={f.servico_id || ''} onChange={(e) => mudar({ servico_id: e.target.value || null })}>
              <option value="">O primeiro serviço ativo</option>
              {d.servicos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </label>
        </div>

        <label>Mensagem de boas-vindas
          <textarea rows={2} data-livre value={f.saudacao || ''} onChange={(e) => mudar({ saudacao: e.target.value })} />
        </label>

        <h3>Perguntas, na ordem</h3>
        <ol className="robo-etapas">
          {f.etapas.map((e, n) => (
            <li key={n}>
              <select value={e.campo} aria-label={`Dado da pergunta ${n + 1}`} onChange={(x) => mudarEtapa(n, { campo: x.target.value })}>
                {Object.entries(d.campos).map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
              </select>
              <input data-livre value={e.pergunta} aria-label={`Pergunta ${n + 1}`} placeholder="O que o robô pergunta" onChange={(x) => mudarEtapa(n, { pergunta: x.target.value })} />
              <label className="linha-check"><input type="checkbox" checked={e.obrigatorio} onChange={(x) => mudarEtapa(n, { obrigatorio: x.target.checked })} /> Obrigatório</label>
              <span className="robo-etapa-acoes">
                <button type="button" className="botao-texto" disabled={n === 0} aria-label="Subir" onClick={() => moverEtapa(n, n - 1)}>↑</button>
                <button type="button" className="botao-texto" disabled={n === f.etapas.length - 1} aria-label="Descer" onClick={() => moverEtapa(n, n + 1)}>↓</button>
                <button type="button" className="fechar" aria-label={`Remover pergunta ${n + 1}`} onClick={() => mudar({ etapas: f.etapas.filter((_, i) => i !== n) })}>×</button>
              </span>
            </li>
          ))}
        </ol>
        <button type="button" className="botao-texto" onClick={() => mudar({ etapas: [...f.etapas, { campo: 'livre', pergunta: '', obrigatorio: false }] })}>+ Pergunta</button>
        <p className="cinza ajuda">Tipo de veículo e Serviço mostram as opções numeradas. O cliente pode escrever ATENDENTE a qualquer momento para falar com uma pessoa.</p>

        <label>Mensagem final
          <textarea rows={2} data-livre value={f.mensagem_final || ''} onChange={(e) => mudar({ mensagem_final: e.target.value })} />
        </label>
        <p className="cinza ajuda">Use {'{nome}'} para o primeiro nome, {'{numero}'} para o número da venda e {'{placa}'} para a placa.</p>

        <h3>Atendimento com IA</h3>
        {d.master && (
          <label className="linha-check">
            <input type="checkbox" checked={d.ia_liberada} onChange={(e) => liberarIA(e.target.checked)} />
            <span>IA liberada para este grupo <small className="cinza">(só o master vê; depende do contrato de prestação)</small></span>
          </label>
        )}
        {!d.ia_liberada ? (
          <p className="cinza ajuda">A IA não está liberada para este grupo. O robô segue as perguntas acima.</p>
        ) : (
          <>
            {!d.ia_configurada && <p className="aviso-zap">Falta a chave da IA no servidor (ANTHROPIC_API_KEY no api/.env). Enquanto isso o robô segue as perguntas acima.</p>}
            <label className="linha-check">
              <input type="checkbox" checked={f.ia_ativa} onChange={(e) => mudar({ ia_ativa: e.target.checked })} />
              <span>Usar IA na conversa <small className="cinza">(o robô conversa livre e junta os mesmos dados das perguntas acima)</small></span>
            </label>
            {f.ia_ativa && (
              <label>Instruções para a IA
                <textarea rows={4} data-livre value={f.ia_instrucoes || ''} placeholder="Ex.: horário de atendimento, endereço da loja, como falar com o cliente…"
                  onChange={(e) => mudar({ ia_instrucoes: e.target.value })} />
              </label>
            )}
          </>
        )}
      </fieldset>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {ok && <p className="sucesso" role="status">{ok}</p>}
      {pode && <div className="acoes-modal"><button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar robô'}</button></div>}
    </form>
  );
}

function Janela({ titulo, aoFechar, children }) {
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}
