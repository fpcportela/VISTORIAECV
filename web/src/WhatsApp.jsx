import { useEffect, useRef, useState } from 'react';
import { api, grupoEscolhido, sessao } from './api.js';
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
    try { await api(`/whatsapp/contatos/${k.id}`, { metodo: 'PUT', corpo: { cliente_id: clienteId } }); setCadastrar(false); carregar(); aoMudar?.(); }
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
          {/* o servidor liga sozinho o contato ao cliente com o mesmo celular */}
          {k.cliente_id ? <span className="selo-cliente">Cliente cadastrado</span> : (
            <>
              <span className="selo-sem-cadastro">CLIENTE NÃO CADASTRADO</span>
              {k.pode_enviar && lojasCliente.length > 0 && <button type="button" className="botao-contorno pequeno" onClick={() => setCadastrar(true)}>Salvar como cliente</button>}
            </>
          )}
        </div>
        <button className="fechar" onClick={aoFechar} aria-label="Fechar conversa">×</button>
      </header>
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
          🤖 O robô abriu a <strong>venda nº {k.chamado.venda_numero}</strong>{k.chamado.venda_situacao === 'futuro' ? ' (AGENDADO, falta confirmar)' : ''}.
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
let seq = 0;
const novoId = () => `b${Date.now().toString(36)}${(seq += 1)}`;
const blocoVazio = (tipo) => ({
  id: novoId(), tipo, nome: '', texto: '', ir: '',
  ...(tipo === 'menu' && { opcoes: [{ rotulo: '', ir: '' }, { rotulo: '', ir: '' }] }),
  ...(tipo === 'pergunta' && { campo: 'nome', obrigatorio: true }),
  ...(tipo === 'ia' && { campos: [] }),
});
const DICA_BLOCO = {
  mensagem: 'Manda o texto e segue sem esperar resposta.',
  menu: 'Manda a pergunta com as opções numeradas; cada opção leva para um bloco.',
  pergunta: 'Pergunta um dado do cliente e confere a resposta.',
  ia: 'A IA conversa usando o prompt e a base de conhecimento. Com dados marcados, ela junta esses dados; sem nenhum, só tira as dúvidas. Quando termina, segue o fluxo.',
  venda: 'Abre a venda AGENDADO com os dados juntados e manda a mensagem final. Termina o robô.',
  atendente: 'Manda o texto e passa a conversa para uma pessoa.',
  fim: 'Manda o texto e encerra o robô nesta conversa, sem abrir venda.',
};

function Robo() {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [novoTipo, setNovoTipo] = useState('mensagem');
  const promptArquivo = useRef(null);

  const carregar = () => api('/whatsapp/robo').then((r) => { setD(r); setF(r.robo); }).catch((x) => setErro(x.message));
  useEffect(() => { carregar(); }, []);
  if (!f) return erro ? <p className="erro" role="alert">{erro}</p> : <p className="cinza">Carregando…</p>;

  const pode = d.pode_enviar;
  const mudar = (campos) => { setF({ ...f, ...campos }); setOk(''); };
  const mudarBloco = (n, campos) => mudar({ fluxo: f.fluxo.map((b, i) => (i === n ? { ...b, ...campos } : b)) });
  const moverBloco = (n, para) => { const l = [...f.fluxo]; const [b] = l.splice(n, 1); l.splice(para, 0, b); mudar({ fluxo: l }); };
  const tirarBloco = (n) => {
    const id = f.fluxo[n].id;
    // quem apontava para o bloco removido passa a seguir para o próximo
    mudar({ fluxo: f.fluxo.filter((_, i) => i !== n).map((b) => ({ ...b, ir: b.ir === id ? '' : b.ir,
      ...(b.opcoes && { opcoes: b.opcoes.map((o) => ({ ...o, ir: o.ir === id ? '' : o.ir })) }) })) });
  };
  const rotulo = (b, i) => `${i + 1} - ${b.nome || d.blocos[b.tipo]}`;
  const destinos = (n) => (
    <>
      <option value="">{n === f.fluxo.length - 1 ? 'Fim do fluxo (passa para atendente)' : `Próximo bloco (${n + 2})`}</option>
      {f.fluxo.map((b, i) => i !== n && <option key={b.id} value={b.id}>Ir para {rotulo(b, i)}</option>)}
    </>
  );

  async function salvar(e) {
    e.preventDefault(); setErro(''); setOk(''); setSalvando(true);
    try { await api('/whatsapp/robo', { metodo: 'PUT', corpo: f }); setOk('Robô salvo.'); carregar(); } catch (x) { setErro(x.message); }
    finally { setSalvando(false); }
  }
  async function liberarIA(liberada) {
    setErro('');
    try { await api('/whatsapp/robo/ia', { metodo: 'PUT', corpo: { liberada } }); carregar(); } catch (x) { setErro(x.message); }
  }
  async function lerPrompt(arquivo) {
    if (!arquivo) return;
    if (arquivo.size > 200000) { setErro('Arquivo de prompt grande demais (até 200 KB de texto).'); return; }
    mudar({ ia_instrucoes: await arquivo.text() });
    if (promptArquivo.current) promptArquivo.current.value = '';
  }
  const temIA = f.fluxo.some((b) => b.tipo === 'ia');

  return (
    <form className="cartao painel formulario robo-config" onSubmit={salvar}>
      <fieldset className="sem-borda" disabled={!pode}>
        <label className="linha-check robo-ligar">
          <input type="checkbox" checked={f.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} />
          <span><strong>Robô ligado</strong><br /><small className="cinza">Responde quem manda mensagem seguindo o fluxo abaixo. Se um atendente responder, o robô para naquela conversa. O cliente pode escrever ATENDENTE a qualquer momento.</small></span>
        </label>

        <div className="grade-2">
          <label>Unidade padrão da venda
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

        <h3>Unidades e responsável pelo atendimento</h3>
        <p className="cinza ajuda">
          {d.lojas.length > 1
            ? 'O grupo tem mais de uma unidade: depois das boas-vindas, o robô pergunta em qual unidade o cliente quer atendimento, mostrando o endereço de cada uma (cadastrado em Grupos e unidades). A venda e o agendamento vão para a unidade escolhida.'
            : 'Com mais de uma unidade ativa, o robô pergunta primeiro em qual unidade o cliente quer atendimento, mostrando o endereço de cada uma.'}
          {' '}Quando o robô agenda ou passa a conversa para uma pessoa, o chamado vai para o responsável abaixo.
        </p>
        <div className="grade-2">
          <label>Responsável padrão
            <select value={f.responsavel_id || ''} onChange={(e) => mudar({ responsavel_id: e.target.value || null })}>
              <option value="">Ninguém (fica sem responsável)</option>
              {d.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
          {d.lojas.length > 1 && d.lojas.map((l) => (
            <label key={l.id}>Responsável · {l.nome}
              <select value={f.responsaveis?.[l.id] || ''} onChange={(e) => {
                const r = { ...(f.responsaveis || {}) };
                if (e.target.value) r[l.id] = e.target.value; else delete r[l.id];
                mudar({ responsaveis: r });
              }}>
                <option value="">O responsável padrão</option>
                {d.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </label>
          ))}
        </div>

        <label>Mensagem de boas-vindas
          <textarea rows={2} data-livre value={f.saudacao || ''} onChange={(e) => mudar({ saudacao: e.target.value })} />
        </label>

        <h3>Fluxo de atendimento</h3>
        <p className="cinza ajuda">O robô começa no bloco 1 e segue a seta de cada bloco. Use {'{nome}'} para o primeiro nome, {'{numero}'} para o nº da venda, {'{placa}'} e {'{horario}'}.</p>
        <ol className="robo-fluxo">
          {f.fluxo.map((b, n) => (
            <li key={b.id} className={`robo-bloco bloco-${b.tipo}`}>
              <div className="robo-bloco-topo">
                <span className="robo-bloco-num">{n + 1}</span>
                <select value={b.tipo} aria-label={`Tipo do bloco ${n + 1}`} onChange={(e) => mudarBloco(n, { ...blocoVazio(e.target.value), id: b.id, nome: b.nome, texto: b.texto, ir: b.ir })}>
                  {Object.entries(d.blocos).map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
                </select>
                <input data-livre value={b.nome} aria-label={`Nome do bloco ${n + 1}`} placeholder="Nome do bloco (para as setas)" onChange={(e) => mudarBloco(n, { nome: e.target.value })} />
                <span className="robo-etapa-acoes">
                  <button type="button" className="botao-texto" disabled={n === 0} aria-label="Subir" onClick={() => moverBloco(n, n - 1)}>↑</button>
                  <button type="button" className="botao-texto" disabled={n === f.fluxo.length - 1} aria-label="Descer" onClick={() => moverBloco(n, n + 1)}>↓</button>
                  <button type="button" className="fechar" aria-label={`Remover bloco ${n + 1}`} onClick={() => tirarBloco(n)}>×</button>
                </span>
              </div>
              <small className="cinza">{DICA_BLOCO[b.tipo]}</small>

              {b.tipo === 'pergunta' && (
                <div className="robo-linha">
                  <select value={b.campo} aria-label="Dado perguntado" onChange={(e) => mudarBloco(n, { campo: e.target.value })}>
                    {Object.entries(d.campos).map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
                  </select>
                  <label className="linha-check"><input type="checkbox" checked={b.obrigatorio} onChange={(e) => mudarBloco(n, { obrigatorio: e.target.checked })} /> Obrigatório</label>
                </div>
              )}
              {b.tipo !== 'ia' && (
                <textarea rows={b.tipo === 'pergunta' ? 1 : 2} data-livre value={b.texto} aria-label={`Texto do bloco ${n + 1}`}
                  placeholder={b.tipo === 'venda' ? 'Mensagem final (em branco: a mensagem final padrão, abaixo)' : b.tipo === 'menu' ? 'Pergunta do menu. Ex.: Como posso ajudar?' : 'Texto que o robô manda'}
                  onChange={(e) => mudarBloco(n, { texto: e.target.value })} />
              )}
              {b.tipo === 'menu' && (
                <div className="robo-opcoes">
                  {b.opcoes.map((o, k) => (
                    <div key={k} className="robo-linha">
                      <span className="robo-opcao-num">{k + 1}</span>
                      <input data-livre value={o.rotulo} placeholder="Texto da opção" aria-label={`Opção ${k + 1}`}
                        onChange={(e) => mudarBloco(n, { opcoes: b.opcoes.map((x, j) => (j === k ? { ...x, rotulo: e.target.value } : x)) })} />
                      <select value={o.ir} aria-label={`Destino da opção ${k + 1}`}
                        onChange={(e) => mudarBloco(n, { opcoes: b.opcoes.map((x, j) => (j === k ? { ...x, ir: e.target.value } : x)) })}>
                        {destinos(n)}
                      </select>
                      <button type="button" className="fechar" aria-label={`Tirar opção ${k + 1}`} onClick={() => mudarBloco(n, { opcoes: b.opcoes.filter((_, j) => j !== k) })}>×</button>
                    </div>
                  ))}
                  <button type="button" className="botao-texto" onClick={() => mudarBloco(n, { opcoes: [...b.opcoes, { rotulo: '', ir: '' }] })}>+ Opção</button>
                </div>
              )}
              {b.tipo === 'ia' && (
                <div className="robo-campos-ia">
                  {Object.entries(d.campos).filter(([v]) => v !== 'livre').map(([v, nome]) => {
                    const c = b.campos.find((x) => x.campo === v);
                    return (
                      <span key={v} className="robo-campo-ia">
                        <label className="linha-check"><input type="checkbox" checked={Boolean(c)}
                          onChange={(e) => mudarBloco(n, { campos: e.target.checked ? [...b.campos, { campo: v, obrigatorio: true }] : b.campos.filter((x) => x.campo !== v) })} /> {nome}</label>
                        {c && <label className="linha-check"><input type="checkbox" checked={c.obrigatorio}
                          onChange={(e) => mudarBloco(n, { campos: b.campos.map((x) => (x.campo === v ? { ...x, obrigatorio: e.target.checked } : x)) })} /> obrigatório</label>}
                      </span>
                    );
                  })}
                  {!d.ia_liberada && <p className="aviso-zap">A IA não está liberada para este grupo: este bloco passa a conversa para um atendente.</p>}
                </div>
              )}
              {['mensagem', 'pergunta', 'ia'].includes(b.tipo) && (
                <label className="robo-depois">{b.tipo === 'ia' ? 'Quando a IA terminar' : 'Depois'}
                  <select value={b.ir} onChange={(e) => mudarBloco(n, { ir: e.target.value })}>{destinos(n)}</select>
                </label>
              )}
            </li>
          ))}
        </ol>
        <div className="robo-linha">
          <select value={novoTipo} aria-label="Tipo do novo bloco" onChange={(e) => setNovoTipo(e.target.value)}>
            {Object.entries(d.blocos).map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
          </select>
          <button type="button" className="botao-contorno" onClick={() => mudar({ fluxo: [...f.fluxo, blocoVazio(novoTipo)] })}>+ Adicionar bloco</button>
        </div>

        <label>Mensagem final padrão (ao abrir a venda)
          <textarea rows={2} data-livre value={f.mensagem_final || ''} onChange={(e) => mudar({ mensagem_final: e.target.value })} />
        </label>

        <h3>IA: prompt e base de conhecimento</h3>
        {d.master && (
          <label className="linha-check">
            <input type="checkbox" checked={d.ia_liberada} onChange={(e) => liberarIA(e.target.checked)} />
            <span>IA liberada para este grupo <small className="cinza">(só o master vê; depende do contrato de prestação)</small></span>
          </label>
        )}
        {!d.ia_liberada && <p className="cinza ajuda">A IA não está liberada para este grupo. Dá para deixar o prompt e a base prontos; o bloco "Conversa com IA" só funciona depois de liberada.</p>}
        {d.ia_liberada && !d.ia_configurada && <p className="aviso-zap">Falta a chave da IA no servidor (ANTHROPIC_API_KEY no api/.env). Enquanto isso, o bloco de IA passa a conversa para um atendente.</p>}
        {d.ia_liberada && !temIA && <p className="cinza ajuda">Para usar a IA, coloque um bloco "Conversa com IA" no fluxo.</p>}
        <label>Prompt da IA
          <textarea rows={8} data-livre value={f.ia_instrucoes || ''} className="robo-prompt"
            placeholder="Quem é a loja, como falar com o cliente, regras, preços, horário de atendimento, endereço, o que fazer e o que não fazer…"
            onChange={(e) => mudar({ ia_instrucoes: e.target.value })} />
        </label>
        <div className="robo-linha">
          <small className="cinza">{(f.ia_instrucoes || '').length.toLocaleString('pt-BR')} caracteres</small>
          <label className="botao-texto">Carregar de um arquivo .txt
            <input ref={promptArquivo} type="file" accept=".txt,.md,text/plain" hidden onChange={(e) => lerPrompt(e.target.files[0])} />
          </label>
        </div>
      </fieldset>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {ok && <p className="sucesso" role="status">{ok}</p>}
      {pode && <div className="acoes-modal"><button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar robô'}</button></div>}
      <BaseConhecimento pode={pode} />
    </form>
  );
}

// Base de conhecimento da IA: textos e arquivos (PDF ou TXT) que a IA consulta para responder
function BaseConhecimento({ pode }) {
  const [lista, setLista] = useState(null);
  const [novo, setNovo] = useState(null); // { titulo, conteudo } enquanto escreve um texto
  const [editando, setEditando] = useState(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const arquivo = useRef(null);
  const carregar = () => api('/whatsapp/conhecimento').then(setLista).catch((x) => setErro(x.message));
  useEffect(() => { carregar(); }, []);
  const acao = async (fn) => { setErro(''); try { await fn(); carregar(); } catch (x) { setErro(x.message); } };

  async function enviar(arqs) {
    setErro(''); setEnviando(true);
    try {
      for (const a of arqs) {
        const q = new URLSearchParams({ arquivo: a.name, titulo: a.name.replace(/\.[^.]+$/, '') });
        const r = await fetch(`/api/whatsapp/conhecimento/arquivo?${q}`, {
          method: 'POST', body: a,
          headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${sessao.token()}`, ...(grupoEscolhido.ler() ? { 'X-Grupo': grupoEscolhido.ler() } : {}) },
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || (r.status === 413 ? `"${a.name}" passa de 10 MB.` : `Não foi possível enviar "${a.name}".`));
      }
    } catch (x) { setErro(x.message); }
    setEnviando(false);
    if (arquivo.current) arquivo.current.value = '';
    carregar();
  }
  const tamanho = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const total = (lista || []).reduce((t, k) => t + k.tamanho, 0);

  return (
    <section className="robo-base">
      <h3>Base de conhecimento</h3>
      <p className="cinza ajuda">Documentos que a IA consulta para responder: tabela de preços, perguntas frequentes, regras do Detran, endereço e horários.
        Envie PDF ou TXT (documento do Word: salve como PDF) ou escreva um texto. Desmarque para a IA deixar de usar sem apagar.</p>
      {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? <p className="cinza">Nenhum documento ainda.</p> : (
        <ul className="robo-docs">
          {lista.map((k) => (
            <li key={k.id}>
              <label className="linha-check"><input type="checkbox" checked={k.ativo} disabled={!pode} aria-label={`Usar ${k.titulo}`}
                onChange={(e) => acao(() => api(`/whatsapp/conhecimento/${k.id}`, { metodo: 'PUT', corpo: { ativo: e.target.checked } }))} /></label>
              <span className="robo-doc-nome">
                <strong>{k.titulo}</strong>
                <small className="cinza">{k.tipo === 'pdf' ? 'PDF' : 'Texto'} · {tamanho(k.tamanho)}{k.nome_arquivo ? ` · ${k.nome_arquivo}` : ''}</small>
              </span>
              <span className="robo-etapa-acoes">
                {k.tipo === 'texto' && pode && <button type="button" className="botao-texto" onClick={() => setEditando({ ...k })}>Editar</button>}
                <button type="button" className="botao-texto" onClick={() => abrirArquivo(k.id).catch((x) => setErro(x.message))}>Abrir</button>
                {pode && <button type="button" className="fechar" aria-label={`Apagar ${k.titulo}`}
                  onClick={() => window.confirm(`Apagar "${k.titulo}" da base de conhecimento?`) && acao(() => api(`/whatsapp/conhecimento/${k.id}`, { metodo: 'DELETE' }))}>×</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {lista?.length > 0 && <small className="cinza">Total {tamanho(total)} de 30 MB.</small>}
      {pode && (
        <div className="robo-linha">
          <button type="button" className="botao-contorno" onClick={() => setNovo({ titulo: '', conteudo: '' })}>+ Escrever texto</button>
          <label className="botao-contorno">{enviando ? 'Enviando…' : '+ Enviar arquivo (PDF ou TXT)'}
            <input ref={arquivo} type="file" multiple accept=".pdf,.txt,.md,.csv,application/pdf,text/plain" hidden disabled={enviando}
              onChange={(e) => e.target.files.length && enviar([...e.target.files])} />
          </label>
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {(novo || editando) && (
        <Janela titulo={novo ? 'Novo texto da base' : 'Editar texto'} aoFechar={() => { setNovo(null); setEditando(null); }}>
          <TextoBase inicial={novo || editando} aoFechar={() => { setNovo(null); setEditando(null); }}
            aoSalvar={(x) => acao(async () => {
              if (novo) await api('/whatsapp/conhecimento', { metodo: 'POST', corpo: x });
              else await api(`/whatsapp/conhecimento/${editando.id}`, { metodo: 'PUT', corpo: x });
              setNovo(null); setEditando(null);
            })} />
        </Janela>
      )}
    </section>
  );
}

function TextoBase({ inicial, aoFechar, aoSalvar }) {
  const [x, setX] = useState({ titulo: inicial.titulo || '', conteudo: inicial.conteudo || '' });
  return (
    <div className="formulario">
      <label>Título<input value={x.titulo} maxLength={120} placeholder="Ex.: Perguntas frequentes" onChange={(e) => setX({ ...x, titulo: e.target.value })} /></label>
      <label>Texto<textarea rows={12} data-livre value={x.conteudo} onChange={(e) => setX({ ...x, conteudo: e.target.value })} /></label>
      <div className="acoes-modal">
        <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao-primario" disabled={!x.titulo.trim() || !x.conteudo.trim()} onClick={() => aoSalvar(x)}>Salvar</button>
      </div>
    </div>
  );
}

// Abre o documento numa aba nova (a rota pede o login, então baixa com o token)
async function abrirArquivo(id) {
  const aba = window.open('', '_blank');
  const r = await fetch(`/api/whatsapp/conhecimento/${id}/arquivo`, {
    headers: { Authorization: `Bearer ${sessao.token()}`, ...(grupoEscolhido.ler() ? { 'X-Grupo': grupoEscolhido.ler() } : {}) },
  });
  if (!r.ok) { aba?.close(); throw new Error('Não foi possível abrir o documento.'); }
  const url = URL.createObjectURL(await r.blob());
  if (aba) aba.location.href = url; else window.location.href = url;
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
