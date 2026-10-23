import { useState } from 'react';
import { Icone } from './icones.jsx';

// O usuário escolhe quais módulos (entre os liberados no perfil) viram atalho
// na tela inicial, e a ordem em que aparecem.
export default function EditorAtalhos({ disponiveis, escolhidos, aoSalvar, aoFechar }) {
  const [lista, setLista] = useState(escolhidos);

  const alternar = (id) =>
    setLista(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  const mover = (id, passo) => {
    const i = lista.indexOf(id), j = i + passo;
    if (i < 0 || j < 0 || j >= lista.length) return;
    const nova = [...lista];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setLista(nova);
  };

  // Escolhidos primeiro, na ordem do usuário; depois os demais
  const ordenados = [
    ...lista.map((id) => disponiveis.find((m) => m.id === id)).filter(Boolean),
    ...disponiveis.filter((m) => !lista.includes(m.id)),
  ];

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Personalizar atalhos">
        <div className="modal-topo">
          <h2>Personalizar atalhos</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <p className="cinza ajuda">Marque os atalhos que quer ver na sua tela inicial. Use as setas para mudar a ordem.</p>
        <ul className="lista-atalhos">
          {ordenados.map((m) => {
            const marcado = lista.includes(m.id);
            return (
              <li key={m.id}>
                <label>
                  <input type="checkbox" checked={marcado} onChange={() => alternar(m.id)} />
                  <span className="bolha"><Icone nome={m.id} tamanho={18} /></span>
                  {m.nome}
                </label>
                {marcado && (
                  <span className="ordem">
                    <button onClick={() => mover(m.id, -1)} aria-label={`Subir ${m.nome}`}>▲</button>
                    <button onClick={() => mover(m.id, 1)} aria-label={`Descer ${m.nome}`}>▼</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="acoes-modal">
          <button className="botao-contorno" onClick={() => setLista(disponiveis.map((m) => m.id))}>Marcar todos</button>
          <button className="botao-primario" onClick={() => aoSalvar(lista)}>Salvar</button>
        </div>
      </section>
    </div>
  );
}
