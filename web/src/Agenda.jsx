import { useEffect, useState } from 'react';
import { api } from './api.js';
import { criarTem } from './modulos.js';
import { cnpjValido, cpfValido, formatarDoc, mascaraCnpj, mascaraCpf, mascaraTelefone } from './documentos.js';
import { CampoData } from './Data.jsx';
import { Placa } from './Placa.jsx';
import { EditorCliente } from './Clientes.jsx';

// Agenda de vistorias por loja: dia ou semana, com os horários livres, os agendamentos
// (feitos na tela ou pelo robô do WhatsApp) e a configuração do horário de atendimento.

const FUSO = 'America/Sao_Paulo';
const diaSP = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: FUSO });
const horaSP = (t) => new Date(t).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const hoje = () => diaSP(new Date());
const somar = (dia, n) => { const d = new Date(`${dia}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const somarMes = (dia, n) => { const d = new Date(`${dia.slice(0, 8)}01T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const inicioSemana = (dia) => somar(dia, -new Date(`${dia}T12:00:00`).getDay());
const instanteSP = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`).toISOString(); // horário de Brasília (sem horário de verão)
const nomeDia = (dia, opcoes) => new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', opcoes);
const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Hora sempre HH:MM (24h), só números: os dois pontos entram sozinhos
const mascaraHora = (t) => { const d = String(t ?? '').replace(/\D/g, '').slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };
function CampoHora({ value, onChange, ...resto }) {
  return <input className="campo-hora" value={value || ''} inputMode="numeric" placeholder="00:00" maxLength={5} pattern="([01]\d|2[0-3]):[0-5]\d"
    title="Hora no formato HH:MM" onChange={(e) => onChange(mascaraHora(e.target.value))} {...resto} />;
}

// "27/10 às 19:10"
const quando = (t) => `${new Date(t).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' })} às ${horaSP(t)}`;
const quem = (h) => (h.origem === 'whatsapp' ? 'pelo cliente no WhatsApp' : h.usuario ? `por ${h.usuario}` : 'na agenda');
const textoHistorico = (h) => ({
  confirmado: `Cliente confirmou pelo WhatsApp em ${quando(h.criado_em)}`,
  nao_confirmado: `Cliente respondeu NÃO em ${quando(h.criado_em)}`,
  remarcado: `Remarcado de ${quando(h.de_inicio)} para ${quando(h.para_inicio)} ${quem(h)} em ${quando(h.criado_em)}`,
}[h.acao]);

export const SITUACOES_AGENDA = {
  agendado: 'Agendado', confirmado: 'Confirmado', compareceu: 'Compareceu', faltou: 'Faltou', cancelado: 'Cancelado',
};

export default function Agenda({ perfil, loja, aoVenda, aoNovaVenda }) {
  const lojas = perfil.lojas.filter((l) => criarTem(perfil, l.id)('agenda.ver'));
  const [filial, setFilial] = useState('');
  const lojaUsada = lojas.some((l) => l.id === filial) ? filial : lojas.some((l) => l.id === loja) ? loja : lojas[0]?.id || '';
  const [modo, setModo] = useState('dia');
  const [dia, setDia] = useState(hoje());
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [janela, setJanela] = useState(null);
  const [aviso, setAviso] = useState('');
  const [recarga, setRecarga] = useState(0);

  // mês: semanas inteiras (de domingo a sábado) que cobrem o mês do dia escolhido
  const primeiroMes = `${dia.slice(0, 8)}01`;
  const ultimoMes = somar(`${somarMes(primeiroMes, 1)}`, -1);
  const de = modo === 'dia' ? dia : modo === 'semana' ? inicioSemana(dia) : inicioSemana(primeiroMes);
  const ate = modo === 'dia' ? dia : modo === 'semana' ? somar(de, 6) : somar(inicioSemana(ultimoMes), 6);
  const passo = (n) => setDia(modo === 'dia' ? somar(dia, n) : modo === 'semana' ? somar(dia, 7 * n) : somarMes(primeiroMes, n));
  useEffect(() => {
    if (!lojaUsada) return undefined;
    let vivo = true;
    const carregar = () => api(`/agenda?loja=${lojaUsada}&de=${de}&ate=${ate}`)
      .then((r) => { if (vivo) { setD(r); setErro(''); } }).catch((f) => vivo && setErro(f.message));
    carregar();
    // o robô pode agendar enquanto a tela está aberta
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [lojaUsada, de, ate, recarga]);

  const recarregar = (msg) => { setRecarga((n) => n + 1); setJanela(null); setAviso(msg || ''); };
  const mudar = async (a, corpo) => {
    setAviso('');
    try { const r = await api(`/agenda/${a.id}`, { metodo: 'PUT', corpo }); recarregar(r.aviso); } catch (f) { setAviso(f.message); }
  };
  const confirmar = async (a) => {
    setAviso('');
    try { await api(`/agenda/${a.id}/confirmacao`, { metodo: 'POST' }); recarregar('Confirmação enviada pelo WhatsApp.'); } catch (f) { setAviso(f.message); }
  };

  if (!lojas.length) return <><div className="cabecalho"><h1>Agenda</h1></div><p className="cinza">Seu perfil não tem acesso à agenda.</p></>;
  const pode = d?.pode_gerenciar;
  const titulo = modo === 'dia'
    ? nomeDia(dia, { weekday: 'long', day: '2-digit', month: 'long' })
    : modo === 'mes' ? nomeDia(primeiroMes, { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())
      : `${nomeDia(de, { day: '2-digit', month: '2-digit' })} a ${nomeDia(ate, { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

  return (
    <>
      <div className="cabecalho">
        <h1>Agenda</h1>
        <div className="acoes-cabecalho">
          {pode && <button className="botao-contorno" onClick={() => setJanela({ tipo: 'config' })}>Horários</button>}
          {pode && <button className="botao-primario" onClick={() => setJanela({ tipo: 'novo', dia })}>+ Agendar</button>}
        </div>
      </div>
      <div className="filtros agenda-filtros">
        {lojas.length > 1 && (
          <select value={lojaUsada} onChange={(e) => setFilial(e.target.value)} aria-label="Loja">
            {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        )}
        <div className="abas" role="tablist">
          <button role="tab" aria-selected={modo === 'dia'} className={modo === 'dia' ? 'ativa' : ''} onClick={() => setModo('dia')}>Dia</button>
          <button role="tab" aria-selected={modo === 'semana'} className={modo === 'semana' ? 'ativa' : ''} onClick={() => setModo('semana')}>Semana</button>
          <button role="tab" aria-selected={modo === 'mes'} className={modo === 'mes' ? 'ativa' : ''} onClick={() => setModo('mes')}>Mês</button>
        </div>
        <div className="agenda-nav">
          <button className="botao-contorno" aria-label="Anterior" onClick={() => passo(-1)}>‹</button>
          <button className="botao-contorno" onClick={() => setDia(hoje())}>Hoje</button>
          <button className="botao-contorno" aria-label="Próximo" onClick={() => passo(1)}>›</button>
          <CampoData value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Ir para o dia" />
        </div>
      </div>
      <h2 className="agenda-titulo">{titulo}</h2>
      {aviso && <p className={/enviada|Agendado\b(?!,)/.test(aviso) ? 'sucesso' : 'erro'} role="status">{aviso}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {!d ? <p className="cinza">Carregando…</p>
        : modo === 'dia' ? (
          <Dia dia={dia} d={d} pode={pode} aoNovo={(hora) => setJanela({ tipo: 'novo', dia, hora })}
            aoEditar={(a) => setJanela({ tipo: 'editar', a })} aoMudar={mudar} aoConfirmar={confirmar} aoVenda={aoVenda} aoNovaVenda={aoNovaVenda} />
        ) : modo === 'semana' ? (
          <Semana de={de} d={d} aoDia={(x) => { setDia(x); setModo('dia'); }} />
        ) : (
          <Semana de={de} dias={Math.round((new Date(`${ate}T12:00:00`) - new Date(`${de}T12:00:00`)) / 864e5) + 1} mes={primeiroMes.slice(0, 7)}
            d={d} aoDia={(x) => { setDia(x); setModo('dia'); }} />
        )}
      {janela?.tipo === 'novo' && <Editor perfil={perfil} loja={lojaUsada} servicos={d?.servicos || []} colunas={d?.colunas || []} inicial={{ dia: janela.dia, hora: janela.hora }}
        aoFechar={() => setJanela(null)} aoSalvar={recarregar} />}
      {janela?.tipo === 'editar' && <Editor perfil={perfil} loja={lojaUsada} servicos={d?.servicos || []} agendamento={janela.a}
        aoFechar={() => setJanela(null)} aoSalvar={recarregar} />}
      {janela?.tipo === 'config' && d && <Configurar loja={lojaUsada} config={d.config} aoFechar={() => setJanela(null)} aoSalvar={recarregar} />}
    </>
  );
}

// ------------------------------------------------------------ dia
function Dia({ dia, d, pode, aoNovo, aoEditar, aoMudar, aoConfirmar, aoVenda, aoNovaVenda }) {
  const doDia = d.agendamentos.filter((a) => diaSP(a.inicio) === dia);
  const livres = d.livres.filter((l) => diaSP(l.inicio) === dia);
  const bloqueios = d.bloqueios;
  // linhas: cada horário livre ou ocupado do dia, em ordem
  // remarcados que saíram deste dia: ficam como registro no horário antigo
  const saiu = (d.historico || []).filter((h) => h.acao === 'remarcado' && diaSP(h.de_inicio) === dia);
  const horas = [...new Set([...livres.map((l) => horaSP(l.inicio)), ...doDia.map((a) => horaSP(a.inicio)), ...saiu.map((h) => horaSP(h.de_inicio))])].sort();
  const fechado = !d.config.horarios?.[new Date(`${dia}T12:00:00`).getDay()];

  return (
    <div className="agenda-dia">
      {bloqueios.filter((b) => diaSP(b.inicio) <= dia && diaSP(b.fim) >= dia).map((b) => (
        <p key={b.id} className="aviso-zap">Bloqueado {horaSP(b.inicio)}–{horaSP(b.fim)}{b.motivo ? `: ${b.motivo}` : ''}</p>
      ))}
      {!horas.length && <p className="cinza">{fechado ? 'A loja não atende neste dia.' : dia < hoje() ? 'Nenhum agendamento neste dia.' : 'Sem horários livres e sem agendamentos neste dia.'}</p>}
      {horas.map((h) => {
        const aqui = doDia.filter((a) => horaSP(a.inicio) === h);
        const livre = livres.find((l) => horaSP(l.inicio) === h);
        return (
          <div key={h} className="agenda-linha">
            <span className="agenda-hora">{h}</span>
            <div className="agenda-itens">
              {aqui.map((a) => <Cartao key={a.id} a={a} historico={(d.historico || []).filter((h) => h.agendamento_id === a.id)}
                pode={pode} aoEditar={aoEditar} aoMudar={aoMudar} aoConfirmar={aoConfirmar} aoVenda={aoVenda} aoNovaVenda={aoNovaVenda} />)}
              {saiu.filter((x) => horaSP(x.de_inicio) === h).map((x) => (
                <div key={x.id} className="agenda-cartao agenda-remarcado">
                  <div className="agenda-cartao-topo">
                    <strong>{x.nome}</strong>
                    {x.placa && <Placa placa={x.placa} tamanho="mini" />}
                    <span className="selo-sit">Remarcado</span>
                  </div>
                  <div className="cinza agenda-detalhe">Foi para {quando(x.para_inicio)} {quem(x)} (em {quando(x.criado_em)})</div>
                </div>
              ))}
              {livre && (pode
                ? <button className="agenda-livre" onClick={() => aoNovo(h)}>+ Livre{livre.vagas > 1 ? ` (${livre.vagas} vagas)` : ''}</button>
                : <span className="agenda-livre">Livre</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Dados do agendamento para abrir a venda já preenchida
const paraVenda = (a) => ({
  id: a.id, loja_id: a.loja_id, placa: a.placa || '', servico_id: a.servico_id || '',
  cliente: a.cliente_id ? { id: a.cliente_id, nome: a.cliente_nome, cpf_cnpj: a.cliente_doc } : null,
  observacao_venda: [`Agendamento de ${quando(a.inicio)}`, !a.cliente_id && a.nome, a.telefone && mascaraTelefone(String(a.telefone).replace(/^55/, '')),
    a.observacao].filter(Boolean).join(' · '),
});

function Cartao({ a, historico = [], pode, aoEditar, aoMudar, aoConfirmar, aoVenda, aoNovaVenda }) {
  return (
    <div className={`agenda-cartao ag-${a.situacao}`}>
      <div className="agenda-cartao-topo">
        <strong>{a.nome}</strong>
        {a.placa && <Placa placa={a.placa} tamanho="mini" />}
        {a.origem === 'whatsapp' && <span className="selo-robo" title="Agendado pelo robô do WhatsApp">🤖 WhatsApp</span>}
      </div>
      <div className="cinza agenda-detalhe">
        {[a.servico, a.telefone && mascaraTelefone(String(a.telefone).replace(/^55/, '')),
          a.confirmacao_etapa ? 'aguardando a resposta do cliente' : a.confirmacao_em && 'confirmação enviada'].filter(Boolean).join(' · ')}
      </div>
      {historico.length > 0 && (
        <ul className="agenda-historico">
          {historico.map((h) => <li key={h.id}>{textoHistorico(h)}</li>)}
        </ul>
      )}
      {a.observacao && <div className="cinza agenda-detalhe">{a.observacao}</div>}
      <div className="agenda-acoes">
        {pode ? (
          <select value={a.situacao} onChange={(e) => aoMudar(a, { situacao: e.target.value })} aria-label="Situação">
            {Object.entries(SITUACOES_AGENDA).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        ) : <span className={`selo-sit ag-${a.situacao}`}>{SITUACOES_AGENDA[a.situacao]}</span>}
        {a.venda_id && <button className="botao-link" onClick={() => aoVenda?.(a.venda_id)}>Venda nº {a.venda_numero}</button>}
        {!a.venda_id && aoNovaVenda && a.situacao !== 'cancelado' && <button className="botao-link" onClick={() => aoNovaVenda(paraVenda(a))}>Abrir venda</button>}
        {pode && a.telefone && a.situacao !== 'cancelado' && <button className="botao-link" onClick={() => aoConfirmar(a)}>Mandar confirmação</button>}
        {pode && <button className="botao-link" onClick={() => aoEditar(a)}>Editar / remarcar</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ semana
// semana (7 dias) ou mês (as semanas do mês; os dias de fora ficam apagados)
function Semana({ de, d, aoDia, dias: total = 7, mes = null }) {
  const dias = Array.from({ length: total }, (_, i) => somar(de, i));
  const MAX = mes ? 3 : 99;
  return (
    <div className={`agenda-semana${mes ? ' agenda-mes' : ''}`}>
      {mes && SEMANA.map((n) => <span key={n} className="agenda-mes-cab">{n.slice(0, 3)}</span>)}
      {dias.map((x) => {
        const ags = d.agendamentos.filter((a) => diaSP(a.inicio) === x && a.situacao !== 'cancelado');
        const livres = d.livres.filter((l) => diaSP(l.inicio) === x).length;
        const bloq = d.bloqueios.some((b) => diaSP(b.inicio) <= x && diaSP(b.fim) >= x);
        return (
          <button key={x} className={`agenda-col${x === hoje() ? ' hoje' : ''}${mes && !x.startsWith(mes) ? ' fora-mes' : ''}`} onClick={() => aoDia(x)}>
            <span className="agenda-col-dia">{mes ? Number(x.slice(8)) : `${SEMANA[new Date(`${x}T12:00:00`).getDay()].slice(0, 3)} ${x.slice(8)}/${x.slice(5, 7)}`}</span>
            {ags.slice(0, MAX).map((a) => <span key={a.id} className={`agenda-mini ag-${a.situacao}`}>{horaSP(a.inicio)} {a.nome.split(' ')[0]}{a.placa ? ` · ${a.placa}` : ''}</span>)}
            {ags.length > MAX && <span className="agenda-mini-mais">+{ags.length - MAX} agendamento(s)</span>}
            {mes && ags.length > 0 && <span className="agenda-mes-qtd">{ags.length} agend.</span>}
            <span className="cinza agenda-col-livres">{bloq && !livres ? 'bloqueado' : livres ? `${livres} livre${livres > 1 ? 's' : ''}` : '—'}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ novo / editar
function Editor({ perfil, loja, servicos, colunas = [], agendamento, inicial, aoFechar, aoSalvar }) {
  const a = agendamento;
  const [f, setF] = useState({
    nome: a?.nome || '', telefone: a?.telefone ? mascaraTelefone(String(a.telefone).replace(/^55/, '')) : '', placa: a?.placa || '',
    servico_id: a?.servico_id || '', observacao: a?.observacao || '',
    dia: a ? diaSP(a.inicio) : inicial?.dia || hoje(), hora: a ? horaSP(a.inicio) : inicial?.hora || '',
    encaixe: false, enviar_whatsapp: false, cpf_cnpj: a?.cliente_doc ? formatarDoc(a.cliente_doc) : '',
  });
  // cliente do cadastro: achado pelo CPF/CNPJ ou escolhido na busca pelo nome (nunca cadastra duplicado)
  const [cliente, setCliente] = useState(a?.cliente_id ? { id: a.cliente_id, nome: a.cliente_nome, cpf_cnpj: a.cliente_doc } : null);
  const [docAviso, setDocAviso] = useState('');
  const [sugestoes, setSugestoes] = useState([]);
  const [cadastrando, setCadastrando] = useState(false); // tela completa de cadastro de cliente (com preços especiais)
  const empresa = perfil.lojas.find((l) => l.id === loja)?.empresa_id;
  const lojasCadastro = perfil.lojas.filter((l) => l.empresa_id === empresa && criarTem(perfil, l.id)('clientes.editar'));
  const [livres, setLivres] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  // agendamento novo com celular: antes de gravar, escolhe a coluna do chamado no WhatsApp
  const [escolhendo, setEscolhendo] = useState(null); // { coluna_id, enviar_whatsapp }
  const mudar = (c) => setF((x) => ({ ...x, ...c }));

  useEffect(() => {
    if (!f.dia) return;
    api(`/agenda?loja=${loja}&de=${f.dia}&ate=${f.dia}`).then((r) => setLivres(r.livres.map((l) => horaSP(l.inicio)))).catch(() => setLivres([]));
  }, [f.dia]);
  // horário atual do agendamento continua valendo ao editar
  const opcoes = [...new Set([...(livres || []), ...(a && diaSP(a.inicio) === f.dia ? [horaSP(a.inicio)] : [])])].sort();

  const usar = (c) => {
    setCliente(c); setSugestoes([]); setDocAviso('');
    mudar({ nome: c.nome, cpf_cnpj: c.cpf_cnpj ? formatarDoc(c.cpf_cnpj) : '',
      telefone: f.telefone || (c.whatsapp || c.telefone ? mascaraTelefone(String(c.whatsapp || c.telefone).replace(/^55(?=\d{10,11}$)/, '')) : '') });
  };

  // CPF/CNPJ completo: procura no cadastro do grupo
  async function mudarDoc(valor) {
    const d = valor.replace(/\D/g, '');
    const doc = d.length > 11 ? mascaraCnpj(valor) : mascaraCpf(valor);
    mudar({ cpf_cnpj: doc }); setCliente(null); setDocAviso('');
    if (d.length !== 11 && d.length !== 14) return;
    if (!(d.length === 11 ? cpfValido(d) : cnpjValido(d))) { setDocAviso(`${d.length === 11 ? 'CPF' : 'CNPJ'} inválido. Confira os números.`); return; }
    try {
      const achado = (await api(`/clientes?loja=${loja}&busca=${d}`)).find((c) => c.cpf_cnpj === d);
      if (achado) usar(achado); else setDocAviso('Cliente novo, ainda sem cadastro.');
    } catch { /* sem busca: o servidor confere de novo ao salvar */ }
  }

  // nome: mostra os clientes já cadastrados parecidos, para não cadastrar de novo
  useEffect(() => {
    if (cliente || f.nome.trim().length < 3) { setSugestoes([]); return undefined; }
    const t = setTimeout(() => api(`/clientes?loja=${loja}&venda=1&busca=${encodeURIComponent(f.nome.trim())}`)
      .then((l) => setSugestoes(l.filter((c) => c.tipo !== 'avulso').slice(0, 6))).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [f.nome, cliente]);

  async function salvar(e) {
    e.preventDefault(); setErro('');
    if (!f.hora) { setErro('Escolha o horário.'); return; }
    const d = f.cpf_cnpj.replace(/\D/g, '');
    if (d && !(d.length === 11 ? cpfValido(d) : d.length === 14 && cnpjValido(d))) { setErro('CPF ou CNPJ inválido. Confira os números.'); return; }
    if (!a && f.telefone.replace(/\D/g, '').length >= 10 && colunas.length) {
      setEscolhendo({ coluna_id: colunas[0].id, enviar_whatsapp: true });
      return;
    }
    gravar({ enviar_whatsapp: f.enviar_whatsapp && Boolean(a) });
  }

  async function gravar(extra) {
    setErro(''); setSalvando(true);
    const d = f.cpf_cnpj.replace(/\D/g, '');
    const corpo = {
      loja_id: loja, nome: f.nome, telefone: f.telefone, placa: f.placa, servico_id: f.servico_id || null, observacao: f.observacao,
      inicio: instanteSP(f.dia, f.hora), encaixe: f.encaixe, ...extra,
      ...(cliente ? { cliente_id: cliente.id } : { cpf_cnpj: d }),
    };
    try {
      const r = a ? await api(`/agenda/${a.id}`, { metodo: 'PUT', corpo }) : await api('/agenda', { metodo: 'POST', corpo });
      aoSalvar(r.aviso || (a ? 'Agendamento salvo.' : extra.enviar_whatsapp ? 'Agendado e confirmação enviada pelo WhatsApp.' : 'Agendado.'));
    } catch (falha) { setErro(falha.message); setSalvando(false); setEscolhendo(null); }
  }

  return (
    <>
    <Janela titulo={a ? 'Editar agendamento' : 'Agendar vistoria'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <label>CPF ou CNPJ
          <input value={f.cpf_cnpj} inputMode="numeric" placeholder="Para achar o cadastro (ou cadastrar o cliente)" onChange={(e) => mudarDoc(e.target.value)} />
        </label>
        {cliente
          ? <small className="aviso-receita">Cliente cadastrado: <strong>{cliente.nome}</strong>{' '}
              <button type="button" className="botao-link" onClick={() => { setCliente(null); mudar({ cpf_cnpj: '' }); }}>trocar</button></small>
          : (docAviso || lojasCadastro.length > 0) && (
            <small className="aviso-receita">{docAviso}{' '}
              {lojasCadastro.length > 0 && <button type="button" className="botao-link" onClick={() => setCadastrando(true)}>Novo cadastro</button>}
            </small>
          )}
        <label>Nome do cliente
          <span className="campo-cliente">
            <input value={f.nome} required readOnly={Boolean(cliente)} onChange={(e) => mudar({ nome: e.target.value.toUpperCase() })}
              onBlur={() => setTimeout(() => setSugestoes([]), 200)} />
            {sugestoes.length > 0 && (
              <ul className="sugestoes-cliente" role="listbox">
                <li className="cinza sem-cliente">Já cadastrados com esse nome:</li>
                {sugestoes.map((c) => (
                  <li key={c.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => usar(c)}>
                    <strong>{c.nome}</strong><small className="cinza">{formatarDoc(c.cpf_cnpj)}</small>
                  </button></li>
                ))}
              </ul>
            )}
          </span>
        </label>
        <div className="linha-campos dois">
          <label>Celular (WhatsApp)<input value={f.telefone} inputMode="tel" placeholder="(11) 99999-9999" onChange={(e) => mudar({ telefone: mascaraTelefone(e.target.value) })} /></label>
          <label>Placa<input value={f.placa} maxLength={8} onChange={(e) => mudar({ placa: e.target.value.toUpperCase() })} /></label>
        </div>
        <label>Serviço
          <select value={f.servico_id} onChange={(e) => mudar({ servico_id: e.target.value })}>
            <option value="">—</option>
            {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </label>
        <div className="linha-campos dois">
          <label>Dia<CampoData value={f.dia} required onChange={(e) => mudar({ dia: e.target.value, hora: f.encaixe ? f.hora : '' })} /></label>
          <label>Horário
            {f.encaixe
              ? <CampoHora value={f.hora} required onChange={(v) => mudar({ hora: v })} />
              : (
                <select value={f.hora} required onChange={(e) => mudar({ hora: e.target.value })}>
                  <option value="">{livres === null ? 'Carregando…' : opcoes.length ? 'Escolha' : 'Sem horário livre'}</option>
                  {opcoes.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              )}
          </label>
        </div>
        <label className="linha-check"><input type="checkbox" checked={f.encaixe} onChange={(e) => mudar({ encaixe: e.target.checked })} />
          Encaixe (agendar fora dos horários livres)</label>
        <label>Observação<textarea rows={2} value={f.observacao} onChange={(e) => mudar({ observacao: e.target.value })} /></label>
        {a && (
          <label className="linha-check"><input type="checkbox" checked={f.enviar_whatsapp} onChange={(e) => mudar({ enviar_whatsapp: e.target.checked })} />
            Mandar a confirmação pelo WhatsApp</label>
        )}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : a ? 'Salvar' : 'Agendar'}</button>
        </div>
      </form>
    </Janela>
    {escolhendo && (
      <Janela titulo="Chamado no WhatsApp" aoFechar={() => setEscolhendo(null)}>
        <div className="formulario">
          <p>Em qual coluna dos chamados fica o atendimento de <strong>{f.nome}</strong>?</p>
          <div className="escolha-coluna" role="radiogroup">
            {colunas.map((c) => (
              <label key={c.id} className="linha-check">
                <input type="radio" name="coluna" checked={escolhendo.coluna_id === c.id} onChange={() => setEscolhendo({ ...escolhendo, coluna_id: c.id })} />
                {c.nome}
              </label>
            ))}
          </div>
          <label className="linha-check"><input type="checkbox" checked={escolhendo.enviar_whatsapp}
            onChange={(e) => setEscolhendo({ ...escolhendo, enviar_whatsapp: e.target.checked })} />
            Mandar a confirmação pelo WhatsApp para {f.telefone}</label>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={() => setEscolhendo(null)}>Voltar</button>
            <button type="button" className="botao-primario" disabled={salvando} onClick={() => gravar(escolhendo)}>
              {salvando ? 'Agendando…' : escolhendo.enviar_whatsapp ? 'Agendar e enviar' : 'Agendar'}
            </button>
          </div>
        </div>
      </Janela>
    )}
    {cadastrando && (
      <EditorCliente lojas={lojasCadastro} lojaInicial={loja} tipoInicial={f.cpf_cnpj.replace(/\D/g, '').length > 11 ? 'pj' : 'pf'}
        inicial={{ cpf_cnpj: f.cpf_cnpj, nome: f.nome, whatsapp: f.telefone }} aoAbrir={() => {}} aoFechar={() => setCadastrando(false)}
        aoSalvar={async (cid) => {
          setCadastrando(false);
          try { usar(await api(`/clientes/${cid}`)); } catch (falha) { setErro(falha.message); }
        }} />
    )}
    </>
  );
}

// ------------------------------------------------------------ horário de atendimento e bloqueios
function Configurar({ loja, config, aoFechar, aoSalvar }) {
  const [f, setF] = useState({
    ativo: config.ativo, horarios: config.horarios || {}, almoco: Boolean(config.almoco_inicio),
    almoco_inicio: config.almoco_inicio?.slice(0, 5) || '12:00', almoco_fim: config.almoco_fim?.slice(0, 5) || '13:00',
    duracao_min: config.duracao_min, vagas: config.vagas, antecedencia_min: config.antecedencia_min, dias_a_frente: config.dias_a_frente,
  });
  const [bloqueios, setBloqueios] = useState(null);
  const [novoB, setNovoB] = useState({ dia: hoje(), ate: hoje(), de_hora: '', ate_hora: '', motivo: '' });
  const [erro, setErro] = useState('');
  const mudar = (c) => setF((x) => ({ ...x, ...c }));
  const dia = (n, c) => mudar({ horarios: { ...f.horarios, [n]: c && { ...(f.horarios[n] || { abre: '08:00', fecha: '17:00' }), ...c } } });

  const carregarB = () => api(`/agenda?loja=${loja}&de=${hoje()}&ate=${somar(hoje(), 365)}`).then((r) => setBloqueios(r.bloqueios)).catch(() => setBloqueios([]));
  useEffect(() => { carregarB(); }, []);

  async function salvar(e) {
    e.preventDefault(); setErro('');
    const horarios = Object.fromEntries(Object.entries(f.horarios).filter(([, h]) => h));
    try {
      await api('/agenda/config', { metodo: 'PUT', corpo: {
        loja_id: loja, ativo: f.ativo, horarios, almoco_inicio: f.almoco ? f.almoco_inicio : null, almoco_fim: f.almoco ? f.almoco_fim : null,
        duracao_min: Number(f.duracao_min), vagas: Number(f.vagas), antecedencia_min: Number(f.antecedencia_min), dias_a_frente: Number(f.dias_a_frente),
      } });
      aoSalvar('Horários salvos.');
    } catch (falha) { setErro(falha.message); }
  }
  async function bloquear() {
    setErro('');
    const inicio = instanteSP(novoB.dia, novoB.de_hora || '00:00');
    const fim = novoB.ate_hora ? instanteSP(novoB.ate || novoB.dia, novoB.ate_hora) : instanteSP(somar(novoB.ate || novoB.dia, 1), '00:00');
    try {
      await api('/agenda/bloqueios', { metodo: 'POST', corpo: { loja_id: loja, inicio, fim, motivo: novoB.motivo } });
      setNovoB({ ...novoB, motivo: '' }); carregarB();
    } catch (falha) { setErro(falha.message); }
  }
  async function desbloquear(id) {
    try { await api(`/agenda/bloqueios/${id}`, { metodo: 'DELETE' }); carregarB(); } catch (falha) { setErro(falha.message); }
  }

  return (
    <Janela titulo="Horário de atendimento" aoFechar={aoFechar}>
      <form className="formulario agenda-config" onSubmit={salvar}>
        <label className="linha-check"><input type="checkbox" checked={f.ativo} onChange={(e) => mudar({ ativo: e.target.checked })} />
          Agenda aberta (o robô do WhatsApp oferece estes horários)</label>
        <div className="agenda-dias">
          {SEMANA.map((nome, n) => {
            const h = f.horarios[n];
            return (
              <div key={n} className="agenda-dia-config">
                <label className="linha-check"><input type="checkbox" checked={Boolean(h)} onChange={(e) => dia(n, e.target.checked ? {} : null)} />{nome}</label>
                {h ? (
                  <>
                    <CampoHora value={h.abre} aria-label={`${nome}: abre`} onChange={(v) => dia(n, { abre: v })} />
                    <span>às</span>
                    <CampoHora value={h.fecha} aria-label={`${nome}: fecha`} onChange={(v) => dia(n, { fecha: v })} />
                  </>
                ) : <span className="cinza">fechado</span>}
              </div>
            );
          })}
        </div>
        <div className="agenda-dia-config">
          <label className="linha-check"><input type="checkbox" checked={f.almoco} onChange={(e) => mudar({ almoco: e.target.checked })} />Almoço</label>
          {f.almoco && <><CampoHora value={f.almoco_inicio} aria-label="Almoço: início" onChange={(v) => mudar({ almoco_inicio: v })} />
            <span>às</span><CampoHora value={f.almoco_fim} aria-label="Almoço: fim" onChange={(v) => mudar({ almoco_fim: v })} /></>}
        </div>
        <div className="linha-campos dois">
          <label>Duração de cada vistoria (min)<input type="number" min="5" max="480" value={f.duracao_min} onChange={(e) => mudar({ duracao_min: e.target.value })} /></label>
          <label>Vistorias ao mesmo tempo<input type="number" min="1" max="50" value={f.vagas} onChange={(e) => mudar({ vagas: e.target.value })} /></label>
        </div>
        <div className="linha-campos dois">
          <label>Antecedência mínima (min)<input type="number" min="0" value={f.antecedencia_min} onChange={(e) => mudar({ antecedencia_min: e.target.value })} /></label>
          <label>Agenda aberta para os próximos (dias)<input type="number" min="1" max="365" value={f.dias_a_frente} onChange={(e) => mudar({ dias_a_frente: e.target.value })} /></label>
        </div>

        <h3>Bloqueios (feriado, folga, manutenção)</h3>
        {bloqueios === null ? <p className="cinza">Carregando…</p> : bloqueios.length === 0 ? <p className="cinza">Nenhum bloqueio marcado.</p> : (
          <ul className="agenda-bloqueios">
            {bloqueios.map((b) => (
              <li key={b.id}>
                {nomeDia(diaSP(b.inicio), { day: '2-digit', month: '2-digit' })} {horaSP(b.inicio)} até {nomeDia(diaSP(b.fim), { day: '2-digit', month: '2-digit' })} {horaSP(b.fim)}
                {b.motivo ? ` · ${b.motivo}` : ''} <button type="button" className="botao-link" onClick={() => desbloquear(b.id)}>Tirar</button>
              </li>
            ))}
          </ul>
        )}
        <div className="agenda-novo-bloqueio">
          <label>De<CampoData value={novoB.dia} onChange={(e) => setNovoB({ ...novoB, dia: e.target.value, ate: novoB.ate < e.target.value ? e.target.value : novoB.ate })} /></label>
          <label>Hora<CampoHora value={novoB.de_hora} onChange={(v) => setNovoB({ ...novoB, de_hora: v })} /></label>
          <label>Até<CampoData value={novoB.ate} onChange={(e) => setNovoB({ ...novoB, ate: e.target.value })} /></label>
          <label>Hora<CampoHora value={novoB.ate_hora} onChange={(v) => setNovoB({ ...novoB, ate_hora: v })} /></label>
          <label>Motivo<input value={novoB.motivo} placeholder="FERIADO" onChange={(e) => setNovoB({ ...novoB, motivo: e.target.value.toUpperCase() })} /></label>
          <button type="button" className="botao-contorno" onClick={bloquear}>Bloquear</button>
        </div>
        <p className="cinza ajuda">Sem hora, o bloqueio vale o dia inteiro.</p>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario">Salvar horários</button>
        </div>
      </form>
    </Janela>
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
