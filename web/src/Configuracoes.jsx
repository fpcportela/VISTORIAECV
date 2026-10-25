import { useEffect, useState } from 'react';
import { sessao } from './api.js';

// Configurações. Por enquanto: backup completo do sistema.

export default function Configuracoes({ perfil }) {
  return (
    <>
      <div className="cabecalho"><h1>Configurações</h1></div>
      {perfil.master ? <Backup /> : <p className="cinza">Nenhuma configuração disponível para o seu perfil.</p>}
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
