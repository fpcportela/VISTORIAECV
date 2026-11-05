import { useEffect, useState } from 'react';
import { api, sessao } from './api.js';
import { CampoData } from './Data.jsx';
import { abrirArquivo } from './Colaboradores.jsx';

// Abas Férias e Atestados do cadastro do colaborador.
// Férias: períodos com a soma dos dias e o banco de horas (jornada, saldo e abono).
// Atestados: cada dia do atestado é a justificativa do dia na folha de ponto, e uma
// justificativa marcada como atestado no espelho aparece aqui também.

const FUSO = 'America/Sao_Paulo';
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const dataBR = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const diasEntre = (a, b) => (a && b && b >= a ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : 0);

// 510 -> "8h30"; com sinal: "+8h30" / "−0h15"
export const horas = (min, sinal = false) => {
  const v = Math.round(Number(min) || 0);
  const a = Math.abs(v);
  const t = `${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
  return sinal ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${t}` : `${v < 0 ? '−' : ''}${t}`;
};
// "08:30" -> 510 (aceita "8", "8:3", "-1:30"); null se não for hora
const lerHoras = (t) => {
  const m = /^\s*([-+−]?)\s*(\d{1,3})(?:[:h](\d{0,2}))?\s*$/.exec(String(t ?? ''));
  if (!m) return null;
  const min = Number(m[2]) * 60 + Number(m[3] || 0);
  return m[1] && m[1] !== '+' ? -min : min;
};
const paraHoras = (min) => { const a = Math.abs(min); return `${min < 0 ? '-' : ''}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`; };
const corSaldo = (v) => (v > 0 ? 'positivo' : v < 0 ? 'negativo' : '');

// ---------------------------------------------------------------------------
// Aba Férias
// ---------------------------------------------------------------------------
export function AbaFerias({ colaborador }) {
  const [d, setD] = useState(null);
  const [editando, setEditando] = useState(null); // null = fechado; {} = novas; registro
  const [erro, setErro] = useState('');
  const carregar = () => api(`/colaboradores/${colaborador.id}/ferias`).then((x) => { setD(x); setErro(''); }).catch((f) => setErro(f.message));
  useEffect(() => { carregar(); }, [colaborador.id]);

  async function excluir(f) {
    if (!confirm(`Excluir as férias de ${dataBR(f.inicio)} a ${dataBR(f.fim)}?`)) return;
    try { await api(`/colaboradores/${colaborador.id}/ferias/${f.id}`, { metodo: 'DELETE' }); carregar(); } catch (falha) { setErro(falha.message); }
  }

  if (!d) return erro ? <p className="erro" role="alert">{erro}</p> : <p className="cinza">Carregando…</p>;
  const totalDias = d.ferias.reduce((t, f) => t + f.dias, 0);
  return (
    <>
      <fieldset className="grupo-permissoes">
        <legend>Férias</legend>
        {d.ferias.length === 0 ? <small className="cinza">Nenhuma férias registrada.</small> : (
          <div className="tabela-relatorio-caixa">
            <table className="tabela-relatorio">
              <thead><tr><th>Início</th><th>Fim</th><th className="num">Dias</th><th className="num">Abono do banco</th><th>Observação</th>{d.pode_editar && <th />}</tr></thead>
              <tbody>
                {d.ferias.map((f) => (
                  <tr key={f.id}>
                    <td>{dataBR(f.inicio)}</td>
                    <td>{dataBR(f.fim)}</td>
                    <td className="num">{f.dias}</td>
                    <td className="num">{f.abono_minutos ? horas(f.abono_minutos, true) : '—'}</td>
                    <td>{f.observacao}</td>
                    {d.pode_editar && (
                      <td className="num">
                        <button type="button" className="botao-texto" onClick={() => setEditando(f)}>Alterar</button>
                        <button type="button" className="botao-texto perigo" onClick={() => excluir(f)}>Excluir</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}>Total</td><td className="num">{totalDias}</td><td colSpan={d.pode_editar ? 3 : 2} /></tr></tfoot>
            </table>
          </div>
        )}
        {d.pode_editar && <button type="button" className="botao-primario" onClick={() => setEditando({})}>+ Registrar férias</button>}
        <small className="cinza">Os dias de férias aparecem no espelho de ponto e não contam como falta no banco de horas.</small>
      </fieldset>
      <BancoHoras colaborador={colaborador} banco={d.banco} podeEditar={d.pode_editar} aoMudar={carregar} />
      {erro && <p className="erro" role="alert">{erro}</p>}
      {editando && (
        <EditorFerias colaborador={colaborador} ferias={editando} banco={d.banco}
          aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); carregar(); }} />
      )}
    </>
  );
}

function EditorFerias({ colaborador, ferias, banco, aoFechar, aoSalvar }) {
  const [f, setF] = useState({ inicio: ferias.inicio || '', fim: ferias.fim || '', observacao: ferias.observacao || '' });
  const [abonar, setAbonar] = useState(Boolean(ferias.abono_minutos));
  const [abono, setAbono] = useState(ferias.abono_minutos ? paraHoras(ferias.abono_minutos) : '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const dias = diasEntre(f.inicio, f.fim);
  // saldo que sobra para abonar (sem contar o abono que estas férias já têm)
  const saldoLivre = banco ? banco.saldo + (ferias.abono_minutos || 0) : 0;

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (!f.inicio || !f.fim) return setErro('Informe as datas de início e fim.');
    if (f.fim < f.inicio) return setErro('A data de fim é antes do início.');
    const abonoMin = abonar ? lerHoras(abono) : 0;
    if (abonoMin === null) return setErro('Abono inválido. Use horas no formato 08:30 (ou -02:00 para perdoar horas devidas).');
    setSalvando(true);
    try {
      const corpo = { ...f, abono_minutos: abonoMin };
      await (ferias.id ? api(`/colaboradores/${colaborador.id}/ferias/${ferias.id}`, { metodo: 'PUT', corpo })
        : api(`/colaboradores/${colaborador.id}/ferias`, { metodo: 'POST', corpo }));
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Férias">
        <div className="modal-topo">
          <h2>{ferias.id ? 'Alterar férias' : 'Registrar férias'}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={salvar}>
          <div className="dados-veiculo">
            <label>Início<CampoData value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} required /></label>
            <label>Fim<CampoData value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} required /></label>
          </div>
          <p className="ajuda"><strong>{dias}</strong> dia(s) de férias{dias ? ` (${dataBR(f.inicio)} a ${dataBR(f.fim)})` : ''}</p>
          {banco?.ativo && (
            <fieldset className="grupo-permissoes">
              <label className="linha-check"><input type="checkbox" checked={abonar} onChange={(e) => {
                setAbonar(e.target.checked);
                if (e.target.checked && !abono) setAbono(paraHoras(saldoLivre));
              }} /> <strong>Abonar o banco de horas nestas férias</strong></label>
              {abonar && (
                <>
                  <label>Horas abonadas<input value={abono} data-livre inputMode="numeric" placeholder="08:00" onChange={(e) => setAbono(e.target.value)} /></label>
                  <small className="cinza">
                    Saldo disponível: <strong className={corSaldo(saldoLivre)}>{horas(saldoLivre, true)}</strong>.
                    Horas positivas saem do saldo (horas a mais usadas como folga). Horas negativas, como -02:00, perdoam horas que o colaborador devia.
                  </small>
                </>
              )}
            </fieldset>
          )}
          <label>Observação<input value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Opcional" /></label>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

// Banco de horas: liga/desliga, jornada de cada dia, saldo e extrato do mês
function BancoHoras({ colaborador, banco, podeEditar, aoMudar }) {
  const [f, setF] = useState(null);
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [extrato, setExtrato] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    setF({ ativo: banco.ativo, inicio: banco.inicio || hoje(), jornada: banco.jornada.map(paraHoras) });
  }, [banco]);
  useEffect(() => {
    if (!banco.ativo) return setExtrato(null);
    api(`/colaboradores/${colaborador.id}/banco-horas?mes=${mes}`).then((x) => setExtrato(x.dias)).catch((falha) => setErro(falha.message));
  }, [banco, mes]);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    const jornada = f.jornada.map(lerHoras);
    if (jornada.some((v) => v === null || v < 0 || v > 1440)) return setErro('Jornada inválida: use horas no formato 08:00.');
    if (f.ativo && !f.inicio) return setErro('Informe a partir de que dia o banco de horas conta.');
    setSalvando(true);
    try {
      await api(`/colaboradores/${colaborador.id}/banco-horas`, { metodo: 'PUT', corpo: { ativo: f.ativo, inicio: f.inicio || null, jornada } });
      aoMudar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setSalvando(false);
    }
  }

  if (!f) return null;
  const semanal = f.jornada.reduce((t, h) => t + (lerHoras(h) || 0), 0);
  const saldoMes = (extrato || []).reduce((t, x) => t + x.saldo, 0);
  return (
    <fieldset className="grupo-permissoes">
      <legend>Banco de horas</legend>
      <form className="formulario" onSubmit={salvar}>
        <fieldset className="sem-borda" disabled={!podeEditar}>
          <label className="linha-check"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> <strong>Habilitar banco de horas</strong></label>
          {f.ativo && (
            <>
              <div className="dados-veiculo">
                <label>Conta a partir de<CampoData value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} required /></label>
              </div>
              <div className="jornada-semana">
                {SEMANA.map((s, i) => (
                  <label key={s}>{s}<input value={f.jornada[i]} data-livre inputMode="numeric" aria-label={`Jornada de ${s}`}
                    onChange={(e) => setF({ ...f, jornada: f.jornada.map((x, k) => (k === i ? e.target.value : x)) })} /></label>
                ))}
              </div>
              <small className="cinza">Jornada prevista de cada dia (00:00 = folga). Semana: {horas(semanal)}. Cada dia, o sistema compara as horas do ponto com a jornada e soma a diferença no banco. Dias de férias e de atestado não contam. O dia de hoje entra amanhã.</small>
            </>
          )}
        </fieldset>
        {erro && <p className="erro" role="alert">{erro}</p>}
        {podeEditar && <div className="acoes-modal"><button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar banco de horas'}</button></div>}
      </form>
      {banco.ativo && (
        <>
          <div className="resumo-valor">
            <span>Horas calculadas<strong className={corSaldo(banco.calculado)}>{horas(banco.calculado, true)}</strong></span>
            <span>Abonado nas férias<strong>{horas(banco.abonado, true)}</strong></span>
            <span className="total-venda">Saldo até ontem<strong className={corSaldo(banco.saldo)}>{horas(banco.saldo, true)}</strong></span>
          </div>
          <div className="filtros">
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês do extrato" />
            <small className="cinza">Saldo do mês: <strong className={corSaldo(saldoMes)}>{horas(saldoMes, true)}</strong></small>
          </div>
          {extrato && (extrato.length === 0 ? <small className="cinza">Sem dias contados neste mês.</small> : (
            <div className="tabela-relatorio-caixa">
              <table className="tabela-relatorio">
                <thead><tr><th>Dia</th><th className="num">Previsto</th><th className="num">Trabalhado</th><th className="num">Saldo</th><th /></tr></thead>
                <tbody>
                  {extrato.map((x) => (
                    <tr key={x.data}>
                      <td>{dataBR(x.data)} {SEMANA[new Date(`${x.data}T12:00:00`).getDay()]}</td>
                      <td className="num">{horas(x.previsto)}</td>
                      <td className="num">{horas(x.trabalhado)}</td>
                      <td className={`num ${corSaldo(x.saldo)}`}>{horas(x.saldo, true)}</td>
                      <td>{x.motivo === 'ferias' ? 'Férias' : x.motivo === 'atestado' ? 'Atestado' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Aba Atestados
// ---------------------------------------------------------------------------
export function AbaAtestados({ colaborador }) {
  const [d, setD] = useState(null);
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState('');
  const carregar = () => api(`/colaboradores/${colaborador.id}/atestados`).then((x) => { setD(x); setErro(''); }).catch((f) => setErro(f.message));
  useEffect(() => { carregar(); }, [colaborador.id]);

  async function excluir(a) {
    if (!confirm(`Excluir o atestado de ${dataBR(a.inicio)} a ${dataBR(a.fim)}? Os dias saem da folha de ponto, com os documentos.`)) return;
    try { await api(`/colaboradores/${colaborador.id}/atestados/${a.id}`, { metodo: 'DELETE' }); carregar(); } catch (falha) { setErro(falha.message); }
  }

  if (!d) return erro ? <p className="erro" role="alert">{erro}</p> : <p className="cinza">Carregando…</p>;
  const totalDias = d.atestados.reduce((t, a) => t + a.dias, 0);
  return (
    <fieldset className="grupo-permissoes">
      <legend>Atestados</legend>
      {d.atestados.length === 0 ? <small className="cinza">Nenhum atestado registrado.</small> : (
        <div className="tabela-relatorio-caixa">
          <table className="tabela-relatorio">
            <thead><tr><th>Início</th><th>Fim</th><th className="num">Dias</th><th>Justificativa</th><th>Documentos</th>{d.pode_justificar && <th />}</tr></thead>
            <tbody>
              {d.atestados.map((a) => (
                <tr key={a.id}>
                  <td>{dataBR(a.inicio)}</td>
                  <td>{dataBR(a.fim)}</td>
                  <td className="num">{a.dias}</td>
                  <td>{a.texto}</td>
                  <td>
                    {a.arquivos.map((x) => (
                      <button key={x.id} type="button" className="botao-texto" onClick={() => abrirArquivo(`/ponto/justificativa/arquivos/${x.id}`).catch((f) => setErro(f.message))}>📎 {x.nome}</button>
                    ))}
                  </td>
                  {d.pode_justificar && <td className="num"><button type="button" className="botao-texto perigo" onClick={() => excluir(a)}>Excluir</button></td>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="num">{totalDias}</td><td colSpan={d.pode_justificar ? 3 : 2} /></tr></tfoot>
          </table>
        </div>
      )}
      {d.pode_justificar && <button type="button" className="botao-primario" onClick={() => setNovo(true)}>+ Registrar atestado</button>}
      <small className="cinza">Cada dia do atestado aparece como justificativa do dia no espelho de ponto. Justificativa marcada como atestado no espelho também aparece aqui.</small>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {novo && <NovoAtestado colaborador={colaborador} aoFechar={() => setNovo(false)} aoSalvar={() => { setNovo(false); carregar(); }} />}
    </fieldset>
  );
}

function NovoAtestado({ colaborador, aoFechar, aoSalvar }) {
  const [f, setF] = useState({ inicio: '', fim: '', texto: '' });
  const [arquivos, setArquivos] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const dias = diasEntre(f.inicio, f.fim);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (!f.inicio || !f.fim) return setErro('Informe as datas de início e fim.');
    if (f.fim < f.inicio) return setErro('A data de fim é antes do início.');
    setSalvando(true);
    try {
      await api(`/colaboradores/${colaborador.id}/atestados`, { metodo: 'POST', corpo: f });
      // o documento fica na justificativa do primeiro dia
      for (const arq of arquivos) {
        const q = new URLSearchParams({ colaborador: colaborador.id, data: f.inicio, nome: arq.name, mime: arq.type || 'application/octet-stream' });
        const r = await fetch(`/api/ponto/justificativa/arquivos?${q}`, {
          method: 'POST', body: arq, headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${sessao.token()}` },
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || (r.status === 413 ? `"${arq.name}" passa de 15 MB.` : `Não foi possível enviar "${arq.name}".`));
      }
      aoSalvar();
    } catch (falha) {
      setErro(falha.message); setSalvando(false);
    }
  }

  return (
    <div className="fundo-modal" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Atestado">
        <div className="modal-topo">
          <h2>Registrar atestado</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        <form className="formulario" onSubmit={salvar}>
          <div className="dados-veiculo">
            <label>Primeiro dia<CampoData value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value, fim: f.fim || e.target.value })} required /></label>
            <label>Último dia<CampoData value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} required /></label>
          </div>
          <p className="ajuda"><strong>{dias}</strong> dia(s) de falta com atestado</p>
          <label>Justificativa<input value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="ATESTADO MÉDICO" /></label>
          <label>Documento do atestado<input type="file" multiple onChange={(e) => setArquivos([...e.target.files])} /></label>
          <small className="cinza">Se o dia já tiver uma justificativa no espelho de ponto, ela é trocada pela do atestado.</small>
          {erro && <p className="erro" role="alert">{erro}</p>}
          <div className="acoes-modal">
            <button type="button" className="botao-contorno" onClick={aoFechar}>Cancelar</button>
            <button className="botao-primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Registrar'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
