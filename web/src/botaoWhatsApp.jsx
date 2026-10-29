// Botão "WhatsApp" dos cadastros e da venda: abre a conversa com o celular na tela do WhatsApp.
// A tela Início fornece a função pelo contexto (sem ela, o botão não aparece).
import { createContext, useContext, useState } from 'react';

export const AbrirWhatsApp = createContext(null);

export function BotaoWhatsApp({ telefone, nome, clienteId, loja, chamadoId, rotulo = 'WhatsApp', titulo = 'Abrir a conversa no WhatsApp do sistema' }) {
  const abrir = useContext(AbrirWhatsApp);
  const [erro, setErro] = useState('');
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!abrir || (digitos.length < 10 && !chamadoId)) return null;
  return (
    <>
      {/* link, não <button>: assim continua funcionando dentro de um fieldset desabilitado (ex.: venda finalizada) */}
      <a href="#" role="button" className="botao-whatsapp" title={titulo} aria-label={rotulo || titulo}
        onClick={async (e) => { e.preventDefault(); setErro(''); try { await abrir({ telefone: digitos, nome, cliente_id: clienteId, loja_id: loja, chamado_id: chamadoId }); } catch (f) { setErro(f.message); } }}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" /></svg>
        {rotulo}
      </a>
      {erro && <small className="erro">{erro}</small>}
    </>
  );
}
