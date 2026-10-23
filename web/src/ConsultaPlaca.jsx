import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icone } from './icones.jsx';

const TIPOS = { carro: 'Carro', moto: 'Moto', caminhao: 'Caminhão', outro: 'Outro' };

const formatarPlaca = (texto) => texto.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);

export default function ConsultaPlaca({ loja, placaInicial = '', aoFechar }) {
  const [placa, setPlaca] = useState(formatarPlaca(placaInicial));
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');
  const [buscando, setBuscando] = useState(false);
  const campo = useRef();

  async function buscar(atualizar = false) {
    if (placa.length !== 7) {
      setErro('Digite a placa completa, com 7 caracteres.');
      return;
    }
    setErro('');
    setBuscando(true);
    try {
      const params = new URLSearchParams();
      if (loja) params.set('loja', loja);
      if (atualizar) params.set('atualizar', '1');
      setResultado(await api(`/placa/${placa}?${params}`));
    } catch (falha) {
      setResultado(null);
      setErro(falha.message);
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    campo.current?.focus();
    if (placaInicial) buscar();
    const fechar = (e) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, []);

  const v = resultado?.veiculo;
  const linhas = v && [
    ['Marca / modelo', [v.marca, v.modelo].filter(Boolean).join(' ') || v.versao],
    ['Tipo', TIPOS[v.tipo]],
    ['Ano', [v.ano_fabricacao, v.ano_modelo].filter(Boolean).join(' / ')],
    ['Cor', v.cor],
    ['Combustível', v.combustivel],
    ['Chassi', v.chassi],
    ['Renavam', v.renavam],
    ['Motor', v.motor],
    ['Município', [v.municipio, v.uf].filter(Boolean).join(' / ')],
  ].filter(([, valor]) => valor);

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Consulta de placa">
        <div className="modal-topo">
          <h2>Consulta de placa</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>

        <form className="busca-placa" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
          <input ref={campo} value={placa} onChange={(e) => setPlaca(formatarPlaca(e.target.value))}
            placeholder="ABC1D23" aria-label="Placa" autoComplete="off" autoCapitalize="characters" />
          <button className="botao-primario" type="submit" disabled={buscando}>
            <Icone nome="busca" tamanho={18} /> {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </form>

        {erro && <p className="erro" role="alert">{erro}</p>}

        {v && (
          <div className="resultado-placa">
            <div className="placa-mercosul" aria-label={`Placa ${v.placa}`}>
              <span>BRASIL</span>
              <strong>{v.placa}</strong>
            </div>
            {resultado.aviso && <p className="aviso-texto">{resultado.aviso} Mostrando os dados guardados.</p>}
            <dl>
              {linhas.map(([rotulo, valor]) => (
                <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>
              ))}
            </dl>
            <div className="rodape-placa">
              <small className="cinza">
                {resultado.origem === 'cache' ? 'Dados guardados' : 'Consultado agora'} em{' '}
                {new Date(v.consultado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </small>
              {resultado.origem === 'cache' && (
                <button className="botao-contorno pequeno" onClick={() => buscar(true)} disabled={buscando}>
                  Atualizar consulta
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
