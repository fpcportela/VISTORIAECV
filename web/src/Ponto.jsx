import { useEffect, useRef, useState } from 'react';
import { api, sessao } from './api.js';
import { criarTem } from './modulos.js';
import { Icone } from './icones.jsx';
import { abrirArquivo } from './Colaboradores.jsx';

// Controle de ponto dos colaboradores: registro com foto (entrada, saída para o
// almoço, volta do almoço, saída) e espelho do mês com edição e justificativa.

export const MARCACOES = { entrada: 'Entrada', saida_intervalo: 'Saída almoço', volta_intervalo: 'Volta almoço', saida: 'Saída' };
const ORDEM = Object.keys(MARCACOES);
const FUSO = 'America/Sao_Paulo';
const horaBR = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
const mesAtual = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO }).slice(0, 7);
const duracao = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;

// Minutos trabalhados no dia: manhã (entrada → saída almoço) + tarde (volta → saída),
// ou entrada → saída quando não houve almoço
function minutosDia(m) {
  const t = (k) => (m[k] ? new Date(m[k].hora).getTime() : null);
  const trecho = (a, b) => (t(a) && t(b) && t(b) > t(a) ? (t(b) - t(a)) / 60000 : 0);
  if (!m.saida_intervalo && !m.volta_intervalo) return trecho('entrada', 'saida');
  return trecho('entrada', 'saida_intervalo') + trecho('volta_intervalo', 'saida');
}

export default function Ponto({ perfil, loja }) {
  const pode = (l, p) => criarTem(perfil, l)(p);
  const lojasRegistro = perfil.lojas.filter((l) => pode(l.id, 'ponto.registrar'));
  const lojasEspelho = perfil.lojas.filter((l) => pode(l.id, 'ponto.ver_equipe'));
  const [aba, setAba] = useState(lojasRegistro.length ? 'registrar' : 'espelho');
  const lojas = aba === 'registrar' ? lojasRegistro : lojasEspelho;
  const [filial, setFilial] = useState('');
  const lojaUsada = lojas.some((l) => l.id === filial) ? filial : lojas.some((l) => l.id === loja) ? loja : lojas[0]?.id || '';

  return (
    <>
      <div className="cabecalho"><h1>Controle de ponto</h1></div>
      <div className="filtros">
        {lojasRegistro.length > 0 && lojasEspelho.length > 0 && (
          <div className="abas" role="tablist">
            <button role="tab" aria-selected={aba === 'registrar'} className={aba === 'registrar' ? 'ativa' : ''} onClick={() => setAba('registrar')}>Registrar ponto</button>
            <button role="tab" aria-selected={aba === 'espelho'} className={aba === 'espelho' ? 'ativa' : ''} onClick={() => setAba('espelho')}>Espelho do ponto</button>
          </div>
        )}
        {lojas.length > 1 && (
          <select value={lojaUsada} onChange={(e) => setFilial(e.target.value)} aria-label="Filial">
            {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        )}
      </div>
      {!lojaUsada ? <p className="cinza">Seu perfil não tem acesso ao ponto.</p>
        : aba === 'registrar' ? <Registrar key={lojaUsada} loja={lojaUsada} /> : <Espelho key={lojaUsada} loja={lojaUsada} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Registro: escolhe o colaborador, tira a foto e registra a próxima marcação
// ---------------------------------------------------------------------------
function Registrar({ loja }) {
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState(null);
  const [feito, setFeito] = useState(null);
  const [erro, setErro] = useState('');

  const carregar = () => api(`/ponto/colaboradores?loja=${loja}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message));
  useEffect(() => { carregar(); }, [loja]);
  useEffect(() => { if (!feito) return undefined; const t = setTimeout(() => setFeito(null), 5000); return () => clearTimeout(t); }, [feito]);

  const proxima = (c) => ORDEM.find((t) => !c.hoje.some((m) => m.tipo === t));
  const filtrados = (lista || []).filter((c) => c.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  if (escolhido) {
    return <Camera loja={loja} colaborador={escolhido} tipo={proxima(escolhido)} aoVoltar={() => setEscolhido(null)}
      aoRegistrar={(r) => { setFeito({ ...r, nome: escolhido.nome }); setEscolhido(null); setBusca(''); carregar(); }} />;
  }
  return (
    <>
      {feito && (
        <div className="ponto-feito" role="status">
          <strong>{MARCACOES[feito.tipo]} registrada às {horaBR(feito.hora)}</strong>
          <span>{feito.nome}</span>
          {feito.comprovante && <small>O comprovante do dia vai para o WhatsApp do colaborador.</small>}
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <input type="search" className="busca-ponto" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procure seu nome" aria-label="Procurar colaborador" />
      {lista === null ? <p className="cinza">Carregando…</p> : filtrados.length === 0 ? (
        <p className="cinza vazio">{lista.length ? 'Ninguém com esse nome.' : 'Nenhum colaborador ativo nesta filial. Cadastre em Colaboradores.'}</p>
      ) : (
        <div className="grade-ponto">
          {filtrados.map((c) => {
            const t = proxima(c);
            return (
              <button key={c.id} className="cartao cartao-ponto" disabled={!t} onClick={() => setEscolhido(c)}>
                <strong>{c.nome}</strong>
                {c.cargo && <small className="cinza">{c.cargo}</small>}
                <span className="marcas-hoje">
                  {ORDEM.map((k) => {
                    const m = c.hoje.find((x) => x.tipo === k);
                    return <span key={k} className={m ? 'feita' : ''} title={MARCACOES[k]}>{m ? horaBR(m.hora) : '--:--'}</span>;
                  })}
                </span>
                <span className="proxima">{t ? `Registrar ${MARCACOES[t].toLowerCase()}` : 'Dia completo'}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// Reduz a foto para no máximo 480 px de largura (JPEG) antes de enviar
function reduzir(fonte, largura, altura) {
  const escala = Math.min(1, 480 / largura);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largura * escala); canvas.height = Math.round(altura * escala);
  canvas.getContext('2d').drawImage(fonte, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

// Câmera ao vivo quando o navegador permite (https ou o próprio computador);
// senão, o botão abre a câmera do celular pelo seletor de arquivo
function Camera({ loja, colaborador, tipo, aoVoltar, aoRegistrar }) {
  const video = useRef(null);
  const [aoVivo, setAoVivo] = useState(false);
  const [foto, setFoto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fluxo = useRef(null);

  const ligar = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
    try {
      fluxo.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      if (video.current) { video.current.srcObject = fluxo.current; setAoVivo(true); }
    } catch {
      setAoVivo(false);
    }
  };
  const desligar = () => { fluxo.current?.getTracks().forEach((t) => t.stop()); fluxo.current = null; };
  useEffect(() => { ligar(); return desligar; }, []);

  const tirar = () => {
    const v = video.current;
    setFoto(reduzir(v, v.videoWidth, v.videoHeight));
    desligar(); setAoVivo(false);
  };
  const deArquivo = (arquivo) => {
    if (!arquivo) return;
    const img = new Image();
    img.onload = () => { setFoto(reduzir(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(arquivo);
  };
  const outra = () => { setFoto(''); ligar(); };

  async function registrar() {
    setEnviando(true); setErro('');
    try {
      aoRegistrar(await api('/ponto/registrar', { metodo: 'POST', corpo: { colaborador_id: colaborador.id, loja_id: loja, foto } }));
    } catch (falha) {
      setErro(falha.message); setEnviando(false);
    }
  }

  return (
    <div className="cartao camera-ponto">
      <div className="camera-topo">
        <button className="botao-texto" onClick={() => { desligar(); aoVoltar(); }}>‹ Voltar</button>
        <span><strong>{colaborador.nome}</strong><small className="cinza">{MARCACOES[tipo]}</small></span>
      </div>
      <div className="camera-quadro">
        {foto ? <img src={foto} alt="Foto tirada agora" />
          : <video ref={video} autoPlay playsInline muted hidden={!aoVivo} />}
        {!foto && !aoVivo && (
          <label className="botao-primario abrir-camera">
            Abrir câmera
            <input type="file" accept="image/*" capture="user" hidden onChange={(e) => deArquivo(e.target.files[0])} />
          </label>
        )}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="acoes-modal">
        {foto ? (
          <>
            <button className="botao-contorno" onClick={outra} disabled={enviando}>Tirar outra</button>
            <button className="botao-primario" onClick={registrar} disabled={enviando}>{enviando ? 'Registrando…' : `Registrar ${MARCACOES[tipo].toLowerCase()}`}</button>
          </>
        ) : aoVivo && <button className="botao-primario" onClick={tirar}>Tirar foto</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Espelho do mês: marcações por dia, horas, fotos, edição e justificativa
// ---------------------------------------------------------------------------
function Espelho({ loja }) {
  const [colaboradores, setColaboradores] = useState([]);
  const [colab, setColab] = useState('');
  const [mes, setMes] = useState(mesAtual());
  const [dados, setDados] = useState(null);
  const [detalhe, setDetalhe] = useState(null); // { data, tipo }
  const [justificando, setJustificando] = useState(null); // { data, tipo } (sem tipo = o dia todo)
  const [foto, setFoto] = useState(null); // { id, titulo }
  const [relatorio, setRelatorio] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api(`/ponto/colaboradores?loja=${loja}&inativos=1`).then((l) => { setColaboradores(l); setColab((c) => c || l[0]?.id || ''); })
      .catch((f) => setErro(f.message));
  }, [loja]);
  const carregar = () => (colab && mes ? api(`/ponto/espelho?colaborador=${colab}&mes=${mes}`)
    .then((d) => { setDados(d); setErro(''); }).catch((f) => { setDados(null); setErro(f.message); }) : null);
  useEffect(() => { carregar(); }, [colab, mes]);

  // Todos os dias do mês, com as marcações ativas e a justificativa
  const [ano, m] = mes.split('-').map(Number);
  const dias = Array.from({ length: new Date(ano, m, 0).getDate() }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
  const doDia = (d) => Object.fromEntries((dados?.registros || []).filter((r) => r.data === d && r.ativo).map((r) => [r.tipo, r]));
  // justificativa de cada marcação (tipo) ou do dia todo (sem tipo)
  const justificativa = (d, tipo = null) => dados?.justificativas.find((j) => j.data === d && (j.tipo || null) === tipo);
  const justificativasDia = (d) => (dados?.justificativas || []).filter((j) => j.data === d)
    .sort((a, b) => (a.tipo ? ORDEM.indexOf(a.tipo) + 1 : 0) - (b.tipo ? ORDEM.indexOf(b.tipo) + 1 : 0));
  const comprovante = (d) => dados?.comprovantes?.find((c) => c.data === d);
  const totalMes = dias.reduce((t, d) => t + minutosDia(doDia(d)), 0);

  return (
    <>
      <div className="filtros">
        <select value={colab} onChange={(e) => setColab(e.target.value)} aria-label="Colaborador">
          {colaboradores.length === 0 && <option value="">Nenhum colaborador</option>}
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês" />
        <button className="botao-contorno" onClick={() => setRelatorio(true)} disabled={!colaboradores.length}>
          <Icone nome="relatorios" tamanho={18} /> Gerar relatório
        </button>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {dados && (
        <>
          <small className="cinza">Total no mês: <strong>{duracao(totalMes)}</strong> · clique num horário para ver a foto{dados.pode.ajustar ? ' ou editar' : ''}.</small>
          <div className="tabela-ponto" role="table" aria-label="Espelho do ponto">
            <div className="tp-linha tp-cabecalho" role="row">
              <span>Dia</span>{ORDEM.map((k) => <span key={k}>{MARCACOES[k]}</span>)}<span>Horas</span><span>Justificativa</span>
            </div>
            {dias.map((d) => {
              const marcas = doDia(d);
              const js = justificativasDia(d);
              const sem = new Date(`${d}T12:00:00`).getDay();
              return (
                <div key={d} className={`tp-linha${sem === 0 || sem === 6 ? ' fim-semana' : ''}`} role="row">
                  <span className="tp-dia">{new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', weekday: 'short' })}</span>
                  {ORDEM.map((k) => (
                    <span key={k} data-rotulo={MARCACOES[k]}>
                      {marcas[k] ? (
                        <button className={`tp-hora${marcas[k].origem === 'ajuste' ? ' editada' : ''}`} onClick={() => setDetalhe({ data: d, tipo: k })}
                          title={marcas[k].origem === 'ajuste' ? `Editada: ${marcas[k].motivo}` : 'Ver detalhes'}>
                          {horaBR(marcas[k].hora)}{marcas[k].origem === 'ajuste' && <sup>*</sup>}
                        </button>
                      ) : null}
                      {marcas[k]?.tem_foto && (
                        <button className="tp-foto" onClick={() => setFoto({ id: marcas[k].id, titulo: `${MARCACOES[k]} · ${new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')} · ${horaBR(marcas[k].hora)}` })}
                          title="Ver foto do registro" aria-label={`Ver foto: ${MARCACOES[k]} de ${new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')}`}>
                          <Icone nome="camera" tamanho={15} />
                        </button>
                      )}
                      {marcas[k] ? null : dados.pode.ajustar ? (
                        <button className="tp-vazio" onClick={() => setDetalhe({ data: d, tipo: k })} title="Incluir marcação">+</button>
                      ) : <span className="cinza">—</span>}
                      {dados.pode.justificar && (
                        <button className={`tp-justificar${justificativa(d, k) ? ' feita' : ''}`} onClick={() => setJustificando({ data: d, tipo: k })}
                          title={justificativa(d, k) ? `Justificativa: ${justificativa(d, k).texto}` : `Justificar ${MARCACOES[k].toLowerCase()}`}
                          aria-label={`Justificar ${MARCACOES[k]} de ${new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')}`}>✎</button>
                      )}
                    </span>
                  ))}
                  <span data-rotulo="Horas" className="tp-horas">
                    {minutosDia(marcas) ? duracao(minutosDia(marcas)) : ''}
                    {comprovante(d) && (
                      <button className={`tp-comprovante ${comprovante(d).envio}`} title={`Comprovante do dia nº ${comprovante(d).nsr}: ${ENVIO[comprovante(d).envio] || comprovante(d).envio}${comprovante(d).erro ? ` (${comprovante(d).erro})` : ''}`}
                        aria-label={`Comprovante do dia ${new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')}`}
                        onClick={() => abrirArquivo(`/ponto/comprovante?colaborador=${colab}&data=${d}`).catch((f) => setErro(f.message))}>🧾</button>
                    )}
                  </span>
                  <span data-rotulo="Justificativa" className="tp-justificativa">
                    {js.map((j) => (
                      <span key={j.tipo || 'dia'} className="tp-just-item">
                        <small title={`${j.criado_por || ''}`}><strong>{j.tipo ? MARCACOES[j.tipo] : 'Dia'}:</strong> {j.texto}</small>
                        {j.arquivos?.map((a) => (
                          <button key={a.id} className="botao-texto tp-anexo" title="Abrir documento"
                            onClick={() => abrirArquivo(`/ponto/justificativa/arquivos/${a.id}`).catch((f) => setErro(f.message))}>📎 {a.nome}</button>
                        ))}
                        {dados.pode.justificar && <button className="botao-texto" onClick={() => setJustificando({ data: d, tipo: j.tipo || null })}>Alterar</button>}
                      </span>
                    ))}
                    {dados.pode.justificar && !justificativa(d) && (
                      <button className="botao-texto" title="Falta, atestado ou folga do dia inteiro" onClick={() => setJustificando({ data: d, tipo: null })}>Justificar o dia</button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <small className="cinza">* horário editado (o registro original fica guardado no histórico).</small>
        </>
      )}
      {detalhe && dados && (
        <DetalheMarcacao dados={dados} {...detalhe} aoFechar={() => setDetalhe(null)} aoSalvar={() => { setDetalhe(null); carregar(); }} />
      )}
      {foto && dados && (
        <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && setFoto(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Foto do registro">
            <div className="modal-topo">
              <h2>{foto.titulo}</h2>
              <button className="fechar" onClick={() => setFoto(null)} aria-label="Fechar">×</button>
            </div>
            <p className="cinza">{dados.colaborador.nome}</p>
            <FotoPonto id={foto.id} />
          </section>
        </div>
      )}
      {justificando && dados && (
        <Justificar colaborador={dados.colaborador.id} {...justificando} atual={justificativa(justificando.data, justificando.tipo)?.texto || ''}
          arquivos={justificativa(justificando.data, justificando.tipo)?.arquivos || []} aoMudar={carregar}
          aoFechar={() => setJustificando(null)} aoSalvar={() => { setJustificando(null); carregar(); }} />
      )}
      {relatorio && <RelatorioPonto loja={loja} colaboradores={colaboradores} colab={colab} mes={mes} aoFechar={() => setRelatorio(false)} />}
    </>
  );
}

function FotoPonto({ id }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    fetch(`/api/ponto/registros/${id}/foto`, { headers: { Authorization: `Bearer ${sessao.token()}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => u && URL.revokeObjectURL(u);
  }, [id]);
  return url ? <img className="foto-ponto" src={url} alt="Foto do registro" /> : <div className="foto-ponto vazia">Carregando foto…</div>;
}

function DetalheMarcacao({ dados, data, tipo, aoFechar, aoSalvar }) {
  const historico = dados.registros.filter((r) => r.data === data && r.tipo === tipo);
  const atual = historico.find((r) => r.ativo);
  const [hora, setHora] = useState(atual ? horaBR(atual.hora) : '');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      await api('/ponto/ajustar', { metodo: 'POST', corpo: { colaborador_id: dados.colaborador.id, data, tipo, hora, motivo } });
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Marcação do ponto">
        <div className="modal-topo">
          <h2>{MARCACOES[tipo]} · {new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR')}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <p className="cinza">{dados.colaborador.nome}</p>
        {atual?.tem_foto ? <FotoPonto id={atual.id} /> : atual && <p className="cinza">Sem foto (incluída pela edição).</p>}
        {historico.length > 0 && (
          <ul className="historico-ponto">
            {historico.map((r) => (
              <li key={r.id} className={r.ativo ? '' : 'riscado'}>
                <strong>{horaBR(r.hora)}</strong> {r.origem === 'ajuste' ? `editado: ${r.motivo}` : 'registrado com foto'}
                <small className="cinza"> · {r.registrado_por || '—'} em {new Date(r.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
              </li>
            ))}
          </ul>
        )}
        {dados.pode.ajustar && (
          <form className="formulario" onSubmit={salvar}>
            <label>{atual ? 'Corrigir o horário' : 'Incluir horário'}<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required /></label>
            <label>Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required placeholder="Ex.: esqueceu de registrar a saída" /></label>
            {erro && <p className="erro" role="alert">{erro}</p>}
            <div className="acoes-modal">
              <button type="button" className="botao-contorno" onClick={aoFechar}>Fechar</button>
              <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function Justificar({ colaborador, data, tipo, atual, arquivos, aoMudar, aoFechar, aoSalvar }) {
  const [texto, setTexto] = useState(atual);
  const [novos, setNovos] = useState([]); // arquivos escolhidos, enviados ao salvar
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  async function salvar(e) {
    e.preventDefault();
    if (novos.length && !texto.trim()) return setErro('Escreva a justificativa para anexar o documento.');
    setSalvando(true); setErro('');
    try {
      await api('/ponto/justificativa', { metodo: 'PUT', corpo: { colaborador_id: colaborador, data, tipo, texto } });
      for (const arq of novos) {
        const q = new URLSearchParams({ colaborador, data, ...(tipo && { tipo }), nome: arq.name, mime: arq.type || 'application/octet-stream' });
        const r = await fetch(`/api/ponto/justificativa/arquivos?${q}`, {
          method: 'POST', body: arq, headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${sessao.token()}` },
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || (r.status === 413 ? `"${arq.name}" passa de 15 MB.` : `Não foi possível enviar "${arq.name}".`));
      }
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }
  async function excluir(a) {
    if (!confirm(`Excluir o documento "${a.nome}"?`)) return;
    try { await api(`/ponto/justificativa/arquivos/${a.id}`, { metodo: 'DELETE' }); aoMudar(); } catch (falha) { setErro(falha.message); }
  }
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Justificativa">
        <div className="modal-topo">
          <h2>Justificativa · {tipo ? `${MARCACOES[tipo]} · ` : 'Dia todo · '}{new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR')}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={salvar}>
          <label>Justificativa<textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: atestado médico, folga combinada…" autoFocus /></label>
          <small className="cinza">Deixe em branco e salve para apagar a justificativa (e os documentos dela).</small>
          <fieldset className="grupo-permissoes">
            <legend>Documentos (atestado, declaração…)</legend>
            {arquivos.length > 0 && (
              <ul className="lista-arquivos">
                {arquivos.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="botao-texto" onClick={() => abrirArquivo(`/ponto/justificativa/arquivos/${a.id}`).catch((f) => setErro(f.message))}>📎 {a.nome}</button>
                    <button type="button" className="fechar" aria-label={`Excluir ${a.nome}`} onClick={() => excluir(a)}>×</button>
                  </li>
                ))}
              </ul>
            )}
            {novos.map((a, i) => (
              <small key={i} className="cinza">Vai anexar: {a.name} <button type="button" className="botao-texto" onClick={() => setNovos(novos.filter((_, k) => k !== i))}>tirar</button></small>
            ))}
            <input type="file" multiple aria-label="Anexar documento" onChange={(e) => { setNovos([...novos, ...e.target.files]); e.target.value = ''; }} />
          </fieldset>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

const ENVIO = { enviado: 'enviado pelo WhatsApp', simulado: 'WhatsApp em modo teste', sem_celular: 'colaborador sem celular', sem_whatsapp: 'grupo sem WhatsApp', falhou: 'não enviado', pendente: 'enviando' };

// Relatório do mês em PDF: um colaborador ou todos, com a linha de assinatura
function RelatorioPonto({ loja, colaboradores, colab, mes, aoFechar }) {
  const [quem, setQuem] = useState(colab || '');
  const [mesR, setMesR] = useState(mes);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);
  async function gerar(e) {
    e.preventDefault(); setErro(''); setGerando(true);
    try {
      const d = await api(`/ponto/relatorio?loja=${loja}&mes=${mesR}${quem ? `&colaborador=${quem}` : ''}`);
      if (!d.colaboradores.length) throw new Error('Nenhum colaborador com ponto neste mês.');
      const { gerarPdfPonto } = await import('./relatorioPonto.js');
      await gerarPdfPonto({ ...d, mes: mesR });
      aoFechar();
    } catch (falha) {
      setErro(falha.message); setGerando(false);
    }
  }
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Relatório do ponto">
        <div className="modal-topo">
          <h2>Relatório do ponto</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={gerar}>
          <label>Colaborador
            <select value={quem} onChange={(e) => setQuem(e.target.value)}>
              <option value="">Todos os colaboradores</option>
              {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Mês<input type="month" value={mesR} onChange={(e) => setMesR(e.target.value)} required /></label>
          <small className="cinza">Sai um PDF com uma página por colaborador e, embaixo, o nome dele com a linha para assinatura.</small>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={gerando}>{gerando ? 'Gerando…' : 'Gerar PDF'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
