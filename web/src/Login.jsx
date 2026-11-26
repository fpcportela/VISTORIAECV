import { useState } from 'react';
import { api, sessao } from './api.js';
import { Icone } from './icones.jsx';

export default function Login({ aoEntrar }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [esqueci, setEsqueci] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro(''); setAviso('');
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

  const marca = (
    <div className="marca">
      <span className="marca-icone"><Icone nome="escudo" tamanho={24} /></span>
      <span className="marca-textos">
        <strong>Vistoria ECV</strong>
        <small>Gestão de vistorias cautelares</small>
      </span>
    </div>
  );

  if (esqueci) {
    return (
      <main className="login">
        <EsqueciSenha usuarioInicial={email} marca={marca}
          aoVoltar={(msg, usuario) => { setEsqueci(false); setErro(''); setAviso(msg || ''); if (usuario) setEmail(usuario); setSenha(''); }} />
      </main>
    );
  }

  return (
    <main className="login">
      <form className="login-caixa" onSubmit={entrar}>
        {marca}
        <label>
          E-mail ou usuário
          <input type="text" data-livre autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        {aviso && <p className="aviso-ok" role="status">{aviso}</p>}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button className="botao-primario" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <button type="button" className="botao-texto esqueci" onClick={() => { setEsqueci(true); setErro(''); setAviso(''); }}>
          Esqueci a senha
        </button>
      </form>
    </main>
  );
}

// Esqueci a senha: 1) pede o código pelo WhatsApp do celular cadastrado; 2) código + senha nova
function EsqueciSenha({ usuarioInicial, marca, aoVoltar }) {
  const [etapa, setEtapa] = useState(1);
  const [usuario, setUsuario] = useState(usuarioInicial);
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function pedirCodigo(e) {
    e?.preventDefault();
    setErro(''); setEnviando(true);
    try {
      await api('/senha/codigo', { metodo: 'POST', corpo: { usuario } });
      setEtapa(2);
    } catch (falha) { setErro(falha.message); } finally { setEnviando(false); }
  }

  async function redefinir(e) {
    e.preventDefault();
    setErro('');
    if (senha.length < 6) return setErro('A senha precisa ter pelo menos 6 caracteres.');
    if (senha !== confirma) return setErro('As duas senhas não são iguais.');
    setEnviando(true);
    try {
      await api('/senha/redefinir', { metodo: 'POST', corpo: { usuario, codigo, senha } });
      aoVoltar('Senha trocada. Entre com a senha nova.', usuario);
    } catch (falha) { setErro(falha.message); setEnviando(false); }
  }

  return (
    <form className="login-caixa" onSubmit={etapa === 1 ? pedirCodigo : redefinir}>
      {marca}
      <h2 className="titulo-login">Esqueci a senha</h2>
      {etapa === 1 ? (
        <>
          <p className="cinza ajuda">Informe seu e-mail ou usuário. Vamos mandar um código de 6 números para o WhatsApp do seu celular cadastrado.</p>
          <label>
            E-mail ou usuário
            <input type="text" data-livre autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
              value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
          </label>
        </>
      ) : (
        <>
          <p className="cinza ajuda">Se o usuário tiver celular cadastrado, o código chegou no WhatsApp. Ele vale por 15 minutos.</p>
          <label>
            Código
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} data-livre autoFocus placeholder="000000"
              value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
          </label>
          <label>
            Senha nova
            <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </label>
          <label>
            Repita a senha nova
            <input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required />
          </label>
        </>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button className="botao-primario" type="submit" disabled={enviando}>
        {enviando ? 'Aguarde…' : etapa === 1 ? 'Enviar código pelo WhatsApp' : 'Trocar senha'}
      </button>
      {etapa === 2 && <button type="button" className="botao-texto esqueci" disabled={enviando} onClick={pedirCodigo}>Mandar outro código</button>}
      <button type="button" className="botao-texto esqueci" onClick={() => aoVoltar()}>Voltar para o login</button>
    </form>
  );
}
