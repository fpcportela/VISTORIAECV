import { useEffect, useRef, useState } from 'react';
import { api, moeda } from './api.js';
import { aplicarTema, COR_PADRAO, PALETA } from './tema.js';
import { Icone } from './icones.jsx';
import { MODULOS, criarTem, ordenar } from './modulos.js';
import ConsultaPlaca from './ConsultaPlaca.jsx';
import EditorAtalhos from './EditorAtalhos.jsx';
import UsuariosPermissoes from './UsuariosPermissoes.jsx';
import { ExecutarVistoria, ListaVistorias, NovaVistoria } from './Vistorias.jsx';
import { EditorVenda, ListaVendas } from './Vendas.jsx';
import Servicos from './Servicos.jsx';
import Pesquisa from './Pesquisa.jsx';

export default function Inicio({ perfil, setPerfil, aoSair }) {
  const [loja, setLoja] = useState('');
  const [tela, setTela] = useState('inicio');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [oculto, setOculto] = useState(false);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [editandoAtalhos, setEditandoAtalhos] = useState(false);
  const [novaVistoria, setNovaVistoria] = useState(false);
  const [vistoriaId, setVistoriaId] = useState(null);
  const [vendaId, setVendaId] = useState(null); // null = lista; 'nova' = nova venda
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
    if (['inicio', 'usuarios', 'vistorias', 'vendas', 'servicos'].includes(id)) {
      setTela(id); setVistoriaId(null); setVendaId(null); setBuscaVendas('');
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

  const novaVenda = () => { setMenuAberto(false); setTela('vendas'); setVendaId('nova'); };
  const abrirVistoria = (id) => { setTela('vistorias'); setVistoriaId(id); };
  const abrirVenda = (id) => { setTela('vendas'); setVendaId(id); };

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
  const empresa = perfil.lojas[0]?.empresa || perfil.usuario.nome;

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
      aoCliente={(c) => { setTela('vendas'); setVendaId(null); setBuscaVendas(c.cpf_cnpj || c.nome); }} />
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
            <button className="botao-claro" onClick={emBreve}>Relação de contas a receber/pagar</button>
          </div>

          <div className="contas">
            {[['A receber', receber, 'positivo', '+ Nova venda', 'vendas.criar'],
              ['A pagar', pagar, 'negativo', '+ Nova despesa', 'financeiro.lancar']].map(([titulo, c, classe, acao, permissao]) => (
              <section className="bloco" key={titulo} aria-label={titulo}>
                <div className="bloco-topo">
                  <h2>{titulo}</h2>
                  {tem(permissao) && <button className="botao-contorno pequeno" onClick={emBreve}>{acao}</button>}
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
            <small className="cinza">Nenhum registro de entrada ainda.</small>
            <button className="botao-primario pequeno" onClick={emBreve}>Registrar ponto</button>
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
          <strong>{empresa}</strong>
          <label>Loja {seletorLoja}</label>
        </div>
        <button className="botao-redondo" onClick={aoSair} aria-label="Sair"><Icone nome="sair" tamanho={22} /></button>
      </header>

      {/* ---------- Topo (celular) ---------- */}
      <header className="topo-celular so-celular">
        <div className="linha">
          <Icone nome="escudo" tamanho={26} />
          <strong className="titulo">Vistoria ECV</strong>
          <button onClick={() => setOculto(!oculto)} aria-label={oculto ? 'Mostrar valores' : 'Ocultar valores'}><Icone nome={oculto ? 'olhoFechado' : 'olho'} tamanho={22} /></button>
          <button onClick={() => setPaletaAberta(!paletaAberta)} aria-label="Personalizar cores"><Icone nome="paleta" tamanho={22} /></button>
          <button onClick={aoSair} aria-label="Sair"><Icone nome="sair" tamanho={22} /></button>
        </div>
        <label className="loja">Loja {seletorLoja}</label>
        <div className="linha-pesquisa">
          {pesquisa('')}
          {tem('placa.foto') && <button type="button" className="botao-camera" onClick={emBreve} aria-label="Ler placa pela câmera"><Icone nome="camera" tamanho={22} /></button>}
        </div>
      </header>

      {paleta}

      <div className="corpo">
        <nav className="menu so-computador" aria-label="Menu principal">
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
          {tela === 'usuarios' ? <UsuariosPermissoes perfil={perfil} />
            : tela === 'servicos' ? (() => {
                const lojaServicos = lojasCom('servicos.ver').includes(loja) ? loja : lojasCom('servicos.ver')[0];
                return <Servicos loja={lojaServicos} podeEditar={criarTem(perfil, lojaServicos)('servicos.gerenciar')} />;
              })()
            : tela === 'vendas' ? (vendaId
              ? <EditorVenda key={vendaId} id={vendaId === 'nova' ? null : vendaId} perfil={perfil} lojaInicial={loja}
                  lojasPermitidas={lojasCom('vendas.criar')} aoVoltar={() => setVendaId(null)} aoSalvo={(id) => setVendaId(id)} />
              : <ListaVendas key={buscaVendas} loja={loja} buscaInicial={buscaVendas} empresa={empresa} podeCriar={tem('vendas.criar')} aoAbrir={setVendaId} aoNova={novaVenda} />)
            : tela === 'vistorias' ? (vistoriaId
              ? <ExecutarVistoria key={vistoriaId} id={vistoriaId} aoVoltar={() => setVistoriaId(null)} />
              : <ListaVistorias loja={loja} podeCriar={tem('vistorias.criar')} aoAbrir={setVistoriaId} aoNova={() => setNovaVistoria(true)} />)
            : painelInicio}
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
          : tem('financeiro.ver') ? <button onClick={emBreve}><Icone nome="financeiro" tamanho={22} />Financeiro</button> : <span />}
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
