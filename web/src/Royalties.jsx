import { useEffect, useMemo, useState } from 'react';
import { semAcento } from './entrada.js';
import { api, moeda } from './api.js';
import { criarTem } from './modulos.js';
import { CampoData } from './Data.jsx';
import { cnpjValido, cpfValido, formatarDoc, mascaraCnpj, mascaraCpf, mascaraTelefone } from './documentos.js';

// Royalties: fornecedores (cada um com o valor que recebe por serviço vendido) e o
// relatório que soma os serviços das vendas finalizadas no período e gera a conta a pagar.

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const real = (v) => `R$ ${moeda(v)}`;
const mascaraCep = (v) => String(v || '').replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
const valorBR = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ultimoDia = (ano, mes) => new Date(Number(ano), Number(mes), 0).getDate();
// Próxima data com o dia escolhido (hoje conta); dia 31 em mês curto vira o último dia
function proximoDia(dia) {
  const [a, m, d] = hojeISO().split('-').map(Number);
  const em = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimoDia(ano, mes))).padStart(2, '0')}`;
  return d <= Math.min(dia, ultimoDia(a, m)) ? em(a, m) : m === 12 ? em(a + 1, 1) : em(a, m + 1);
}
const somarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// De/até a partir do filtro de período (dia, mês, ano ou de/até)
function periodo(f) {
  if (f.modo === 'dia') return { de: f.dia, ate: f.dia };
  if (f.modo === 'mes' && /^\d{4}-\d{2}$/.test(f.mes)) {
    const [a, m] = f.mes.split('-');
    return { de: `${f.mes}-01`, ate: `${f.mes}-${String(ultimoDia(a, m)).padStart(2, '0')}` };
  }
  if (f.modo === 'ano' && /^\d{4}$/.test(f.ano)) return { de: `${f.ano}-01-01`, ate: `${f.ano}-12-31` };
  return { de: f.de, ate: f.ate };
}

export default function Royalties({ perfil, loja }) {
  const [aba, setAba] = useState('relatorio');
  const lojasCom = (p) => perfil.lojas.filter((l) => criarTem(perfil, l.id)(p));
  // loja usada para saber o grupo (serviços, plano de contas, novo fornecedor)
  const lojaGrupo = lojasCom('royalties.ver').some((l) => l.id === loja) ? loja : lojasCom('royalties.ver')[0]?.id || '';
  const podeConfigurar = lojasCom('royalties.configurar').length > 0;
  const podeGerar = perfil.lojas.some((l) => criarTem(perfil, l.id)('royalties.fechar') && criarTem(perfil, l.id)('financeiro.lancar'));
  return (
    <>
      <div className="cabecalho"><h1>Royalties</h1></div>
      <div className="abas" role="tablist">
        <button role="tab" aria-selected={aba === 'relatorio'} className={aba === 'relatorio' ? 'ativa' : ''} onClick={() => setAba('relatorio')}>Relatório e contas a pagar</button>
        <button role="tab" aria-selected={aba === 'fornecedores'} className={aba === 'fornecedores' ? 'ativa' : ''} onClick={() => setAba('fornecedores')}>Fornecedores</button>
      </div>
      {!lojaGrupo ? <p className="cinza vazio">Seu perfil não tem acesso aos royalties de nenhuma loja.</p>
        : aba === 'relatorio' ? <Relatorio loja={loja} lojaGrupo={lojaGrupo} podeGerar={podeGerar} />
        : <Fornecedores perfil={perfil} loja={loja} lojaGrupo={lojaGrupo} podeConfigurar={podeConfigurar} lojasEditar={lojasCom('royalties.configurar')} />}
    </>
  );
}

// ------------------------------------------------------------ relatório
function Relatorio({ loja, lojaGrupo, podeGerar }) {
  const hoje = hojeISO();
  const [f, setF] = useState({ modo: 'mes', dia: hoje, mes: hoje.slice(0, 7), ano: hoje.slice(0, 4), de: `${hoje.slice(0, 8)}01`, ate: hoje,
    servico: '', fornecedor: '', situacao: 'pendente' });
  const [servicos, setServicos] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [linhas, setLinhas] = useState(null);
  const [marcadas, setMarcadas] = useState(new Set());
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    api(`/servicos?loja=${lojaGrupo}&uso=venda`).then(setServicos).catch(() => setServicos([]));
    api(`/royalties/fornecedores?loja=${lojaGrupo}`).then(setFornecedores).catch(() => setFornecedores([]));
  }, [lojaGrupo]);

  async function buscar(e) {
    e?.preventDefault();
    const { de, ate } = periodo(f);
    if (!de || !ate) return setErro('Informe o período.');
    setErro('');
    const q = new URLSearchParams({ de, ate });
    if (loja) q.set('loja', loja);
    if (f.servico) q.set('servico', f.servico);
    if (f.fornecedor) q.set('fornecedor', f.fornecedor);
    if (f.situacao) q.set('situacao', f.situacao);
    try {
      const l = await api(`/royalties/relatorio?${q}`);
      setLinhas(l);
      setMarcadas(new Set(l.filter((i) => !i.lancamento_id && Number(i.valor) > 0).map(chave)));
    } catch (falha) { setErro(falha.message); }
  }
  useEffect(() => { buscar(); }, [loja]); // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => {
    const m = new Map();
    for (const i of linhas || []) (m.get(i.fornecedor_id) || m.set(i.fornecedor_id, { nome: i.fornecedor, itens: [] }).get(i.fornecedor_id)).itens.push(i);
    return [...m.entries()];
  }, [linhas]);
  const marcaveis = (linhas || []).filter((i) => !i.lancamento_id && Number(i.valor) > 0);
  const escolhidas = marcaveis.filter((i) => marcadas.has(chave(i)));
  const soma = (lista) => lista.reduce((t, i) => t + Number(i.valor), 0);
  const qtd = (lista) => lista.reduce((t, i) => t + Number(i.quantidade), 0);
  const marcar = (lista, sim) => setMarcadas((m) => { const n = new Set(m); for (const i of lista) if (sim) n.add(chave(i)); else n.delete(chave(i)); return n; });
  const muda = (campo) => (e) => setF({ ...f, [campo]: e.target.value });
  const p = periodo(f);

  return (
    <>
      <p className="cinza ajuda">Soma os serviços das vendas finalizadas no período pelo valor de cada fornecedor (cadastrado na aba Fornecedores).
        Marque o que entra e clique em "Gerar contas a pagar": o sistema cria uma conta para cada fornecedor e loja no Financeiro.
        Cada serviço só entra uma vez; se a conta for cancelada, ele volta a aparecer como pendente.</p>
      <form className="relatorio-config" onSubmit={buscar}>
        <div className="linha-config">
          <label>Período
            <select value={f.modo} onChange={muda('modo')}>
              <option value="dia">Dia</option><option value="mes">Mês</option><option value="ano">Ano</option><option value="livre">De / até</option>
            </select>
          </label>
          {f.modo === 'dia' && <label>Dia<CampoData value={f.dia} onChange={muda('dia')} required /></label>}
          {f.modo === 'mes' && <label>Mês<input type="month" value={f.mes} onChange={muda('mes')} required data-livre /></label>}
          {f.modo === 'ano' && <label>Ano<input type="number" min="2000" max="2100" value={f.ano} onChange={muda('ano')} required style={{ width: 100 }} /></label>}
          {f.modo === 'livre' && (
            <>
              <label>De<CampoData value={f.de} onChange={muda('de')} required /></label>
              <label>Até<CampoData value={f.ate} onChange={muda('ate')} required min={f.de || undefined} /></label>
            </>
          )}
          <label>Serviço
            <select value={f.servico} onChange={muda('servico')}>
              <option value="">Todos</option>
              {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
          <label>Fornecedor
            <select value={f.fornecedor} onChange={muda('fornecedor')}>
              <option value="">Todos</option>
              {fornecedores.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.ativo ? '' : ' (INATIVO)'}</option>)}
            </select>
          </label>
          <label>Situação
            <select value={f.situacao} onChange={muda('situacao')}>
              <option value="pendente">A lançar</option><option value="lancado">Já lançados</option><option value="">Todos</option>
            </select>
          </label>
          <button className="botao-contorno">Filtrar</button>
        </div>
      </form>
      {aviso && <p className="aviso-ok" role="status">{aviso}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {fornecedores.length === 0 && <p className="cinza">Nenhum fornecedor cadastrado ainda. Cadastre na aba Fornecedores, com o valor de cada serviço.</p>}
      {linhas && (linhas.length === 0 ? (
        <p className="cinza vazio">Nenhum serviço {f.situacao === 'pendente' ? 'a lançar ' : f.situacao === 'lancado' ? 'já lançado ' : ''}de {dataBR(p.de)} a {dataBR(p.ate)}.
          {' '}Entram só vendas finalizadas, com serviços que tenham valor no cadastro do fornecedor{loja ? ', nesta loja' : ''}.</p>
      ) : (
        <>
          <div className="resumo-fin">
            {grupos.map(([id, g]) => (
              <div key={id} className="cartao"><small>{g.nome}</small><strong>{real(soma(g.itens))}</strong><small>{qtd(g.itens)} serviço(s)</small></div>
            ))}
            {grupos.length > 1 && <div className="cartao"><small>TOTAL</small><strong>{real(soma(linhas))}</strong><small>{qtd(linhas)} serviço(s)</small></div>}
          </div>
          <div className="tabela-relatorio-caixa">
            <table className="tabela-relatorio">
              <thead>
                <tr>
                  <th className="marcar">{marcaveis.length > 0 && <input type="checkbox" checked={escolhidas.length === marcaveis.length} aria-label="Marcar todos"
                    onChange={(e) => marcar(marcaveis, e.target.checked)} />}</th>
                  <th>Data</th><th>Venda</th><th>Loja</th><th>Cliente</th><th>Placa</th><th>Serviço</th>
                  <th className="num">Qtd</th><th className="num">Valor unit.</th><th className="num">Total</th><th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map(([id, g]) => (
                  <Grupo key={id} g={g} marcadas={marcadas} marcar={marcar} soma={soma} qtd={qtd} />
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={7}>Total</td><td className="num">{qtd(linhas)}</td><td /><td className="num">{moeda(soma(linhas))}</td><td /></tr>
              </tfoot>
            </table>
            {podeGerar && marcaveis.length > 0 && (
              <div className="rodape-faturar">
                <span>{escolhidas.length} de {marcaveis.length} serviço(s) marcado(s) · <strong>{real(soma(escolhidas))}</strong></span>
                <button className="botao-primario" disabled={!escolhidas.length} onClick={() => setGerando(true)}>Gerar contas a pagar</button>
              </div>
            )}
          </div>
        </>
      ))}
      {gerando && (
        <GerarPagar lojaGrupo={escolhidas[0]?.loja_id || lojaGrupo} itens={escolhidas} fornecedores={fornecedores} total={soma(escolhidas)} periodo={p}
          aoFechar={() => setGerando(false)}
          aoGerar={(l) => { setGerando(false); setAviso(`Contas a pagar geradas no Financeiro: ${l.map((x) => `${x.fornecedor}${l.length > 1 ? ` (${x.loja})` : ''} ${real(x.valor)}`).join(' · ')}.`); buscar(); }} />
      )}
    </>
  );
}

const chave = (i) => `${i.fornecedor_id}:${i.venda_item_id}`;

function Grupo({ g, marcadas, marcar, soma, qtd }) {
  const marcaveis = g.itens.filter((i) => !i.lancamento_id && Number(i.valor) > 0);
  return (
    <>
      <tr className="linha-grupo">
        <td className="marcar">{marcaveis.length > 0 && <input type="checkbox" checked={marcaveis.every((i) => marcadas.has(chave(i)))}
          aria-label={`Marcar todos de ${g.nome}`} onChange={(e) => marcar(marcaveis, e.target.checked)} />}</td>
        <td colSpan={10}>{g.nome} <small>({g.itens.length})</small></td>
      </tr>
      {g.itens.map((i) => {
        const pode = !i.lancamento_id && Number(i.valor) > 0;
        const marcada = pode && marcadas.has(chave(i));
        return (
          <tr key={chave(i)} className={marcada ? 'marcada' : ''} onClick={(e) => pode && e.target.type !== 'checkbox' && marcar([i], !marcada)}>
            <td className="marcar">{pode && <input type="checkbox" checked={marcada} onChange={(e) => marcar([i], e.target.checked)} aria-label={`Venda ${i.numero}, ${i.servico}`} />}</td>
            <td>{dataBR(i.data_venda)}</td><td>{i.numero}</td><td>{i.loja}</td><td>{i.cliente}</td><td>{i.placa || ''}</td><td>{i.servico}</td>
            <td className="num">{Number(i.quantidade)}</td><td className="num">{moeda(i.valor_unit)}</td><td className="num">{moeda(i.valor)}</td>
            <td>{i.lancamento_id ? `LANÇADO (VENC. ${dataBR(i.lancado_vencimento)})` : Number(i.valor) > 0 ? 'A LANÇAR' : 'VALOR ZERO'}</td>
          </tr>
        );
      })}
      <tr className="linha-subtotal"><td /><td colSpan={6}>Subtotal {g.nome}</td><td className="num">{qtd(g.itens)}</td><td /><td className="num">{moeda(soma(g.itens))}</td><td /></tr>
    </>
  );
}

// Tela que abre ao gerar: data de pagamento, categoria e centro de custo (vêm do padrão do fornecedor)
function GerarPagar({ lojaGrupo, itens, fornecedores, total, periodo: p, aoFechar, aoGerar }) {
  const ids = [...new Set(itens.map((i) => i.fornecedor_id))];
  const lojas = [...new Set(itens.map((i) => i.loja))];
  const doFornecedor = ids.length === 1 ? fornecedores.find((x) => x.id === ids[0]) : null;
  const nomes = [...new Set(itens.map((i) => i.fornecedor))];
  const descricaoPeriodo = p.de === p.ate ? dataBR(p.de) : /-01$/.test(p.de) && p.ate.slice(0, 7) === p.de.slice(0, 7) ? p.de.slice(0, 7).split('-').reverse().join('/') : `${dataBR(p.de)} A ${dataBR(p.ate)}`;
  const [f, setF] = useState({
    vencimento: doFornecedor?.dia_vencimento ? proximoDia(doFornecedor.dia_vencimento) : somarDias(hojeISO(), 10),
    categoria_id: '', centro_custo_id: doFornecedor?.centro_custo_id || '',
    descricao: ids.length === 1 ? `ROYALTIES ${nomes[0]} ${descricaoPeriodo}` : '', documento: '', salvar_padrao: false,
  });
  const [categorias, setCategorias] = useState([]);
  const [centros, setCentros] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api(`/financeiro/plano?loja=${lojaGrupo}`).then((l) => {
      const despesas = l.filter((c) => c.tipo === 'pagar' && !c.grupo && c.ativo);
      setCategorias(despesas);
      const sugerida = despesas.find((c) => c.id === doFornecedor?.categoria_id) || despesas.find((c) => /royalt/i.test(c.nome)) || despesas[0];
      setF((x) => ({ ...x, categoria_id: x.categoria_id || sugerida?.id || '' }));
    }).catch((falha) => setErro(falha.message));
    api(`/financeiro/centros?loja=${lojaGrupo}`).then((l) => setCentros(l.filter((c) => c.ativo))).catch(() => {});
  }, [lojaGrupo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      const r = await api('/royalties/gerar', { metodo: 'POST', corpo: { ...f, itens: itens.map(chave) } });
      aoGerar(r.lancamentos);
    } catch (falha) { setErro(falha.message); setSalvando(false); }
  }

  const contas = new Set(itens.map((i) => `${i.fornecedor_id}|${i.loja_id}`)).size;
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Gerar contas a pagar">
        <div className="modal-topo">
          <h2>Gerar contas a pagar</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <p><strong>{nomes.join(', ')}</strong><br /><span className="cinza">{itens.length} serviço(s) · {real(total)}</span></p>
        <form className="formulario" onSubmit={salvar}>
          <label>Data de pagamento (vencimento)<CampoData value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} required /></label>
          <label>Centro de custo
            <select value={f.centro_custo_id} onChange={(e) => setF({ ...f, centro_custo_id: e.target.value })}>
              <option value="">Centro de custo de cada loja</option>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Categoria (plano de contas)
            <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })} required>
              <option value="">Escolha…</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} ` : ''}{c.nome}</option>)}
            </select>
          </label>
          <label>Descrição<input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={200}
            placeholder={ids.length > 1 ? 'Em branco: ROYALTIES + nome de cada fornecedor' : ''} required={ids.length === 1} /></label>
          <label>Documento<input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} placeholder="Opcional: nº do boleto ou NF" /></label>
          <label className="linha-check"><input type="checkbox" checked={f.salvar_padrao} onChange={(e) => setF({ ...f, salvar_padrao: e.target.checked })} />
            Usar esta categoria e este centro de custo como padrão {ids.length > 1 ? 'destes fornecedores' : 'deste fornecedor'}</label>
          {contas > 1 && <p className="cinza ajuda">Serão criadas {contas} contas a pagar: uma para cada fornecedor e loja{lojas.length > 1 ? ` (${lojas.join(', ')})` : ''}.</p>}
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={salvando}>{salvando ? 'Gerando…' : 'Gerar contas a pagar'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ------------------------------------------------------------ fornecedores
function Fornecedores({ loja, lojaGrupo, podeConfigurar, lojasEditar }) {
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(undefined); // undefined = fechado; { id } ou { novo: true }
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const q = new URLSearchParams({ ...(loja && { loja }), ...(busca.trim() && { busca: busca.trim() }), ...(inativos && { inativos: '1' }) });
    const t = setTimeout(() => api(`/royalties/fornecedores?${q}`).then((l) => { setLista(l); setErro(''); }).catch((f) => setErro(f.message)), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [loja, busca, inativos, recarga]);

  return (
    <>
      <div className="filtros">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CPF/CNPJ" aria-label="Buscar fornecedor" />
        <label className="linha-check filtro-check"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
        {podeConfigurar && <button className="botao-primario" onClick={() => setAberto({ novo: true })}>+ Novo fornecedor</button>}
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {lista === null ? <p className="cinza">Carregando…</p> : lista.length === 0 ? (
        <p className="cinza vazio">Nenhum fornecedor encontrado.</p>
      ) : (
        <div className="lista-cadastro">
          {lista.map((x) => (
            <button key={x.id} className="cartao item-cadastro" onClick={() => setAberto({ id: x.id })}>
              <span className="item-titulo">
                <strong>{x.nome}</strong>
                {!x.ativo && <span className="etiqueta inativa">Inativo</span>}
              </span>
              <small className="cinza">
                {[x.cpf_cnpj && formatarDoc(x.cpf_cnpj), x.nome_fantasia, (x.whatsapp || x.telefone) && mascaraTelefone(x.whatsapp || x.telefone),
                  x.cidade && `${x.cidade}${x.uf ? `/${x.uf}` : ''}`].filter(Boolean).join(' · ')}
              </small>
              <small className="cinza">{x.servicos ? `${x.servicos} serviço(s) com valor` : 'Nenhum valor por serviço ainda'}</small>
            </button>
          ))}
        </div>
      )}
      {aberto && (
        <EditorFornecedor key={aberto.id || 'novo'} id={aberto.id} lojas={lojasEditar} lojaInicial={lojasEditar.some((l) => l.id === loja) ? loja : lojaGrupo}
          aoFechar={() => { setAberto(undefined); setRecarga((n) => n + 1); }} />
      )}
    </>
  );
}

const vazio = () => ({ tipo: 'pj', nome: '', nome_fantasia: '', cpf_cnpj: '', telefone: '', whatsapp: '', email: '', cep: '', endereco: '',
  cidade: '', uf: '', chave_pix: '', observacoes: '', ativo: true, dia_vencimento: '', categoria_id: '', centro_custo_id: '', precos: {} });

function EditorFornecedor({ id, lojas, lojaInicial, aoFechar }) {
  const [c, setC] = useState(id ? null : vazio());
  const [extra, setExtra] = useState(null); // pode_editar, empresa
  const [loja, setLoja] = useState(lojas.some((l) => l.id === lojaInicial) ? lojaInicial : lojas[0]?.id || lojaInicial);
  const [servicos, setServicos] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [centros, setCentros] = useState([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const gruposLojas = [...lojas.reduce((m, l) => (m.has(l.empresa_id) ? m : m.set(l.empresa_id, { id: l.empresa_id, nome: l.empresa, loja: l.id })), new Map()).values()];

  useEffect(() => {
    if (!id) return;
    api(`/royalties/fornecedores/${id}`).then((d) => {
      setC({ ...vazio(), ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? ''])),
        cpf_cnpj: d.cpf_cnpj ? formatarDoc(d.cpf_cnpj) : '', telefone: d.telefone ? mascaraTelefone(d.telefone) : '',
        whatsapp: d.whatsapp ? mascaraTelefone(d.whatsapp) : '', cep: mascaraCep(d.cep), ativo: d.ativo,
        precos: Object.fromEntries(d.precos.map((p) => [p.servico_id, valorBR(p.valor)])) });
      setExtra({ pode_editar: d.pode_editar, empresa: d.empresa_id });
    }).catch((f) => setErro(f.message));
  }, [id]);

  // serviços, plano de contas e centros de custo do grupo do fornecedor
  const lojaDados = (extra?.empresa && lojas.find((l) => l.empresa_id === extra.empresa)?.id) || (id ? lojaInicial : loja);
  useEffect(() => {
    if (!lojaDados || (id && !extra)) return;
    api(`/servicos?loja=${lojaDados}&uso=venda`).then(setServicos).catch(() => setServicos([]));
    api(`/financeiro/plano?loja=${lojaDados}`).then((l) => setCategorias(l.filter((x) => x.tipo === 'pagar' && !x.grupo && x.ativo))).catch(() => setCategorias([]));
    api(`/financeiro/centros?loja=${lojaDados}`).then((l) => setCentros(l.filter((x) => x.ativo))).catch(() => setCentros([]));
  }, [lojaDados, Boolean(extra)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return <Janela titulo="Fornecedor" aoFechar={aoFechar}>{erro ? <p className="erro">{erro}</p> : <p className="cinza">Carregando…</p>}</Janela>;

  const somenteLeitura = Boolean(id && extra && !extra.pode_editar);
  const muda = (campo) => (e) => setC({ ...c, [campo]: e.target.value });
  const comValor = Object.values(c.precos || {}).filter((v) => String(v).trim()).length;

  // CNPJ completo: busca razão social, fantasia e endereço nos dados públicos da Receita
  async function mudarDoc(valor) {
    const doc = c.tipo === 'pj' ? mascaraCnpj(valor) : mascaraCpf(valor);
    setC((x) => ({ ...x, cpf_cnpj: doc })); setAviso('');
    if (c.tipo !== 'pj' || doc.replace(/\D/g, '').length < 14) return;
    if (!cnpjValido(doc)) return setAviso('CNPJ inválido. Confira os números.');
    setAviso('Buscando na Receita…');
    try {
      const r = await api(`/cnpj/${doc.replace(/\D/g, '')}`);
      setC((x) => ({ ...x, nome: x.nome || r.razao_social || '', nome_fantasia: x.nome_fantasia || r.nome_fantasia || '',
        telefone: x.telefone || (r.telefone ? mascaraTelefone(r.telefone) : ''), email: x.email || r.email || '',
        cep: x.cep || mascaraCep(r.cep), endereco: x.endereco || r.endereco || '', cidade: x.cidade || r.cidade || '', uf: x.uf || r.uf || '' }));
      setAviso(`Encontrado na Receita${r.situacao ? ` · situação: ${r.situacao}` : ''}`);
    } catch (falha) { setAviso(falha.message); }
  }

  async function mudarCep(valor) {
    const cep = mascaraCep(valor);
    setC((x) => ({ ...x, cep }));
    if (cep.replace(/\D/g, '').length !== 8) return;
    setAviso('Buscando o CEP…');
    try {
      const r = await api(`/cep/${cep.replace(/\D/g, '')}`);
      setC((x) => ({ ...x, endereco: semAcento([r.logradouro, r.bairro].filter(Boolean).join(', ')) || x.endereco, cidade: semAcento(r.cidade) || x.cidade, uf: semAcento(r.uf) || x.uf }));
      setAviso(r.logradouro ? 'Endereço encontrado pelo CEP. Complete o número.' : 'CEP encontrado. Complete o endereço.');
    } catch (falha) { setAviso(falha.message); }
  }

  async function salvar(e) {
    e.preventDefault();
    if (c.cpf_cnpj && c.tipo === 'pf' && !cpfValido(c.cpf_cnpj)) return setErro('CPF inválido. Confira os números.');
    if (c.cpf_cnpj && c.tipo === 'pj' && !cnpjValido(c.cpf_cnpj)) return setErro('CNPJ inválido. Confira os números.');
    setSalvando(true); setErro('');
    try {
      const precos = Object.entries(c.precos || {}).filter(([, v]) => String(v).trim()).map(([servico_id, valor]) => ({ servico_id, valor }));
      await api(id ? `/royalties/fornecedores/${id}` : '/royalties/fornecedores', { metodo: id ? 'PUT' : 'POST', corpo: { ...c, loja_id: loja, precos } });
      aoFechar();
    } catch (falha) { setErro(falha.message); setSalvando(false); }
  }

  return (
    <Janela titulo={id ? c.nome : 'Novo fornecedor'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <fieldset className="sem-borda" disabled={somenteLeitura}>
          <div className="opcoes">
            {[['pj', 'Empresa'], ['pf', 'Pessoa física']].map(([v, n]) => (
              <label key={v} className={c.tipo === v ? 'opcao marcada' : 'opcao'}>
                <input type="radio" name="tipo-fornecedor" checked={c.tipo === v} onChange={() => setC({ ...c, tipo: v, cpf_cnpj: '' })} /><strong>{n}</strong>
              </label>
            ))}
          </div>
          {!id && gruposLojas.length > 1 && (
            <label>Grupo
              <select value={gruposLojas.find((g) => lojas.find((l) => l.id === loja)?.empresa_id === g.id)?.loja || ''} onChange={(e) => { setLoja(e.target.value); setC({ ...c, precos: {}, categoria_id: '', centro_custo_id: '' }); }}>
                {gruposLojas.map((g) => <option key={g.id} value={g.loja}>{g.nome}</option>)}
              </select>
            </label>
          )}
          <label>{c.tipo === 'pj' ? 'CNPJ' : 'CPF'}
            <input value={c.cpf_cnpj} inputMode="numeric" onChange={(e) => mudarDoc(e.target.value)} placeholder={c.tipo === 'pj' ? '12.345.678/0001-90' : '123.456.789-10'} />
          </label>
          {aviso && <small className="aviso-receita">{aviso}</small>}
          <label>{c.tipo === 'pj' ? 'Razão social' : 'Nome completo'}<input value={c.nome} onChange={muda('nome')} required /></label>
          {c.tipo === 'pj' && <label>Nome fantasia<input value={c.nome_fantasia} onChange={muda('nome_fantasia')} placeholder="Opcional" /></label>}
          <div className="linha-campos dois">
            <label>WhatsApp<input value={c.whatsapp} inputMode="tel" onChange={(e) => setC({ ...c, whatsapp: mascaraTelefone(e.target.value) })} /></label>
            <label>Telefone<input value={c.telefone} inputMode="tel" onChange={(e) => setC({ ...c, telefone: mascaraTelefone(e.target.value) })} /></label>
          </div>
          <label>E-mail<input type="email" value={c.email} onChange={muda('email')} placeholder="Opcional" /></label>
          <div className="linha-campos cep">
            <label>CEP<input value={c.cep} inputMode="numeric" placeholder="00000-000" onChange={(e) => mudarCep(e.target.value)} /></label>
            <label>Endereço<input value={c.endereco} onChange={muda('endereco')} /></label>
          </div>
          <div className="linha-campos">
            <label>Cidade<input value={c.cidade} onChange={muda('cidade')} /></label>
            <label className="campo-uf">UF<input value={c.uf} maxLength={2} onChange={(e) => setC({ ...c, uf: e.target.value.replace(/[^A-Za-z]/g, '') })} /></label>
          </div>
          <label>Chave PIX<input value={c.chave_pix} onChange={muda('chave_pix')} placeholder="Opcional" data-livre /></label>

          <section className="precos-cliente">
            <div className="titulo-secao"><strong>Valor pago por serviço{comValor ? ` (${comValor})` : ''}</strong></div>
            <small className="cinza">Quanto este fornecedor recebe por cada serviço vendido (por unidade). Em branco: o serviço não entra nos royalties dele.</small>
            {servicos === null ? <p className="cinza">Carregando…</p> : servicos.length === 0 ? <p className="cinza">Nenhum serviço cadastrado.</p> : (
              <table className="tabela-precos">
                <thead><tr><th>Serviço / produto</th><th className="num">Preço de venda</th><th className="num">Valor do fornecedor</th></tr></thead>
                <tbody>
                  {servicos.map((sv) => (
                    <tr key={sv.id}>
                      <td>{sv.nome}</td>
                      <td className="num cinza">{valorBR(sv.precos?.carro ?? sv.valor_padrao)}</td>
                      <td className="num"><input value={c.precos?.[sv.id] || ''} inputMode="numeric" data-moeda placeholder="—" aria-label={`Valor de ${sv.nome} para o fornecedor`}
                        onChange={(e) => setC({ ...c, precos: { ...c.precos, [sv.id]: e.target.value.replace(/[^\d,.]/g, '') } })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="precos-cliente">
            <div className="titulo-secao"><strong>Padrão da conta a pagar</strong></div>
            <small className="cinza">Já vem marcado ao gerar a conta a pagar dos royalties (dá para trocar na hora).</small>
            <div className="linha-campos">
              <label>Dia do pagamento<input type="number" min="1" max="31" value={c.dia_vencimento} onChange={muda('dia_vencimento')} placeholder="Ex.: 10" /></label>
              <label>Centro de custo
                <select value={c.centro_custo_id} onChange={muda('centro_custo_id')}>
                  <option value="">Centro de custo de cada loja</option>
                  {centros.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
            </div>
            <label>Categoria (plano de contas)
              <select value={c.categoria_id} onChange={muda('categoria_id')}>
                <option value="">Royalties (sugerida)</option>
                {categorias.map((x) => <option key={x.id} value={x.id}>{x.codigo ? `${x.codigo} ` : ''}{x.nome}</option>)}
              </select>
            </label>
          </section>
          <label>Observações<textarea rows={2} value={c.observacoes} onChange={muda('observacoes')} /></label>
          {id && <label className="linha-check"><input type="checkbox" checked={c.ativo} onChange={(e) => setC({ ...c, ativo: e.target.checked })} /> Fornecedor ativo</label>}
        </fieldset>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>{somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
          {!somenteLeitura && <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
        </div>
      </form>
    </Janela>
  );
}

function Janela({ titulo, aoFechar, children }) {
  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal largo" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}
