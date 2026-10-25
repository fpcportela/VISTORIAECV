import { useEffect, useRef, useState } from 'react';
import { api, grupoEscolhido, moeda } from './api.js';
import { aplicarTema, COR_PADRAO, PALETA } from './tema.js';
import { Icone } from './icones.jsx';
import { MODULOS, criarTem, ordenar } from './modulos.js';
import ConsultaPlaca from './ConsultaPlaca.jsx';
import EditorAtalhos from './EditorAtalhos.jsx';
import UsuariosPermissoes from './UsuariosPermissoes.jsx';
import { ExecutarVistoria, ListaVistorias, NovaVistoria } from './Vistorias.jsx';
import { EditorVenda, ListaVendas, SITUACOES } from './Vendas.jsx';
import Servicos from './Servicos.jsx';
import Colaboradores from './Colaboradores.jsx';
import Ponto from './Ponto.jsx';
import Financeiro from './Financeiro.jsx';
import Configuracoes from './Configuracoes.jsx';
import Grupos from './Grupos.jsx';
import Clientes from './Clientes.jsx';
import WhatsApp from './WhatsApp.jsx';
import Relatorios from './Relatorios.jsx';
import { Placa, PlacasDiversas } from './Placa.jsx';
import Pesquisa from './Pesquisa.jsx';

export default function Inicio({ perfil, setPerfil, aoSair }) {
  const [loja, setLoja] = useState('');
  const [tela, setTela] = useState('inicio');
  const [financeiroAbre, setFinanceiroAbre] = useState({ aba: 'receber', novo: false, chave: 0 });
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [oculto, setOculto] = useState(false);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [editandoAtalhos, setEditandoAtalhos] = useState(false);
  const [novaVistoria, setNovaVistoria] = useState(false);
  const [vistoriaId, setVistoriaId] = useState(null);
  // Vendas abertas em abas: { chave, id (null = nova, ainda não salva), titulo }
  const [abasVenda, setAbasVenda] = useState([]);
  const [abaVenda, setAbaVenda] = useState('lista'); // 'lista' ou a chave da aba
  const contadorAbas = useRef(0);
  const [buscaVendas, setBuscaVendas] = useState('');
  const [organizandoMenu, setOrganizandoMenu] = useState(false);
  const [aviso, setAviso] = useState('');
  const [consulta, setConsulta] = useState(null); // null = fechada; texto = placa digitada
  const timerAviso = useRef();

  const tem = criarTem(perfil, loja);
  const modulos = ordenar(MODULOS.filter((m) => tem(m.permissao)), perfil.menu);
  // Lojas em que o usuário pode fazer algo (para telas que precisam de uma loja só)
  const lojasCom = (permissao) => perfil.lojas.map((l) => l.id).filter((id) => criarTem(perfil, id)(permissao));
  // Atalhos: os escolhidos pelo usuário (que ele ainda pode ver) ou, sem escolha, todos os liberados
  const atalhos = perfil.atalhos
    ? perfil.atalhos.map((id) => modulos.find((m) => m.id === id)).filter(Boolean)
    : modulos;

  useEffect(() => {
    if (tela !== 'inicio') return;
    setErro('');
    api(`/inicio${loja ? `?loja=${loja}` : ''}`)
      .then(setDados)
      .catch((falha) => (falha.status === 401 ? aoSair() : setErro(falha.message)));
  }, [loja, tela]);

  function emBreve() {
    setAviso('Este módulo será desenvolvido nas próximas etapas.');
    clearTimeout(timerAviso.current);
    timerAviso.current = setTimeout(() => setAviso(''), 2600);
  }

  function abrir(id) {
    setMenuAberto(false);
    if (['inicio', 'usuarios', 'vistorias', 'vendas', 'servicos', 'colaboradores', 'ponto', 'financeiro', 'config', 'lojas', 'clientes', 'whatsapp', 'relatorios'].includes(id)) {
      setTela(id); setVistoriaId(null); setBuscaVendas('');
      if (id === 'vendas') setAbaVenda('lista');
      if (id === 'financeiro') setFinanceiroAbre((f) => ({ aba: 'receber', novo: false, chave: f.chave + 1 }));
    }
    else if (id === 'busca') setConsulta('');
    else emBreve();
  }

  async function trocarCor(cor) {
    aplicarTema(cor);
    setPerfil({ ...perfil, cor });
    try {
      await api('/tema', { metodo: 'PUT', corpo: { cor } });
    } catch (falha) {
      setErro(falha.message);
    }
  }

  // Cada nova venda abre numa aba nova; uma venda já aberta só volta para a aba dela
  const novaVenda = () => {
    setMenuAberto(false); setTela('vendas');
    const chave = `nova-${++contadorAbas.current}`;
    setAbasVenda((abas) => [...abas, { chave, id: null }]);
    setAbaVenda(chave);
  };
  const abrirFinanceiro = (aba, novo = false) => {
    setMenuAberto(false); setTela('financeiro');
    setFinanceiroAbre((f) => ({ aba, novo, chave: f.chave + 1 }));
  };
  const abrirVistoria = (id) => { setTela('vistorias'); setVistoriaId(id); };
  const abrirVenda = (id) => {
    setTela('vendas');
    setAbasVenda((abas) => (abas.some((a) => a.id === id) ? abas : [...abas, { chave: id, id }]));
    setAbaVenda(id);
  };
  const vendaSalva = (chave, id) => {
    // a aba da venda nova passa a ser a da venda salva (se ela já estava aberta em outra aba, junta as duas)
    setAbasVenda((abas) => abas.filter((a) => a.id !== id || a.chave === chave).map((a) => (a.chave === chave ? { ...a, chave: id, id } : a)));
    setAbaVenda(id);
  };
  const tituloAba = (chave, info) => setAbasVenda((abas) => abas.map((a) => (a.chave === chave ? { ...a, ...info } : a)));
  const nomeAba = (a) => (a.numero ? `Venda nº ${a.numero}` : a.id ? 'Venda' : 'Nova venda');
  function fecharAba(aba) {
    if (!aba.id && !confirm('Fechar esta venda sem salvar?')) return;
    const resto = abasVenda.filter((a) => a.chave !== aba.chave);
    setAbasVenda(resto);
    if (abaVenda === aba.chave) {
      const i = abasVenda.findIndex((a) => a.chave === aba.chave);
      setAbaVenda((resto[i] || resto[i - 1])?.chave || 'lista');
    }
  }

  async function salvarMenu(lista) {
    setPerfil({ ...perfil, menu: lista });
    setOrganizandoMenu(false);
    try {
      await api('/menu', { metodo: 'PUT', corpo: { menu: lista } });
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function salvarAtalhos(lista) {
    setPerfil({ ...perfil, atalhos: lista });
    setEditandoAtalhos(false);
    try {
      await api('/atalhos', { metodo: 'PUT', corpo: { atalhos: lista } });
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const valor = (v) => (oculto ? '••••' : moeda(v));
  const receber = dados?.receber, pagar = dados?.pagar, hoje = dados?.vistoriasHoje, mes = dados?.vistoriasMes;
  const nomeMes = new Date().toLocaleDateString('pt-BR', { month: 'long' });
  // O master escolhe o grupo no topo (ou todos); os demais veem só o nome do seu grupo
  const grupoAtual = perfil.grupos?.find((g) => g.id === perfil.grupo);
  const empresa = perfil.master ? (grupoAtual?.nome || 'TODOS OS GRUPOS') : perfil.lojas[0]?.empresa || perfil.usuario.nome;
  function trocarGrupo(id) {
    if (abasVenda.some((a) => !a.id) && !confirm('Há venda nova ainda não salva. Trocar de grupo e descartar?')) return;
    grupoEscolhido.salvar(id);
    window.location.reload();
  }
  const seletorGrupo = perfil.master && perfil.grupos?.length > 0 && (
    <select value={perfil.grupo || ''} onChange={(e) => trocarGrupo(e.target.value)} aria-label="Grupo" className="seletor-grupo">
      <option value="">TODOS OS GRUPOS</option>
      {perfil.grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
    </select>
  );

  const contadores = (q) => (
    <div className="vistorias-hoje">
      {[['carro', 'Carros', q?.carros], ['moto', 'Motos', q?.motos], ['caminhao', 'Caminhões', q?.caminhoes]].map(([ic, nome, qtd]) => (
        <div className="cartao contador" key={ic}>
          <span className="bolha"><Icone nome={ic} tamanho={28} traco={1.8} /></span>
          <span><strong>{qtd ?? '–'}</strong><small>{nome}</small></span>
        </div>
      ))}
    </div>
  );

  const seletorLoja = (
    <select value={loja} onChange={(e) => setLoja(e.target.value)} aria-label="Loja">
      {perfil.lojas.length > 1 && <option value="">Todas as lojas</option>}
      {perfil.lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
    </select>
  );

  const pesquisa = (classe) => (tem('vistorias.ver') || tem('vendas.ver') || tem('clientes.ver') || tem('placa.consultar')) && (
    <Pesquisa classe={classe} loja={loja} podeConsultarPlaca={tem('placa.consultar')}
      aoVistoria={abrirVistoria} aoVenda={abrirVenda} aoConsultarPlaca={(p) => setConsulta(p)}
      aoCliente={(c) => { setTela('vendas'); setAbaVenda('lista'); setBuscaVendas(c.cpf_cnpj || c.nome); }} />
  );

  const paleta = paletaAberta && (
    <div className="paleta" role="dialog" aria-label="Cor do sistema">
      <div className="paleta-topo">
        <strong>Cor do sistema</strong>
        <button className="fechar" onClick={() => setPaletaAberta(false)} aria-label="Fechar">×</button>
      </div>
      <p>Escolha uma cor pronta ou uma cor personalizada. Menu, botões e destaques mudam juntos.</p>
      <div className="paleta-cores">
        {PALETA.map(([nome, hex]) => (
          <button key={hex} title={nome} aria-label={nome} onClick={() => trocarCor(hex)}
            className={perfil.cor.toLowerCase() === hex.toLowerCase() ? 'cor selecionada' : 'cor'}
            style={{ background: hex }} />
        ))}
      </div>
      <label className="paleta-personalizada">
        Cor personalizada
        <input type="color" value={perfil.cor} onChange={(e) => trocarCor(e.target.value)} />
      </label>
      <button className="botao-contorno" onClick={() => trocarCor(COR_PADRAO)}>Voltar ao azul padrão</button>
    </div>
  );

  const painelInicio = (
    <>
      <div className="cabecalho so-computador">
        <h1>Visão geral</h1>
        <button className="botao-contorno" onClick={() => setOculto(!oculto)}>
          {oculto ? 'Mostrar valores' : 'Ocultar valores'} <Icone nome={oculto ? 'olho' : 'olhoFechado'} tamanho={18} />
        </button>
      </div>

      {erro && <p className="erro" role="alert">{erro}</p>}

      <section className="bloco" aria-label="Atalhos">
        <div className="bloco-topo">
          <h2>Atalhos</h2>
          <button className="botao-contorno pequeno" onClick={() => setEditandoAtalhos(true)}>Personalizar</button>
        </div>
        {atalhos.length ? (
          <div className="atalhos">
            {atalhos.map((m) => (
              <button key={m.id} className="cartao atalho" onClick={() => abrir(m.id)}>
                <span className="bolha"><Icone nome={m.id} tamanho={22} /></span>{m.curto}
              </button>
            ))}
          </div>
        ) : (
          <p className="cinza vazio">Nenhum atalho escolhido. Toque em Personalizar para escolher.</p>
        )}
      </section>

      {tem('vendas.ver') && (
        <>
          <section className="bloco">
            <div className="bloco-topo">
              <h2>Vistorias vendidas hoje</h2>
              {tem('vendas.criar') && <button className="botao-contorno pequeno so-computador" onClick={novaVenda}>+ Nova venda</button>}
            </div>
            {contadores(hoje)}
          </section>

          <section className="bloco">
            <div className="bloco-topo">
              <h2>Vistorias vendidas em {nomeMes}</h2>
              <small className="cinza total">Total: {mes ? mes.carros + mes.motos + mes.caminhoes : '–'}</small>
            </div>
            {contadores(mes)}
          </section>
        </>
      )}

      {tem('financeiro.ver') && (
        <>
          <div className="linha-filtro so-computador">
            <label>Mostrar
              <select defaultValue="ambos"><option value="ambos">A receber e a pagar</option><option>Só a receber</option><option>Só a pagar</option></select>
            </label>
            <button className="botao-claro" onClick={() => abrirFinanceiro('receber')}>Relação de contas a receber/pagar</button>
          </div>

          <div className="contas">
            {[['A receber', receber, 'positivo', '+ Nova venda', 'vendas.criar'],
              ['A pagar', pagar, 'negativo', '+ Nova despesa', 'financeiro.lancar']].map(([titulo, c, classe, acao, permissao]) => (
              <section className="bloco" key={titulo} aria-label={titulo}>
                <div className="bloco-topo">
                  <h2>{titulo}</h2>
                  {tem(permissao) && <button className="botao-contorno pequeno" onClick={titulo === 'A pagar' ? () => abrirFinanceiro('pagar', true) : novaVenda}>{acao}</button>}
                </div>
                <div className="duas-colunas">
                  <div className="cartao valor">
                    <span className={classe}><small>R$ </small>{valor(c?.vencidos)}</span>
                    <strong>Vencidos</strong>
                  </div>
                  <div className="cartao valor">
                    <span className={classe}><small>R$ </small>{valor(c?.vencem_hoje)}</span>
                    <strong>Vencem hoje</strong>
                    <small className="cinza">Restante do mês: R$ {valor(c?.restante_mes)}</small>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <div className="tres-colunas">
        {tem('royalties.ver') && (
          <section className="cartao painel">
            <h2>Royalties do mês</h2>
            <span className="destaque">R$ {valor(dados?.royaltiesMes)}</span>
            <small className="cinza">Calculado sobre o faturamento das lojas da franquia.</small>
          </section>
        )}
        {tem('maquininhas.ver') && (
          <section className="cartao painel">
            <h2>Contas e maquininhas</h2>
            <small className="cinza">Nenhum banco ou maquininha conectado.</small>
            {tem('integracoes.gerenciar') && <button className="botao-primario pequeno" onClick={emBreve}>Conectar</button>}
          </section>
        )}
        {tem('ponto.registrar') && (
          <section className="cartao painel">
            <h2>Ponto de hoje</h2>
            <small className="cinza">Entrada, almoço e saída, com foto.</small>
            <button className="botao-primario pequeno" onClick={() => abrir('ponto')}>Registrar ponto</button>
          </section>
        )}
      </div>
    </>
  );

  return (
    <div className="app">
      {/* ---------- Topo (computador) ---------- */}
      <header className="topo so-computador">
        <div className="marca">
          <span className="marca-icone"><Icone nome="escudo" tamanho={22} /></span>
          <span className="marca-textos"><strong>Vistoria ECV</strong><small>Gestão de vistorias cautelares</small></span>
        </div>
        {pesquisa('so-computador')}
        <button className="botao-redondo clara" onClick={() => setPaletaAberta(!paletaAberta)} aria-label="Personalizar cores"><Icone nome="paleta" tamanho={22} /></button>
        <button className="botao-redondo" onClick={emBreve} aria-label="Ajuda"><Icone nome="ajuda" tamanho={22} /></button>
        <div className="empresa">
          {seletorGrupo || <strong>{empresa}</strong>}
          <label>Loja {seletorLoja}</label>
        </div>
        <button className="botao-redondo" onClick={aoSair} aria-label="Sair"><Icone nome="sair" tamanho={22} /></button>
      </header>

      {/* ---------- Topo (celular) ---------- */}
      <header className="topo-celular so-celular">
        <div className="linha">
          <Icone nome="escudo" tamanho={26} />
          <strong className="titulo">Vistoria ECV</strong>
          {perfil.logo && <img className="logo-celular" src={perfil.logo} alt={`Logo ${empresa}`} />}
          <button onClick={() => setOculto(!oculto)} aria-label={oculto ? 'Mostrar valores' : 'Ocultar valores'}><Icone nome={oculto ? 'olhoFechado' : 'olho'} tamanho={22} /></button>
          <button onClick={() => setPaletaAberta(!paletaAberta)} aria-label="Personalizar cores"><Icone nome="paleta" tamanho={22} /></button>
          <button onClick={aoSair} aria-label="Sair"><Icone nome="sair" tamanho={22} /></button>
        </div>
        {seletorGrupo && <label className="loja">Grupo {seletorGrupo}</label>}
        <label className="loja">Loja {seletorLoja}</label>
        <div className="linha-pesquisa">
          {pesquisa('')}
        </div>
      </header>

      {paleta}

      <div className="corpo">
        <nav className="menu so-computador" aria-label="Menu principal">
          {perfil.logo && <div className="logo-grupo"><img src={perfil.logo} alt={`Logo ${empresa}`} /></div>}
          {tem('vendas.criar') && (
            <button className="nova-venda" onClick={novaVenda} title="Nova venda" aria-label="Nova venda">
              <Icone nome="mais" /><span className="rotulo">Nova venda</span>
            </button>
          )}
          {[{ id: 'inicio', nome: 'Início' }, ...modulos].map((m) => (
            <button key={m.id} className={tela === m.id ? 'ativo' : ''} title={m.nome} aria-label={m.nome} onClick={() => abrir(m.id)}>
              <Icone nome={m.id} /><span className="rotulo">{m.nome}</span>
              {m.sub && <span className="seta"><Icone nome="direita" tamanho={16} /></span>}
            </button>
          ))}
          <button className="organizar-menu" onClick={() => setOrganizandoMenu(true)} title="Organizar menu" aria-label="Organizar menu">
            <Icone nome="ordenar" tamanho={18} /><span className="rotulo">Organizar menu</span>
          </button>
        </nav>

        <main className="conteudo">
          {tela === 'vendas' && abasVenda.length > 0 && (
            <div className="abas-vendas" role="tablist" aria-label="Vendas abertas">
              <button role="tab" aria-selected={abaVenda === 'lista'} className={abaVenda === 'lista' ? 'ativa' : ''} onClick={() => setAbaVenda('lista')}>
                <Icone nome="vendas" tamanho={16} /> Lista
              </button>
              {abasVenda.map((a) => (
                <span key={a.chave} className={`aba-venda${a.situacao ? ` st-${a.situacao}` : ''}${abaVenda === a.chave ? ' ativa' : ''}`}
                  title={`${nomeAba(a)} · ${a.situacao ? SITUACOES[a.situacao] : 'ainda não salva'}`}>
                  <button role="tab" aria-selected={abaVenda === a.chave} onClick={() => setAbaVenda(a.chave)} aria-label={`${nomeAba(a)}${a.placa ? `, placa ${a.placa}` : ''}`}>
                    {a.placa === 'DIVERSOS' ? <PlacasDiversas tamanho="mini" /> : a.placa ? <Placa placa={a.placa} tamanho="mini" /> : nomeAba(a)}
                  </button>
                  <button className="fechar-aba" aria-label={`Fechar ${nomeAba(a)}`} title="Fechar" onClick={() => fecharAba(a)}>×</button>
                </span>
              ))}
              {tem('vendas.criar') && <button className="nova-aba" onClick={novaVenda} title="Nova venda" aria-label="Nova venda em outra aba">+</button>}
            </div>
          )}
          {tela === 'usuarios' ? <UsuariosPermissoes perfil={perfil} />
            : tela === 'colaboradores' ? <Colaboradores perfil={perfil} loja={loja} />
            : tela === 'ponto' ? <Ponto perfil={perfil} loja={loja} />
            : tela === 'config' ? <Configuracoes perfil={perfil} />
            : tela === 'lojas' ? <Grupos />
            : tela === 'clientes' ? <Clientes perfil={perfil} loja={loja} />
            : tela === 'whatsapp' ? <WhatsApp perfil={perfil} loja={loja} />
            : tela === 'relatorios' ? <Relatorios perfil={perfil} loja={loja} empresa={empresa} logo={perfil.logo} />
            : tela === 'financeiro' ? <Financeiro key={financeiroAbre.chave} perfil={perfil} loja={loja} abaInicial={financeiroAbre.aba} novoInicial={financeiroAbre.novo} />
            : tela === 'servicos' ? (() => {
                const lojaServicos = lojasCom('servicos.ver').includes(loja) ? loja : lojasCom('servicos.ver')[0];
                return <Servicos loja={lojaServicos} podeEditar={criarTem(perfil, lojaServicos)('servicos.gerenciar')} />;
              })()
            : tela === 'vendas' ? (abaVenda === 'lista' || !abasVenda.length) && (
                <ListaVendas key={buscaVendas} loja={loja} buscaInicial={buscaVendas} empresa={empresa} logo={perfil.logo} lojasLote={perfil.lojas.filter((l) => lojasCom('vendas.criar').includes(l.id))} podeCriar={tem('vendas.criar')} aoAbrir={abrirVenda} aoNova={novaVenda} />)
            : tela === 'vistorias' ? (vistoriaId
              ? <ExecutarVistoria key={vistoriaId} id={vistoriaId} aoVoltar={() => setVistoriaId(null)} />
              : <ListaVistorias loja={loja} podeCriar={tem('vistorias.criar')} aoAbrir={setVistoriaId} aoNova={() => setNovaVistoria(true)} />)
            : painelInicio}
          {/* As vendas abertas ficam montadas (escondidas) para não perder o que foi digitado ao trocar de aba ou de tela */}
          {abasVenda.length > 0 && (
            <div className="area-vendas" hidden={tela !== 'vendas'}>
              {abasVenda.map((a) => (
                <div key={a.chave} hidden={abaVenda !== a.chave}>
                  <EditorVenda id={a.id} perfil={perfil} lojaInicial={loja} lojasPermitidas={lojasCom('vendas.criar')}
                    aoVoltar={() => setAbaVenda('lista')} aoSalvo={(id) => vendaSalva(a.chave, id)} aoTitulo={(info) => tituloAba(a.chave, info)} />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ---------- Navegação inferior (celular) ---------- */}
      <nav className="barra-inferior so-celular" aria-label="Navegação">
        <button className={tela === 'inicio' ? 'ativo' : ''} onClick={() => abrir('inicio')}><Icone nome="inicio" tamanho={22} />Início</button>
        {tem('placa.consultar') ? <button onClick={() => setConsulta('')}><Icone nome="busca" tamanho={22} />Placa</button> : <span />}
        <span>
          {tem('vendas.criar') && <button className="botao-central" onClick={novaVenda} aria-label="Nova venda"><Icone nome="mais" tamanho={26} traco={2.6} /></button>}
        </span>
        {tem('vendas.ver') ? <button className={tela === 'vendas' ? 'ativo' : ''} onClick={() => abrir('vendas')}><Icone nome="vendas" tamanho={22} />Vendas</button>
          : tem('financeiro.ver') ? <button className={tela === 'financeiro' ? 'ativo' : ''} onClick={() => abrir('financeiro')}><Icone nome="financeiro" tamanho={22} />Financeiro</button> : <span />}
        <button className={menuAberto ? 'ativo' : ''} onClick={() => setMenuAberto(true)}><Icone nome="menu" tamanho={22} />Menu</button>
      </nav>

      {menuAberto && (
        <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && setMenuAberto(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="modal-topo">
              <h2>Menu</h2>
              <button className="fechar" onClick={() => setMenuAberto(false)} aria-label="Fechar">×</button>
            </div>
            {tem('vendas.criar') && <button className="botao-primario" onClick={novaVenda}><Icone nome="mais" tamanho={18} /> Nova venda</button>}
            <div className="lista-menu">
              {modulos.map((m) => (
                <button key={m.id} onClick={() => abrir(m.id)}>
                  <span className="bolha"><Icone nome={m.id} tamanho={20} /></span>{m.nome}
                </button>
              ))}
            </div>
            <button className="botao-contorno" onClick={() => { setMenuAberto(false); setOrganizandoMenu(true); }}>
              <Icone nome="ordenar" tamanho={18} /> Organizar menu
            </button>
          </section>
        </div>
      )}

      {organizandoMenu && (
        <EditorAtalhos soOrdem titulo="Organizar menu" ajuda="Use as setas para escolher a ordem dos itens do seu menu."
          disponiveis={MODULOS.filter((m) => tem(m.permissao))} escolhidos={modulos.map((m) => m.id)}
          aoSalvar={salvarMenu} aoFechar={() => setOrganizandoMenu(false)} />
      )}

      {editandoAtalhos && (
        <EditorAtalhos disponiveis={modulos} escolhidos={atalhos.map((m) => m.id)}
          aoSalvar={salvarAtalhos} aoFechar={() => setEditandoAtalhos(false)} />
      )}

      {novaVistoria && (
        <NovaVistoria perfil={perfil} lojaInicial={loja} tem={tem}
          lojasPermitidas={perfil.lojas.map((l) => l.id).filter((id) => criarTem(perfil, id)('vistorias.criar'))}
          aoFechar={() => setNovaVistoria(false)}
          aoCriar={(id) => { setNovaVistoria(false); setTela('vistorias'); setVistoriaId(id); }} />
      )}

      {consulta !== null && <ConsultaPlaca loja={loja} placaInicial={consulta} aoFechar={() => setConsulta(null)} />}

      {aviso && <div className="aviso" role="status">{aviso}</div>}
    </div>
  );
}
