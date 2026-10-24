import { useEffect, useState } from 'react';
import { api } from './api.js';
import { criarTem } from './modulos.js';
import { cpfValido, mascaraCpf, mascaraTelefone } from './documentos.js';

// Tela "Usuários e permissões": perfis (função → em cada módulo, consulta e/ou uso)
// e usuários (dados, filiais onde trabalham e o perfil em cada uma).
// Quem só tem "usuarios.ver" vê tudo, mas não altera.
export default function UsuariosPermissoes({ perfil }) {
  const [aba, setAba] = useState('usuarios');
  const [permissoes, setPermissoes] = useState([]);
  const [perfis, setPerfis] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [editando, setEditando] = useState(null); // { tipo: 'perfil' | 'usuario', item }
  const [erro, setErro] = useState('');

  // Lojas em que quem está logado pode configurar (ou só ver) usuários
  const lojas = perfil.lojas.filter((l) => criarTem(perfil, l.id)('usuarios.gerenciar'));
  const lojasVer = perfil.lojas.filter((l) => criarTem(perfil, l.id)('usuarios.ver') || criarTem(perfil, l.id)('usuarios.gerenciar'));
  const podeEditar = lojas.length > 0;
  const empresas = [...new Map(lojas.map((l) => [l.empresa_id, l.empresa])).entries()];

  async function carregar() {
    setErro('');
    try {
      const [p, f, u] = await Promise.all([api('/permissoes'), api('/perfis'), api('/usuarios')]);
      setPermissoes(p); setPerfis(f); setUsuarios(u);
    } catch (falha) {
      setErro(falha.message);
    }
  }
  useEffect(() => { carregar(); }, []);

  async function excluirPerfil(p) {
    if (!confirm(`Excluir o perfil "${p.nome}"?`)) return;
    try {
      await api(`/perfis/${p.id}`, { metodo: 'DELETE' });
      carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const nomeLoja = (id) => perfil.lojas.find((l) => l.id === id)?.nome || 'Outra loja';
  const nomePerfil = (id) => perfis.find((p) => p.id === id)?.nome || '–';

  return (
    <>
      <div className="cabecalho">
        <h1>Usuários e permissões</h1>
        {podeEditar && (
          <button className="botao-primario" onClick={() => setEditando({ tipo: aba === 'usuarios' ? 'usuario' : 'perfil', item: null })}>
            + {aba === 'usuarios' ? 'Novo usuário' : 'Novo perfil'}
          </button>
        )}
      </div>

      <div className="abas" role="tablist">
        <button role="tab" aria-selected={aba === 'usuarios'} className={aba === 'usuarios' ? 'ativa' : ''} onClick={() => setAba('usuarios')}>Usuários</button>
        <button role="tab" aria-selected={aba === 'perfis'} className={aba === 'perfis' ? 'ativa' : ''} onClick={() => setAba('perfis')}>Perfis (funções)</button>
      </div>

      {erro && <p className="erro" role="alert">{erro}</p>}

      {aba === 'usuarios' ? (
        <div className="lista-cadastro">
          {usuarios.map((u) => (
            <button key={u.id} className="cartao item-cadastro" onClick={() => setEditando({ tipo: 'usuario', item: u })} disabled={u.master && !perfil.master && podeEditar}>
              <span className="item-titulo">
                <strong>{u.nome}</strong>
                {u.master && <span className="etiqueta">Master</span>}
                {!u.ativo && <span className="etiqueta inativa">Inativo</span>}
              </span>
              <small className="cinza">{[u.email, u.cpf && mascaraCpf(u.cpf), u.telefone && mascaraTelefone(u.telefone)].filter(Boolean).join(' · ')}</small>
              <small>
                {u.master ? 'Acesso a todos os módulos e lojas'
                  : u.vinculos.length ? u.vinculos.map((v) => `${nomeLoja(v.loja_id)}: ${nomePerfil(v.perfil_id)}`).join(' · ')
                  : 'Sem loja'}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <div className="lista-cadastro">
          <p className="cinza ajuda">O perfil define, em cada módulo, se a função só consulta ou também usa. O usuário master sempre tem acesso a tudo.</p>
          {perfis.map((p) => (
            <div key={p.id} className="cartao item-cadastro">
              <span className="item-titulo">
                <strong>{p.nome}</strong>
                {empresas.length > 1 && <span className="etiqueta">{p.empresa}</span>}
              </span>
              {p.descricao && <small className="cinza">{p.descricao}</small>}
              <small>{resumoPerfil(p, permissoes)} · {p.usuarios} usuário(s)</small>
              <span className="acoes-item">
                <button className="botao-contorno pequeno" onClick={() => setEditando({ tipo: 'perfil', item: p })}>{podeEditar ? 'Editar' : 'Ver'}</button>
                {podeEditar && <button className="botao-contorno pequeno" onClick={() => setEditando({ tipo: 'perfil', item: { ...p, id: null, nome: `${p.nome} (cópia)` } })}>Duplicar</button>}
                {podeEditar && p.usuarios === 0 && <button className="botao-contorno pequeno perigo" onClick={() => excluirPerfil(p)}>Excluir</button>}
              </span>
            </div>
          ))}
        </div>
      )}

      {editando?.tipo === 'perfil' && (
        <EditorPerfil item={editando.item} empresas={empresas} permissoes={permissoes} somenteLeitura={!podeEditar}
          aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); carregar(); }} />
      )}
      {editando?.tipo === 'usuario' && (
        <EditorUsuario item={editando.item} lojas={podeEditar ? lojas : lojasVer} perfis={perfis} somenteLeitura={!podeEditar}
          aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); carregar(); }} />
      )}
    </>
  );
}

function Modal({ titulo, aoFechar, children }) {
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

// Módulos fora do sistema (a vistoria é feita no sistema do Detran): não aparecem,
// mas o que já estiver marcado neles é mantido.
const OCULTOS = new Set(['Vistorias']);
// Aqui "consulta" (ver o ponto da equipe) não é necessária para "uso" (bater o próprio ponto)
const USO_SEM_CONSULTA = new Set(['Controle de ponto']);

// Permissões agrupadas por módulo, na ordem do catálogo, separadas em consulta e uso
function agruparModulos(permissoes) {
  const mapa = new Map();
  permissoes.filter((p) => !OCULTOS.has(p.modulo)).forEach((p) => {
    const m = mapa.get(p.modulo) || { modulo: p.modulo, consulta: [], uso: [] };
    m[p.nivel === 'consulta' ? 'consulta' : 'uso'].push(p);
    mapa.set(p.modulo, m);
  });
  return [...mapa.values()];
}

function resumoPerfil(p, permissoes) {
  const tem = new Set(p.permissoes);
  const mods = agruparModulos(permissoes);
  const uso = mods.filter((m) => m.uso.some((x) => tem.has(x.codigo))).length;
  const consulta = mods.filter((m) => !m.uso.some((x) => tem.has(x.codigo)) && m.consulta.some((x) => tem.has(x.codigo))).length;
  return `${uso} módulo(s) com uso · ${consulta} só consulta`;
}

function EditorPerfil({ item, empresas, permissoes, somenteLeitura, aoFechar, aoSalvar }) {
  const [nome, setNome] = useState(item?.nome || '');
  const [descricao, setDescricao] = useState(item?.descricao || '');
  const [empresa, setEmpresa] = useState(item?.empresa_id || empresas[0]?.[0] || '');
  const [marcadas, setMarcadas] = useState(new Set(item?.permissoes || []));
  const [aberto, setAberto] = useState(null); // módulo com o detalhe aberto
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const modulos = agruparModulos(permissoes);
  const codigos = (lista) => lista.map((p) => p.codigo);
  const estado = (lista) => {
    const n = lista.filter((p) => marcadas.has(p.codigo)).length;
    return n === 0 ? 'nada' : n === lista.length ? 'tudo' : 'parte';
  };

  // Liga/desliga códigos; "uso" leva junto a "consulta" do módulo e tirar a consulta tira o uso
  const alternar = (lista, ligar, m) => {
    const nova = new Set(marcadas);
    lista.forEach((c) => (ligar ? nova.add(c) : nova.delete(c)));
    if (m && !USO_SEM_CONSULTA.has(m.modulo)) {
      const usando = m.uso.some((p) => nova.has(p.codigo));
      const consultando = m.consulta.some((p) => nova.has(p.codigo));
      if (ligar && usando && !consultando) codigos(m.consulta).forEach((c) => nova.add(c));
      if (!ligar && m.consulta.length && !consultando) codigos(m.uso).forEach((c) => nova.delete(c));
    }
    setMarcadas(nova);
  };
  const visiveis = modulos.flatMap((m) => [...codigos(m.consulta), ...codigos(m.uso)]);
  const tudo = visiveis.every((c) => marcadas.has(c));

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      const corpo = { empresa_id: empresa, nome, descricao, permissoes: [...marcadas] };
      await (item?.id ? api(`/perfis/${item.id}`, { metodo: 'PUT', corpo }) : api('/perfis', { metodo: 'POST', corpo }));
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  const caixa = (lista, m, rotulo) => {
    if (!lista.length) return <span className="cinza" title="Este módulo não tem esta opção">—</span>;
    const e = estado(lista);
    return (
      <input type="checkbox" aria-label={`${rotulo} em ${m.modulo}`} checked={e === 'tudo'}
        ref={(el) => el && (el.indeterminate = e === 'parte')}
        onChange={() => alternar(codigos(lista), e !== 'tudo', m)} />
    );
  };

  return (
    <Modal titulo={somenteLeitura ? 'Perfil' : item?.id ? 'Editar perfil' : 'Novo perfil'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <fieldset className="sem-borda" disabled={somenteLeitura}>
          <label>Nome da função<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Atendente" required /></label>
          <label>Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" /></label>
          {!item?.id && empresas.length > 1 && (
            <label>Grupo
              <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                {empresas.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </label>
          )}

          <p className="cinza ajuda"><strong>Consulta</strong>: só vê o módulo. <strong>Uso</strong>: também cria, altera e executa as ações. Clique no nome do módulo para escolher item por item.</p>
          <div className="tabela-acessos" role="table" aria-label="Acesso por módulo">
            <div className="ta-linha ta-cabecalho" role="row">
              <span role="columnheader">Módulo</span><span role="columnheader">Consulta</span><span role="columnheader">Uso</span>
            </div>
            {modulos.map((m) => (
              <div key={m.modulo} className="ta-grupo">
                <div className="ta-linha" role="row">
                  <button type="button" className="ta-modulo" aria-expanded={aberto === m.modulo}
                    onClick={() => setAberto(aberto === m.modulo ? null : m.modulo)}>
                    <span className="ta-seta">{aberto === m.modulo ? '▾' : '▸'}</span>{m.modulo}
                  </button>
                  <span role="cell">{caixa(m.consulta, m, 'Consulta')}</span>
                  <span role="cell">{caixa(m.uso, m, 'Uso')}</span>
                </div>
                {aberto === m.modulo && (
                  <div className="ta-detalhe">
                    {[...m.consulta, ...m.uso].map((p) => (
                      <label key={p.codigo} className="linha-check">
                        <input type="checkbox" checked={marcadas.has(p.codigo)} onChange={() => alternar([p.codigo], !marcadas.has(p.codigo), m)} />
                        {p.descricao}
                        <span className={`etiqueta ${p.nivel === 'consulta' ? '' : 'uso'}`}>{p.nivel === 'consulta' ? 'Consulta' : 'Uso'}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </fieldset>

        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          {somenteLeitura ? <button type="button" className="botao-contorno" onClick={aoFechar}>Fechar</button> : (
            <>
              <button type="button" className="botao-contorno" onClick={() => alternar(visiveis, !tudo)}>
                {tudo ? 'Desmarcar tudo' : 'Marcar tudo'}
              </button>
              <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

function EditorUsuario({ item, lojas, perfis, somenteLeitura, aoFechar, aoSalvar }) {
  const [nome, setNome] = useState(item?.nome || '');
  const [cpf, setCpf] = useState(item?.cpf ? mascaraCpf(item.cpf) : '');
  const [telefone, setTelefone] = useState(item?.telefone ? mascaraTelefone(item.telefone) : '');
  const [email, setEmail] = useState(item?.email || '');
  const [senha, setSenha] = useState('');
  const [ativo, setAtivo] = useState(item?.ativo ?? true);
  // perfil escolhido em cada filial (sem entrada = não tem acesso à filial)
  const [vinculos, setVinculos] = useState(() =>
    Object.fromEntries((item?.vinculos || []).map((v) => [v.loja_id, v.perfil_id])));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const perfisDa = (l) => perfis.filter((p) => p.empresa_id === l.empresa_id);
  // Ao marcar uma filial, repete o perfil já escolhido nas outras do grupo (sem nenhum, a pessoa escolhe)
  const sugerir = (l) => Object.values(vinculos).find((p) => perfisDa(l).some((x) => x.id === p)) || '';
  const marcada = (l) => l.id in vinculos;
  const marcarFilial = (l, marcar) => {
    const novo = { ...vinculos };
    if (marcar) novo[l.id] = sugerir(l); else delete novo[l.id];
    setVinculos(novo);
  };
  const todas = lojas.length > 0 && lojas.every(marcada);
  const marcarTodas = () => {
    if (todas) return setVinculos({});
    const novo = { ...vinculos };
    lojas.forEach((l) => { if (!marcada(l)) novo[l.id] = sugerir(l); });
    setVinculos(novo);
  };

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (cpf && !cpfValido(cpf)) return setErro('CPF inválido. Confira os números.');
    const semPerfil = lojas.find((l) => marcada(l) && !vinculos[l.id]);
    if (semPerfil) return setErro(`Escolha o perfil do usuário em ${semPerfil.nome}.`);
    if (telefone && !/^\d{10,11}$/.test(telefone.replace(/\D/g, ''))) return setErro('Celular incompleto. Use DDD + número.');
    setSalvando(true);
    try {
      const corpo = {
        nome, cpf, telefone, email, senha: senha || undefined, ativo,
        vinculos: Object.entries(vinculos).filter(([, p]) => p).map(([loja_id, perfil_id]) => ({ loja_id, perfil_id })),
      };
      await (item ? api(`/usuarios/${item.id}`, { metodo: 'PUT', corpo }) : api('/usuarios', { metodo: 'POST', corpo }));
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  return (
    <Modal titulo={somenteLeitura ? 'Usuário' : item ? 'Editar usuário' : 'Novo usuário'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <fieldset className="sem-borda" disabled={somenteLeitura}>
          <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required autoComplete="off" /></label>
          <div className="dados-veiculo">
            <label>CPF<input value={cpf} inputMode="numeric" placeholder="123.456.789-10" onChange={(e) => setCpf(mascaraCpf(e.target.value))} autoComplete="off" /></label>
            <label>Celular<input value={telefone} inputMode="tel" placeholder="(11) 99999-9999" onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} autoComplete="off" /></label>
          </div>
          <label>E-mail (login)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></label>
          {!somenteLeitura && (
            <label>{item ? 'Nova senha (deixe em branco para manter)' : 'Senha'}
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} minLength={6} required={!item} autoComplete="new-password" />
            </label>
          )}
          {item && (
            <label className="linha-check">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Usuário ativo (pode entrar no sistema)
            </label>
          )}

          {item?.master ? (
            <p className="cinza ajuda">Usuário master: tem acesso a todos os módulos e filiais.</p>
          ) : (
            <fieldset className="grupo-permissoes">
              <legend>Filiais que acessa e perfil em cada uma</legend>
              {lojas.length > 1 && (
                <label className="linha-check"><input type="checkbox" checked={todas} onChange={marcarTodas} /> <strong>Todas as filiais</strong></label>
              )}
              {lojas.map((l) => (
                <div key={l.id} className="linha-loja">
                  <label className="linha-check">
                    <input type="checkbox" checked={marcada(l)} onChange={(e) => marcarFilial(l, e.target.checked)} /> {l.nome}
                  </label>
                  <select value={vinculos[l.id] || ''} disabled={!marcada(l)} aria-label={`Perfil em ${l.nome}`}
                    onChange={(e) => setVinculos({ ...vinculos, [l.id]: e.target.value })}>
                    {!vinculos[l.id] && <option value="">{marcada(l) ? 'Escolha o perfil…' : 'Sem acesso'}</option>}
                    {perfisDa(l).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
              ))}
            </fieldset>
          )}
        </fieldset>

        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>{somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
          {!somenteLeitura && <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
        </div>
      </form>
    </Modal>
  );
}
