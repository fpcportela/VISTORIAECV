import { useEffect, useMemo, useState } from 'react';
import { api, moeda } from './api.js';
import { criarTem } from './modulos.js';
import { formatarDoc } from './documentos.js';
import { CampoData } from './Data.jsx';
import { semAcento } from './entrada.js';

// Relatórios: o relatório personalizado (fonte, filtros, colunas e agrupamento, com PDF e
// modelos salvos) e o faturamento de um cliente (marca as vendas e gera a conta a receber).

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const inicioMes = () => `${hojeISO().slice(0, 8)}01`;
const somarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const real = (v) => `R$ ${moeda(v)}`;
const FORMAS = { pix: 'PIX', dinheiro: 'DINHEIRO', cartao_credito: 'CREDITO', cartao_debito: 'DEBITO', boleto: 'BOLETO', transferencia: 'TRANSFERENCIA', faturado: 'FATURADO' };
const SIT_VENDA = { aberta: 'ABERTA', futuro: 'FUTURO', finalizada: 'FINALIZADA', cancelada: 'CANCELADA' };
const SIT_FIN = { em_aberto: 'EM ABERTO', pago_parcial: 'PAGO PARCIAL', pago: 'PAGO', cancelado: 'CANCELADO' };

// Colunas de cada fonte: rótulo, como mostrar, se soma e a largura no PDF
const COLUNAS = {
  vendas: [
    { id: 'numero', nome: 'Nº', valor: (v) => v.numero },
    { id: 'data_venda', nome: 'Data', valor: (v) => dataBR(v.data_venda) },
    { id: 'cliente', nome: 'Cliente', valor: (v) => v.cliente },
    { id: 'cpf_cnpj', nome: 'CPF/CNPJ', valor: (v) => formatarDoc(v.cpf_cnpj) },
    { id: 'grupo_cliente', nome: 'Grupo do cliente', valor: (v) => v.grupo_cliente || '' },
    { id: 'placas', nome: 'Placa', valor: (v) => v.placas || '' },
    { id: 'veiculos', nome: 'Marca/Modelo', valor: (v) => v.veiculos || '' },
    { id: 'servicos', nome: 'Serviços', valor: (v) => v.servicos || '' },
    { id: 'loja', nome: 'Loja', valor: (v) => v.loja },
    { id: 'vendedor', nome: 'Responsável', valor: (v) => v.vendedor || '' },
    { id: 'formas', nome: 'Pagamento', valor: (v) => (v.formas || '').split(',').filter(Boolean).map((f) => FORMAS[f] || f).join(', ') },
    { id: 'situacao', nome: 'Situação', valor: (v) => SIT_VENDA[v.situacao] || v.situacao },
    { id: 'valor_bruto', nome: 'Bruto', soma: true },
    { id: 'desconto', nome: 'Desconto', soma: true },
    { id: 'valor_total', nome: 'Total', soma: true },
    { id: 'a_faturar', nome: 'A receber', soma: true },
  ],
  financeiro: [
    { id: 'vencimento', nome: 'Vencimento', valor: (v) => dataBR(v.vencimento) },
    { id: 'competencia', nome: 'Competência', valor: (v) => (v.competencia ? `${v.competencia.slice(5, 7)}/${v.competencia.slice(0, 4)}` : '') },
    { id: 'pago_em', nome: 'Pago em', valor: (v) => dataBR(v.pago_em) },
    { id: 'tipo', nome: 'Tipo', valor: (v) => (v.tipo === 'receber' ? 'RECEBER' : 'PAGAR') },
    { id: 'descricao', nome: 'Descrição', valor: (v) => `${v.descricao}${v.total_parcelas > 1 ? ` (${v.parcela}/${v.total_parcelas})` : ''}` },
    { id: 'cliente', nome: 'Cliente', valor: (v) => v.cliente || '' },
    { id: 'categoria', nome: 'Categoria', valor: (v) => v.categoria || '' },
    { id: 'centro', nome: 'Centro de custo', valor: (v) => v.centro || '' },
    { id: 'loja', nome: 'Loja', valor: (v) => v.loja },
    { id: 'documento', nome: 'Documento', valor: (v) => v.documento || '' },
    { id: 'status', nome: 'Situação', valor: (v) => (v.vencido ? 'VENCIDO' : SIT_FIN[v.status] || v.status) },
    { id: 'valor', nome: 'Valor', soma: true },
    { id: 'valor_pago', nome: 'Pago', soma: true },
    { id: 'saldo', nome: 'Saldo', soma: true },
  ],
};
const PADRAO = {
  vendas: ['numero', 'data_venda', 'cliente', 'placas', 'veiculos', 'loja', 'situacao', 'valor_total'],
  financeiro: ['vencimento', 'descricao', 'cliente', 'categoria', 'status', 'valor', 'saldo'],
};
const mes = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) : 'SEM DATA');
const GRUPOS = {
  vendas: { '': 'Sem agrupar', cliente: 'Cliente', loja: 'Loja', vendedor: 'Responsável', dia: 'Dia', mes: 'Mês', situacao: 'Situação', formas: 'Pagamento' },
  financeiro: { '': 'Sem agrupar', categoria: 'Categoria', centro: 'Centro de custo', loja: 'Loja', cliente: 'Cliente', mes: 'Mês do vencimento', status: 'Situação', tipo: 'Tipo' },
};
const chaveGrupo = (fonte, g, v) => {
  if (!g) return '';
  if (g === 'dia') return dataBR(v.data_venda);
  if (g === 'mes') return mes(fonte === 'vendas' ? v.data_venda : v.vencimento);
  const col = COLUNAS[fonte].find((c) => c.id === g);
  return (col?.valor ? col.valor(v) : v[g]) || 'SEM INFORMAÇÃO';
};
const celula = (col, v) => (col.soma ? moeda(v[col.id]) : col.valor(v));

export default function Relatorios({ perfil, loja, empresa, logo }) {
  const [aba, setAba] = useState('personalizado');
  const tem = criarTem(perfil, loja);
  const podeFaturar = perfil.lojas.some((l) => criarTem(perfil, l.id)('financeiro.lancar'));
  return (
    <>
      <div className="cabecalho"><h1>Relatórios</h1></div>
      <div className="abas" role="tablist">
        <button role="tab" aria-selected={aba === 'personalizado'} className={aba === 'personalizado' ? 'ativa' : ''} onClick={() => setAba('personalizado')}>Relatório personalizado</button>
        {podeFaturar && <button role="tab" aria-selected={aba === 'faturar'} className={aba === 'faturar' ? 'ativa' : ''} onClick={() => setAba('faturar')}>Faturar cliente</button>}
      </div>
      {aba === 'personalizado'
        ? <Personalizado loja={loja} empresa={empresa} logo={logo} podeFinanceiro={tem('financeiro.ver')} />
        : <Faturar perfil={perfil} loja={loja} />}
    </>
  );
}

// ------------------------------------------------------------ busca de cliente
export function CampoCliente({ cliente, aoEscolher, obrigatorio }) {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState([]);
  const [aberta, setAberta] = useState(false);
  const [buscou, setBuscou] = useState('');
  useEffect(() => {
    if (busca.trim().length < 2) { setLista([]); setBuscou(''); return undefined; }
    const t = setTimeout(() => api(`/clientes?busca=${encodeURIComponent(busca)}`)
      .then((l) => { setLista(l.filter((c) => !(c.tipo === 'avulso' && c.nome === 'CLIENTE PARTICULAR / AVULSO'))); setBuscou(busca); }).catch(() => setLista([])), 300);
    return () => clearTimeout(t);
  }, [busca]);
  if (cliente) {
    return (
      <span className="cliente-escolhido">
        <strong>{cliente.nome}</strong>{cliente.tipo === 'grupo' && <small> (grupo: todas as empresas)</small>}
        <button type="button" className="fechar" onClick={() => aoEscolher(null)} aria-label="Tirar o cliente">×</button>
      </span>
    );
  }
  return (
    <span className="campo-cliente">
      <input type="search" value={busca} placeholder={obrigatorio ? 'Busque o cliente (nome, CPF ou CNPJ)' : 'Todos os clientes'} aria-label="Cliente"
        onChange={(e) => { setBusca(e.target.value); setAberta(true); }} onFocus={() => setAberta(true)} onBlur={() => setTimeout(() => setAberta(false), 200)} />
      {aberta && lista.length > 0 && (
        <ul className="sugestoes-cliente" role="listbox">
          {lista.slice(0, 12).map((c) => (
            <li key={c.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { aoEscolher(c); setBusca(''); }}>
              <strong>{c.nome}</strong>
              <small className="cinza">{c.tipo === 'grupo' ? `Grupo · ${c.empresas} empresa(s)` : formatarDoc(c.cpf_cnpj)}{c.grupo_nome ? ` · ${c.grupo_nome}` : ''}</small>
            </button></li>
          ))}
        </ul>
      )}
      {aberta && buscou === busca && busca.trim().length >= 2 && lista.length === 0 && (
        <ul className="sugestoes-cliente"><li className="cinza sem-cliente">Nenhum cliente cadastrado com esse nome, CPF ou CNPJ
          (o "cliente particular / avulso" genérico não entra no faturamento).</li></ul>
      )}
    </span>
  );
}

// ------------------------------------------------------------ personalizado
function Personalizado({ loja, empresa, logo, podeFinanceiro }) {
  const [fonte, setFonte] = useState('vendas');
  const [f, setF] = useState({ de: inicioMes(), ate: hojeISO(), situacao: '', tipo: '', data: 'vencimento' });
  const [cliente, setCliente] = useState(null);
  const [colunas, setColunas] = useState(PADRAO.vendas);
  const [grupo, setGrupo] = useState('');
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [modelos, setModelos] = useState([]);
  const [aviso, setAviso] = useState('');

  const carregarModelos = () => api('/relatorios/modelos').then(setModelos).catch(() => {});
  useEffect(() => { carregarModelos(); }, []);

  function trocarFonte(nova) {
    setFonte(nova); setColunas(PADRAO[nova]); setGrupo(''); setLinhas(null);
    setF((x) => ({ ...x, situacao: '' }));
  }

  async function gerar(e) {
    e?.preventDefault();
    setCarregando(true); setErro(''); setAviso('');
    const q = new URLSearchParams();
    if (loja) q.set('loja', loja);
    if (cliente) q.set('cliente', cliente.id);
    if (f.de) q.set('de', f.de);
    if (f.ate) q.set('ate', f.ate);
    if (f.situacao) q.set('situacao', f.situacao);
    if (fonte === 'financeiro') { if (f.tipo) q.set('tipo', f.tipo); q.set('data', f.data); }
    try { setLinhas(await api(`/relatorios/${fonte}?${q}`)); } catch (falha) { setErro(falha.message); } finally { setCarregando(false); }
  }

  const cols = COLUNAS[fonte].filter((c) => colunas.includes(c.id));
  const grupos = useMemo(() => {
    if (!linhas) return [];
    const mapa = new Map();
    for (const v of linhas) {
      const k = chaveGrupo(fonte, grupo, v);
      (mapa.get(k) || mapa.set(k, []).get(k)).push(v);
    }
    return [...mapa.entries()];
  }, [linhas, grupo, fonte]);
  const soma = (lista, id) => lista.reduce((t, v) => t + Number(v[id] || 0), 0);

  async function salvarModelo() {
    const nome = window.prompt('Nome do modelo (ex.: VENDAS POR CLIENTE)');
    if (!nome) return;
    try {
      await api('/relatorios/modelos', { metodo: 'POST', corpo: { nome, fonte, config: { colunas, grupo, situacao: f.situacao, tipo: f.tipo, data: f.data } } });
      setAviso(`Modelo ${semAcento(nome)} salvo.`); carregarModelos();
    } catch (falha) { setErro(falha.message); }
  }
  function usarModelo(id) {
    const m = modelos.find((x) => x.id === id);
    if (!m) return;
    setFonte(m.fonte); setColunas(m.config.colunas?.length ? m.config.colunas : PADRAO[m.fonte]); setGrupo(m.config.grupo || '');
    setF((x) => ({ ...x, situacao: m.config.situacao || '', tipo: m.config.tipo || '', data: m.config.data || 'vencimento' }));
    setLinhas(null); setAviso(`Modelo ${m.nome} carregado. Clique em Gerar.`);
  }
  async function excluirModelo(id) {
    const m = modelos.find((x) => x.id === id);
    if (!m || !window.confirm(`Excluir o modelo ${m.nome}?`)) return;
    await api(`/relatorios/modelos/${id}`, { metodo: 'DELETE' }).catch(() => {});
    carregarModelos();
  }

  async function pdf() {
    const { gerarPdfRelatorio } = await import('./relatorioPersonalizado.js');
    const filtros = [f.de || f.ate ? `Período: ${dataBR(f.de) || '...'} a ${dataBR(f.ate) || '...'}` : '', cliente ? `Cliente: ${cliente.nome}` : '',
      f.situacao ? `Situação: ${f.situacao.toUpperCase()}` : '', grupo ? `Agrupado por: ${GRUPOS[fonte][grupo]}` : ''].filter(Boolean);
    await gerarPdfRelatorio({ titulo: fonte === 'vendas' ? 'Relatório de vendas' : 'Relatório financeiro', empresa, logo, filtros, cols, grupos, agrupado: Boolean(grupo) });
  }

  return (
    <>
      <form className="relatorio-config" onSubmit={gerar}>
        <div className="linha-config">
          <label>Fonte
            <select value={fonte} onChange={(e) => trocarFonte(e.target.value)}>
              <option value="vendas">Vendas</option>
              {podeFinanceiro && <option value="financeiro">Contas a pagar e a receber</option>}
            </select>
          </label>
          {fonte === 'financeiro' && (
            <>
              <label>Tipo
                <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                  <option value="">Receber e pagar</option><option value="receber">A receber</option><option value="pagar">A pagar</option>
                </select>
              </label>
              <label>Data por
                <select value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })}>
                  <option value="vencimento">Vencimento</option><option value="competencia">Competência</option><option value="pagamento">Pagamento</option>
                </select>
              </label>
            </>
          )}
          <label>De<CampoData value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
          <label>Até<CampoData value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
          <label>Situação
            <select value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}>
              <option value="">Todas</option>
              {fonte === 'vendas'
                ? Object.entries(SIT_VENDA).map(([k, n]) => <option key={k} value={k}>{n}</option>)
                : [['aberto', 'EM ABERTO'], ['vencido', 'VENCIDO'], ['pago', 'PAGO'], ['cancelado', 'CANCELADO']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          <label className="config-cliente">Cliente<CampoCliente cliente={cliente} aoEscolher={setCliente} /></label>
          <label>Agrupar por
            <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
              {Object.entries(GRUPOS[fonte]).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="colunas-relatorio">
          <legend>Colunas</legend>
          {COLUNAS[fonte].map((c) => (
            <label key={c.id} className="linha-check">
              <input type="checkbox" checked={colunas.includes(c.id)}
                onChange={(e) => setColunas(e.target.checked ? COLUNAS[fonte].map((x) => x.id).filter((id) => id === c.id || colunas.includes(id)) : colunas.filter((x) => x !== c.id))} />
              {c.nome}
            </label>
          ))}
        </fieldset>
        <div className="acoes-relatorio">
          <button className="botao-primario" disabled={carregando}>{carregando ? 'Gerando…' : 'Gerar'}</button>
          <button type="button" className="botao-contorno" disabled={!linhas?.length} onClick={pdf}>Gerar PDF</button>
          <button type="button" className="botao-contorno" onClick={salvarModelo}>Salvar modelo</button>
          {modelos.length > 0 && (
            <select value="" onChange={(e) => usarModelo(e.target.value)} aria-label="Modelos salvos">
              <option value="">Modelos salvos…</option>
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          )}
          {modelos.length > 0 && (
            <select value="" onChange={(e) => excluirModelo(e.target.value)} aria-label="Excluir modelo" className="excluir-modelo">
              <option value="">Excluir modelo…</option>
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          )}
        </div>
      </form>
      {aviso && <p className="aviso-ok" role="status">{aviso}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {linhas && (linhas.length === 0 ? <p className="cinza vazio">Nada encontrado com esses filtros.</p> : (
        <div className="tabela-relatorio-caixa">
          <small className="cinza">{linhas.length} registro(s)</small>
          <table className="tabela-relatorio">
            <thead><tr>{cols.map((c) => <th key={c.id} className={c.soma ? 'num' : ''}>{c.nome}</th>)}</tr></thead>
            <tbody>
              {grupos.map(([k, lista]) => (
                <GrupoLinhas key={k} titulo={grupo ? k : null} lista={lista} cols={cols} soma={soma} />
              ))}
            </tbody>
            <tfoot>
              <tr>{cols.map((c, i) => <td key={c.id} className={c.soma ? 'num' : ''}>{c.soma ? moeda(soma(linhas, c.id)) : i === 0 ? 'TOTAL' : ''}</td>)}</tr>
            </tfoot>
          </table>
        </div>
      ))}
    </>
  );
}

function GrupoLinhas({ titulo, lista, cols, soma }) {
  return (
    <>
      {titulo !== null && <tr className="linha-grupo"><td colSpan={cols.length}>{titulo} <small>({lista.length})</small></td></tr>}
      {lista.map((v) => <tr key={v.id}>{cols.map((c) => <td key={c.id} className={c.soma ? 'num' : ''}>{celula(c, v)}</td>)}</tr>)}
      {titulo !== null && cols.some((c) => c.soma) && (
        <tr className="linha-subtotal">{cols.map((c, i) => <td key={c.id} className={c.soma ? 'num' : ''}>{c.soma ? moeda(soma(lista, c.id)) : i === 0 ? 'Subtotal' : ''}</td>)}</tr>
      )}
    </>
  );
}

// ------------------------------------------------------------ faturar cliente
function Faturar({ perfil, loja }) {
  const [cliente, setCliente] = useState(null);
  const [f, setF] = useState({ de: '', ate: '', situacao: '' });
  const [linhas, setLinhas] = useState(null);
  const [motivos, setMotivos] = useState(null);
  const [marcadas, setMarcadas] = useState(new Set());
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [gerando, setGerando] = useState(false);

  async function buscar(e) {
    e?.preventDefault();
    if (!cliente) return setErro('Escolha o cliente.');
    setErro('');
    const q = new URLSearchParams({ faturar: '1', cliente: cliente.id });
    if (loja) q.set('loja', loja);
    if (f.de) q.set('de', f.de);
    if (f.ate) q.set('ate', f.ate);
    if (f.situacao) q.set('situacao', f.situacao);
    try {
      const l = await api(`/relatorios/vendas?${q}`);
      setLinhas(l); setMarcadas(new Set(l.map((v) => v.id))); setMotivos(null);
      // nada a faturar: mostra por que as vendas do cliente ficaram de fora
      if (!l.length) {
        q.delete('faturar');
        const todas = await api(`/relatorios/vendas?${q}`);
        const conta = {};
        for (const v of todas) {
          const m = v.situacao === 'cancelada' ? 'cancelada(s)' : v.situacao === 'futuro' ? 'FUTURO (falta confirmar)'
            : v.faturada_em ? 'já faturada(s)' : 'já paga(s)';
          conta[m] = (conta[m] || 0) + 1;
        }
        setMotivos({ total: todas.length, conta });
      }
    } catch (falha) { setErro(falha.message); }
  }
  useEffect(() => { setLinhas(null); setMarcadas(new Set()); if (cliente) buscar(); }, [cliente]); // eslint-disable-line react-hooks/exhaustive-deps

  const escolhidas = (linhas || []).filter((v) => marcadas.has(v.id));
  const total = escolhidas.reduce((t, v) => t + Number(v.a_faturar), 0);
  const todas = linhas?.length > 0 && escolhidas.length === linhas.length;
  const marcar = (id, sim) => setMarcadas((m) => { const n = new Set(m); if (sim) n.add(id); else n.delete(id); return n; });

  return (
    <>
      <p className="cinza ajuda">Escolha o cliente para ver as vendas dele que ainda não foram pagas nem faturadas. Marque as que entram e clique em
        "Gerar recebimento": o sistema cria a conta a receber no Financeiro, como previsão. Cada venda só pode ser faturada uma vez.</p>
      <form className="relatorio-config" onSubmit={buscar}>
        <div className="linha-config">
          <label className="config-cliente">Cliente<CampoCliente cliente={cliente} aoEscolher={setCliente} obrigatorio /></label>
          <label>Vendas de<CampoData value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} /></label>
          <label>Até<CampoData value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label>
          <label>Situação
            <select value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}>
              <option value="">Todas</option><option value="aberta">ABERTA</option><option value="finalizada">FINALIZADA</option>
            </select>
          </label>
          <button className="botao-contorno" disabled={!cliente}>Filtrar</button>
        </div>
      </form>
      {aviso && <p className="aviso-ok" role="status">{aviso}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {linhas && (linhas.length === 0 ? (
        <p className="cinza vazio">
          Nenhuma venda a faturar para este cliente{f.de || f.ate ? ' no período' : ''}.
          {motivos && (motivos.total === 0
            ? ` Ele não tem vendas${f.de || f.ate ? ' no período' : ''}${loja ? ' nesta loja (troque a loja no topo para "Todas as lojas")' : ''}.`
            : ` Das ${motivos.total} venda(s) dele: ${Object.entries(motivos.conta).map(([m, n]) => `${n} ${m}`).join(', ')}. Só entram vendas com valor ainda a receber (sem pagamento, ou pagas como "Faturado").`)}
        </p>
      ) : (
        <div className="tabela-relatorio-caixa">
          <table className="tabela-relatorio">
            <thead>
              <tr>
                <th className="marcar"><input type="checkbox" checked={todas} aria-label="Marcar todas"
                  onChange={(e) => setMarcadas(e.target.checked ? new Set(linhas.map((v) => v.id)) : new Set())} /></th>
                <th>Nº</th><th>Data</th><th>Cliente</th><th>Placa</th><th>Marca/Modelo</th><th>Serviços</th><th>Loja</th><th>Pagamento</th>
                <th className="num">Total</th><th className="num">A receber</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((v) => (
                <tr key={v.id} className={marcadas.has(v.id) ? 'marcada' : ''} onClick={(e) => e.target.type !== 'checkbox' && marcar(v.id, !marcadas.has(v.id))}>
                  <td className="marcar"><input type="checkbox" checked={marcadas.has(v.id)} onChange={(e) => marcar(v.id, e.target.checked)} aria-label={`Venda ${v.numero}`} /></td>
                  <td>{v.numero}</td><td>{dataBR(v.data_venda)}</td><td>{v.cliente}</td><td>{v.placas || ''}</td><td>{v.veiculos || ''}</td>
                  <td>{v.servicos || ''}</td><td>{v.loja}</td>
                  <td>{(v.formas || '').split(',').filter(Boolean).map((x) => FORMAS[x] || x).join(', ') || 'SEM PAGAMENTO'}</td>
                  <td className="num">{moeda(v.valor_total)}</td><td className="num">{moeda(v.a_faturar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rodape-faturar">
            <span>{escolhidas.length} de {linhas.length} venda(s) marcada(s) · <strong>{real(total)}</strong></span>
            <button className="botao-primario" disabled={!escolhidas.length} onClick={() => setGerando(true)}>Gerar recebimento</button>
          </div>
        </div>
      ))}
      {gerando && (
        <GerarRecebimento perfil={perfil} cliente={cliente} vendas={escolhidas} total={total}
          aoFechar={() => setGerando(false)}
          aoGerar={(n) => { setGerando(false); setAviso(`Recebimento gerado: ${n} conta(s) a receber no Financeiro, total ${real(total)}.`); buscar(); }} />
      )}
    </>
  );
}

function GerarRecebimento({ perfil, cliente, vendas, total, aoFechar, aoGerar }) {
  const lojaGrupo = vendas[0]?.loja_id;
  const [categorias, setCategorias] = useState([]);
  const [f, setF] = useState({ vencimento: somarDias(hojeISO(), 30), categoria_id: '', descricao: `FATURA ${cliente.nome}`, documento: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const lojas = [...new Set(vendas.map((v) => v.loja))];

  useEffect(() => {
    api(`/financeiro/plano?loja=${lojaGrupo}`).then((l) => {
      const receitas = l.filter((c) => c.tipo === 'receber' && !c.grupo && c.ativo);
      setCategorias(receitas);
      // sugere a categoria de vistoria/serviços, se houver
      const sugerida = receitas.find((c) => /vistori|servi/i.test(c.nome)) || receitas[0];
      setF((x) => ({ ...x, categoria_id: x.categoria_id || sugerida?.id || '' }));
    }).catch((falha) => setErro(falha.message));
  }, [lojaGrupo]);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      const r = await api('/relatorios/faturar', { metodo: 'POST', corpo: { ...f, vendas: vendas.map((v) => v.id) } });
      aoGerar(r.lancamentos.length);
    } catch (falha) { setErro(falha.message); setSalvando(false); }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Gerar recebimento">
        <div className="modal-topo">
          <h2>Gerar recebimento</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <p><strong>{cliente.nome}</strong><br /><span className="cinza">{vendas.length} venda(s) · {real(total)}</span></p>
        <form className="formulario" onSubmit={salvar}>
          <label>Previsão de recebimento (vencimento)<CampoData value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} required /></label>
          <label>Categoria (plano de contas)
            <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })} required>
              <option value="">Escolha…</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} ` : ''}{c.nome}</option>)}
            </select>
          </label>
          <label>Descrição<input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} required maxLength={200} /></label>
          <label>Documento<input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} placeholder="Opcional: nº da fatura, boleto ou NF" /></label>
          {lojas.length > 1 && <p className="cinza ajuda">As vendas são de {lojas.length} lojas: será criada uma conta a receber para cada loja ({lojas.join(', ')}).</p>}
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={salvando}>{salvando ? 'Gerando…' : 'Gerar recebimento'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
