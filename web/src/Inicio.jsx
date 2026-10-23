import { useEffect, useRef, useState } from 'react';
import { api, moeda } from './api.js';
import { aplicarTema, COR_PADRAO, PALETA } from './tema.js';
import { Icone } from './icones.jsx';
import ConsultaPlaca from './ConsultaPlaca.jsx';

const MENU = [
  ['inicio', 'Início'], ['vistorias', 'Vistorias', true], ['busca', 'Consulta de placa'],
  ['camera', 'Ler placa por foto'], ['clientes', 'Clientes'], ['financeiro', 'Financeiro', true],
  ['royalties', 'Royalties'], ['maquininha', 'Maquininhas e bancos', true], ['lojas', 'Lojas'],
  ['usuarios', 'Usuários e permissões'], ['ponto', 'Controle de ponto'], ['relatorios', 'Relatórios'],
  ['whatsapp', 'WhatsApp'], ['config', 'Configurações'],
];

const ATALHOS = [
  ['vistorias', 'Vistorias'], ['financeiro', 'Financeiro'], ['royalties', 'Royalties'],
  ['maquininha', 'Maquininhas'], ['ponto', 'Ponto'], ['relatorios', 'Relatórios'],
  ['whatsapp', 'WhatsApp'], ['lojas', 'Lojas'], ['usuarios', 'Usuários'],
];

export default function Inicio({ perfil, setPerfil, aoSair }) {
  const [loja, setLoja] = useState('');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [oculto, setOculto] = useState(false);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [aviso, setAviso] = useState('');
  const [consulta, setConsulta] = useState(null); // null = fechada; texto = placa digitada
  const [buscaCelular, setBuscaCelular] = useState('');
  const timerAviso = useRef();

  useEffect(() => {
    setErro('');
    api(`/inicio${loja ? `?loja=${loja}` : ''}`)
      .then(setDados)
      .catch((falha) => (falha.status === 401 ? aoSair() : setErro(falha.message)));
  }, [loja]);

  function emBreve() {
    setAviso('Este módulo será desenvolvido nas próximas etapas.');
    clearTimeout(timerAviso.current);
    timerAviso.current = setTimeout(() => setAviso(''), 2600);
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

  const valor = (v) => (oculto ? '••••' : moeda(v));
  const receber = dados?.receber, pagar = dados?.pagar, hoje = dados?.vistoriasHoje;
  const empresa = perfil.lojas[0]?.empresa || perfil.usuario.nome;

  const seletorLoja = (
    <select value={loja} onChange={(e) => setLoja(e.target.value)} aria-label="Loja">
      {perfil.lojas.length > 1 && <option value="">Todas as lojas</option>}
      {perfil.lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
    </select>
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

  return (
    <div className="app">
      {/* ---------- Topo (computador) ---------- */}
      <header className="topo so-computador">
        <div className="marca">
          <span className="marca-icone"><Icone nome="escudo" tamanho={22} /></span>
          <span className="marca-textos"><strong>Vistoria ECV</strong><small>Gestão de vistorias cautelares</small></span>
        </div>
        <button className="botao-texto" onClick={() => setConsulta('')}><Icone nome="busca" /> Buscar placa</button>
        <button className="botao-primario" onClick={emBreve}><Icone nome="mais" tamanho={18} /> Nova vistoria</button>
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
        <form className="busca" onSubmit={(e) => { e.preventDefault(); setConsulta(buscaCelular); }}>
          <label>
            <Icone nome="busca" />
            <input type="search" enterKeyHint="search" placeholder="Buscar placa" aria-label="Buscar placa"
              value={buscaCelular} onChange={(e) => setBuscaCelular(e.target.value)} />
          </label>
          <button type="button" onClick={emBreve} aria-label="Ler placa pela câmera"><Icone nome="camera" tamanho={22} /></button>
        </form>
      </header>

      {paleta}

      <div className="corpo">
        <nav className="menu so-computador" aria-label="Menu principal">
          {MENU.map(([icone, nome, sub]) => (
            <button key={icone} className={icone === 'inicio' ? 'ativo' : ''}
              onClick={icone === 'inicio' ? undefined : icone === 'busca' ? () => setConsulta('') : emBreve}>
              <Icone nome={icone} /><span>{nome}</span>{sub && <Icone nome="direita" tamanho={16} />}
            </button>
          ))}
        </nav>

        <main className="conteudo">
          <div className="cabecalho so-computador">
            <h1>Visão geral</h1>
            <button className="botao-contorno" onClick={() => setOculto(!oculto)}>
              {oculto ? 'Mostrar valores' : 'Ocultar valores'} <Icone nome={oculto ? 'olho' : 'olhoFechado'} tamanho={18} />
            </button>
          </div>

          {erro && <p className="erro" role="alert">{erro}</p>}

          <section className="bloco">
            <div className="bloco-topo">
              <h2>Vistorias de hoje</h2>
              <button className="botao-contorno pequeno so-computador" onClick={emBreve}>+ Nova vistoria</button>
            </div>
            <div className="vistorias-hoje">
              {[['carro', 'Carros', hoje?.carros], ['moto', 'Motos', hoje?.motos], ['caminhao', 'Caminhões', hoje?.caminhoes]].map(([ic, nome, qtd]) => (
                <div className="cartao contador" key={ic}>
                  <span className="bolha"><Icone nome={ic} tamanho={28} traco={1.8} /></span>
                  <span><strong>{qtd ?? '–'}</strong><small>{nome}</small></span>
                </div>
              ))}
            </div>
          </section>

          <div className="linha-filtro so-computador">
            <label>Mostrar
              <select defaultValue="ambos"><option value="ambos">A receber e a pagar</option><option>Só a receber</option><option>Só a pagar</option></select>
            </label>
            <button className="botao-claro" onClick={emBreve}>Relação de contas a receber/pagar</button>
          </div>

          <div className="contas">
            {[['A receber', receber, 'positivo', '+ Nova venda'], ['A pagar', pagar, 'negativo', '+ Nova despesa']].map(([titulo, c, classe, acao]) => (
              <section className="bloco" key={titulo} aria-label={titulo}>
                <div className="bloco-topo">
                  <h2>{titulo}</h2>
                  <button className="botao-contorno pequeno" onClick={emBreve}>{acao}</button>
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

          <section className="bloco so-celular" aria-label="Atalhos">
            <h2>Atalhos</h2>
            <div className="atalhos">
              {ATALHOS.map(([ic, nome]) => (
                <button key={ic} className="cartao atalho" onClick={emBreve}>
                  <span className="bolha"><Icone nome={ic} tamanho={22} /></span>{nome}
                </button>
              ))}
            </div>
          </section>

          <div className="tres-colunas">
            <section className="cartao painel">
              <h2>Royalties do mês</h2>
              <span className="destaque">R$ {valor(dados?.royaltiesMes)}</span>
              <small className="cinza">Calculado sobre o faturamento das lojas da franquia.</small>
            </section>
            <section className="cartao painel">
              <h2>Contas e maquininhas</h2>
              <small className="cinza">Nenhum banco ou maquininha conectado.</small>
              <button className="botao-primario pequeno" onClick={emBreve}>Conectar</button>
            </section>
            <section className="cartao painel">
              <h2>Ponto de hoje</h2>
              <small className="cinza">Nenhum registro de entrada ainda.</small>
              <button className="botao-primario pequeno" onClick={emBreve}>Registrar ponto</button>
            </section>
          </div>
        </main>
      </div>

      {/* ---------- Navegação inferior (celular) ---------- */}
      <nav className="barra-inferior so-celular" aria-label="Navegação">
        <button className="ativo"><Icone nome="inicio" tamanho={22} />Início</button>
        <button onClick={emBreve}><Icone nome="vistorias" tamanho={22} />Vistorias</button>
        <span><button className="botao-central" onClick={emBreve} aria-label="Nova vistoria"><Icone nome="mais" tamanho={26} traco={2.6} /></button></span>
        <button onClick={emBreve}><Icone nome="financeiro" tamanho={22} />Financeiro</button>
        <button onClick={emBreve}><Icone nome="menu" tamanho={22} />Menu</button>
      </nav>

      {consulta !== null && <ConsultaPlaca loja={loja} placaInicial={consulta} aoFechar={() => setConsulta(null)} />}

      {aviso && <div className="aviso" role="status">{aviso}</div>}
    </div>
  );
}
