import { useEffect, useState } from 'react';
import { api, moeda } from './api.js';
import { Icone } from './icones.jsx';
import { criarTem } from './modulos.js';

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
export const FORMAS = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', boleto: 'Boleto', transferencia: 'Transferência', faturado: 'Faturado' };
const SITUACOES = { em_aberto: 'Em aberto', pago_parcial: 'Pago em parte', pago: 'Pago', cancelado: 'Cancelado' };

export default function Financeiro({ perfil, loja, abaInicial = 'receber', novoInicial = false }) {
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

  const abas = [['receber', 'A receber'], ['pagar', 'A pagar'], ['plano', 'Plano de contas'], ['centros', 'Centros de custo']];
  return (
    <>
      <div className="cabecalho"><h1>Financeiro</h1></div>
      <div className="abas" role="tablist">
        {abas.map(([v, n]) => <button key={v} role="tab" aria-selected={aba === v} className={aba === v ? 'ativa' : ''} onClick={() => setAba(v)}>{n}</button>)}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {aba === 'receber' || aba === 'pagar' ? (
        <Lancamentos key={aba} tipo={aba} loja={loja} perfil={perfil} lojasLancar={lojasLancar} plano={plano} centros={centros} novoInicial={novoInicial} />
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
function Lancamentos({ tipo, loja, perfil, lojasLancar, plano, centros, novoInicial }) {
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
        <label className="filtro-data">De<input type="date" value={de} onChange={(e) => setIntervalo([e.target.value, ate])} /></label>
        <label className="filtro-data">Até<input type="date" value={ate} onChange={(e) => setIntervalo([de, e.target.value])} /></label>
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
        <EditorLancamento id={aberto} tipo={tipo} loja={loja} perfil={perfil} lojasLancar={lojasLancar} plano={plano} centros={centros}
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
function EditorLancamento({ id, tipo, loja, perfil, lojasLancar, plano, centros, aoFechar, aoSalvar }) {
  const receita = tipo === 'receber';
  const [l, setL] = useState(null);
  const lojaPadrao = lojasLancar.some((x) => x.id === loja) ? loja : lojasLancar[0]?.id || '';
  const centroDaLoja = (lj) => centros.find((c) => c.loja_id === lj && c.ativo)?.id || '';
  const [f, setF] = useState({ loja_id: lojaPadrao, descricao: '', categoria_id: '', centro_custo_id: centroDaLoja(lojaPadrao),
    valor: '', vencimento: hoje(), competencia: hoje(), parcelas: '1', documento: '', observacoes: '' });
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try {
      const d = await api(`/financeiro/lancamentos/${id}`);
      setL(d);
      setF({ loja_id: d.loja_id, descricao: d.descricao, categoria_id: d.categoria_id || '', centro_custo_id: d.centro_custo_id || '',
        valor: String(d.valor).replace('.', ','), vencimento: d.vencimento, competencia: d.competencia, parcelas: '1',
        documento: d.documento || '', observacoes: d.observacoes || '' });
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
    setF((x) => ({ ...x, [campo]: v, ...(campo === 'loja_id' && { centro_custo_id: centroDaLoja(v) }) }));
  };
  const valorParcela = numero(f.valor) / Math.max(1, Number(f.parcelas) || 1);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      const corpo = { ...f, tipo, valor: numero(f.valor) };
      if (id) await api(`/financeiro/lancamentos/${id}`, { metodo: 'PUT', corpo });
      else await api('/financeiro/lancamentos', { metodo: 'POST', corpo });
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
                  {!id && lojasLancar.length > 1 && (
                    <label>Loja
                      <select value={f.loja_id} onChange={muda('loja_id')}>
                        {lojasLancar.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                    </label>
                  )}
                  <label>{id ? 'Valor (R$)' : 'Valor total (R$)'}<input value={f.valor} onChange={muda('valor')} inputMode="decimal" required placeholder="0,00" /></label>
                  <label>{!id && Number(f.parcelas) > 1 ? '1º vencimento' : 'Vencimento'}<input type="date" value={f.vencimento} onChange={muda('vencimento')} required /></label>
                  <label>Competência<input type="date" value={f.competencia} onChange={muda('competencia')} /></label>
                  {!id && (
                    <label>Parcelas
                      <select value={f.parcelas} onChange={muda('parcelas')}>
                        {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'À vista (1x)' : `${n}x mensais`}</option>)}
                      </select>
                    </label>
                  )}
                  <label>Documento<input value={f.documento} onChange={muda('documento')} placeholder="Nº da nota, boleto…" /></label>
                </div>
                {!id && Number(f.parcelas) > 1 && numero(f.valor) > 0 && (
                  <small className="cinza">{f.parcelas} parcelas de cerca de R$ {moeda(valorParcela)}, uma por mês.</small>
                )}
                <label>Observações<textarea rows={2} value={f.observacoes} onChange={muda('observacoes')} /></label>
              </fieldset>
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
  const [f, setF] = useState({ data: hoje(), valor: String(Math.round((l.valor - l.valor_pago) * 100) / 100).replace('.', ','),
    forma_pagamento: 'pix', conta_id: '', juros: '', multa: '', desconto: '' });
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
            <label>Data<input type="date" value={f.data} onChange={muda('data')} required /></label>
            <label>Valor (R$)<input value={f.valor} onChange={muda('valor')} inputMode="decimal" required /></label>
            <label>Forma de pagamento
              <select value={f.forma_pagamento} onChange={muda('forma_pagamento')}>
                {Object.entries(FORMAS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
            </label>
            <label>Conta
              <select value={f.conta_id} onChange={muda('conta_id')} required>
                {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label>Juros (R$)<input value={f.juros} onChange={muda('juros')} inputMode="decimal" placeholder="0,00" /></label>
            <label>Multa (R$)<input value={f.multa} onChange={muda('multa')} inputMode="decimal" placeholder="0,00" /></label>
            <label>Desconto (R$)<input value={f.desconto} onChange={muda('desconto')} inputMode="decimal" placeholder="0,00" /></label>
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
