import { useEffect, useState } from 'react';
import { api } from './api.js';
import { criarTem } from './modulos.js';

// Tela "Usuários e permissões": perfis (função → módulos liberados)
// e usuários (lojas onde trabalham e o perfil em cada uma).
export default function UsuariosPermissoes({ perfil }) {
  const [aba, setAba] = useState('usuarios');
  const [permissoes, setPermissoes] = useState([]);
  const [perfis, setPerfis] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [editando, setEditando] = useState(null); // { tipo: 'perfil' | 'usuario', item }
  const [erro, setErro] = useState('');

  // Lojas em que quem está logado pode configurar usuários
  const lojas = perfil.lojas.filter((l) => criarTem(perfil, l.id)('usuarios.gerenciar'));
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
        <button className="botao-primario" onClick={() => setEditando({ tipo: aba === 'usuarios' ? 'usuario' : 'perfil', item: null })}>
          + {aba === 'usuarios' ? 'Novo usuário' : 'Novo perfil'}
        </button>
      </div>

      <div className="abas" role="tablist">
        <button role="tab" aria-selected={aba === 'usuarios'} className={aba === 'usuarios' ? 'ativa' : ''} onClick={() => setAba('usuarios')}>Usuários</button>
        <button role="tab" aria-selected={aba === 'perfis'} className={aba === 'perfis' ? 'ativa' : ''} onClick={() => setAba('perfis')}>Perfis (funções)</button>
      </div>

      {erro && <p className="erro" role="alert">{erro}</p>}

      {aba === 'usuarios' ? (
        <div className="lista-cadastro">
          {usuarios.map((u) => (
            <button key={u.id} className="cartao item-cadastro" onClick={() => setEditando({ tipo: 'usuario', item: u })} disabled={u.master && !perfil.master}>
              <span className="item-titulo">
                <strong>{u.nome}</strong>
                {u.master && <span className="etiqueta">Master</span>}
                {!u.ativo && <span className="etiqueta inativa">Inativo</span>}
              </span>
              <small className="cinza">{u.email}</small>
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
          <p className="cinza ajuda">O perfil define o que cada função vê e pode fazer. O usuário master sempre tem acesso a tudo.</p>
          {perfis.map((p) => (
            <div key={p.id} className="cartao item-cadastro">
              <span className="item-titulo">
                <strong>{p.nome}</strong>
                {empresas.length > 1 && <span className="etiqueta">{p.empresa}</span>}
              </span>
              {p.descricao && <small className="cinza">{p.descricao}</small>}
              <small>{p.permissoes.length} de {permissoes.length} permissões · {p.usuarios} usuário(s)</small>
              <span className="acoes-item">
                <button className="botao-contorno pequeno" onClick={() => setEditando({ tipo: 'perfil', item: p })}>Editar</button>
                <button className="botao-contorno pequeno" onClick={() => setEditando({ tipo: 'perfil', item: { ...p, id: null, nome: `${p.nome} (cópia)` } })}>Duplicar</button>
                {p.usuarios === 0 && <button className="botao-contorno pequeno perigo" onClick={() => excluirPerfil(p)}>Excluir</button>}
              </span>
            </div>
          ))}
        </div>
      )}

      {editando?.tipo === 'perfil' && (
        <EditorPerfil item={editando.item} empresas={empresas} permissoes={permissoes}
          aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); carregar(); }} />
      )}
      {editando?.tipo === 'usuario' && (
        <EditorUsuario item={editando.item} lojas={lojas} perfis={perfis}
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

function EditorPerfil({ item, empresas, permissoes, aoFechar, aoSalvar }) {
  const [nome, setNome] = useState(item?.nome || '');
  const [descricao, setDescricao] = useState(item?.descricao || '');
  const [empresa, setEmpresa] = useState(item?.empresa_id || empresas[0]?.[0] || '');
  const [marcadas, setMarcadas] = useState(new Set(item?.permissoes || []));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Permissões agrupadas por módulo, na ordem do catálogo
  const modulos = [...permissoes.reduce((m, p) => m.set(p.modulo, [...(m.get(p.modulo) || []), p]), new Map())];

  const alternar = (codigos, ligar) => {
    const nova = new Set(marcadas);
    codigos.forEach((c) => (ligar ? nova.add(c) : nova.delete(c)));
    setMarcadas(nova);
  };

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

  return (
    <Modal titulo={item?.id ? 'Editar perfil' : 'Novo perfil'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <label>Nome da função<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Vistoriador" required /></label>
        <label>Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" /></label>
        {!item?.id && empresas.length > 1 && (
          <label>Grupo
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              {empresas.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
        )}

        <div className="grade-permissoes">
          {modulos.map(([modulo, lista]) => {
            const codigos = lista.map((p) => p.codigo);
            const todas = codigos.every((c) => marcadas.has(c));
            return (
              <fieldset key={modulo} className="grupo-permissoes">
                <legend>
                  <label>
                    <input type="checkbox" checked={todas}
                      ref={(el) => el && (el.indeterminate = !todas && codigos.some((c) => marcadas.has(c)))}
                      onChange={() => alternar(codigos, !todas)} />
                    {modulo}
                  </label>
                </legend>
                {lista.map((p) => (
                  <label key={p.codigo}>
                    <input type="checkbox" checked={marcadas.has(p.codigo)} onChange={() => alternar([p.codigo], !marcadas.has(p.codigo))} />
                    {p.descricao}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>

        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={() => alternar(permissoes.map((p) => p.codigo), marcadas.size < permissoes.length)}>
            {marcadas.size < permissoes.length ? 'Marcar tudo' : 'Desmarcar tudo'}
          </button>
          <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditorUsuario({ item, lojas, perfis, aoFechar, aoSalvar }) {
  const [nome, setNome] = useState(item?.nome || '');
  const [email, setEmail] = useState(item?.email || '');
  const [senha, setSenha] = useState('');
  const [ativo, setAtivo] = useState(item?.ativo ?? true);
  // perfil escolhido em cada loja ('' = não trabalha nesta loja)
  const [vinculos, setVinculos] = useState(() =>
    Object.fromEntries((item?.vinculos || []).map((v) => [v.loja_id, v.perfil_id])));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setErro('');
    try {
      const corpo = {
        nome, email, senha: senha || undefined, ativo,
        vinculos: Object.entries(vinculos).filter(([, p]) => p).map(([loja_id, perfil_id]) => ({ loja_id, perfil_id })),
      };
      await (item ? api(`/usuarios/${item.id}`, { metodo: 'PUT', corpo }) : api('/usuarios', { metodo: 'POST', corpo }));
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  return (
    <Modal titulo={item ? 'Editar usuário' : 'Novo usuário'} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={salvar}>
        <label>Nome<input value={nome} onChange={(e) => setNome(e.target.value)} required autoComplete="off" /></label>
        <label>E-mail (login)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></label>
        <label>{item ? 'Nova senha (deixe em branco para manter)' : 'Senha'}
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} minLength={6} required={!item} autoComplete="new-password" />
        </label>
        {item && (
          <label className="linha-check">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Usuário ativo (pode entrar no sistema)
          </label>
        )}

        {item?.master ? (
          <p className="cinza ajuda">Usuário master: tem acesso a todos os módulos e lojas.</p>
        ) : (
          <fieldset className="grupo-permissoes">
            <legend>Lojas e função em cada uma</legend>
            {lojas.map((l) => (
              <label key={l.id} className="linha-loja">
                <span>{l.nome}</span>
                <select value={vinculos[l.id] || ''} onChange={(e) => setVinculos({ ...vinculos, [l.id]: e.target.value })}>
                  <option value="">Sem acesso</option>
                  {perfis.filter((p) => p.empresa_id === l.empresa_id).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
            ))}
          </fieldset>
        )}

        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-modal">
          <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
          <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
