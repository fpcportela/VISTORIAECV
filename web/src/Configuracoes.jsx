import { useEffect, useState } from 'react';
import { sessao } from './api.js';

// Configurações. Por enquanto: backup completo do sistema.

export default function Configuracoes({ perfil }) {
  return (
    <>
      <div className="cabecalho"><h1>Configurações</h1></div>
      {perfil.master ? <><Backup /><Importar /></> : <p className="cinza">Nenhuma configuração disponível para o seu perfil.</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Backup: baixa o banco inteiro e grava numa pasta escolhida (do computador ou
// sincronizada com o Google Drive). Cada backup é um arquivo novo, com data e hora.
// ---------------------------------------------------------------------------

// A pasta escolhida fica lembrada neste navegador (IndexedDB guarda o acesso à pasta)
const BANCO = 'vistoria-ecv';
function abrirBanco() {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('preferencias');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}
async function lembrar(chave, valor) {
  const db = await abrirBanco();
  return new Promise((ok, falha) => {
    const t = db.transaction('preferencias', 'readwrite');
    if (valor === undefined) t.objectStore('preferencias').delete(chave); else t.objectStore('preferencias').put(valor, chave);
    t.oncomplete = () => ok(); t.onerror = () => falha(t.error);
  });
}
async function lembrado(chave) {
  const db = await abrirBanco();
  return new Promise((ok) => {
    const r = db.transaction('preferencias').objectStore('preferencias').get(chave);
    r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined);
  });
}

const doisDig = (n) => String(n).padStart(2, '0');
// vistoria-ecv_backup_25-10-2026_22h35m10s.dump
function nomeBackup(d = new Date()) {
  return `vistoria-ecv_backup_${doisDig(d.getDate())}-${doisDig(d.getMonth() + 1)}-${d.getFullYear()}_${doisDig(d.getHours())}h${doisDig(d.getMinutes())}m${doisDig(d.getSeconds())}s.dump`;
}
const tamanho = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const escolhePasta = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function Backup() {
  const [pasta, setPasta] = useState(null);
  const [anteriores, setAnteriores] = useState([]);
  const [fazendo, setFazendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');

  async function listar(p) {
    if (!p || (await p.queryPermission({ mode: 'readwrite' })) !== 'granted') return setAnteriores([]);
    const lista = [];
    for await (const [nome, item] of p.entries()) {
      if (item.kind === 'file' && /^vistoria-ecv_backup_.*\.dump$/.test(nome)) {
        const f = await item.getFile();
        lista.push({ nome, tamanho: f.size, data: f.lastModified });
      }
    }
    setAnteriores(lista.sort((a, b) => b.data - a.data).slice(0, 10));
  }

  useEffect(() => {
    if (!escolhePasta) return;
    lembrado('pasta-backup').then((p) => { if (p) { setPasta(p); listar(p); } }).catch(() => {});
  }, []);

  async function escolher() {
    setErro('');
    try {
      const p = await window.showDirectoryPicker({ id: 'backup-vistoria', mode: 'readwrite' });
      setPasta(p); await lembrar('pasta-backup', p); await listar(p);
    } catch (e) {
      if (e.name !== 'AbortError') setErro(`Não foi possível usar essa pasta: ${e.message}`);
    }
  }

  async function fazer() {
    setFazendo(true); setErro(''); setAviso('');
    try {
      // pede de novo a permissão da pasta (o navegador esquece ao fechar)
      if (pasta && (await pasta.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        throw new Error('O navegador não deu acesso à pasta. Clique em "Escolher pasta" de novo.');
      }
      const r = await fetch('/api/backup', { headers: { Authorization: `Bearer ${sessao.token()}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Não foi possível gerar o backup.');
      const dados = await r.blob();
      let nome = nomeBackup();
      if (pasta) {
        // nunca sobrescreve: se já existir um arquivo com o mesmo nome, acrescenta -2, -3…
        for (let n = 2; await pasta.getFileHandle(nome).then(() => true, () => false); n++) nome = nomeBackup().replace('.dump', `-${n}.dump`);
        const arquivo = await pasta.getFileHandle(nome, { create: true });
        const escrita = await arquivo.createWritable();
        await escrita.write(dados); await escrita.close();
        await listar(pasta);
        setAviso(`Backup salvo em "${pasta.name}" como ${nome} (${tamanho(dados.size)}).`);
      } else {
        const url = URL.createObjectURL(dados);
        const a = Object.assign(document.createElement('a'), { href: url, download: nome });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setAviso(`Backup baixado como ${nome} (${tamanho(dados.size)}). Ele foi para a pasta de downloads do navegador.`);
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setFazendo(false);
    }
  }

  return (
    <section className="cartao painel-backup">
      <h2>Backup</h2>
      <p className="cinza ajuda">
        Copia todos os registros do sistema (lojas, usuários, vendas, financeiro, colaboradores, ponto com fotos e arquivos).
        Cada backup é um arquivo novo com a data e a hora no nome. Os anteriores nunca são apagados nem substituídos.
      </p>
      {escolhePasta ? (
        <div className="pasta-backup">
          <span>Pasta: <strong>{pasta ? pasta.name : 'nenhuma escolhida'}</strong></span>
          <button className="botao-contorno" onClick={escolher}>{pasta ? 'Trocar pasta' : 'Escolher pasta'}</button>
          {pasta && <button className="botao-texto" onClick={() => { setPasta(null); setAnteriores([]); lembrar('pasta-backup', undefined); }}>Não usar pasta</button>}
        </div>
      ) : (
        <p className="aviso-texto">Este navegador não deixa escolher a pasta: o backup vai para a pasta de downloads. Para escolher a pasta (do computador ou do Google Drive), use o Google Chrome ou o Edge.</p>
      )}
      <small className="cinza">Para guardar no Google Drive, escolha uma pasta dentro do "Google Drive" do computador (programa Google Drive para computador). Ele envia o arquivo para a nuvem sozinho.</small>
      <div className="acoes-modal">
        <button className="botao-primario" onClick={fazer} disabled={fazendo}>{fazendo ? 'Gerando backup…' : 'Fazer backup agora'}</button>
      </div>
      {aviso && <p className="sucesso" role="status">{aviso}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
      {anteriores.length > 0 && (
        <>
          <h3>Últimos backups nesta pasta</h3>
          <ul className="lista-arquivos">
            {anteriores.map((b) => (
              <li key={b.nome}><span>{b.nome}</span><small className="cinza">{tamanho(b.tamanho)}</small></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Importar arquivo de recuperação (.dump): sobrescrever tudo ou combinar.
// Ao combinar, aponta as duplicidades (mesmo registro, igual em todos os campos)
// e os registros que mudaram; para cada um: SUBSCREVE, MANTÉM o antigo ou APAGA.
// ---------------------------------------------------------------------------
const ACOES_IMPORTAR = [['mantem', 'Mantém antigo'], ['subscreve', 'Subscreve'], ['apaga', 'Apaga']];

function Importar() {
  const [arquivo, setArquivo] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [modo, setModo] = useState('combinar');
  const [acoes, setAcoes] = useState({}); // { tabela: { iguais, diferentes, registros: { chave: acao } } }
  const [aberta, setAberta] = useState(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [resultado, setResultado] = useState('');
  const [erro, setErro] = useState('');

  async function analisar() {
    setOcupado('Lendo o arquivo e comparando com o sistema…'); setErro(''); setResultado(''); setAnalise(null);
    try {
      const r = await fetch('/api/backup/importar/analisar', {
        method: 'POST', body: arquivo, headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${sessao.token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Não foi possível ler o arquivo.');
      setAnalise(d); setAcoes({});
    } catch (falha) { setErro(falha.message); } finally { setOcupado(''); }
  }

  const acao = (t, tipo) => acoes[t]?.[tipo] || 'mantem';
  const mudar = (t, campos) => setAcoes((a) => ({ ...a, [t]: { ...a[t], ...campos } }));
  const mudarRegistro = (t, chave, valor) => setAcoes((a) => ({ ...a, [t]: { ...a[t], registros: { ...a[t]?.registros, [chave]: valor } } }));

  async function aplicar() {
    if (modo === 'sobrescrever' && confirmacao !== 'SOBRESCREVER') return setErro('Digite SOBRESCREVER para confirmar.');
    setOcupado(modo === 'sobrescrever' ? 'Restaurando o banco…' : 'Combinando…'); setErro('');
    try {
      const r = await fetch('/api/backup/importar/aplicar', {
        method: 'POST', body: JSON.stringify({ id: analise.id, modo, acoes, confirmacao }),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.token()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Não foi possível importar.');
      setResultado(modo === 'sobrescrever'
        ? `${d.resumo} Antes, o sistema guardou um backup automático (${d.automatico}).`
        : `Pronto: ${d.inseridos} registro(s) novo(s), ${d.atualizados} subscrito(s), ${d.apagados} apagado(s), ${d.mantidos} mantido(s). Backup automático guardado antes: ${d.automatico}.`
          + (d.nao_apagados?.length ? ` Não foram apagados (usuários e colaboradores só podem ser inativados): ${d.nao_apagados.length}.` : ''));
      setAnalise(null); setArquivo(null);
    } catch (falha) { setErro(falha.message); } finally { setOcupado(''); }
  }

  const totais = analise?.tabelas.reduce((t, x) => ({ novos: t.novos + x.novos, iguais: t.iguais + x.iguais, diferentes: t.diferentes + x.diferentes }), { novos: 0, iguais: 0, diferentes: 0 });
  return (
    <section className="cartao painel-backup importar-backup">
      <h2>Importar arquivo de recuperação</h2>
      <p className="cinza ajuda">Escolha um arquivo de backup (.dump). Antes de mudar qualquer coisa, o sistema mostra o que vai acontecer e guarda um backup automático do jeito que está agora.</p>
      <div className="pasta-backup">
        <input type="file" accept=".dump" onChange={(e) => { setArquivo(e.target.files[0] || null); setAnalise(null); setResultado(''); }} aria-label="Arquivo de recuperação" />
        <button className="botao-contorno" onClick={analisar} disabled={!arquivo || Boolean(ocupado)}>Ler arquivo</button>
      </div>
      {ocupado && <p className="cinza" role="status">{ocupado}</p>}
      {analise && (
        <>
          <div className="opcoes">
            <label className={modo === 'combinar' ? 'opcao marcada' : 'opcao'}>
              <input type="radio" name="modo-importar" checked={modo === 'combinar'} onChange={() => setModo('combinar')} />
              <span><strong>Combinar</strong><small className="cinza"> traz o que falta e você decide as duplicidades</small></span>
            </label>
            <label className={modo === 'sobrescrever' ? 'opcao marcada' : 'opcao'}>
              <input type="radio" name="modo-importar" checked={modo === 'sobrescrever'} onChange={() => setModo('sobrescrever')} />
              <span><strong>Sobrescrever tudo</strong><small className="cinza"> o sistema volta a ser exatamente o do arquivo</small></span>
            </label>
          </div>
          {modo === 'combinar' ? (
            <>
              <p><strong>{totais.novos}</strong> registro(s) novo(s) entram. <strong>{totais.iguais}</strong> duplicidade(s) (iguais em todos os campos) e <strong>{totais.diferentes}</strong> registro(s) com dados diferentes: escolha a ação.</p>
              <div className="tabela-importar" role="table" aria-label="Comparação por cadastro">
                <div className="ti-linha ti-cabecalho" role="row"><span>Cadastro</span><span>Novos</span><span>Duplicidades</span><span>Ação</span><span>Diferentes</span><span>Ação</span><span /></div>
                {analise.tabelas.filter((t) => !t.ausente).map((t) => (
                  <div key={t.tabela} className="ti-grupo">
                    <div className="ti-linha" role="row">
                      <span><strong>{t.nome}</strong></span>
                      <span data-rotulo="Novos">{t.novos}</span>
                      <span data-rotulo="Duplicidades">{t.iguais}</span>
                      <span data-rotulo="Ação">{t.iguais > 0 && (
                        <select value={acao(t.tabela, 'iguais')} onChange={(e) => mudar(t.tabela, { iguais: e.target.value })} aria-label={`Ação nas duplicidades de ${t.nome}`}>
                          {ACOES_IMPORTAR.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                        </select>)}</span>
                      <span data-rotulo="Diferentes">{t.diferentes}</span>
                      <span data-rotulo="Ação">{t.diferentes > 0 && (
                        <select value={acao(t.tabela, 'diferentes')} onChange={(e) => mudar(t.tabela, { diferentes: e.target.value })} aria-label={`Ação nos diferentes de ${t.nome}`}>
                          {ACOES_IMPORTAR.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                        </select>)}</span>
                      <span>{t.registros.length > 0 && <button className="botao-texto" onClick={() => setAberta(aberta === t.tabela ? null : t.tabela)}>{aberta === t.tabela ? 'Fechar' : 'Ver registros'}</button>}</span>
                    </div>
                    {aberta === t.tabela && (
                      <ul className="ti-registros">
                        {t.registros.map((r) => (
                          <li key={r.chave}>
                            <span className={`etiqueta ${r.tipo === 'igual' ? '' : 'inativa'}`}>{r.tipo === 'igual' ? 'Duplicidade' : 'Diferente'}</span>
                            <span>{r.resumo}
                              {r.campos?.length > 0 && <small className="cinza"> · {r.campos.map((c) => `${c.coluna}: "${c.atual}" no sistema, "${c.arquivo}" no arquivo`).join(' · ')}</small>}
                            </span>
                            <select value={acoes[t.tabela]?.registros?.[r.chave] || acao(t.tabela, r.tipo === 'igual' ? 'iguais' : 'diferentes')}
                              onChange={(e) => mudarRegistro(t.tabela, r.chave, e.target.value)} aria-label="Ação neste registro">
                              {ACOES_IMPORTAR.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                            </select>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <small className="cinza">Subscreve: fica o registro do arquivo. Mantém antigo: fica o que está no sistema. Apaga: tira o registro do sistema (usuários e colaboradores nunca são apagados, só inativados).</small>
            </>
          ) : (
            <>
              <p className="aviso-texto">Tudo o que foi feito depois deste backup some do sistema (fica guardado no backup automático). Depois de sobrescrever, rode <strong>npm run banco:atualizar</strong> se o arquivo for de uma versão mais antiga.</p>
              <label>Para confirmar, digite SOBRESCREVER<input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value.toUpperCase())} /></label>
            </>
          )}
          <div className="acoes-modal">
            <button className="botao-contorno" onClick={() => setAnalise(null)}>Cancelar</button>
            <button className={modo === 'sobrescrever' ? 'botao-primario perigo' : 'botao-primario'} onClick={aplicar} disabled={Boolean(ocupado)}>
              {modo === 'sobrescrever' ? 'Sobrescrever tudo' : 'Combinar'}
            </button>
          </div>
        </>
      )}
      {resultado && <p className="sucesso" role="status">{resultado}</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </section>
  );
}
