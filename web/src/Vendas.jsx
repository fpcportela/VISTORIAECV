import { useEffect, useId, useRef, useState } from 'react';
import { api, moeda } from './api.js';
import { Icone } from './icones.jsx';
import { Placa, PlacaInput, PlacasDiversas, placaValida } from './Placa.jsx';
import { lerMoeda, paraMoeda, semAcento } from './entrada.js';
import { SeletorVeiculo } from './Veiculo.jsx';
import ConsultaPlaca from './ConsultaPlaca.jsx';
import { formatarDoc, mascaraTelefone } from './documentos.js';
import { CampoData } from './Data.jsx';
import { EditorCliente } from './Clientes.jsx';

export const SITUACOES = { aberta: 'Aberta', futuro: 'Agendado', finalizada: 'Finalizada', cancelada: 'Cancelada' };
const ACOES = { criada: 'Criou', alterada: 'Alterou', finalizada: 'Finalizou', reaberta: 'Reabriu para edição', confirmada: 'Confirmou a venda agendada', cancelada: 'Cancelou', desconto: 'Deu desconto', preco: 'Alterou preço' };
const BANDEIRAS = ['VISA', 'MASTERCARD', 'ELO', 'HIPERCARD', 'AMERICAN EXPRESS', 'CABAL', 'OUTRA'];
const ehCartao = (forma) => forma === 'cartao_credito' || forma === 'cartao_debito';
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const numero = lerMoeda;
const Etiqueta = ({ situacao }) => <span className={`etiqueta venda-${situacao}`}>{SITUACOES[situacao]}</span>;
export const FORMAS_PAGAMENTO = { pix: 'PIX', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito',
  boleto: 'Boleto', transferencia: 'Transferência', faturado: 'Faturado' };
const itemVazio = () => ({ servico_id: '', quantidade: '1', valor_unit: '' });
let chaves = 0;
// A venda é organizada por veículo: cada veículo tem os seus itens
const veiculoVazio = () => ({ chave: ++chaves, placa: '', tipo_veiculo: null, marca: '', modelo: '', consulta: null, itens: [itemVazio()] });
// Veículo vindo da consulta de placa: os campos da venda e o relatório da consulta
const doConsultado = (d) => ({ placa: d.placa, tipo_veiculo: d.tipo, marca: d.marca || '', modelo: d.modelo || '', consulta: d.consultado_em ? d : null });
const TIPOS_VEICULO = { carro: 'Carro', moto: 'Moto', caminhao: 'Caminhão', outro: 'Outro' };

// Relatório da consulta de placa, anexado ao veículo da venda
function RelatorioConsulta({ dados: d }) {
  const linhas = [
    ['Marca / modelo', [d.marca, d.modelo].filter(Boolean).join(' ') || d.versao],
    ['Versão', d.versao],
    ['Tipo', TIPOS_VEICULO[d.tipo]],
    ['Ano', [d.ano_fabricacao, d.ano_modelo].filter(Boolean).join(' / ')],
    ['Cor', d.cor], ['Combustível', d.combustivel], ['Chassi', d.chassi], ['Renavam', d.renavam], ['Motor', d.motor],
    ['Município', [d.municipio, d.uf].filter(Boolean).join(' / ')],
  ].filter(([, valor]) => valor);
  return (
    <details className="relatorio-consulta">
      <summary>
        <Icone nome="vistorias" tamanho={16} /> Relatório da consulta da placa {d.placa}
        <small className="cinza"> · consultado em {new Date(d.consultado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
      </summary>
      <dl>{linhas.map(([rotulo, valor]) => <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>)}</dl>
    </details>
  );
}
const pagamentoVazio = (valor = '') => ({ chave: ++chaves, data_pagamento: hoje(), forma: 'pix', valor, detalhe: '', cv: '', bandeira: '' });

// ---------------------------------------------------------------------------
// Lista de vendas e orçamentos
// ---------------------------------------------------------------------------
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const PERIODOS = {
  hoje: () => [hoje(), hoje()],
  mes: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), hoje()]; },
  anterior: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; },
  todas: () => ['', ''],
};

export function ListaVendas({ loja, podeCriar, aoAbrir, aoNova, buscaInicial = '', situacaoInicial = '', empresa, logo, lojasLote = [] }) {
  const [[de, ate], setIntervalo] = useState(buscaInicial || situacaoInicial ? PERIODOS.todas() : PERIODOS.mes());
  const [situacao, setSituacao] = useState(situacaoInicial);
  const [cliente, setCliente] = useState(buscaInicial);
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);
  const [lote, setLote] = useState(null); // null = fora do modo lote; Set com os ids marcados
  const [editandoLote, setEditandoLote] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [avisoLote, setAvisoLote] = useState('');

  useEffect(() => {
    const q = new URLSearchParams({ ...(loja && { loja }), ...(de && { de }), ...(ate && { ate }), ...(situacao && { situacao }),
      ...(cliente.trim() && { cliente: cliente.trim() }), ...(busca.trim() && { busca: busca.trim() }) });
    const t = setTimeout(() => api(`/vendas?${q}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message)), busca || cliente ? 300 : 0);
    return () => clearTimeout(t);
  }, [loja, de, ate, situacao, cliente, busca, recarga]);

  const total = (lista || []).filter((v) => v.situacao !== 'cancelada').reduce((t, v) => t + v.valor_total, 0);
  const periodoAtivo = Object.keys(PERIODOS).find((k) => { const [a, b] = PERIODOS[k](); return a === de && b === ate; });

  async function pdf() {
    setGerando(true);
    try {
      const filtros = [
        de || ate ? `Período: ${de ? dataBR(de) : 'início'} a ${ate ? dataBR(ate) : 'hoje'}` : 'Todo o período',
        cliente.trim() && `Cliente: ${cliente.trim()}`, busca.trim() && `Busca: ${busca.trim()}`,
        situacao && SITUACOES[situacao],
      ].filter(Boolean);
      const { gerarPdfVendas } = await import('./relatorioVendas.js');
      await gerarPdfVendas({ lista, filtros, empresa, logo });
    } catch (falha) {
      setErro(`Não foi possível gerar o PDF: ${falha.message}`);
    } finally {
      setGerando(false);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <h1>Vendas</h1>
        <span className="acoes-cabecalho">
          <button className="botao-contorno" onClick={pdf} disabled={gerando || !lista?.length}>{gerando ? 'Gerando…' : 'Gerar PDF'}</button>
          {podeCriar && lojasLote.length > 0 && (
            <button className={lote ? 'botao-primario' : 'botao-contorno'} onClick={() => setLote(lote ? null : new Set())}>{lote ? 'Sair da edição em lote' : 'Editar em lote'}</button>
          )}
          {podeCriar && !lote && <button className="botao-primario" onClick={aoNova}><Icone nome="mais" tamanho={18} /> Nova venda</button>}
        </span>
      </div>
      <div className="filtros">
        <div className="abas" role="tablist">
          {[['hoje', 'Hoje'], ['mes', 'Este mês'], ['anterior', 'Mês passado'], ['todas', 'Todas']].map(([v, n]) => (
            <button key={v} role="tab" aria-selected={periodoAtivo === v} className={periodoAtivo === v ? 'ativa' : ''} onClick={() => setIntervalo(PERIODOS[v]())}>{n}</button>
          ))}
        </div>
        <label className="filtro-data">De<CampoData value={de} max={ate || undefined} onChange={(e) => setIntervalo([e.target.value, ate])} aria-label="De" /></label>
        <label className="filtro-data">Até<CampoData value={ate} min={de || undefined} onChange={(e) => setIntervalo([de, e.target.value])} aria-label="Até" /></label>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(SITUACOES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
        <input type="search" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Cliente, CPF ou CNPJ" aria-label="Filtrar por cliente, CPF ou CNPJ" />
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Placa ou nº da venda" aria-label="Buscar por placa ou número" />
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? (
        <p className="cinza vazio">Nenhuma venda encontrada com esses filtros.</p>
      ) : (
        <>
          <small className="cinza">{lista.length} registro(s) · vendas (sem canceladas): <strong>R$ {moeda(total)}</strong></small>
          {avisoLote && <p className="aviso-texto" role="status">{avisoLote}</p>}
          {lote && (
            <div className="barra-lote">
              <span><strong>{lote.size}</strong> venda(s) selecionada(s). Só as abertas podem ser alteradas.</span>
              <button className="botao-texto" onClick={() => setLote(new Set(lista.filter((v) => ['aberta', 'futuro'].includes(v.situacao)).map((v) => v.id)))}>Marcar todas as abertas</button>
              <button className="botao-texto" onClick={() => setLote(new Set())} disabled={!lote.size}>Desmarcar</button>
              <button className="botao-primario" disabled={!lote.size} onClick={() => setEditandoLote(true)}>Alterar selecionadas</button>
            </div>
          )}
          <div className="tabela-vendas" role="table">
            {lista.map((v) => (
              <button key={v.id} className={`cartao linha-venda${v.situacao === 'futuro' ? ' agendada' : v.sem_servico && v.situacao === 'aberta' ? ' sem-servico' : ''}${lote ? ' em-lote' : ''}${lote?.has(v.id) ? ' marcada' : ''}`} role="row" aria-pressed={lote ? lote.has(v.id) : undefined}
                onClick={() => (lote ? setLote((l) => { const n = new Set(l); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; }) : aoAbrir(v.id))}>
                <span className="lv-num">{lote && <span className="marca-lote" aria-hidden="true">{lote.has(v.id) ? '✓' : ''}</span>}{v.tipo_veiculo && ['carro', 'moto', 'caminhao'].includes(v.tipo_veiculo) && (
                  <span className="lv-tipo" title={TIPOS_VEICULO[v.tipo_veiculo]} aria-label={TIPOS_VEICULO[v.tipo_veiculo]}><Icone nome={v.tipo_veiculo} tamanho={20} /></span>
                )}<strong>Nº {v.numero}</strong></span>
                <span className="lv-cliente">
                  {!v.placas ? <small className="cinza lv-sem-placa">Sem placa</small>
                    : v.placas.includes(',') ? <PlacasDiversas tamanho="mini" /> : <Placa placa={v.placas} tamanho="mini" />}
                  <span className="lv-nome">
                    <strong>{v.cliente}</strong>
                    <small className="cinza">{v.cpf_cnpj && `${formatarDoc(v.cpf_cnpj)}`}{v.cpf_cnpj && !loja && ' · '}{!loja && v.loja}</small>
                    {v.vendedor && <small className="lv-vendedor" title="Vistoriador (responsável pela venda)">Vistoriador: <strong>{v.vendedor}</strong></small>}
                    {v.sem_servico && ['aberta', 'futuro'].includes(v.situacao) && <small className="lv-pendente">Falta o serviço</small>}
                  </span>
                </span>
                <span className="lv-data">{dataBR(v.data_venda)}</span>
                <span className="lv-valor">R$ {moeda(v.valor_total)}</span>
                <Etiqueta situacao={v.situacao} />
              </button>
            ))}
          </div>
        </>
      )}
      {editandoLote && (
        <EdicaoLote vendas={lista.filter((v) => lote.has(v.id))} lojas={lojasLote} aoFechar={() => setEditandoLote(false)}
          aoConcluir={(r) => {
            setEditandoLote(false); setLote(new Set()); setRecarga((n) => n + 1);
            setAvisoLote(`${r.alteradas} venda(s) alterada(s).${r.puladas.length ? ` Não alteradas: ${r.puladas.map((p) => `nº ${p.numero} (${p.motivo})`).join(', ')}.` : ''}`);
          }} />
      )}
    </>
  );
}

// Altera responsável, data do serviço e centro de custo de várias vendas de uma vez
function EdicaoLote({ vendas, lojas, aoFechar, aoConcluir }) {
  const [vendedor, setVendedor] = useState('');
  const [data, setData] = useState('');
  const [loja, setLoja] = useState('');
  const [responsaveis, setResponsaveis] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const fechadas = vendas.filter((v) => !['aberta', 'futuro'].includes(v.situacao)).length;

  useEffect(() => {
    const base = vendas[0]?.loja_id;
    if (base) api(`/vendas-responsaveis?loja=${base}`).then(setResponsaveis).catch((f) => setErro(f.message));
  }, []);

  async function aplicar(e) {
    e.preventDefault();
    if (!vendedor && !data && !loja) return setErro('Escolha pelo menos uma coisa para alterar.');
    setSalvando(true); setErro('');
    try {
      aoConcluir(await api('/vendas/lote', { metodo: 'POST', corpo: { ids: vendas.map((v) => v.id), vendedor_id: vendedor || null, data_venda: data || null, loja_id: loja || null } }));
    } catch (falha) { setErro(falha.message); setSalvando(false); }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Editar vendas em lote">
        <div className="modal-topo">
          <h2>Alterar {vendas.length} venda(s)</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={aplicar}>
          <p className="cinza ajuda">Deixe em "Não alterar" o que deve ficar como está. Cada venda alterada registra a mudança no histórico.</p>
          <label>Responsável
            <select value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
              <option value="">Não alterar</option>
              {responsaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
          <label>Data do serviço<CampoData value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label>Centro de custo (loja)
            <select value={loja} onChange={(e) => setLoja(e.target.value)}>
              <option value="">Não alterar</option>
              {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </label>
          {fechadas > 0 && <p className="aviso-texto">{fechadas} das vendas marcadas estão finalizadas ou canceladas e não serão alteradas. Para mudar uma delas, use "Liberar edição" na venda.</p>}
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={salvando}>{salvando ? 'Alterando…' : 'Aplicar'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nova venda / edição
// ---------------------------------------------------------------------------
export function EditorVenda({ id, perfil, lojaInicial, lojasPermitidas, veiculoInicial, agendamento = null, aoVoltar, aoSalvo, aoTitulo }) {
  const grupo = useId(); // nomes únicos dos botões de opção (várias vendas abertas em abas)
  const [venda, setVenda] = useState(null); // carregada do servidor (null = nova)
  const [loja, setLoja] = useState(lojasPermitidas.includes(lojaInicial) ? lojaInicial : lojasPermitidas[0] || '');
  // venda aberta com uma unidade escolhida no topo: fica nessa unidade
  const [lojaFixa] = useState(Boolean(lojaInicial) && lojasPermitidas.includes(lojaInicial));
  const [trocandoUnidade, setTrocandoUnidade] = useState(false);
  const [data, setData] = useState(hoje());
  // venda aberta pela agenda: já vem com o cliente do agendamento (se for cadastrado)
  const [modoCliente, setModoCliente] = useState(agendamento?.cliente ? 'atual' : 'avulso');
  const [cliente, setCliente] = useState(agendamento?.cliente || null);
  const [busca, setBusca] = useState('');
  const [clientes, setClientes] = useState([]);
  const [cadastrando, setCadastrando] = useState(false); // tela de cadastro de cliente aberta
  const [precosCliente, setPrecosCliente] = useState({}); // preços especiais do cliente escolhido
  const clienteCarregado = useRef(undefined); // cliente da venda salva: abrir a venda não muda os preços
  // venda aberta direto de uma consulta de placa: já vem com o veículo e o relatório da consulta
  const [veiculos, setVeiculos] = useState(() => [veiculoInicial ? { ...veiculoVazio(), ...doConsultado(veiculoInicial) }
    : agendamento ? { ...veiculoVazio(), placa: agendamento.placa || '', itens: [{ ...itemVazio(), servico_id: agendamento.servico_id || '' }] }
      : veiculoVazio()]);
  const [pagamentos, setPagamentos] = useState(() => [pagamentoVazio()]);
  const [desconto, setDesconto] = useState('');
  const [observacoes, setObservacoes] = useState(agendamento ? agendamento.observacao_venda || '' : '');
  const [servicos, setServicos] = useState([]);
  const [consulta, setConsulta] = useState(null); // { indice, placa }
  const [liberando, setLiberando] = useState(false);
  const [autorizando, setAutorizando] = useState(null); // { finalizar } enquanto pede a senha do desconto
  // preços vêm travados; destrava com a senha de quem autoriza (vale até salvar)
  const [precoLiberado, setPrecoLiberado] = useState(null); // { email, senha, nome }
  const [pedindoPreco, setPedindoPreco] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [carregando, setCarregando] = useState(Boolean(id));

  const acessos = perfil.master ? null : perfil.acessos[venda?.loja_id || loja] || [];
  const podeLoja = (p) => !acessos || acessos.includes(p);
  const pode = venda?.pode || { editar: podeLoja('vendas.criar'), finalizar: podeLoja('vendas.finalizar'), cancelar: podeLoja('vendas.cancelar'), desconto: podeLoja('vendas.desconto'), autorizar: podeLoja('vendas.autorizar') };
  const editavel = (!venda || ['aberta', 'futuro'].includes(venda.situacao)) && pode.editar;

  async function carregar() {
    try {
      const v = await api(`/vendas/${id}`);
      setVenda(v); setLoja(v.loja_id); setData(String(v.data_venda).slice(0, 10));
      const avulso = v.cliente.tipo === 'avulso' && v.cliente.nome === 'CLIENTE PARTICULAR / AVULSO';
      clienteCarregado.current = avulso ? null : v.cliente.id;
      setCliente(v.cliente); setModoCliente(avulso ? 'avulso' : 'atual');
      // agrupa os itens por placa, na ordem em que foram lançados
      const grupos = [];
      for (const i of v.itens) {
        let g = grupos.find((x) => x.placa === (i.placa || ''));
        if (!g) grupos.push(g = { ...veiculoVazio(), placa: i.placa || '', tipo_veiculo: i.tipo_veiculo || null, marca: i.marca || '', modelo: i.modelo || '', consulta: i.consulta || null, itens: [] });
        g.itens.push(i.servico_id ? { servico_id: i.servico_id, quantidade: String(Number(i.quantidade)), valor_unit: paraMoeda(i.valor_unit) } : itemVazio());
      }
      setVeiculos(grupos.length ? grupos : [veiculoVazio()]);
      setPagamentos(v.pagamentos?.length
        ? v.pagamentos.map((pg) => ({ ...pagamentoVazio(), data_pagamento: String(pg.data_pagamento).slice(0, 10), forma: pg.forma, valor: paraMoeda(pg.valor), detalhe: pg.detalhe || '', cv: pg.cv || '', bandeira: pg.bandeira || '' }))
        : [pagamentoVazio()]);
      setDesconto(v.desconto ? paraMoeda(v.desconto) : ''); setObservacoes(v.observacoes || '');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { if (id) carregar(); }, [id]);

  useEffect(() => {
    if (loja) api(`/servicos?loja=${loja}&uso=venda`).then(setServicos).catch((f) => setErro(f.message));
  }, [loja]);

  useEffect(() => {
    if (modoCliente !== 'buscar' || !loja) return;
    const t = setTimeout(() => api(`/clientes?loja=${loja}&venda=1&busca=${encodeURIComponent(busca)}`).then(setClientes).catch((f) => setErro(f.message)), 300);
    return () => clearTimeout(t);
  }, [busca, modoCliente, loja]);

  const precoDe = (servicoId, tipoVeiculo, especiais = precosCliente) => {
    const s = servicos.find((x) => x.id === servicoId);
    if (!s) return '';
    return paraMoeda(especiais[servicoId] ?? s.precos?.[tipoVeiculo || 'carro'] ?? s.valor_padrao);
  };

  // cliente cadastrado com preços especiais: os itens usam o preço dele; trocando o cliente, os preços acompanham
  const clienteId = (modoCliente === 'atual' || modoCliente === 'buscar') && cliente?.id ? cliente.id : null;
  useEffect(() => {
    let vale = true;
    (clienteId ? api(`/clientes/${clienteId}/precos`) : Promise.resolve([])).then((l) => {
      if (!vale) return;
      const especiais = Object.fromEntries(l.map((p) => [p.servico_id, Number(p.valor)]));
      setPrecosCliente(especiais);
      if (clienteCarregado.current !== undefined && clienteCarregado.current === clienteId) return;
      clienteCarregado.current = undefined;
      if (editavel) setVeiculos((lista) => lista.map((v) => ({ ...v, itens: v.itens.map((i) => (i.servico_id ? { ...i, valor_unit: precoDe(i.servico_id, v.tipo_veiculo, especiais) } : i)) })));
    }).catch(() => {});
    return () => { vale = false; };
  }, [clienteId, servicos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Veículos e os seus itens. Se o tipo do veículo muda, o preço dos itens acompanha.
  const mudarVeiculo = (n, campos) => setVeiculos((lista) => lista.map((v, k) => {
    if (k !== n) return v;
    const novo = { ...v, ...campos };
    if ('tipo_veiculo' in campos && campos.tipo_veiculo !== v.tipo_veiculo) {
      novo.itens = v.itens.map((i) => (i.servico_id ? { ...i, valor_unit: precoDe(i.servico_id, campos.tipo_veiculo) } : i));
    }
    return novo;
  }));
  const mudarItens = (n, f) => setVeiculos((lista) => lista.map((v, k) => (k === n ? { ...v, itens: f(v.itens, v) } : v)));
  const mudarItem = (n, m, campos) => mudarItens(n, (itens) => itens.map((i, k) => (k === m ? { ...i, ...campos } : i)));
  const escolherServico = (n, m, servicoId) => mudarItens(n, (itens, v) => itens.map((i, k) => (k === m ? { ...i, servico_id: servicoId, valor_unit: precoDe(servicoId, v.tipo_veiculo) } : i)));

  // Placa consultada na API: preenche o veículo (o da lupa, ou o primeiro sem placa, ou um novo)
  function usarVeiculo(dados) {
    const campos = doConsultado(dados);
    let n = consulta.indice ?? veiculos.findIndex((v) => !v.placa || v.placa === dados.placa);
    if (n < 0) { n = veiculos.length; setVeiculos((l) => [...l, veiculoVazio()]); }
    mudarVeiculo(n, campos);
    setConsulta(null);
  }

  // A aba mostra a placa da venda (ou DIVERSOS com mais de um veículo), o número e a situação
  const placasVenda = veiculos.map((v) => v.placa).filter(placaValida);
  const placaPrincipal = placasVenda.length > 1 ? 'DIVERSOS' : placasVenda[0] || '';
  useEffect(() => { aoTitulo?.({ placa: placaPrincipal, numero: venda?.numero, situacao: venda?.situacao }); }, [placaPrincipal, venda]);

  const todosItens = veiculos.flatMap((v) => v.itens);
  const bruto = todosItens.reduce((t, i) => t + numero(i.quantidade) * numero(i.valor_unit), 0);
  const total = bruto - numero(desconto);
  const pago = pagamentos.reduce((t, pg) => t + numero(pg.valor), 0);
  const falta = Math.round((total - pago) * 100) / 100;
  const mudarPagamento = (n, campos) => setPagamentos((l) => l.map((pg, k) => (k === n ? { ...pg, ...campos } : pg)));

  async function salvar(finalizar = false, autorizacao = null) {
    setErro('');
    if (modoCliente === 'buscar' && !cliente) return setErro('Escolha o cliente na lista.');
    const placaRuim = veiculos.findIndex((v) => v.placa && !placaValida(v.placa));
    if (placaRuim >= 0) return setErro(`Veículo ${placaRuim + 1}: placa incompleta.`);
    if (finalizar && (!todosItens.some((i) => i.servico_id) || veiculos.some((v) => v.placa && !v.itens.some((i) => i.servico_id)))) {
      return setErro('Para finalizar, inclua o serviço de cada veículo. Para deixar para depois, use Salvar.');
    }
    if (finalizar && Math.abs(falta) > 0.005) {
      return setErro(`Para finalizar, os pagamentos precisam fechar o total: ${falta > 0 ? `faltam R$ ${moeda(falta)}` : `sobram R$ ${moeda(-falta)}`}.`);
    }
    const cartaoSemCv = pagamentos.findIndex((pg) => numero(pg.valor) > 0 && ehCartao(pg.forma) && (!pg.cv.trim() || !pg.bandeira));
    if (cartaoSemCv >= 0) return setErro(`Pagamento ${cartaoSemCv + 1}: informe o CV e a bandeira do cartão.`);
    // desconto novo ou alterado: pede a senha de quem autoriza antes de salvar
    if (!autorizacao && numero(desconto) > 0 && numero(desconto) !== Number(venda?.desconto || 0)) {
      return setAutorizando({ finalizar });
    }
    setOcupado(true);
    try {
      const corpo = {
        loja_id: loja, data_venda: data, desconto: numero(desconto), observacoes,
        ...(autorizacao && { autorizacao_desconto: autorizacao }),
        ...(precoLiberado && { autorizacao_preco: { email: precoLiberado.email, senha: precoLiberado.senha } }),
        // veículo ainda sem serviço vai só com a placa: a venda fica aberta para ajustar depois
        itens: veiculos.flatMap(({ placa, tipo_veiculo, marca, modelo, itens }) => (itens.some((i) => i.servico_id)
          ? itens.filter((i) => i.servico_id)
            .map(({ servico_id, quantidade, valor_unit }) => ({ servico_id, placa, tipo_veiculo, marca, modelo, quantidade: numero(quantidade), valor_unit: numero(valor_unit) }))
          : placa ? [{ servico_id: null, placa, tipo_veiculo, marca, modelo }] : [])),
        pagamentos: pagamentos.filter((pg) => numero(pg.valor) > 0)
          .map(({ data_pagamento, forma, valor, detalhe, cv, bandeira }) => ({ data_pagamento, forma, valor: numero(valor), detalhe, cv, bandeira })),
        ...(modoCliente === 'avulso' && { cliente_avulso: true }),
        ...((modoCliente === 'buscar' || modoCliente === 'atual') && cliente && { cliente_id: cliente.id }),
        ...(!venda && agendamento && { agendamento_id: agendamento.id }),
      };
      let vid = venda?.id;
      if (vid) await api(`/vendas/${vid}`, { metodo: 'PUT', corpo });
      else vid = (await api('/vendas', { metodo: 'POST', corpo })).id;
      setPrecoLiberado(null);
      if (finalizar) await api(`/vendas/${vid}/finalizar`, { metodo: 'POST' });
      if (!venda) return aoSalvo(vid);
      await carregar();
      setAviso(finalizar ? 'Venda finalizada.' : 'Venda salva.'); setTimeout(() => setAviso(''), 2200);
    } catch (falha) {
      if (falha.status === 428) { setAutorizando({ finalizar }); return; }
      setErro(falha.message);
      if (venda && !autorizacao) carregar();
      if (autorizacao) throw falha; // a janela de autorização mostra o erro
    } finally {
      setOcupado(false);
    }
  }

  // FUTURO (aberta pelo robô do WhatsApp) passa a ser uma venda aberta comum
  async function confirmar() {
    try {
      await api(`/vendas/${venda.id}/confirmar`, { metodo: 'POST' });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function cancelar() {
    const motivo = prompt('Motivo do cancelamento:');
    if (!motivo) return;
    try {
      await api(`/vendas/${venda.id}/cancelar`, { metodo: 'POST', corpo: { motivo } });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  if (carregando) return <p className="cinza">Carregando…</p>;
  if (id && !venda) return <p className="erro" role="alert">{erro}</p>;

  const nomeLoja = perfil.lojas.find((l) => l.id === loja)?.nome;
  // Novo cadastro abre a tela completa de cliente (com os preços especiais), nas unidades do grupo da venda
  const empresaVenda = perfil.lojas.find((l) => l.id === loja)?.empresa_id;
  const lojasCadastro = perfil.lojas.filter((l) => l.empresa_id === empresaVenda && (perfil.master || perfil.acessos[l.id]?.includes('clientes.editar')));
  return (
    <>
      <div className="cabecalho">
        <button className="botao-texto" onClick={aoVoltar}>‹ Vendas</button>
        <h1>{venda ? `Venda nº ${venda.numero}` : 'Nova venda'}</h1>
        {venda ? <Etiqueta situacao={venda.situacao} /> : <span />}
      </div>

      {venda?.situacao === 'finalizada' && (
        <p className="aviso-texto">Venda finalizada: nada pode ser alterado. Para corrigir, use "Liberar edição" (precisa de autorização).</p>
      )}

      <fieldset className="cartao secao-venda" disabled={!editavel}>
        <legend>Informações</legend>
        <div className="grade-venda">
          <label className="campo">Número<input value={venda ? venda.numero : 'Gerado ao salvar'} readOnly className="somente-leitura" /></label>
          <label className="campo">Data do serviço<CampoData value={data} onChange={(e) => setData(e.target.value)} /></label>
          <div className="campo">
            <span className="rotulo-campo">Unidade (centro de custo)</span>
            {/* Escolhe a unidade só quando a venda nasce em "Todas as lojas"; depois, troca só com senha */}
            {venda || lojaFixa || lojasPermitidas.length < 2 ? (
              <span className="unidade-venda">
                <input value={nomeLoja || ''} readOnly className="somente-leitura" aria-label="Unidade" />
                {['aberta', 'futuro'].includes(venda?.situacao) && lojasPermitidas.length > 1 && (
                  <button type="button" className="botao-texto" onClick={() => setTrocandoUnidade(true)}>Trocar</button>
                )}
              </span>
            ) : (
              <select value={loja} onChange={(e) => setLoja(e.target.value)} aria-label="Unidade">
                {lojasPermitidas.map((l) => <option key={l} value={l}>{perfil.lojas.find((x) => x.id === l)?.nome}</option>)}
              </select>
            )}
          </div>
          <label className="campo">Responsável<input value={venda?.vendedor || perfil.usuario.nome} readOnly className="somente-leitura" /></label>
          <div className="campo">
            <span className="rotulo-campo">Placa</span>
            <button type="button" className="botao-contorno" onClick={() => setConsulta({ indice: null, placa: '' })} disabled={!podeLoja('placa.consultar')}>
              <Icone nome="busca" tamanho={18} /> Consultar placa
            </button>
          </div>
        </div>

        <span className="rotulo-campo">Cliente</span>
        <div className="opcoes">
          {[
            ['avulso', 'Avulso (sem cadastro)', true],
            ['atual', cliente?.nome, modoCliente === 'atual' && cliente],
            ['buscar', 'Cliente cadastrado', podeLoja('clientes.ver')],
            ['novo', 'Novo cadastro', podeLoja('clientes.editar')],
          ].filter(([, , ok]) => ok).map(([v, n]) => (
            <label key={v} className={modoCliente === v ? 'opcao marcada' : 'opcao'}>
              <input type="radio" name={`${grupo}-modo-cliente`} checked={modoCliente === v} onChange={() => (v === 'novo' ? setCadastrando(true) : setModoCliente(v))} /><strong>{n}</strong>
            </label>
          ))}
        </div>
        {(modoCliente === 'atual' || modoCliente === 'buscar') && cliente && (
          <div className="dados-cliente">
            <span><small className="cinza">Nome completo</small><strong>{cliente.nome}</strong></span>
            <span><small className="cinza">{String(cliente.cpf_cnpj || '').replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF'}</small><strong>{cliente.cpf_cnpj ? formatarDoc(cliente.cpf_cnpj) : 'NÃO INFORMADO'}</strong></span>
            {cliente.grupo_nome && <span><small className="cinza">Grupo</small><strong>{cliente.grupo_nome}</strong></span>}
            {cliente.whatsapp && <span><small className="cinza">WhatsApp</small><strong>{mascaraTelefone(cliente.whatsapp)}</strong></span>}
          </div>
        )}
        {modoCliente === 'buscar' && (
          <div className="formulario">
            <input type="search" value={busca} onChange={(e) => { setBusca(e.target.value); setCliente(null); }} placeholder="Nome, CPF/CNPJ ou telefone" aria-label="Buscar cliente" />
            <ul className="lista-clientes">
              {clientes.filter((c) => c.tipo !== 'avulso').map((c) => (
                <li key={c.id}>
                  <label className={cliente?.id === c.id ? 'opcao marcada' : 'opcao'}>
                    <input type="radio" name={`${grupo}-cliente`} checked={cliente?.id === c.id} onChange={() => setCliente(c)} />
                    <strong>{c.nome}</strong><small className="cinza">{c.tipo === 'pj' ? 'Empresa' : c.tipo === 'avulso' ? 'Avulso' : 'Pessoa física'}{c.cpf_cnpj && ` · ${formatarDoc(c.cpf_cnpj)}`}{c.grupo_nome && ` · Grupo ${c.grupo_nome}`}</small>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <fieldset className="cartao secao-venda" disabled={!editavel}>
        <legend>Veículos e itens</legend>
        {editavel && (precoLiberado
          ? <small className="aviso-receita">Preços liberados{precoLiberado.nome ? ` por ${precoLiberado.nome}` : ''} até salvar a venda.</small>
          : <small className="cinza ajuda">Os preços vêm travados. Para alterar, clique no valor e informe a senha de quem autoriza.</small>)}
        {veiculos.map((v, n) => (
          <div key={v.chave} className="grupo-veiculo">
            <div className="bloco-veiculo">
              <div className="placa-item">
                <PlacaInput valor={v.placa} tamanho="item" aoMudar={(p) => mudarVeiculo(n, { placa: p, marca: '', modelo: '', consulta: null })} aria-label={`Placa do veículo ${n + 1}`} />
                <button type="button" className="botao-redondo clara" title="Consultar esta placa" aria-label="Consultar esta placa"
                  disabled={!podeLoja('placa.consultar')} onClick={() => setConsulta({ indice: n, placa: v.placa })}><Icone nome="busca" tamanho={18} /></button>
              </div>
              <SeletorVeiculo tipo={v.tipo_veiculo} marca={v.marca} modelo={v.modelo} disabled={!editavel} aoMudar={(campos) => mudarVeiculo(n, campos)} />
              <button type="button" className="fechar" aria-label={`Remover veículo ${n + 1}`} title="Remover este veículo e os itens dele (o único fica em branco)"
                onClick={() => setVeiculos((l) => (l.length === 1 ? [veiculoVazio()] : l.filter((_, k) => k !== n)))}>×</button>
            </div>
            {v.consulta && <RelatorioConsulta dados={v.consulta} />}
            <div className="itens-venda">
              <div className="item-venda cabecalho-itens" aria-hidden="true">
                <span>Serviço / produto</span><span>Qtd.</span><span>Valor unitário</span><span>Total</span><span />
              </div>
              {v.itens.map((i, m) => (
                <div key={m} className="item-venda">
                  <label><span className="so-celular rotulo-campo">Serviço / produto</span>
                    <select value={i.servico_id} onChange={(e) => escolherServico(n, m, e.target.value)} aria-label={`Serviço do item ${m + 1} do veículo ${n + 1}`}>
                      <option value="">Escolha…</option>
                      {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.tipo === 'produto' ? ' (PRODUTO)' : ''}</option>)}
                    </select>
                  </label>
                  <label><span className="so-celular rotulo-campo">Quantidade</span>
                    <input value={i.quantidade} inputMode="numeric" onChange={(e) => mudarItem(n, m, { quantidade: e.target.value.replace(/\D/g, '') })} aria-label={`Quantidade do item ${m + 1} do veículo ${n + 1}`} />
                  </label>
                  <label><span className="so-celular rotulo-campo">Valor unitário (R$)</span>
                    <input value={i.valor_unit} inputMode="numeric" data-moeda placeholder="0,00" readOnly={!precoLiberado}
                      className={precoLiberado ? undefined : 'preco-travado'} title={precoLiberado ? undefined : 'Preço travado: clique para alterar com a senha de quem autoriza'}
                      onClick={() => { if (!precoLiberado && editavel) setPedindoPreco(true); }}
                      onChange={(e) => mudarItem(n, m, { valor_unit: e.target.value })} aria-label={`Valor unitário do item ${m + 1} do veículo ${n + 1}`} />
                  </label>
                  <strong className="total-item">R$ {moeda(numero(i.quantidade) * numero(i.valor_unit))}</strong>
                  <button type="button" className="fechar" aria-label={`Remover item ${m + 1} do veículo ${n + 1}`}
                    onClick={() => mudarItens(n, (itens) => (itens.length === 1 ? [itemVazio()] : itens.filter((_, k) => k !== m)))}>×</button>
                </div>
              ))}
              <button type="button" className="botao-texto" onClick={() => mudarItens(n, (itens) => [...itens, itemVazio()])}><Icone nome="mais" tamanho={18} /> Adicionar item</button>
            </div>
          </div>
        ))}
        <button type="button" className="botao-contorno mais-veiculo" onClick={() => setVeiculos((l) => [...l, veiculoVazio()])}><Icone nome="mais" tamanho={18} /> Veículo</button>
      </fieldset>

      <fieldset className="cartao secao-venda" disabled={!editavel}>
        <legend>Valor e pagamento</legend>
        <div className="resumo-valor">
          <label>Desconto (R$)<input value={desconto} inputMode="numeric" data-moeda placeholder="0,00" title="Precisa da senha de um sênior ou administrador"
            onChange={(e) => setDesconto(e.target.value)} /></label>
          <span>Itens<strong>R$ {moeda(bruto)}</strong></span>
          <span>Desconto<strong className="negativo">− R$ {moeda(numero(desconto))}</strong></span>
          <span className="total-venda">Total<strong>R$ {moeda(total)}</strong></span>
        </div>
        <div className="pagamentos-venda">
          {pagamentos.map((pg, n) => (
            <div key={pg.chave} className={`pagamento-venda${ehCartao(pg.forma) ? ' com-cartao' : ''}`}>
              <label><span className="rotulo-campo">Data do pagamento</span>
                <CampoData value={pg.data_pagamento} onChange={(e) => mudarPagamento(n, { data_pagamento: e.target.value })} aria-label={`Data do pagamento ${n + 1}`} />
              </label>
              <label><span className="rotulo-campo">Forma de pagamento</span>
                <select value={pg.forma} onChange={(e) => mudarPagamento(n, { forma: e.target.value })} aria-label={`Forma do pagamento ${n + 1}`}>
                  {Object.entries(FORMAS_PAGAMENTO).map(([k, nome]) => <option key={k} value={k}>{semAcento(nome)}</option>)}
                </select>
              </label>
              <label><span className="rotulo-campo">Valor (R$)</span>
                <input value={pg.valor} inputMode="numeric" data-moeda placeholder={falta > 0 ? moeda(falta) : '0,00'}
                  onFocus={(e) => {
                    // sugere o que falta pagar, já selecionado: digitar outro valor substitui
                    if (!pg.valor && falta > 0) mudarPagamento(n, { valor: moeda(falta) });
                    const campo = e.target; setTimeout(() => campo.select(), 0);
                  }}
                  onChange={(e) => mudarPagamento(n, { valor: e.target.value })} aria-label={`Valor do pagamento ${n + 1}`} />
              </label>
              {ehCartao(pg.forma) && (
                <>
                  <label><span className="rotulo-campo">CV</span>
                    <input value={pg.cv} placeholder="Nº DO COMPROVANTE" onChange={(e) => mudarPagamento(n, { cv: e.target.value })} aria-label={`CV do pagamento ${n + 1}`} />
                  </label>
                  <label><span className="rotulo-campo">Bandeira</span>
                    <select value={pg.bandeira} onChange={(e) => mudarPagamento(n, { bandeira: e.target.value })} aria-label={`Bandeira do pagamento ${n + 1}`}>
                      <option value="">ESCOLHA…</option>
                      {BANDEIRAS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </label>
                </>
              )}
              <label><span className="rotulo-campo">Detalhe</span>
                <input value={pg.detalhe}  placeholder={ehCartao(pg.forma) ? 'EX.: MAQUININHA' : 'EX.: BANCO DO PIX'} onChange={(e) => mudarPagamento(n, { detalhe: e.target.value })} aria-label={`Detalhe do pagamento ${n + 1}`} />
              </label>
              <button type="button" className="fechar" aria-label={`Remover pagamento ${n + 1}`}
                onClick={() => setPagamentos((l) => (l.length === 1 ? [pagamentoVazio()] : l.filter((_, k) => k !== n)))}>×</button>
            </div>
          ))}
          <div className="rodape-pagamentos">
            <button type="button" className="botao-texto" onClick={() => setPagamentos((l) => [...l, pagamentoVazio(falta > 0 ? moeda(falta) : '')])}>
              <Icone nome="mais" tamanho={18} /> Outra forma de pagamento
            </button>
            <span className={Math.abs(falta) < 0.005 ? 'pago-ok' : 'pago-falta'}>
              Pago R$ {moeda(pago)} · {Math.abs(falta) < 0.005 ? 'fechou o total' : falta > 0 ? `falta R$ ${moeda(falta)}` : `passou R$ ${moeda(-falta)}`}
            </span>
          </div>
        </div>
        <label className="campo">Observações<textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} /></label>
      </fieldset>

      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="acoes-vistoria">
        {['aberta', 'futuro'].includes(venda?.situacao) && pode.cancelar && <button className="botao-contorno perigo" onClick={cancelar}>Cancelar venda</button>}
        {venda?.situacao === 'finalizada' && <button className="botao-contorno" onClick={() => setLiberando(true)}>Liberar edição</button>}
        {editavel && <button className="botao-contorno" onClick={() => salvar(false)} disabled={ocupado}>Salvar</button>}
        {venda?.situacao === 'futuro' && pode.editar && <button className="botao-contorno" onClick={confirmar} disabled={ocupado}>Confirmar venda</button>}
        {editavel && pode.finalizar && <button className="botao-primario" onClick={() => salvar(true)} disabled={ocupado}>Salvar e finalizar</button>}
      </div>

      {venda?.historico?.length > 0 && (
        <section className="cartao painel historico">
          <h2>Histórico</h2>
          <ul>
            {venda.historico.map((h, k) => (
              <li key={k}>
                <small className="cinza">{new Date(h.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
                <span><strong>{h.usuario}</strong> {ACOES[h.acao] || h.acao}{h.detalhe && `: ${h.detalhe}`}
                  {h.autorizado_por && ` (autorizado por ${h.autorizado_por})`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {consulta && (
        <ConsultaPlaca loja={loja} placaInicial={consulta.placa} aoUsar={editavel ? usarVeiculo : undefined} aoFechar={() => setConsulta(null)} />
      )}
      {cadastrando && (
        <EditorCliente lojas={lojasCadastro} lojaInicial={loja} aoAbrir={() => {}} aoFechar={() => setCadastrando(false)}
          aoSalvar={async (cid) => {
            setCadastrando(false);
            try { setCliente(await api(`/clientes/${cid}`)); setModoCliente('atual'); } catch (falha) { setErro(falha.message); }
          }} />
      )}
      {trocandoUnidade && (
        <TrocarUnidade venda={venda} lojas={lojasPermitidas.filter((l) => l !== venda.loja_id && perfil.lojas.find((x) => x.id === l)?.empresa_id === perfil.lojas.find((x) => x.id === venda.loja_id)?.empresa_id)
          .map((l) => perfil.lojas.find((x) => x.id === l))} emailSugerido={pode.autorizar ? perfil.usuario.email : ''}
          aoFechar={() => setTrocandoUnidade(false)} aoTrocar={() => { setTrocandoUnidade(false); carregar(); }} />
      )}
      {pedindoPreco && (
        <AutorizarDesconto titulo="Alterar preço dos itens" texto="O preço vem da tabela do serviço ou do preço especial do cliente. Para alterar, precisa da senha de um sênior ou administrador. Fica registrado no histórico da venda."
          emailSugerido={pode.desconto ? perfil.usuario.email : ''} aoFechar={() => setPedindoPreco(false)}
          aoAutorizar={async (a) => {
            const r = await api('/vendas/autorizar-preco', { metodo: 'POST', corpo: { loja_id: loja, ...a } });
            setPrecoLiberado({ ...a, nome: r.nome }); setPedindoPreco(false);
          }} />
      )}
      {autorizando && (
        <AutorizarDesconto desconto={numero(desconto)} emailSugerido={pode.desconto ? perfil.usuario.email : ''}
          aoFechar={() => setAutorizando(null)}
          aoAutorizar={async (a) => { await salvar(autorizando.finalizar, a); setAutorizando(null); }} />
      )}
      {liberando && (
        <LiberarEdicao venda={venda} dispensaSenha={perfil.master || pode.autorizar}
          aoFechar={() => setLiberando(false)} aoLiberar={() => { setLiberando(false); carregar(); }} />
      )}
      {aviso && <div className="aviso" role="status">{aviso}</div>}
    </>
  );
}

// Troca a unidade de uma venda aberta com a senha de um supervisor/administrador
function TrocarUnidade({ venda, lojas, emailSugerido, aoFechar, aoTrocar }) {
  const [loja, setLoja] = useState(lojas[0]?.id || '');
  const [email, setEmail] = useState(emailSugerido);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function trocar(e) {
    e.preventDefault();
    setEnviando(true); setErro('');
    try { await api(`/vendas/${venda.id}/unidade`, { metodo: 'POST', corpo: { loja_id: loja, email, senha } }); aoTrocar(); }
    catch (falha) { setErro(falha.message); setEnviando(false); }
  }
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Trocar unidade">
        <div className="modal-topo">
          <h2>Trocar a unidade da venda nº {venda.numero}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {lojas.length === 0 ? <p className="cinza">Não há outra unidade do mesmo grupo para escolher.</p> : (
          <form className="formulario" onSubmit={trocar}>
            <label>Nova unidade
              <select value={loja} onChange={(e) => setLoja(e.target.value)}>{lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}</select>
            </label>
            <p className="cinza ajuda">Precisa da senha de um supervisor ou administrador (perfil com "Autorizar alteração de venda"). Fica registrado no histórico.</p>
            <label>E-mail de quem autoriza<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></label>
            <label>Senha de quem autoriza<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="new-password" /></label>
            {erro && <p className="erro" role="alert">{erro}</p>}
            <div className="acoes-modal">
              <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
              <button className="botao-primario" disabled={enviando}>{enviando ? 'Conferindo…' : 'Trocar unidade'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

// Desconto: e-mail e senha de quem pode autorizar (master ou perfil com "Dar desconto")
function AutorizarDesconto({ desconto, titulo, texto, emailSugerido, aoFechar, aoAutorizar }) {
  const [email, setEmail] = useState(emailSugerido);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true); setErro('');
    try { await aoAutorizar({ email, senha }); } catch (falha) { setErro(falha.message); setEnviando(false); }
  }
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={titulo || 'Autorizar desconto'}>
        <div className="modal-topo">
          <h2>{titulo || `Autorizar desconto de R$ ${moeda(desconto)}`}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={enviar}>
          <p className="cinza ajuda">{texto || 'O desconto só vale com a senha de um sênior ou administrador. Fica registrado no histórico da venda.'}</p>
          <label>E-mail de quem autoriza<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" autoFocus={!emailSugerido} /></label>
          <label>Senha de quem autoriza<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="new-password" autoFocus={Boolean(emailSugerido)} /></label>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={enviando}>{enviando ? 'Conferindo…' : 'Autorizar'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function LiberarEdicao({ venda, dispensaSenha, aoFechar, aoLiberar }) {
  const [motivo, setMotivo] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function liberar(e) {
    e.preventDefault();
    setEnviando(true); setErro('');
    try {
      await api(`/vendas/${venda.id}/reabrir`, { metodo: 'POST', corpo: { motivo, email, senha } });
      aoLiberar();
    } catch (falha) {
      setErro(falha.message); setEnviando(false);
    }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Liberar edição">
        <div className="modal-topo">
          <h2>Liberar edição da venda nº {venda.numero}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={liberar}>
          <label>Motivo da alteração<input value={motivo} onChange={(e) => setMotivo(e.target.value)} required autoFocus /></label>
          {!dispensaSenha && (
            <>
              <p className="cinza ajuda">Precisa da autorização de um administrador ou de quem tem a permissão "Autorizar alteração de venda finalizada".</p>
              <label>E-mail de quem autoriza<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></label>
              <label>Senha de quem autoriza<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="new-password" /></label>
            </>
          )}
          <p className="cinza ajuda">A venda volta para "Aberta" e a liberação fica registrada no histórico.</p>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={enviando}>{enviando ? 'Liberando…' : 'Liberar edição'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

