import { useEffect, useState } from 'react';
import { api, moeda, sessao } from './api.js';
import { paraMoeda } from './entrada.js';
import { Icone } from './icones.jsx';
import { criarTem } from './modulos.js';
import { CampoData, CampoMes } from './Data.jsx';
import { abrirArquivo } from './Colaboradores.jsx';

// Financeiro: contas a receber e a pagar (com parcelas, pagamento parcial,
// categoria do plano de contas e centro de custo), o plano de contas e os centros de custo.

const FUSO = 'America/Sao_Paulo';
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const numero = (v) => Number(String(v ?? '').replace(/\./g, (m, i, t) => (t.includes(',') ? '' : m)).replace(',', '.')) || 0;
const mes = (desloc = 0) => {
  const [a, m] = hoje().split('-').map(Number);
  const ini = new Date(Date.UTC(a, m - 1 + desloc, 1));
  const fim = new Date(Date.UTC(a, m + desloc, 0));
  return [ini.toISOString().slice(0, 10), fim.toISOString().slice(0, 10)];
};
const CARTAO = ['cartao_credito', 'cartao_debito'];
export const FORMAS = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', boleto: 'Boleto', transferencia: 'Transferência', faturado: 'Faturado' };
const SITUACOES = { em_aberto: 'Em aberto', pago_parcial: 'Pago em parte', pago: 'Pago', cancelado: 'Cancelado' };

export default function Financeiro({ perfil, loja, abaInicial = 'receber', novoInicial = false, aoVenda }) {
  const pode = (p, l = loja) => criarTem(perfil, l)(p);
  const lojasLancar = perfil.lojas.filter((l) => pode('financeiro.lancar', l.id));
  const podePlano = perfil.lojas.some((l) => pode('financeiro.plano', l.id));
  const [aba, setAba] = useState(abaInicial);
  // plano de contas e centros são do grupo: usa a loja escolhida ou a primeira
  const lojaGrupo = loja || perfil.lojas.find((l) => pode('financeiro.ver', l.id))?.id;
  const [plano, setPlano] = useState([]);
  const [centros, setCentros] = useState([]);
  const [erro, setErro] = useState('');

  const carregarCadastros = () => lojaGrupo && Promise.all([api(`/financeiro/plano?loja=${lojaGrupo}`), api(`/financeiro/centros?loja=${lojaGrupo}`)])
    .then(([p, c]) => { setPlano(p); setCentros(c); }).catch((f) => setErro(f.message));
  useEffect(() => { carregarCadastros(); }, [lojaGrupo]);

  const abas = [['receber', 'A receber'], ['pagar', 'A pagar'], ['contas', 'Contas (caixa e bancos)'], ['plano', 'Plano de contas'], ['centros', 'Centros de custo']];
  return (
    <>
      <div className="cabecalho"><h1>Financeiro</h1></div>
      <div className="abas" role="tablist">
        {abas.map(([v, n]) => <button key={v} role="tab" aria-selected={aba === v} className={aba === v ? 'ativa' : ''} onClick={() => setAba(v)}>{n}</button>)}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {aba === 'receber' || aba === 'pagar' ? (
        <Lancamentos key={aba} tipo={aba} loja={loja} perfil={perfil} lojasLancar={lojasLancar} plano={plano} centros={centros} novoInicial={novoInicial} aoVenda={aoVenda} />
      ) : aba === 'contas' ? (
        <ContasFinanceiras loja={lojaGrupo} perfil={perfil} lojasLancar={lojasLancar} />
      ) : aba === 'plano' ? (
        <PlanoContas loja={lojaGrupo} plano={plano} podeEditar={podePlano} aoMudar={carregarCadastros} />
      ) : (
        <CentrosCusto loja={lojaGrupo} centros={centros} podeEditar={podePlano} aoMudar={carregarCadastros} />
      )}
    </>
  );
}

// Categorias em ordem do plano: "4.01 Aluguel", agrupadas por grupo
function OpcoesCategoria({ plano, tipo, comGrupos = false }) {
  const grupos = plano.filter((c) => c.grupo && c.tipo === tipo && c.ativo);
  return grupos.map((g) => (
    <optgroup key={g.id} label={`${g.codigo ? `${g.codigo} ` : ''}${g.nome}`}>
      {comGrupos && <option value={g.id}>Todo o grupo {g.nome}</option>}
      {plano.filter((c) => c.pai_id === g.id && c.ativo).map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} ` : ''}{c.nome}</option>)}
    </optgroup>
  ));
}

// ---------------------------------------------------------------------------
// Lista de contas a receber / a pagar
// ---------------------------------------------------------------------------
function Lancamentos({ tipo, loja, perfil, lojasLancar, plano, centros, novoInicial, aoVenda }) {
  const [[de, ate], setIntervalo] = useState(mes());
  const [situacao, setSituacao] = useState('');
  const [categoria, setCategoria] = useState('');
  const [centro, setCentro] = useState('');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(novoInicial ? null : undefined); // undefined = fechado; null = novo; id
  const receita = tipo === 'receber';

  const carregar = () => {
    const q = new URLSearchParams({ tipo, ...(loja && { loja }), ...(de && { de }), ...(ate && { ate }), ...(situacao && { situacao }),
      ...(categoria && { categoria }), ...(centro && { centro }), ...(busca.trim() && { busca: busca.trim() }) });
    api(`/financeiro/lancamentos?${q}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message));
  };
  useEffect(() => { const t = setTimeout(carregar, busca ? 300 : 0); return () => clearTimeout(t); }, [tipo, loja, de, ate, situacao, categoria, centro, busca]);

  const validos = (lista || []).filter((l) => l.status !== 'cancelado');
  const soma = (f) => validos.filter(f).reduce((t, l) => t + (l.valor - l.valor_pago), 0);
  const resumo = [
    ['Vencidos', soma((l) => l.vencido), 'negativo'],
    ['Em aberto', soma((l) => l.status !== 'pago'), ''],
    [receita ? 'Recebido' : 'Pago', validos.reduce((t, l) => t + l.valor_pago, 0), 'positivo'],
    ['Total do período', validos.reduce((t, l) => t + l.valor, 0), ''],
  ];
  const periodos = [['Este mês', mes()], ['Mês passado', mes(-1)], ['Próximo mês', mes(1)], ['Todos', ['', '']]];

  return (
    <>
      <div className="cabecalho-secao">
        <div className="resumo-fin">
          {resumo.map(([n, v, c]) => <span key={n} className="cartao"><small>{n}</small><strong className={c}>R$ {moeda(v)}</strong></span>)}
        </div>
        {lojasLancar.length > 0 && (
          <button className="botao-primario" onClick={() => setAberto(null)}><Icone nome="mais" tamanho={18} /> {receita ? 'Nova receita' : 'Nova despesa'}</button>
        )}
      </div>
      <div className="filtros">
        <div className="abas" role="tablist">
          {periodos.map(([n, p]) => (
            <button key={n} role="tab" aria-selected={p[0] === de && p[1] === ate} className={p[0] === de && p[1] === ate ? 'ativa' : ''} onClick={() => setIntervalo(p)}>{n}</button>
          ))}
        </div>
        <label className="filtro-data">De<CampoData value={de} onChange={(e) => setIntervalo([e.target.value, ate])} aria-label="De" /></label>
        <label className="filtro-data">Até<CampoData value={ate} onChange={(e) => setIntervalo([de, e.target.value])} aria-label="Até" /></label>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="aberto">Em aberto</option><option value="vencido">Vencidos</option>
          <option value="pago">{receita ? 'Recebidos' : 'Pagos'}</option><option value="cancelado">Cancelados</option>
        </select>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          <OpcoesCategoria plano={plano} tipo={tipo} comGrupos />
        </select>
        <select value={centro} onChange={(e) => setCentro(e.target.value)} aria-label="Centro de custo">
          <option value="">Todos os centros de custo</option>
          {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Descrição ou documento" aria-label="Buscar" />
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? (
        <p className="cinza vazio">Nenhuma conta {receita ? 'a receber' : 'a pagar'} com esses filtros.</p>
      ) : (
        <div className="tabela-fin" role="table">
          <div className="tf-linha tf-cabecalho" role="row">
            <span>Vencimento</span><span>Descrição</span><span>Categoria</span><span>Centro de custo</span><span>Valor</span><span>Situação</span>
          </div>
          {lista.map((l) => (
            <button key={l.id} className={`tf-linha${l.status === 'cancelado' ? ' cancelado' : ''}`} role="row" onClick={() => setAberto(l.id)}>
              <span className={l.vencido ? 'negativo' : ''}>{dataBR(l.vencimento)}</span>
              <span className="tf-desc"><strong>{l.descricao}</strong>
                <small className="cinza">{l.total_parcelas > 1 && `Parcela ${l.parcela}/${l.total_parcelas}`}{l.documento && ` · Doc. ${l.documento}`}{!loja && ` · ${l.loja}`}</small>
              </span>
              <span data-rotulo="Categoria">{l.categoria_codigo ? `${l.categoria_codigo} ` : ''}{l.categoria}</span>
              <span data-rotulo="Centro">{l.centro || '—'}</span>
              <span className="tf-valor">R$ {moeda(l.valor)}{l.valor_pago > 0 && l.status !== 'pago' && <small className="cinza">falta R$ {moeda(l.valor - l.valor_pago)}</small>}</span>
              <span><EtiquetaFin l={l} receita={receita} /></span>
            </button>
          ))}
        </div>
      )}
      {aberto !== undefined && (
        <EditorLancamento id={aberto} tipo={tipo} loja={loja} perfil={perfil} lojasLancar={lojasLancar} plano={plano} centros={centros} aoVenda={aoVenda}
          aoFechar={() => { setAberto(undefined); carregar(); }} aoSalvar={() => { setAberto(undefined); carregar(); }} />
      )}
    </>
  );
}

function EtiquetaFin({ l, receita }) {
  if (l.vencido) return <span className="etiqueta fin-vencido">Vencido</span>;
  const nome = l.status === 'pago' ? (receita ? 'Recebido' : 'Pago') : l.status === 'pago_parcial' ? (receita ? 'Recebido em parte' : 'Pago em parte') : SITUACOES[l.status];
  return <span className={`etiqueta fin-${l.status}`}>{nome}</span>;
}

// ---------------------------------------------------------------------------
// Novo lançamento / detalhe (edição, receber/pagar, cancelar, excluir)
// ---------------------------------------------------------------------------
function EditorLancamento({ id, tipo, loja, perfil, lojasLancar, plano, centros, aoVenda, aoFechar, aoSalvar }) {
  const receita = tipo === 'receber';
  const [l, setL] = useState(null);
  const lojaPadrao = lojasLancar.some((x) => x.id === loja) ? loja : lojasLancar[0]?.id || '';
  const centroDaLoja = (lj) => centros.find((c) => c.loja_id === lj && c.ativo)?.id || '';
  const [f, setF] = useState({ loja_id: lojaPadrao, descricao: '', categoria_id: '', centro_custo_id: centroDaLoja(lojaPadrao),
    valor: '', vencimento: hoje(), competencia: `${hoje().slice(0, 7)}-01`, parcelas: '1', documento: '', observacoes: '', forma_pagamento: '', cv: '' });
  const [novosArquivos, setNovosArquivos] = useState([]); // { arquivo, nome } anexados ao lançar
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try {
      const d = await api(`/financeiro/lancamentos/${id}`);
      setL(d);
      setF({ loja_id: d.loja_id, descricao: d.descricao, categoria_id: d.categoria_id || '', centro_custo_id: d.centro_custo_id || '',
        valor: paraMoeda(d.valor), vencimento: d.vencimento, competencia: d.competencia, parcelas: '1',
        documento: d.documento || '', observacoes: d.observacoes || '', forma_pagamento: d.forma_pagamento || '', cv: d.cv || '' });
    } catch (falha) {
      setErro(falha.message);
    }
  }
  useEffect(() => { if (id) carregar(); }, [id]);
  // os centros de custo podem chegar depois de abrir: sugere o da loja
  useEffect(() => {
    if (!id && centros.length) setF((x) => (x.centro_custo_id ? x : { ...x, centro_custo_id: centroDaLoja(x.loja_id) }));
  }, [centros]);

  const editavel = !id || (l?.pode.lancar && l.status !== 'cancelado');
  const muda = (campo) => (e) => {
    const v = e.target.value;
    setF((x) => {
      const novo = { ...x, [campo]: v };
      // sem campo Loja: a loja do lançamento é a do centro de custo (se for de uma loja em que a pessoa lança)
      if (campo === 'centro_custo_id' && !id) {
        const lj = centros.find((c) => c.id === v)?.loja_id;
        novo.loja_id = lojasLancar.some((x2) => x2.id === lj) ? lj : lojaPadrao;
      }
      return novo;
    });
  };
  const valorParcela = numero(f.valor) / Math.max(1, Number(f.parcelas) || 1);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      const corpo = { ...f, tipo, valor: numero(f.valor) };
      if (id) await api(`/financeiro/lancamentos/${id}`, { metodo: 'PUT', corpo });
      else {
        const { ids } = await api('/financeiro/lancamentos', { metodo: 'POST', corpo });
        // documentos escolhidos antes de lançar vão para a 1ª parcela
        for (const a of novosArquivos) await enviarArquivo(ids[0], a);
      }
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  const acao = async (fn, confirmar) => {
    if (confirmar && !confirm(confirmar)) return;
    setErro('');
    try { await fn(); } catch (falha) { setErro(falha.message); }
  };
  const cancelar = () => acao(async () => { await api(`/financeiro/lancamentos/${id}/cancelar`, { metodo: 'POST' }); aoSalvar(); }, 'Cancelar este lançamento?');
  const excluir = () => acao(async () => { await api(`/financeiro/lancamentos/${id}`, { metodo: 'DELETE' }); aoSalvar(); }, 'Excluir este lançamento? Não dá para desfazer.');
  const desfazer = (b) => acao(async () => { await api(`/financeiro/lancamentos/${id}/baixas/${b.id}`, { metodo: 'DELETE' }); carregar(); },
    `Desfazer o ${receita ? 'recebimento' : 'pagamento'} de R$ ${moeda(b.valor)}?`);

  const titulo = id ? (l ? l.descricao : 'Carregando…') : receita ? 'Nova receita (a receber)' : 'Nova despesa (a pagar)';
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal largo" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h2>{titulo}</h2>
          {l && <EtiquetaFin l={{ ...l, vencido: ['em_aberto', 'pago_parcial'].includes(l.status) && l.vencimento < hoje() }} receita={receita} />}
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {id && !l ? <p className="cinza">{erro || 'Carregando…'}</p> : (
          <>
            {l && l.total_parcelas > 1 && <p className="cinza">Parcela {l.parcela} de {l.total_parcelas}</p>}
            {l?.vendas?.length > 0 && aoVenda && (
              <p className="links-venda">{l.vendas.length > 1 ? 'Vendas:' : 'Venda:'}
                {l.vendas.map((v) => <button key={v.id} type="button" className="botao-texto" onClick={() => aoVenda(v.id)}>nº {v.numero} ↗</button>)}
              </p>
            )}
            {l && (
              <div className="saldo-lancamento">
                <span>Valor<strong>R$ {moeda(l.valor)}</strong></span>
                <span>{receita ? 'Recebido' : 'Pago'}<strong className="positivo">R$ {moeda(l.valor_pago)}</strong></span>
                <span>Falta<strong className={l.valor > l.valor_pago ? 'negativo' : ''}>R$ {moeda(l.valor - l.valor_pago)}</strong></span>
                {l.pode.lancar && ['em_aberto', 'pago_parcial'].includes(l.status) && (
                  <button className="botao-primario" onClick={() => setBaixando(true)}>{receita ? 'Receber' : 'Pagar'}</button>
                )}
              </div>
            )}
            <form className="formulario" onSubmit={salvar}>
              <fieldset className="sem-borda" disabled={!editavel}>
                <label>Descrição<input value={f.descricao} onChange={muda('descricao')} required placeholder={receita ? 'Ex.: Vistorias faturadas — Transportadora X' : 'Ex.: Aluguel da loja'} /></label>
                <div className="dados-veiculo">
                  <label>Categoria
                    <select value={f.categoria_id} onChange={muda('categoria_id')} required>
                      <option value="">Escolha…</option>
                      <OpcoesCategoria plano={plano} tipo={tipo} />
                    </select>
                  </label>
                  <label>Centro de custo
                    <select value={f.centro_custo_id} onChange={muda('centro_custo_id')}>
                      <option value="">Sem centro de custo</option>
                      {centros.filter((c) => c.ativo || c.id === f.centro_custo_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </label>
                  <label>{id ? 'Valor (R$)' : 'Valor total (R$)'}<input value={f.valor} onChange={muda('valor')} inputMode="numeric" data-moeda required placeholder="0,00" /></label>
                  <label>{!id && Number(f.parcelas) > 1 ? '1º vencimento' : 'Vencimento'}<CampoData value={f.vencimento} onChange={muda('vencimento')} required /></label>
                  <label>Competência<CampoMes value={f.competencia} onChange={muda('competencia')} /></label>
                  {!id && (
                    <label>Parcelas
                      <select value={f.parcelas} onChange={muda('parcelas')}>
                        {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'À vista (1x)' : `${n}x mensais`}</option>)}
                      </select>
                    </label>
                  )}
                  <label>Documento<input value={f.documento} onChange={muda('documento')} placeholder="Nº da nota, boleto…" /></label>
                  {id && (
                    <label>Forma de pagamento
                      <select value={f.forma_pagamento} onChange={muda('forma_pagamento')}>
                        <option value="">Não informada</option>
                        {Object.entries(FORMAS).filter(([v]) => v !== 'faturado' || l?.origem !== 'venda' || f.forma_pagamento === v)
                          .map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                      </select>
                    </label>
                  )}
                  {id && CARTAO.includes(f.forma_pagamento) && <label>CV (comprovante da maquininha)<input value={f.cv} onChange={muda('cv')} maxLength={40} placeholder="Nº do CV" /></label>}
                </div>
                {l?.origem === 'venda' && <small className="cinza">Ao trocar a forma de pagamento ou o CV, o pagamento da venda é ajustado junto e fica no histórico dela.</small>}
                {!id && Number(f.parcelas) > 1 && numero(f.valor) > 0 && (
                  <small className="cinza">{f.parcelas} parcelas de cerca de R$ {moeda(valorParcela)}, uma por mês.</small>
                )}
                <label>Observações<textarea rows={2} value={f.observacoes} onChange={muda('observacoes')} /></label>
              </fieldset>
              <Documentos id={id} arquivos={l?.arquivos || []} podeEditar={editavel} temCliente={Boolean(l?.cliente_id)} novos={novosArquivos} aoNovos={setNovosArquivos}
                aoMudar={carregar} aoErro={setErro} />
              {erro && <p className="erro" role="alert">{erro}</p>}
              <div className="acoes-modal">
                {l?.pode.excluir && l.valor_pago === 0 && <button type="button" className="botao-contorno perigo" onClick={excluir}>Excluir</button>}
                {l?.pode.lancar && l.valor_pago === 0 && l.status !== 'cancelado' && <button type="button" className="botao-contorno" onClick={cancelar}>Cancelar lançamento</button>}
                <button type="button" className="botao-contorno" onClick={aoFechar}>Fechar</button>
                {editavel && <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : id ? 'Salvar alterações' : 'Lançar'}</button>}
              </div>
            </form>
            {l?.baixas.length > 0 && (
              <fieldset className="grupo-permissoes">
                <legend>{receita ? 'Recebimentos' : 'Pagamentos'}</legend>
                <ul className="lista-arquivos">
                  {l.baixas.map((b) => (
                    <li key={b.id}>
                      <strong>R$ {moeda(b.valor)}</strong>
                      <span>{dataBR(b.data)} · {FORMAS[b.forma_pagamento]} · {b.conta}</span>
                      <small className="cinza">
                        {[b.juros > 0 && `juros R$ ${moeda(b.juros)}`, b.multa > 0 && `multa R$ ${moeda(b.multa)}`, b.desconto > 0 && `desconto R$ ${moeda(b.desconto)}`, b.usuario].filter(Boolean).join(' · ')}
                      </small>
                      {l.pode.excluir && <button type="button" className="botao-texto perigo" onClick={() => desfazer(b)}>Desfazer</button>}
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
          </>
        )}
        {baixando && l && <Baixa l={l} receita={receita} aoFechar={() => setBaixando(false)} aoSalvar={() => { setBaixando(false); carregar(); }} />}
      </section>
    </div>
  );
}

function Baixa({ l, receita, aoFechar, aoSalvar }) {
  const [contas, setContas] = useState([]);
  const [f, setF] = useState({ data: hoje(), valor: paraMoeda(Math.round((l.valor - l.valor_pago) * 100) / 100),
    forma_pagamento: l.forma_pagamento && !(l.origem === 'venda' && l.forma_pagamento === 'faturado') ? l.forma_pagamento : 'pix', cv: l.cv || '',
    conta_id: '', juros: '', multa: '', desconto: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    api(`/financeiro/contas?loja=${l.loja_id}`).then((c) => { setContas(c); setF((x) => ({ ...x, conta_id: x.conta_id || c[0]?.id || '' })); })
      .catch((falha) => setErro(falha.message));
  }, [l.loja_id]);
  const muda = (campo) => (e) => setF({ ...f, [campo]: e.target.value });

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      await api(`/financeiro/lancamentos/${l.id}/baixar`, { metodo: 'POST',
        corpo: { ...f, valor: numero(f.valor), juros: numero(f.juros), multa: numero(f.multa), desconto: numero(f.desconto) } });
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={receita ? 'Receber' : 'Pagar'}>
        <div className="modal-topo">
          <h2>{receita ? 'Receber' : 'Pagar'} · {l.descricao}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={salvar}>
          <div className="dados-veiculo">
            <label>Data<CampoData value={f.data} onChange={muda('data')} required /></label>
            <label>Valor (R$)<input value={f.valor} onChange={muda('valor')} inputMode="numeric" data-moeda required /></label>
            <label>Forma de pagamento
              <select value={f.forma_pagamento} onChange={muda('forma_pagamento')}>
                {Object.entries(FORMAS).filter(([v]) => v !== 'faturado' || l.origem !== 'venda').map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
            </label>
            {CARTAO.includes(f.forma_pagamento) && <label>CV (comprovante)<input value={f.cv} onChange={muda('cv')} maxLength={40} placeholder="Nº do CV" /></label>}
            <label>Conta
              <select value={f.conta_id} onChange={muda('conta_id')} required>
                {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label>Juros (R$)<input value={f.juros} onChange={muda('juros')} inputMode="numeric" data-moeda placeholder="0,00" /></label>
            <label>Multa (R$)<input value={f.multa} onChange={muda('multa')} inputMode="numeric" data-moeda placeholder="0,00" /></label>
            <label>Desconto (R$)<input value={f.desconto} onChange={muda('desconto')} inputMode="numeric" data-moeda placeholder="0,00" /></label>
          </div>
          <small className="cinza">Valor menor que o saldo deixa a conta {receita ? 'recebida' : 'paga'} em parte; o resto continua em aberto.</small>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : receita ? 'Confirmar recebimento' : 'Confirmar pagamento'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plano de contas: grupos e categorias de receitas e de despesas
// ---------------------------------------------------------------------------
function PlanoContas({ loja, plano, podeEditar, aoMudar }) {
  const [editando, setEditando] = useState(null); // { id?, nome, codigo, grupo, tipo?, pai_id?, ativo }
  const [erro, setErro] = useState('');

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    try {
      const corpo = { ...editando, loja_id: loja };
      await (editando.id ? api(`/financeiro/categorias/${editando.id}`, { metodo: 'PUT', corpo }) : api('/financeiro/categorias', { metodo: 'POST', corpo }));
      setEditando(null); aoMudar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const proximoCodigo = (tipo, pai) => {
    if (pai) {
      const g = plano.find((c) => c.id === pai);
      const filhos = plano.filter((c) => c.pai_id === pai).length + 1;
      return g?.codigo ? `${g.codigo}.${String(filhos).padStart(2, '0')}` : '';
    }
    const maior = Math.max(0, ...plano.filter((c) => c.grupo).map((c) => Number(c.codigo) || 0));
    return String(maior + 1);
  };

  return (
    <>
      <p className="cinza ajuda">O plano de contas organiza as receitas e despesas em grupos. Cada lançamento usa uma categoria. Ele vale para todas as lojas do grupo.</p>
      {erro && !editando && <p className="erro" role="alert">{erro}</p>}
      <div className="colunas-plano">
        {[['receber', 'Receitas'], ['pagar', 'Despesas']].map(([tipo, nome]) => (
          <section key={tipo} className="cartao plano-coluna">
            <div className="bloco-topo">
              <h2>{nome}</h2>
              {podeEditar && <button className="botao-contorno pequeno" onClick={() => setEditando({ grupo: true, tipo, nome: '', codigo: proximoCodigo(tipo), ativo: true })}>+ Grupo</button>}
            </div>
            {plano.filter((g) => g.grupo && g.tipo === tipo).map((g) => (
              <div key={g.id} className={`plano-grupo${g.ativo ? '' : ' inativo'}`}>
                <div className="plano-linha grupo">
                  <strong>{g.codigo} {g.nome}</strong>
                  {podeEditar && (
                    <span className="acoes-item">
                      <button className="botao-texto" onClick={() => setEditando({ ...g })}>Editar</button>
                      <button className="botao-texto" onClick={() => setEditando({ grupo: false, pai_id: g.id, nome: '', codigo: proximoCodigo(tipo, g.id), ativo: true })}>+ Categoria</button>
                    </span>
                  )}
                </div>
                {plano.filter((c) => c.pai_id === g.id).map((c) => (
                  <div key={c.id} className={`plano-linha${c.ativo ? '' : ' inativo'}`}>
                    <span>{c.codigo} {c.nome}{!c.ativo && ' (inativa)'}</span>
                    <small className="cinza">{c.usos} lanç.</small>
                    {podeEditar && <button className="botao-texto" onClick={() => setEditando({ ...c })}>Editar</button>}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
      {editando && (
        <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && setEditando(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Plano de contas">
            <div className="modal-topo">
              <h2>{editando.id ? 'Editar' : 'Novo'} {editando.grupo ? 'grupo' : 'categoria'}</h2>
              <button className="fechar" onClick={() => setEditando(null)} aria-label="Fechar">×</button>
            </div>
            <form className="formulario" onSubmit={salvar}>
              <div className="dados-veiculo">
                <label>Código<input value={editando.codigo || ''} onChange={(e) => setEditando({ ...editando, codigo: e.target.value })} placeholder="Ex.: 4.05" /></label>
                <label>Nome<input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} required autoFocus /></label>
              </div>
              {editando.id && (
                <label className="linha-check"><input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo (aparece nos lançamentos)</label>
              )}
              {erro && <p className="erro" role="alert">{erro}</p>}
              <div className="acoes-modal">
                <button type="button" className="botao-contorno" onClick={() => setEditando(null)}>Cancelar</button>
                <button className="botao-primario">Salvar</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function CentrosCusto({ loja, centros, podeEditar, aoMudar }) {
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState(null);
  const [erro, setErro] = useState('');
  const acao = async (fn) => { setErro(''); try { await fn(); await aoMudar(); } catch (falha) { setErro(falha.message); } };

  return (
    <>
      <p className="cinza ajuda">Centros de custo mostram onde o dinheiro entra e sai. Cada loja já tem o seu. Dá para criar outros, como "Administrativo" ou "Marketing".</p>
      <ul className="lista-tipos cartao">
        {centros.map((c) => (
          <li key={c.id}>
            {editando?.id === c.id ? (
              <form className="linha-tipo" onSubmit={(e) => { e.preventDefault(); acao(async () => { await api(`/financeiro/centros/${c.id}`, { metodo: 'PUT', corpo: { ...editando, loja_id: loja } }); setEditando(null); }); }}>
                <input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} autoFocus aria-label="Nome do centro de custo" />
                <label className="linha-check"><input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo</label>
                <button className="botao-primario pequeno">Salvar</button>
                <button type="button" className="botao-contorno pequeno" onClick={() => setEditando(null)}>Cancelar</button>
              </form>
            ) : (
              <span className="linha-tipo">
                <strong>{c.nome}</strong>{!c.ativo && <span className="etiqueta inativa">Inativo</span>}
                <small className="cinza">{c.usos} lançamento(s)</small>
                {podeEditar && <button className="botao-contorno pequeno" onClick={() => setEditando({ id: c.id, nome: c.nome, ativo: c.ativo })}>Editar</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {podeEditar && (
        <form className="linha-tipo" onSubmit={(e) => { e.preventDefault(); acao(async () => { await api('/financeiro/centros', { metodo: 'POST', corpo: { loja_id: loja, nome: novo } }); setNovo(''); }); }}>
          <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo centro de custo (ex.: Administrativo)" aria-label="Novo centro de custo" />
          <button className="botao-primario" disabled={!novo.trim()}>Criar</button>
        </form>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </>
  );
}

// Envia um documento para o lançamento (o corpo é o próprio arquivo)
async function enviarArquivo(lancamentoId, { arquivo, nome }) {
  const q = new URLSearchParams({ arquivo: arquivo.name, nome: nome || '', mime: arquivo.type || 'application/octet-stream' });
  const r = await fetch(`/api/financeiro/lancamentos/${lancamentoId}/arquivos?${q}`, {
    method: 'POST', body: arquivo, headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${sessao.token()}` },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || (r.status === 413 ? `"${arquivo.name}" passa de 15 MB.` : `Não foi possível enviar "${arquivo.name}".`));
}

const tamanho = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// Documentos do lançamento: nome dado por quem anexa, abrir, baixar, renomear e excluir
function Documentos({ id, arquivos, podeEditar, temCliente, novos, aoNovos, aoMudar, aoErro }) {
  const [arquivo, setArquivo] = useState(null);
  const [marcados, setMarcados] = useState([]);
  const [zap, setZap] = useState({ enviando: false, ok: '' });
  const [nome, setNome] = useState('');
  const [chave, setChave] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [renomeando, setRenomeando] = useState(null);

  async function anexar() {
    if (!arquivo) return;
    if (arquivo.size > 15 * 1024 * 1024) return aoErro('O arquivo passa de 15 MB.');
    if (!id) { aoNovos([...novos, { arquivo, nome }]); setArquivo(null); setNome(''); setChave((k) => k + 1); return; }
    setEnviando(true); aoErro('');
    try { await enviarArquivo(id, { arquivo, nome }); setArquivo(null); setNome(''); setChave((k) => k + 1); aoMudar(); }
    catch (falha) { aoErro(falha.message); }
    finally { setEnviando(false); }
  }
  async function baixar(a) {
    try {
      const r = await fetch(`/api/financeiro/arquivos/${a.id}?baixar=1`, { headers: { Authorization: `Bearer ${sessao.token()}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Não foi possível baixar o arquivo.');
      const nomeBaixado = decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || a.nome_arquivo);
      const url = URL.createObjectURL(await r.blob());
      const link = Object.assign(document.createElement('a'), { href: url, download: nomeBaixado });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (falha) { aoErro(falha.message); }
  }
  const acao = async (fn) => { aoErro(''); try { await fn(); aoMudar(); } catch (falha) { aoErro(falha.message); } };
  const renomear = () => acao(async () => { await api(`/financeiro/arquivos/${renomeando.id}`, { metodo: 'PUT', corpo: { nome: renomeando.nome } }); setRenomeando(null); });
  // documentos marcados vão para o WhatsApp do cliente, com a saudação e a competência
  async function enviarWhatsApp() {
    aoErro(''); setZap({ enviando: true, ok: '' });
    try {
      const r = await api('/whatsapp/lancamento-documentos', { metodo: 'POST', corpo: { lancamento_id: id, arquivos: marcados } });
      setMarcados([]); setZap({ enviando: false, ok: `${r.documentos} documento(s) enviado(s) para o WhatsApp de ${r.cliente}.` });
    } catch (falha) { setZap({ enviando: false, ok: '' }); aoErro(falha.message); }
  }
  const marcar = (aid, sim) => setMarcados((m) => (sim ? [...m, aid] : m.filter((x) => x !== aid)));

  return (
    <fieldset className="grupo-permissoes documentos-fin">
      <legend>Documentos</legend>
      {arquivos.length === 0 && novos.length === 0 && <small className="cinza">Nenhum documento anexado.</small>}
      {arquivos.length > 0 && (
        <ul className="lista-arquivos">
          {arquivos.map((a) => (
            <li key={a.id}>
              {renomeando?.id === a.id ? (
                <span className="linha-tipo">
                  <input value={renomeando.nome} onChange={(e) => setRenomeando({ ...renomeando, nome: e.target.value })} autoFocus aria-label="Nome do documento"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renomear(); } }} />
                  <button type="button" className="botao-primario pequeno" onClick={renomear}>Salvar</button>
                  <button type="button" className="botao-contorno pequeno" onClick={() => setRenomeando(null)}>Cancelar</button>
                </span>
              ) : (
                <>
                  {temCliente && <input type="checkbox" checked={marcados.includes(a.id)} onChange={(e) => marcar(a.id, e.target.checked)} aria-label={`Marcar ${a.nome}`} />}
                  <button type="button" className="botao-texto" onClick={() => abrirArquivo(`/financeiro/arquivos/${a.id}`).catch((f) => aoErro(f.message))}>📎 {a.nome}</button>
                  <small className="cinza">{a.nome_arquivo} · {tamanho(a.tamanho)}{a.enviado_por && ` · ${a.enviado_por}`}</small>
                  <button type="button" className="botao-contorno pequeno" onClick={() => baixar(a)}>Baixar</button>
                  {podeEditar && <button type="button" className="botao-texto" onClick={() => setRenomeando({ id: a.id, nome: a.nome })}>Renomear</button>}
                  {podeEditar && <button type="button" className="fechar" aria-label={`Excluir ${a.nome}`}
                    onClick={() => confirm(`Excluir o documento "${a.nome}"?`) && acao(() => api(`/financeiro/arquivos/${a.id}`, { metodo: 'DELETE' }))}>×</button>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {temCliente && arquivos.length > 0 && (
        <div className="envio-whatsapp-docs">
          <button type="button" className="botao-whatsapp" disabled={!marcados.length || zap.enviando} onClick={enviarWhatsApp}
            title="Envia os documentos marcados para o WhatsApp do cliente">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" /></svg>
            {zap.enviando ? 'Enviando…' : `Enviar no WhatsApp${marcados.length ? ` (${marcados.length})` : ''}`}
          </button>
          <small className={zap.ok ? 'aviso-ok' : 'cinza'}>{zap.ok || 'Marque os documentos e envie para o chamado do cliente.'}</small>
        </div>
      )}
      {novos.map((a, i) => (
        <small key={i} className="cinza">Vai anexar ao lançar: <strong>{a.nome || a.arquivo.name}</strong> ({a.arquivo.name})
          <button type="button" className="botao-texto" onClick={() => aoNovos(novos.filter((_, k) => k !== i))}>tirar</button></small>
      ))}
      {podeEditar && (
        <div className="envio-arquivo">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do documento (ex.: NOTA FISCAL)" aria-label="Nome do documento"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); anexar(); } }} />
          <input key={chave} type="file" onChange={(e) => { const a = e.target.files[0] || null; setArquivo(a); if (a && !nome) setNome(a.name.replace(/\.[^.]+$/, '').toUpperCase()); }} aria-label="Arquivo" />
          <button type="button" className="botao-primario" disabled={enviando || !arquivo} onClick={anexar}>{enviando ? 'Enviando…' : 'Anexar'}</button>
        </div>
      )}
    </fieldset>
  );
}

// Contas onde o dinheiro entra e sai (caixa e bancos), por loja, com o saldo
const TIPOS_CONTA = { caixa: 'Caixa', conta_corrente: 'Conta corrente', poupanca: 'Poupança' };
function ContasFinanceiras({ loja, lojasLancar }) {
  const [contas, setContas] = useState(null);
  const [editando, setEditando] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = () => loja && api(`/financeiro/contas/todas?loja=${loja}`).then(setContas).catch((f) => setErro(f.message));
  useEffect(() => { carregar(); }, [loja]);
  const novaConta = () => setEditando({ loja_id: lojasLancar.find((l) => l.id === loja)?.id || lojasLancar[0]?.id || '', tipo: 'conta_corrente', nome: '', banco_codigo: '', agencia: '', conta: '', saldo_inicial: '0,00', data_saldo_inicial: hoje(), ativo: true });

  async function salvar(e) {
    e.preventDefault(); setErro('');
    try {
      const corpo = { ...editando, saldo_inicial: numero(editando.saldo_inicial) };
      if (editando.id) await api(`/financeiro/contas/${editando.id}`, { metodo: 'PUT', corpo });
      else await api('/financeiro/contas', { metodo: 'POST', corpo });
      setEditando(null); carregar();
    } catch (falha) { setErro(falha.message); }
  }
  const muda = (campo) => (e) => setEditando({ ...editando, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  if (!contas) return erro ? <p className="erro" role="alert">{erro}</p> : <p className="cinza">Carregando…</p>;
  return (
    <>
      <div className="linha-filtro">
        <p className="cinza ajuda">Contas onde os recebimentos e pagamentos entram e saem. Na hora de receber ou pagar um lançamento, escolha a conta.</p>
        {lojasLancar.length > 0 && <button className="botao-primario" onClick={novaConta}>+ Nova conta</button>}
      </div>
      <div className="lista-cadastro">
        {contas.map((c) => (
          <button key={c.id} className="cartao item-cadastro" disabled={!c.pode_editar}
            onClick={() => setEditando({ ...c, saldo_inicial: paraMoeda(c.saldo_inicial), banco_codigo: c.banco_codigo || '', agencia: c.agencia || '', conta: c.conta || '' })}>
            <span className="item-titulo">
              <strong>{c.nome}</strong>
              <span className="etiqueta">{TIPOS_CONTA[c.tipo] || c.tipo}</span>
              {!c.ativo && <span className="etiqueta inativa">Inativa</span>}
            </span>
            <small className="cinza">{[c.loja, c.banco_codigo && `Banco ${c.banco_codigo}`, c.agencia && `Ag. ${c.agencia}`, c.conta && `Conta ${c.conta}`].filter(Boolean).join(' · ')}</small>
            <small>Saldo: <strong className={Number(c.saldo) < 0 ? 'negativo' : 'positivo'}>R$ {moeda(c.saldo)}</strong></small>
          </button>
        ))}
        {contas.length === 0 && <p className="cinza">Nenhuma conta ainda. O caixa de cada loja aparece aqui no primeiro recebimento.</p>}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {editando && (
        <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && setEditando(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Conta">
            <div className="modal-topo">
              <h2>{editando.id ? 'Editar conta' : 'Nova conta'}</h2>
              <button className="fechar" onClick={() => setEditando(null)} aria-label="Fechar">×</button>
            </div>
            <form className="formulario" onSubmit={salvar}>
              <label>Nome<input value={editando.nome} onChange={muda('nome')} required placeholder="Ex.: ITAÚ CONTA CORRENTE" /></label>
              <div className="dados-veiculo">
                <label>Tipo
                  <select value={editando.tipo} onChange={muda('tipo')}>
                    {Object.entries(TIPOS_CONTA).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                  </select>
                </label>
                {!editando.id && lojasLancar.length > 1 && (
                  <label>Loja
                    <select value={editando.loja_id} onChange={muda('loja_id')}>
                      {lojasLancar.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                    </select>
                  </label>
                )}
                {editando.tipo !== 'caixa' && (
                  <>
                    <label>Banco (código)<input value={editando.banco_codigo} onChange={muda('banco_codigo')} inputMode="numeric" placeholder="Ex.: 341" /></label>
                    <label>Agência<input value={editando.agencia} onChange={muda('agencia')} /></label>
                    <label>Conta<input value={editando.conta} onChange={muda('conta')} /></label>
                  </>
                )}
                <label>Saldo inicial (R$)<input value={editando.saldo_inicial} onChange={muda('saldo_inicial')} inputMode="numeric" data-moeda /></label>
                <label>Saldo em<CampoData value={editando.data_saldo_inicial} onChange={muda('data_saldo_inicial')} required /></label>
              </div>
              {editando.id && <label className="linha-check"><input type="checkbox" checked={editando.ativo} onChange={muda('ativo')} /> Conta ativa (aparece na hora de receber e pagar)</label>}
              {erro && <p className="erro" role="alert">{erro}</p>}
              <div className="acoes-modal">
                <button type="button" className="botao-contorno" onClick={() => setEditando(null)}>Cancelar</button>
                <button className="botao-primario">Salvar</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
