import { useEffect, useState } from 'react';
import { api, sessao } from './api.js';
import { aplicarTema, COR_PADRAO } from './tema.js';
import Login from './Login.jsx';
import Inicio from './Inicio.jsx';

export default function App() {
  const [perfil, setPerfil] = useState(null);
  const [carregando, setCarregando] = useState(Boolean(sessao.token()));

  async function carregarPerfil() {
    try {
      const dados = await api('/eu');
      aplicarTema(dados.cor);
      setPerfil(dados);
    } catch {
      setPerfil(null);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    aplicarTema(COR_PADRAO);
    if (sessao.token()) carregarPerfil();
  }, []);

  function sair() {
    sessao.sair();
    aplicarTema(COR_PADRAO);
    setPerfil(null);
  }

  if (carregando) return <div className="carregando">Carregando…</div>;
  if (!perfil) return <Login aoEntrar={carregarPerfil} />;
  return <Inicio perfil={perfil} setPerfil={setPerfil} aoSair={sair} />;
}
