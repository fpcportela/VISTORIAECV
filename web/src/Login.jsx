import { useState } from 'react';
import { api, sessao } from './api.js';
import { Icone } from './icones.jsx';

export default function Login({ aoEntrar }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const { token } = await api('/login', { metodo: 'POST', corpo: { email, senha } });
      sessao.salvar(token);
      await aoEntrar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login">
      <form className="login-caixa" onSubmit={entrar}>
        <div className="marca">
          <span className="marca-icone"><Icone nome="escudo" tamanho={24} /></span>
          <span className="marca-textos">
            <strong>Vistoria ECV</strong>
            <small>Gestão de vistorias cautelares</small>
          </span>
        </div>
        <label>
          E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button className="botao-primario" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
