import { useEffect, useId, useState } from 'react';
import { api, moeda } from './api.js';
import { Icone } from './icones.jsx';
import { Placa, PlacaInput, PlacasDiversas, placaValida } from './Placa.jsx';
import { lerMoeda, paraMoeda } from './entrada.js';
import { SeletorVeiculo } from './Veiculo.jsx';
import ConsultaPlaca from './ConsultaPlaca.jsx';
import { cnpjValido, cpfValido, formatarDoc, mascaraCnpj, mascaraCpf, mascaraTelefone } from './documentos.js';

export const SITUACOES = { aberta: 'Aberta', finalizada: 'Finalizada', cancelada: 'Cancelada' };
const ACOES = { criada: 'Criou', alterada: 'Alterou', finalizada: 'Finalizou', reaberta: 'Reabriu para edição', cancelada: 'Cancelou' };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const numero = lerMoeda;
const Etiqueta = ({ situacao }) => <span className={`etiqueta venda-${situacao}`}>{SITUACOES[situacao]}</span>;
export const FORMAS_PAGAMENTO = { pix: 'PIX', dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito',
  boleto: 'Boleto', transferencia: 'Transferência', faturado: 'Faturado' };
const itemVazio = () => ({ servico_id: '', quantidade: '1', valor_unit: '' });
let chaves = 0;
// A venda é organizada por veículo: cada veículo tem os seus itens
const veiculoVazio = () => ({ chave: ++chaves, placa: '', tipo_veiculo: null, marca: '', modelo: '', itens: [itemVazio()] });
const pagamentoVazio = (valor = '') => ({ chave: ++chaves, data_pagamento: hoje(), forma: 'pix', valor, detalhe: '' });

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

export function ListaVendas({ loja, podeCriar, aoAbrir, aoNova, buscaInicial = '', empresa }) {
  const [[de, ate], setIntervalo] = useState(buscaInicial ? PERIODOS.todas() : PERIODOS.mes());
  const [situacao, setSituacao] = useState('');
  const [cliente, setCliente] = useState(buscaInicial);
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams({ ...(loja && { loja }), ...(de && { de }), ...(ate && { ate }), ...(situacao && { situacao }),
      ...(cliente.trim() && { cliente: cliente.trim() }), ...(busca.trim() && { busca: busca.trim() }) });
    const t = setTimeout(() => api(`/vendas?${q}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message)), busca || cliente ? 300 : 0);
    return () => clearTimeout(t);
  }, [loja, de, ate, situacao, cliente, busca]);

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
      await gerarPdfVendas({ lista, filtros, empresa });
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
          {podeCriar && <button className="botao-primario" onClick={aoNova}><Icone nome="mais" tamanho={18} /> Nova venda</button>}
        </span>
      </div>
      <div className="filtros">
        <div className="abas" role="tablist">
          {[['hoje', 'Hoje'], ['mes', 'Este mês'], ['anterior', 'Mês passado'], ['todas', 'Todas']].map(([v, n]) => (
            <button key={v} role="tab" aria-selected={periodoAtivo === v} className={periodoAtivo === v ? 'ativa' : ''} onClick={() => setIntervalo(PERIODOS[v]())}>{n}</button>
          ))}
        </div>
        <label className="filtro-data">De<input type="date" value={de} max={ate || undefined} onChange={(e) => setIntervalo([e.target.value, ate])} /></label>
        <label className="filtro-data">Até<input type="date" value={ate} min={de || undefined} onChange={(e) => setIntervalo([de, e.target.value])} /></label>
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
          <div className="tabela-vendas" role="table">
            {lista.map((v) => (
              <button key={v.id} className="cartao linha-venda" role="row" onClick={() => aoAbrir(v.id)}>
                <span className="lv-num"><strong>Nº {v.numero}</strong></span>
                <span className="lv-cliente">
                  {!v.placas ? <small className="cinza lv-sem-placa">Sem placa</small>
                    : v.placas.includes(',') ? <PlacasDiversas tamanho="mini" /> : <Placa placa={v.placas} tamanho="mini" />}
                  <span className="lv-nome">
                    <strong>{v.cliente}</strong>
                    <small className="cinza">{v.cpf_cnpj && `${formatarDoc(v.cpf_cnpj)}`}{v.cpf_cnpj && !loja && ' · '}{!loja && v.loja}</small>
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Nova venda / edição
// ---------------------------------------------------------------------------
export function EditorVenda({ id, perfil, lojaInicial, lojasPermitidas, aoVoltar, aoSalvo, aoTitulo }) {
  const grupo = useId(); // nomes únicos dos botões de opção (várias vendas abertas em abas)
  const [venda, setVenda] = useState(null); // carregada do servidor (null = nova)
  const [loja, setLoja] = useState(lojasPermitidas.includes(lojaInicial) ? lojaInicial : lojasPermitidas[0] || '');
  const [data, setData] = useState(hoje());
  const [modoCliente, setModoCliente] = useState('avulso');
  const [cliente, setCliente] = useState(null);
  const [busca, setBusca] = useState('');
  const [clientes, setClientes] = useState([]);
  const [novo, setNovo] = useState({ tipo: 'pf', nome: '', cpf_cnpj: '', whatsapp: '', email: '' });
  const [receita, setReceita] = useState(''); // situação da busca do CNPJ
  const [veiculos, setVeiculos] = useState(() => [veiculoVazio()]);
  const [pagamentos, setPagamentos] = useState(() => [pagamentoVazio()]);
  const [desconto, setDesconto] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [servicos, setServicos] = useState([]);
  const [consulta, setConsulta] = useState(null); // { indice, placa }
  const [liberando, setLiberando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [carregando, setCarregando] = useState(Boolean(id));

  const acessos = perfil.master ? null : perfil.acessos[venda?.loja_id || loja] || [];
  const podeLoja = (p) => !acessos || acessos.includes(p);
  const pode = venda?.pode || { editar: podeLoja('vendas.criar'), finalizar: podeLoja('vendas.finalizar'), cancelar: podeLoja('vendas.cancelar'), desconto: podeLoja('vendas.desconto'), autorizar: podeLoja('vendas.autorizar') };
  const editavel = (!venda || venda.situacao === 'aberta') && pode.editar;

  async function carregar() {
    try {
      const v = await api(`/vendas/${id}`);
      setVenda(v); setLoja(v.loja_id); setData(String(v.data_venda).slice(0, 10));
      setCliente(v.cliente); setModoCliente(v.cliente.tipo === 'avulso' ? 'avulso' : 'atual');
      // agrupa os itens por placa, na ordem em que foram lançados
      const grupos = [];
      for (const i of v.itens) {
        let g = grupos.find((x) => x.placa === (i.placa || ''));
        if (!g) grupos.push(g = { ...veiculoVazio(), placa: i.placa || '', tipo_veiculo: i.tipo_veiculo || null, marca: i.marca || '', modelo: i.modelo || '', itens: [] });
        g.itens.push({ servico_id: i.servico_id, quantidade: String(Number(i.quantidade)), valor_unit: paraMoeda(i.valor_unit) });
      }
      setVeiculos(grupos.length ? grupos : [veiculoVazio()]);
      setPagamentos(v.pagamentos?.length
        ? v.pagamentos.map((pg) => ({ ...pagamentoVazio(), data_pagamento: String(pg.data_pagamento).slice(0, 10), forma: pg.forma, valor: paraMoeda(pg.valor), detalhe: pg.detalhe || '' }))
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
    const t = setTimeout(() => api(`/clientes?loja=${loja}&busca=${encodeURIComponent(busca)}`).then(setClientes).catch((f) => setErro(f.message)), 300);
    return () => clearTimeout(t);
  }, [busca, modoCliente, loja]);

  // CNPJ completo e válido: busca razão social e contato nos dados públicos da Receita
  async function mudarDocumento(valor) {
    const doc = novo.tipo === 'pj' ? mascaraCnpj(valor) : mascaraCpf(valor);
    setNovo((n) => ({ ...n, cpf_cnpj: doc }));
    setReceita('');
    if (novo.tipo !== 'pj' || doc.replace(/\D/g, '').length < 14) return;
    if (!cnpjValido(doc)) return setReceita('CNPJ inválido. Confira os números.');
    setReceita('Buscando na Receita…');
    try {
      const r = await api(`/cnpj/${doc.replace(/\D/g, '')}`);
      setNovo((n) => ({
        ...n, nome: r.razao_social || n.nome,
        whatsapp: n.whatsapp || (r.telefone ? mascaraTelefone(r.telefone) : ''), email: n.email || r.email || '',
        cep: r.cep, endereco: r.endereco, cidade: r.cidade, uf: r.uf,
      }));
      setReceita(`Encontrado na Receita${r.situacao ? ` · situação: ${r.situacao}` : ''}${r.cidade ? ` · ${r.cidade}/${r.uf}` : ''}`);
    } catch (falha) {
      setReceita(falha.message);
    }
  }

  const precoDe = (servicoId, tipoVeiculo) => {
    const s = servicos.find((x) => x.id === servicoId);
    if (!s) return '';
    return paraMoeda(s.precos?.[tipoVeiculo || 'carro'] ?? s.valor_padrao);
  };
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
    const campos = { placa: dados.placa, tipo_veiculo: dados.tipo, marca: dados.marca || '', modelo: dados.modelo || '' };
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

  async function salvar(finalizar = false) {
    setErro('');
    if (modoCliente === 'buscar' && !cliente) return setErro('Escolha o cliente na lista.');
    if (modoCliente === 'novo' && !novo.nome.trim()) return setErro('Informe o nome do cliente.');
    if (modoCliente === 'novo' && novo.tipo === 'pf' && !cpfValido(novo.cpf_cnpj)) return setErro('CPF inválido. Confira os números.');
    if (modoCliente === 'novo' && novo.tipo === 'pj' && !cnpjValido(novo.cpf_cnpj)) return setErro('CNPJ inválido. Confira os números.');
    const placaRuim = veiculos.findIndex((v) => v.placa && !placaValida(v.placa));
    if (placaRuim >= 0) return setErro(`Veículo ${placaRuim + 1}: placa incompleta.`);
    if (finalizar && Math.abs(falta) > 0.005) {
      return setErro(`Para finalizar, os pagamentos precisam fechar o total: ${falta > 0 ? `faltam R$ ${moeda(falta)}` : `sobram R$ ${moeda(-falta)}`}.`);
    }
    setOcupado(true);
    try {
      const corpo = {
        loja_id: loja, data_venda: data, desconto: numero(desconto), observacoes,
        itens: veiculos.flatMap(({ placa, tipo_veiculo, marca, modelo, itens }) => itens.filter((i) => i.servico_id)
          .map(({ servico_id, quantidade, valor_unit }) => ({ servico_id, placa, tipo_veiculo, marca, modelo, quantidade: numero(quantidade), valor_unit: numero(valor_unit) }))),
        pagamentos: pagamentos.filter((pg) => numero(pg.valor) > 0)
          .map(({ data_pagamento, forma, valor, detalhe }) => ({ data_pagamento, forma, valor: numero(valor), detalhe })),
        ...(modoCliente === 'avulso' && { cliente_avulso: true }),
        ...((modoCliente === 'buscar' || modoCliente === 'atual') && cliente && { cliente_id: cliente.id }),
        ...(modoCliente === 'novo' && { cliente_novo: novo }),
      };
      let vid = venda?.id;
      if (vid) await api(`/vendas/${vid}`, { metodo: 'PUT', corpo });
      else vid = (await api('/vendas', { metodo: 'POST', corpo })).id;
      if (finalizar) await api(`/vendas/${vid}/finalizar`, { metodo: 'POST' });
      if (!venda) return aoSalvo(vid);
      await carregar();
      setAviso(finalizar ? 'Venda finalizada.' : 'Venda salva.'); setTimeout(() => setAviso(''), 2200);
    } catch (falha) {
      setErro(falha.message);
      if (venda) carregar();
    } finally {
      setOcupado(false);
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
          <label className="campo">Data do serviço<input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label className="campo">Centro de custo (loja)
            {venda || lojasPermitidas.length < 2 ? <input value={nomeLoja || ''} readOnly className="somente-leitura" /> : (
              <select value={loja} onChange={(e) => setLoja(e.target.value)}>
                {lojasPermitidas.map((l) => <option key={l} value={l}>{perfil.lojas.find((x) => x.id === l)?.nome}</option>)}
              </select>
            )}
          </label>
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
              <input type="radio" name={`${grupo}-modo-cliente`} checked={modoCliente === v} onChange={() => setModoCliente(v)} /><strong>{n}</strong>
            </label>
          ))}
        </div>
        {modoCliente === 'buscar' && (
          <div className="formulario">
            <input type="search" value={busca} onChange={(e) => { setBusca(e.target.value); setCliente(null); }} placeholder="Nome, CPF/CNPJ ou telefone" aria-label="Buscar cliente" />
            <ul className="lista-clientes">
              {clientes.filter((c) => c.tipo !== 'avulso').map((c) => (
                <li key={c.id}>
                  <label className={cliente?.id === c.id ? 'opcao marcada' : 'opcao'}>
                    <input type="radio" name={`${grupo}-cliente`} checked={cliente?.id === c.id} onChange={() => setCliente(c)} />
                    <strong>{c.nome}</strong><small className="cinza">{c.tipo === 'pj' ? 'Empresa' : 'Pessoa física'}{c.cpf_cnpj && ` · ${formatarDoc(c.cpf_cnpj)}`}</small>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        {modoCliente === 'novo' && (
          <div className="dados-veiculo">
            <label>Tipo
              <select value={novo.tipo} onChange={(e) => { setNovo({ ...novo, tipo: e.target.value, cpf_cnpj: '' }); setReceita(''); }}>
                <option value="pf">Pessoa física</option><option value="pj">Empresa</option>
              </select>
            </label>
            <label>{novo.tipo === 'pj' ? 'CNPJ' : 'CPF'}
              <input value={novo.cpf_cnpj} inputMode="numeric" placeholder={novo.tipo === 'pj' ? '12.345.678/0001-90' : '123.456.789-10'}
                onChange={(e) => mudarDocumento(e.target.value)} />
            </label>
            <label>{novo.tipo === 'pj' ? 'Razão social' : 'Nome'}<input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></label>
            <label>WhatsApp<input value={novo.whatsapp} inputMode="tel" placeholder="(11) 99999-9999" onChange={(e) => setNovo({ ...novo, whatsapp: mascaraTelefone(e.target.value) })} /></label>
            <label>E-mail<input value={novo.email} type="email" placeholder="Opcional" onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></label>
            {receita && <small className="aviso-receita">{receita}</small>}
          </div>
        )}
      </fieldset>

      <fieldset className="cartao secao-venda" disabled={!editavel}>
        <legend>Veículos e itens</legend>
        {veiculos.map((v, n) => (
          <div key={v.chave} className="grupo-veiculo">
            <div className="bloco-veiculo">
              <div className="placa-item">
                <PlacaInput valor={v.placa} tamanho="item" aoMudar={(p) => mudarVeiculo(n, { placa: p, marca: '', modelo: '' })} aria-label={`Placa do veículo ${n + 1}`} />
                <button type="button" className="botao-redondo clara" title="Consultar esta placa" aria-label="Consultar esta placa"
                  disabled={!podeLoja('placa.consultar')} onClick={() => setConsulta({ indice: n, placa: v.placa })}><Icone nome="busca" tamanho={18} /></button>
              </div>
              <SeletorVeiculo tipo={v.tipo_veiculo} marca={v.marca} modelo={v.modelo} disabled={!editavel} aoMudar={(campos) => mudarVeiculo(n, campos)} />
              <button type="button" className="fechar" aria-label={`Remover veículo ${n + 1}`} title="Remover este veículo e os itens dele"
                disabled={veiculos.length === 1} onClick={() => setVeiculos((l) => l.filter((_, k) => k !== n))}>×</button>
            </div>
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
                    <input value={i.valor_unit} inputMode="numeric" data-moeda placeholder="0,00" onChange={(e) => mudarItem(n, m, { valor_unit: e.target.value })} aria-label={`Valor unitário do item ${m + 1} do veículo ${n + 1}`} />
                  </label>
                  <strong className="total-item">R$ {moeda(numero(i.quantidade) * numero(i.valor_unit))}</strong>
                  <button type="button" className="fechar" aria-label={`Remover item ${m + 1} do veículo ${n + 1}`} disabled={v.itens.length === 1}
                    onClick={() => mudarItens(n, (itens) => itens.filter((_, k) => k !== m))}>×</button>
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
          <label>Desconto (R$)<input value={desconto} inputMode="numeric" data-moeda placeholder="0,00" disabled={!pode.desconto}
            onChange={(e) => setDesconto(e.target.value)} /></label>
          <span>Itens<strong>R$ {moeda(bruto)}</strong></span>
          <span>Desconto<strong className="negativo">− R$ {moeda(numero(desconto))}</strong></span>
          <span className="total-venda">Total<strong>R$ {moeda(total)}</strong></span>
        </div>
        <div className="pagamentos-venda">
          <div className="pagamento-venda cabecalho-itens" aria-hidden="true">
            <span>Data do pagamento</span><span>Forma de pagamento</span><span>Valor (R$)</span><span>Detalhe</span><span />
          </div>
          {pagamentos.map((pg, n) => (
            <div key={pg.chave} className="pagamento-venda">
              <label><span className="so-celular rotulo-campo">Data do pagamento</span>
                <input type="date" value={pg.data_pagamento} onChange={(e) => mudarPagamento(n, { data_pagamento: e.target.value })} aria-label={`Data do pagamento ${n + 1}`} />
              </label>
              <label><span className="so-celular rotulo-campo">Forma de pagamento</span>
                <select value={pg.forma} onChange={(e) => mudarPagamento(n, { forma: e.target.value })} aria-label={`Forma do pagamento ${n + 1}`}>
                  {Object.entries(FORMAS_PAGAMENTO).map(([k, nome]) => <option key={k} value={k}>{nome.toUpperCase()}</option>)}
                </select>
              </label>
              <label><span className="so-celular rotulo-campo">Valor (R$)</span>
                <input value={pg.valor} inputMode="numeric" data-moeda placeholder={falta > 0 ? moeda(falta) : '0,00'}
                  onFocus={(e) => {
                    // sugere o que falta pagar, já selecionado: digitar outro valor substitui
                    if (!pg.valor && falta > 0) mudarPagamento(n, { valor: moeda(falta) });
                    const campo = e.target; setTimeout(() => campo.select(), 0);
                  }}
                  onChange={(e) => mudarPagamento(n, { valor: e.target.value })} aria-label={`Valor do pagamento ${n + 1}`} />
              </label>
              <label><span className="so-celular rotulo-campo">Detalhe</span>
                <input value={pg.detalhe} placeholder="Ex.: MAQUININHA, BANDEIRA, BANCO" onChange={(e) => mudarPagamento(n, { detalhe: e.target.value })} aria-label={`Detalhe do pagamento ${n + 1}`} />
              </label>
              <button type="button" className="fechar" aria-label={`Remover pagamento ${n + 1}`} disabled={pagamentos.length === 1}
                onClick={() => setPagamentos((l) => l.filter((_, k) => k !== n))}>×</button>
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
        {venda?.situacao === 'aberta' && pode.cancelar && <button className="botao-contorno perigo" onClick={cancelar}>Cancelar venda</button>}
        {venda?.situacao === 'finalizada' && <button className="botao-contorno" onClick={() => setLiberando(true)}>Liberar edição</button>}
        {editavel && <button className="botao-contorno" onClick={() => salvar(false)} disabled={ocupado}>Salvar</button>}
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
      {liberando && (
        <LiberarEdicao venda={venda} dispensaSenha={perfil.master || pode.autorizar}
          aoFechar={() => setLiberando(false)} aoLiberar={() => { setLiberando(false); carregar(); }} />
      )}
      {aviso && <div className="aviso" role="status">{aviso}</div>}
    </>
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

