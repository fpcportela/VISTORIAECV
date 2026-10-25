import { useEffect, useState } from 'react';
import { api, moeda } from './api.js';
import { Icone } from './icones.jsx';
import { Placa, PlacaInput, limparPlaca, placaValida } from './Placa.jsx';

export const TIPOS = { carro: 'Carro', moto: 'Moto', caminhao: 'Caminhão', outro: 'Outro' };
const STATUS = { agendada: 'Agendada', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const RESULTADOS = {
  aprovado: 'Aprovado',
  aprovado_com_apontamentos: 'Aprovado com apontamentos',
  reprovado: 'Reprovado',
};
const SITUACOES = [['conforme', 'Conforme', '✓'], ['nao_conforme', 'Não conforme', '✗'], ['nao_se_aplica', 'Não se aplica', 'N/A']];

const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const Situacao = ({ v }) => (
  <span className={`etiqueta status-${v.status}`}>
    {v.status === 'concluida' && v.resultado ? RESULTADOS[v.resultado] : STATUS[v.status]}
  </span>
);

// ---------------------------------------------------------------------------
// Lista de vistorias com filtros
// ---------------------------------------------------------------------------
export function ListaVistorias({ loja, podeCriar, aoAbrir, aoNova }) {
  const [periodo, setPeriodo] = useState('hoje');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    const q = new URLSearchParams({ ...(loja && { loja }), ...(periodo && { periodo }), ...(status && { status }), ...(busca.trim() && { busca: busca.trim() }) });
    const t = setTimeout(() => {
      api(`/vistorias?${q}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message));
    }, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [loja, periodo, status, busca]);

  return (
    <>
      <div className="cabecalho">
        <h1>Vistorias</h1>
        {podeCriar && <button className="botao-primario" onClick={aoNova}><Icone nome="mais" tamanho={18} /> Nova vistoria</button>}
      </div>

      <div className="filtros">
        <div className="abas" role="tablist">
          {[['hoje', 'Hoje'], ['mes', 'Este mês'], ['', 'Todas']].map(([v, n]) => (
            <button key={v} role="tab" aria-selected={periodo === v} className={periodo === v ? 'ativa' : ''} onClick={() => setPeriodo(v)}>{n}</button>
          ))}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(STATUS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Placa, cliente ou nº" aria-label="Buscar vistoria" />
      </div>

      {erro && <p className="erro" role="alert">{erro}</p>}
      {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? (
        <p className="cinza vazio">Nenhuma vistoria encontrada com esses filtros.</p>
      ) : (
        <div className="lista-cadastro">
          {lista.map((v) => (
            <button key={v.id} className="cartao item-vistoria" onClick={() => aoAbrir(v.id)}>
              <Placa placa={v.placa} tamanho="pequena" />
              <span className="item-vistoria-textos">
                <span className="item-titulo"><strong>Nº {v.numero}</strong><Situacao v={v} /></span>
                <small>{[v.marca, v.modelo].filter(Boolean).join(' ') || TIPOS[v.tipo]} · {v.servico}</small>
                <small className="cinza">{v.cliente}</small>
                <small className="cinza">{dataHora(v.criado_em)}{!loja && ` · ${v.loja}`}{v.vistoriador && ` · ${v.vistoriador}`}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Nova vistoria: placa → veículo, serviço, cliente
// ---------------------------------------------------------------------------
export function NovaVistoria({ perfil, lojaInicial, lojasPermitidas, tem, aoCriar, aoFechar }) {
  const [loja, setLoja] = useState(lojasPermitidas.includes(lojaInicial) ? lojaInicial : lojasPermitidas[0] || '');
  const [placa, setPlaca] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [veiculo, setVeiculo] = useState(null); // { tipo, marca, modelo, cor, ano, encontrado }
  const [avisoPlaca, setAvisoPlaca] = useState('');
  const [servicos, setServicos] = useState([]);
  const [servico, setServico] = useState('');
  const [modoCliente, setModoCliente] = useState('avulso');
  const [busca, setBusca] = useState('');
  const [clientes, setClientes] = useState([]);
  const [cliente, setCliente] = useState(null);
  const [novo, setNovo] = useState({ nome: '', cpf_cnpj: '', whatsapp: '' });
  const [km, setKm] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const podeLoja = (p) => perfil.master || (perfil.acessos[loja] || []).includes(p);

  useEffect(() => {
    if (!loja) return;
    api(`/servicos?loja=${loja}`).then((l) => { setServicos(l); setServico((s) => (l.some((x) => x.id === s) ? s : l[0]?.id || '')); })
      .catch((f) => setErro(f.message));
  }, [loja]);

  useEffect(() => {
    if (modoCliente !== 'buscar' || !loja) return;
    const t = setTimeout(() => {
      api(`/clientes?loja=${loja}&venda=1&busca=${encodeURIComponent(busca)}`).then(setClientes).catch((f) => setErro(f.message));
    }, 300);
    return () => clearTimeout(t);
  }, [busca, modoCliente, loja]);

  async function consultar(e) {
    e?.preventDefault();
    const p = limparPlaca(placa);
    if (!placaValida(p)) { setAvisoPlaca('Placa inválida. Use o formato ABC1234 ou ABC1D23.'); return; }
    setPlaca(p); setAvisoPlaca(''); setConsultando(true);
    try {
      if (!podeLoja('placa.consultar')) throw new Error('Seu perfil não consulta placas. Preencha os dados do veículo.');
      const r = await api(`/placa/${p}?loja=${loja}`);
      const v = r.veiculo;
      setVeiculo({ tipo: v.tipo, marca: v.marca || '', modelo: v.modelo || '', cor: v.cor || '', ano: v.ano_modelo || '', encontrado: true });
      if (r.aviso) setAvisoPlaca(r.aviso);
    } catch (falha) {
      setVeiculo({ tipo: 'carro', marca: '', modelo: '', cor: '', ano: '', encontrado: false });
      setAvisoPlaca(`${falha.message} Preencha os dados do veículo abaixo.`);
    } finally {
      setConsultando(false);
    }
  }

  async function abrir() {
    setErro('');
    if (!veiculo) return setErro('Consulte a placa primeiro.');
    if (!servico) return setErro('Escolha o serviço.');
    if (modoCliente === 'buscar' && !cliente) return setErro('Escolha o cliente na lista.');
    if (modoCliente === 'novo' && !novo.nome.trim()) return setErro('Informe o nome do cliente.');
    setSalvando(true);
    try {
      const { id } = await api('/vistorias', {
        metodo: 'POST',
        corpo: {
          loja_id: loja, placa, servico_id: servico, km,
          veiculo: { tipo: veiculo.tipo, marca: veiculo.marca, modelo: veiculo.modelo, cor: veiculo.cor, ano: veiculo.ano },
          ...(modoCliente === 'buscar' && { cliente_id: cliente.id }),
          ...(modoCliente === 'novo' && { cliente_novo: novo }),
        },
      });
      aoCriar(id);
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  const preco = servicos.find((s) => s.id === servico)?.precos?.[veiculo?.tipo];
  const campoVeiculo = (campo, rotulo, props = {}) => (
    <label>{rotulo}<input value={veiculo[campo]} onChange={(e) => setVeiculo({ ...veiculo, [campo]: e.target.value })} {...props} /></label>
  );

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal largo" role="dialog" aria-modal="true" aria-label="Nova vistoria">
        <div className="modal-topo">
          <h2>Nova vistoria</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>

        <div className="formulario">
          {lojasPermitidas.length > 1 && (
            <label>Loja
              <select value={loja} onChange={(e) => setLoja(e.target.value)}>
                {lojasPermitidas.map((id) => <option key={id} value={id}>{perfil.lojas.find((l) => l.id === id)?.nome}</option>)}
              </select>
            </label>
          )}

          <h3 className="passo"><span>1</span> Veículo</h3>
          <form className="busca-placa" onSubmit={consultar}>
            <PlacaInput valor={placa} aoMudar={(p) => { setPlaca(p); setVeiculo(null); }} autoFocus />
            <button className="botao-primario" disabled={consultando}>{consultando ? 'Buscando…' : 'Buscar'}</button>
          </form>
          {avisoPlaca && <p className="aviso-texto">{avisoPlaca}</p>}
          {veiculo && (
            <div className="dados-veiculo">
              <label>Tipo
                <select value={veiculo.tipo} onChange={(e) => setVeiculo({ ...veiculo, tipo: e.target.value })}>
                  {Object.entries(TIPOS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              </label>
              {veiculo.encontrado ? (
                <p className="resumo-veiculo"><strong>{[veiculo.marca, veiculo.modelo].filter(Boolean).join(' ') || 'Modelo não informado'}</strong>
                  <small className="cinza">{[veiculo.cor, veiculo.ano].filter(Boolean).join(' · ')}</small></p>
              ) : (
                <>
                  {campoVeiculo('marca', 'Marca')}
                  {campoVeiculo('modelo', 'Modelo')}
                  {campoVeiculo('cor', 'Cor')}
                  {campoVeiculo('ano', 'Ano', { inputMode: 'numeric', maxLength: 4 })}
                </>
              )}
              <label>Quilometragem<input value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Opcional" /></label>
            </div>
          )}

          <h3 className="passo"><span>2</span> Serviço</h3>
          <div className="opcoes">
            {servicos.map((s) => (
              <label key={s.id} className={servico === s.id ? 'opcao marcada' : 'opcao'}>
                <input type="radio" name="servico" checked={servico === s.id} onChange={() => setServico(s.id)} />
                <strong>{s.nome}</strong>
                {veiculo && s.precos[veiculo.tipo] !== undefined && <small>R$ {moeda(s.precos[veiculo.tipo])}</small>}
              </label>
            ))}
          </div>

          <h3 className="passo"><span>3</span> Cliente</h3>
          <div className="opcoes">
            {[['avulso', 'Particular / avulso', true], ['buscar', 'Cliente cadastrado', podeLoja('clientes.ver')], ['novo', 'Novo cliente', podeLoja('clientes.editar')]]
              .filter(([, , ok]) => ok).map(([v, n]) => (
                <label key={v} className={modoCliente === v ? 'opcao marcada' : 'opcao'}>
                  <input type="radio" name="cliente" checked={modoCliente === v} onChange={() => setModoCliente(v)} />
                  <strong>{n}</strong>
                </label>
              ))}
          </div>
          {modoCliente === 'buscar' && (
            <>
              <input type="search" value={busca} onChange={(e) => { setBusca(e.target.value); setCliente(null); }} placeholder="Nome, CPF/CNPJ ou telefone" aria-label="Buscar cliente" />
              <ul className="lista-clientes">
                {clientes.map((c) => (
                  <li key={c.id}>
                    <label className={cliente?.id === c.id ? 'opcao marcada' : 'opcao'}>
                      <input type="radio" name="cliente-escolhido" checked={cliente?.id === c.id} onChange={() => setCliente(c)} />
                      <strong>{c.nome}</strong>{c.cpf_cnpj && <small className="cinza">{c.cpf_cnpj}</small>}
                    </label>
                  </li>
                ))}
                {!clientes.length && <li className="cinza">Nenhum cliente encontrado.</li>}
              </ul>
            </>
          )}
          {modoCliente === 'novo' && (
            <div className="dados-veiculo">
              <label>Nome<input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></label>
              <label>CPF ou CNPJ<input value={novo.cpf_cnpj} onChange={(e) => setNovo({ ...novo, cpf_cnpj: e.target.value })} inputMode="numeric" placeholder="Opcional" /></label>
              <label>WhatsApp<input value={novo.whatsapp} onChange={(e) => setNovo({ ...novo, whatsapp: e.target.value })} inputMode="tel" placeholder="(11) 99999-9999" /></label>
            </div>
          )}

          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            {preco !== undefined && <span className="valor-servico">Valor: <strong>R$ {moeda(preco)}</strong></span>}
            <button className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" onClick={abrir} disabled={salvando || !veiculo}>{salvando ? 'Abrindo…' : 'Abrir vistoria'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execução: checklist, km, parecer, concluir ou cancelar
// ---------------------------------------------------------------------------
export function ExecutarVistoria({ id, aoVoltar }) {
  const [v, setV] = useState(null);
  const [itens, setItens] = useState([]);
  const [km, setKm] = useState('');
  const [parecer, setParecer] = useState('');
  const [alterado, setAlterado] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    try {
      const d = await api(`/vistorias/${id}`);
      setV(d); setItens(d.itens); setKm(d.km ?? ''); setParecer(d.parecer || ''); setAlterado(false);
    } catch (falha) {
      setErro(falha.message);
    }
  }
  useEffect(() => { carregar(); }, [id]);

  if (!v) return erro ? <p className="erro" role="alert">{erro}</p> : <p className="cinza">Carregando…</p>;

  const aberta = ['agendada', 'em_andamento'].includes(v.status);
  const editavel = aberta && v.pode.editar;
  const respondidos = itens.filter((i) => i.situacao).length;
  const grupos = [...itens.reduce((m, i) => m.set(i.grupo || 'Itens', [...(m.get(i.grupo || 'Itens') || []), i]), new Map())];

  const mudarItem = (itemId, campo, valor) => {
    setItens(itens.map((i) => (i.id === itemId ? { ...i, [campo]: valor } : i)));
    setAlterado(true);
  };

  async function salvar(silencioso) {
    setErro(''); setOcupado(true);
    try {
      await api(`/vistorias/${id}`, { metodo: 'PUT', corpo: { km, parecer, itens: itens.map(({ id: i, situacao, observacao }) => ({ id: i, situacao, observacao })) } });
      setAlterado(false);
      if (!silencioso) { setAviso('Andamento salvo.'); setTimeout(() => setAviso(''), 2000); }
      return true;
    } catch (falha) {
      setErro(falha.message); return false;
    } finally {
      setOcupado(false);
    }
  }

  async function concluir(resultado) {
    if (editavel && !(await salvar(true))) return;
    setOcupado(true);
    try {
      await api(`/vistorias/${id}/concluir`, { metodo: 'POST', corpo: { resultado } });
      setConcluindo(false);
      await carregar();
    } catch (falha) {
      setErro(falha.message); setConcluindo(false);
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    const motivo = prompt('Motivo do cancelamento:');
    if (motivo === null) return;
    try {
      await api(`/vistorias/${id}/cancelar`, { metodo: 'POST', corpo: { motivo } });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const ve = v.veiculo;
  return (
    <>
      <div className="cabecalho">
        <button className="botao-texto" onClick={() => (!alterado || confirm('Sair sem salvar as alterações?')) && aoVoltar()}>‹ Vistorias</button>
        <h1>Vistoria nº {v.numero}</h1>
        <Situacao v={v} />
      </div>

      <section className="cartao ficha-vistoria">
        <Placa placa={ve.placa} />
        <dl>
          <div><dt>Veículo</dt><dd>{[ve.marca, ve.modelo].filter(Boolean).join(' ') || '–'}</dd></div>
          <div><dt>Tipo</dt><dd>{TIPOS[ve.tipo]}</dd></div>
          <div><dt>Cor / ano</dt><dd>{[ve.cor, ve.ano_modelo].filter(Boolean).join(' · ') || '–'}</dd></div>
          <div><dt>Cliente</dt><dd>{v.cliente.nome}</dd></div>
          <div><dt>Serviço</dt><dd>{v.servico}{v.preco != null && ` · R$ ${moeda(v.preco)}`}</dd></div>
          <div><dt>Loja</dt><dd>{v.loja}</dd></div>
          <div><dt>Vistoriador</dt><dd>{v.vistoriador || '–'}</dd></div>
          <div><dt>{v.concluida_em ? 'Concluída em' : 'Aberta em'}</dt><dd>{dataHora(v.concluida_em || v.criado_em)}</dd></div>
        </dl>
      </section>

      <section className="bloco">
        <div className="bloco-topo">
          <h2>Checklist</h2>
          <small className="cinza total">{respondidos} de {itens.length} respondidos</small>
        </div>
        <div className="progresso" aria-hidden="true"><span style={{ width: `${itens.length ? (respondidos / itens.length) * 100 : 0}%` }} /></div>
        {grupos.map(([grupo, lista]) => (
          <div key={grupo} className="cartao grupo-checklist">
            <h3>{grupo}</h3>
            {lista.map((i) => (
              <div key={i.id} className={`item-checklist ${i.situacao || ''}`}>
                <div className="item-checklist-linha">
                  <span className="item-nome">{i.descricao}{i.exige_foto && <small className="cinza"> · foto</small>}</span>
                  <span className="botoes-situacao" role="radiogroup" aria-label={i.descricao}>
                    {SITUACOES.map(([valor, nome, simbolo]) => (
                      <button key={valor} role="radio" aria-checked={i.situacao === valor} title={nome} aria-label={nome} disabled={!editavel}
                        className={i.situacao === valor ? `marcado ${valor}` : ''} onClick={() => mudarItem(i.id, 'situacao', i.situacao === valor ? null : valor)}>
                        {simbolo}
                      </button>
                    ))}
                  </span>
                </div>
                {(i.situacao === 'nao_conforme' || i.observacao) && (
                  <input className="obs-item" value={i.observacao || ''} disabled={!editavel} placeholder="Descreva o apontamento"
                    onChange={(e) => mudarItem(i.id, 'observacao', e.target.value)} aria-label={`Observação: ${i.descricao}`} />
                )}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="cartao painel formulario">
        <label>Quilometragem
          <input value={km} disabled={!editavel} inputMode="numeric" onChange={(e) => { setKm(e.target.value.replace(/\D/g, '')); setAlterado(true); }} />
        </label>
        <label>Parecer do vistoriador
          <textarea rows={4} value={parecer} disabled={!editavel} onChange={(e) => { setParecer(e.target.value); setAlterado(true); }} />
        </label>
      </section>

      {erro && <p className="erro" role="alert">{erro}</p>}
      {aberta && (
        <div className="acoes-vistoria">
          {v.pode.cancelar && <button className="botao-contorno perigo" onClick={cancelar}>Cancelar vistoria</button>}
          {editavel && <button className="botao-contorno" onClick={() => salvar()} disabled={ocupado}>Salvar andamento</button>}
          {v.pode.concluir && <button className="botao-primario" onClick={() => setConcluindo(true)} disabled={ocupado}>Concluir vistoria</button>}
        </div>
      )}

      {concluindo && (
        <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && setConcluindo(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Resultado da vistoria">
            <div className="modal-topo">
              <h2>Resultado da vistoria</h2>
              <button className="fechar" onClick={() => setConcluindo(false)} aria-label="Fechar">×</button>
            </div>
            {respondidos < itens.length && <p className="aviso-texto">Ainda faltam {itens.length - respondidos} item(ns) do checklist.</p>}
            <div className="resultados">
              {Object.entries(RESULTADOS).map(([valor, nome]) => (
                <button key={valor} className={`resultado ${valor}`} disabled={ocupado} onClick={() => concluir(valor)}>{nome}</button>
              ))}
            </div>
          </section>
        </div>
      )}
      {aviso && <div className="aviso" role="status">{aviso}</div>}
    </>
  );
}
