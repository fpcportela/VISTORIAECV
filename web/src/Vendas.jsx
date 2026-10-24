import { useEffect, useState } from 'react';
import { api, moeda } from './api.js';
import { Icone } from './icones.jsx';
import { PlacaInput, placaValida } from './Placa.jsx';
import ConsultaPlaca from './ConsultaPlaca.jsx';
import { cnpjValido, cpfValido, formatarDoc, mascaraCnpj, mascaraCpf, mascaraTelefone } from './documentos.js';

const SITUACOES = { aberta: 'Aberta', finalizada: 'Finalizada', cancelada: 'Cancelada' };
const TIPOS_VENDA = { orcamento: 'Orçamento', venda_avulsa: 'Venda avulsa' };
const ACOES = { criada: 'Criou', alterada: 'Alterou', finalizada: 'Finalizou', reaberta: 'Reabriu para edição', cancelada: 'Cancelou' };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const numero = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const Etiqueta = ({ situacao }) => <span className={`etiqueta venda-${situacao}`}>{SITUACOES[situacao]}</span>;
const itemVazio = () => ({ servico_id: '', placa: '', tipo_veiculo: null, veiculo: '', quantidade: '1', valor_unit: '' });

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
  const [tipo, setTipo] = useState('');
  const [cliente, setCliente] = useState(buscaInicial);
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams({ ...(loja && { loja }), ...(de && { de }), ...(ate && { ate }), ...(situacao && { situacao }), ...(tipo && { tipo }),
      ...(cliente.trim() && { cliente: cliente.trim() }), ...(busca.trim() && { busca: busca.trim() }) });
    const t = setTimeout(() => api(`/vendas?${q}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message)), busca || cliente ? 300 : 0);
    return () => clearTimeout(t);
  }, [loja, de, ate, situacao, tipo, cliente, busca]);

  const total = (lista || []).filter((v) => v.situacao !== 'cancelada' && v.tipo === 'venda_avulsa').reduce((t, v) => t + v.valor_total, 0);
  const periodoAtivo = Object.keys(PERIODOS).find((k) => { const [a, b] = PERIODOS[k](); return a === de && b === ate; });

  async function pdf() {
    setGerando(true);
    try {
      const filtros = [
        de || ate ? `Período: ${de ? dataBR(de) : 'início'} a ${ate ? dataBR(ate) : 'hoje'}` : 'Todo o período',
        cliente.trim() && `Cliente: ${cliente.trim()}`, busca.trim() && `Busca: ${busca.trim()}`,
        tipo && TIPOS_VENDA[tipo], situacao && SITUACOES[situacao],
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
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
          <option value="">Vendas e orçamentos</option>
          {Object.entries(TIPOS_VENDA).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
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
                <span className="lv-num"><strong>Nº {v.numero}</strong><small className="cinza">{TIPOS_VENDA[v.tipo]}</small></span>
                <span className="lv-cliente"><strong>{v.cliente}</strong><small className="cinza">{v.cpf_cnpj && `${formatarDoc(v.cpf_cnpj)} · `}{v.placas || 'Sem placa'}{!loja && ` · ${v.loja}`}</small></span>
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
export function EditorVenda({ id, perfil, lojaInicial, lojasPermitidas, aoVoltar, aoSalvo }) {
  const [venda, setVenda] = useState(null); // carregada do servidor (null = nova)
  const [loja, setLoja] = useState(lojasPermitidas.includes(lojaInicial) ? lojaInicial : lojasPermitidas[0] || '');
  const [tipo, setTipo] = useState('venda_avulsa');
  const [data, setData] = useState(hoje());
  const [modoCliente, setModoCliente] = useState('avulso');
  const [cliente, setCliente] = useState(null);
  const [busca, setBusca] = useState('');
  const [clientes, setClientes] = useState([]);
  const [novo, setNovo] = useState({ tipo: 'pf', nome: '', cpf_cnpj: '', whatsapp: '', email: '' });
  const [receita, setReceita] = useState(''); // situação da busca do CNPJ
  const [itens, setItens] = useState([itemVazio()]);
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
      setVenda(v); setLoja(v.loja_id); setTipo(v.tipo); setData(String(v.data_venda).slice(0, 10));
      setCliente(v.cliente); setModoCliente(v.cliente.tipo === 'avulso' ? 'avulso' : 'atual');
      setItens(v.itens.map((i) => ({ servico_id: i.servico_id, placa: i.placa || '', tipo_veiculo: i.tipo_veiculo, veiculo: [i.marca, i.modelo].filter(Boolean).join(' '), quantidade: String(i.quantidade), valor_unit: String(i.valor_unit) })));
      setDesconto(v.desconto ? String(v.desconto) : ''); setObservacoes(v.observacoes || '');
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
    return String(s.precos?.[tipoVeiculo || 'carro'] ?? s.valor_padrao);
  };
  const mudarItem = (n, campos) => setItens(itens.map((i, k) => (k === n ? { ...i, ...campos } : i)));
  const escolherServico = (n, servicoId) => mudarItem(n, { servico_id: servicoId, valor_unit: precoDe(servicoId, itens[n].tipo_veiculo) });

  // Placa consultada na API: preenche o item e ajusta o preço ao tipo do veículo
  function usarVeiculo(v) {
    const n = consulta.indice ?? (itens.findIndex((i) => !i.placa) >= 0 ? itens.findIndex((i) => !i.placa) : itens.length);
    const lista = n < itens.length ? [...itens] : [...itens, itemVazio()];
    const i = lista[n];
    lista[n] = { ...i, placa: v.placa, tipo_veiculo: v.tipo, veiculo: [v.marca, v.modelo].filter(Boolean).join(' '), valor_unit: i.servico_id ? precoDe(i.servico_id, v.tipo) : i.valor_unit };
    setItens(lista);
    setConsulta(null);
  }

  const bruto = itens.reduce((t, i) => t + numero(i.quantidade) * numero(i.valor_unit), 0);
  const total = bruto - numero(desconto);

  async function salvar(finalizar = false) {
    setErro('');
    if (modoCliente === 'buscar' && !cliente) return setErro('Escolha o cliente na lista.');
    if (modoCliente === 'novo' && !novo.nome.trim()) return setErro('Informe o nome do cliente.');
    if (modoCliente === 'novo' && novo.tipo === 'pf' && !cpfValido(novo.cpf_cnpj)) return setErro('CPF inválido. Confira os números.');
    if (modoCliente === 'novo' && novo.tipo === 'pj' && !cnpjValido(novo.cpf_cnpj)) return setErro('CNPJ inválido. Confira os números.');
    const placaRuim = itens.findIndex((i) => i.placa && !placaValida(i.placa));
    if (placaRuim >= 0) return setErro(`Item ${placaRuim + 1}: placa incompleta.`);
    setOcupado(true);
    try {
      const corpo = {
        loja_id: loja, tipo, data_venda: data, desconto: numero(desconto), observacoes,
        itens: itens.filter((i) => i.servico_id).map(({ servico_id, placa, tipo_veiculo, quantidade, valor_unit }) => ({ servico_id, placa, tipo_veiculo, quantidade: numero(quantidade), valor_unit: numero(valor_unit) })),
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
        <h1>{venda ? `${TIPOS_VENDA[venda.tipo]} nº ${venda.numero}` : 'Nova venda'}</h1>
        {venda ? <Etiqueta situacao={venda.situacao} /> : <span />}
      </div>

      {venda?.situacao === 'finalizada' && (
        <p className="aviso-texto">Venda finalizada: nada pode ser alterado. Para corrigir, use "Liberar edição" (precisa de autorização).</p>
      )}

      <fieldset className="cartao secao-venda" disabled={!editavel}>
        <legend>Informações</legend>
        <div className="grade-venda">
          <div className="campo">
            <span className="rotulo-campo">Tipo</span>
            <div className="alternador">
              {Object.entries(TIPOS_VENDA).map(([v, n]) => (
                <button type="button" key={v} className={tipo === v ? 'ativo' : ''} onClick={() => setTipo(v)}>{n}</button>
              ))}
            </div>
          </div>
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
              <input type="radio" name="modo-cliente" checked={modoCliente === v} onChange={() => setModoCliente(v)} /><strong>{n}</strong>
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
                    <input type="radio" name="cliente-escolhido" checked={cliente?.id === c.id} onChange={() => setCliente(c)} />
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
        <legend>Itens</legend>
        <div className="itens-venda">
          <div className="item-venda cabecalho-itens" aria-hidden="true">
            <span>Serviço / produto</span><span>Placa</span><span>Qtd.</span><span>Valor unitário</span><span>Total</span><span />
          </div>
          {itens.map((i, n) => (
            <div key={n} className="item-venda">
              <label><span className="so-celular rotulo-campo">Serviço / produto</span>
                <select value={i.servico_id} onChange={(e) => escolherServico(n, e.target.value)} aria-label={`Serviço do item ${n + 1}`}>
                  <option value="">Escolha…</option>
                  {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.tipo === 'produto' ? ' (produto)' : ''}</option>)}
                </select>
              </label>
              <div className="placa-item">
                <PlacaInput valor={i.placa} tamanho="item" aoMudar={(p) => mudarItem(n, { placa: p, veiculo: '', tipo_veiculo: null })} aria-label={`Placa do item ${n + 1}`} />
                <button type="button" className="botao-redondo clara" title="Consultar esta placa" aria-label="Consultar esta placa"
                  disabled={!podeLoja('placa.consultar')} onClick={() => setConsulta({ indice: n, placa: i.placa })}><Icone nome="busca" tamanho={18} /></button>
                {i.veiculo && <small className="cinza">{i.veiculo}</small>}
              </div>
              <label><span className="so-celular rotulo-campo">Quantidade</span>
                <input value={i.quantidade} inputMode="decimal" onChange={(e) => mudarItem(n, { quantidade: e.target.value })} aria-label={`Quantidade do item ${n + 1}`} />
              </label>
              <label><span className="so-celular rotulo-campo">Valor unitário (R$)</span>
                <input value={i.valor_unit} inputMode="decimal" onChange={(e) => mudarItem(n, { valor_unit: e.target.value })} aria-label={`Valor unitário do item ${n + 1}`} />
              </label>
              <strong className="total-item">R$ {moeda(numero(i.quantidade) * numero(i.valor_unit))}</strong>
              <button type="button" className="fechar" aria-label={`Remover item ${n + 1}`} disabled={itens.length === 1}
                onClick={() => setItens(itens.filter((_, k) => k !== n))}>×</button>
            </div>
          ))}
          <button type="button" className="botao-texto" onClick={() => setItens([...itens, itemVazio()])}><Icone nome="mais" tamanho={18} /> Adicionar item</button>
        </div>
      </fieldset>

      <fieldset className="cartao secao-venda" disabled={!editavel}>
        <legend>Valor</legend>
        <div className="resumo-valor">
          <label>Desconto (R$)<input value={desconto} inputMode="decimal" placeholder="0,00" disabled={!pode.desconto}
            onChange={(e) => setDesconto(e.target.value)} /></label>
          <span>Itens<strong>R$ {moeda(bruto)}</strong></span>
          <span>Desconto<strong className="negativo">− R$ {moeda(numero(desconto))}</strong></span>
          <span className="total-venda">Total<strong>R$ {moeda(total)}</strong></span>
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

