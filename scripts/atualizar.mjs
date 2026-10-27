// Confere se há uma versão nova do sistema no GitHub e, se houver, instala.
//
//   node scripts/atualizar.mjs           atualiza se tiver versão nova
//   node scripts/atualizar.mjs --forcar  baixa e instala de novo mesmo sem versão nova
//   node scripts/atualizar.mjs --banco   só atualiza as regras do banco (npm run banco:atualizar)
//
// Mantém os arquivos .env, os node_modules e os backups automáticos. A versão anterior fica
// guardada em ~/.vistoria-ecv/versao-anterior (sem os node_modules), para voltar se precisar.
// Depois de trocar os arquivos roda o "npm run instalar" e atualiza as regras do banco.
//
// Configuração (opcional, no arquivo .env da pasta do projeto):
//   VISTORIA_RAMO=consulta-placa    de qual branch do GitHub vêm as atualizações
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'fpcportela/VISTORIAECV';
const CONTEINER = 'vistoria-ecv-banco';
const ARQ_VERSAO = path.join(RAIZ, '.versao');
const ANTERIOR = path.join(os.homedir(), '.vistoria-ecv', 'versao-anterior');
// O que nunca é apagado nem trocado na pasta do sistema
const MANTER = new Set(['.env', 'node_modules', 'backups-automaticos', '.versao', '.git', '.DS_Store']);

lerEnv(path.join(RAIZ, '.env'));
const RAMO = process.env.VISTORIA_RAMO || 'consulta-placa';

function lerEnv(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { return; }
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(linha);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const aviso = (texto) => console.log(`\n[Atualização] ${texto}`);

function rodar(programa, args, opcoes = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(programa, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opcoes });
    proc.on('error', (e) => reject(new Error(`não consegui rodar "${programa}": ${e.message}`)));
    proc.on('close', (codigo) => (codigo === 0 ? resolve() : reject(new Error(`${programa} ${args.join(' ')} saiu com código ${codigo}`))));
  });
}

function portaEmUso(porta) {
  return new Promise((resolve) => {
    const s = net.connect(porta, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

async function versaoNoGitHub() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(RAMO)}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vistoria-ecv' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`o GitHub respondeu ${r.status}`);
  const j = await r.json();
  return { sha: j.sha, data: j.commit?.committer?.date, mensagem: (j.commit?.message || '').split('\n')[0] };
}

async function baixar(sha, destino) {
  const r = await fetch(`https://codeload.github.com/${REPO}/zip/${sha}`, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`não consegui baixar a versão nova (${r.status})`);
  const zip = path.join(destino, 'versao.zip');
  await fsp.writeFile(zip, Buffer.from(await r.arrayBuffer()));
  // macOS tem unzip; o Windows 10/11 abre zip com o tar
  if (process.platform === 'win32') await rodar('tar', ['-xf', zip, '-C', destino], { shell: false });
  else await rodar('unzip', ['-q', zip, '-d', destino], { shell: false });
  await fsp.rm(zip);
  const [pasta] = (await fsp.readdir(destino)).filter((n) => fs.statSync(path.join(destino, n)).isDirectory());
  if (!pasta || !fs.existsSync(path.join(destino, pasta, 'package.json'))) throw new Error('o arquivo baixado não parece ser o sistema');
  return path.join(destino, pasta);
}

const manter = (nome) => MANTER.has(nome);

// Copia a pasta do sistema sem node_modules (para dar para voltar)
async function guardarAnterior() {
  await fsp.rm(ANTERIOR, { recursive: true, force: true });
  await fsp.cp(RAIZ, ANTERIOR, { recursive: true, filter: (origem) => path.basename(origem) !== 'node_modules' });
}

// Apaga o que é do código antigo (menos o que está em MANTER, em qualquer nível) e copia o novo
async function limpar(pasta) {
  for (const nome of await fsp.readdir(pasta)) {
    if (manter(nome)) continue;
    const p = path.join(pasta, nome);
    if ((await fsp.lstat(p)).isDirectory()) {
      await limpar(p);
      if (!(await fsp.readdir(p)).length) await fsp.rmdir(p);
    } else {
      await fsp.rm(p, { force: true });
    }
  }
}

async function atualizarBanco() {
  try {
    await rodar('docker', ['info'], { stdio: 'ignore', shell: false });
  } catch {
    aviso('O Docker não está ligado, então as regras do banco não foram atualizadas agora. Depois rode: npm run banco:atualizar');
    return;
  }
  await rodar('docker', ['compose', 'up', '-d', 'banco'], { cwd: RAIZ, stdio: 'ignore', shell: false }).catch(() => {});
  for (let i = 0; i < 90; i++) {
    try {
      await rodar('docker', ['exec', CONTEINER, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'vistoria', '-d', 'vistoria_ecv'], { stdio: 'ignore', shell: false });
      break;
    } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  // Os .sql são lidos da pasta do app e mandados pela entrada do psql. A pasta db montada no
  // contêiner não serve: a atualização recria a pasta, e o contêiner continua vendo a antiga (vazia).
  const pasta = path.join(RAIZ, 'db');
  const arquivos = (await fsp.readdir(pasta)).filter((f) => /^(02|0[5-9]|[1-9][0-9])-.*\.sql$/.test(f)).sort();
  for (const f of arquivos) {
    const entrada = fs.openSync(path.join(pasta, f), 'r');
    try {
      await rodar('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', CONTEINER,
        'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'vistoria', '-d', 'vistoria_ecv', '-f', '-'],
      { stdio: [entrada, 'ignore', 'inherit'], shell: false })
        .catch((e) => { throw new Error(`${f}: ${e.message}`); });
    } finally {
      fs.closeSync(entrada);
    }
  }
  aviso('Regras do banco atualizadas (os dados continuam).');
}

async function main() {
  if (process.argv.includes('--banco')) return atualizarBanco();
  const forcar = process.argv.includes('--forcar');
  let nova;
  try {
    nova = await versaoNoGitHub();
  } catch (e) {
    aviso(`Não deu para conferir se há versão nova (${e.message}). Abrindo a versão que já está aqui.`);
    return;
  }
  const atual = fs.existsSync(ARQ_VERSAO) ? fs.readFileSync(ARQ_VERSAO, 'utf8').trim() : '';
  if (!forcar && atual === nova.sha) {
    aviso(`O sistema já está na versão mais nova (${nova.sha.slice(0, 7)}).`);
    return;
  }
  if (await portaEmUso(3001)) {
    aviso('Há uma versão nova, mas o sistema está aberto (porta 3001). Feche-o e abra de novo para atualizar.');
    return;
  }
  aviso(`Versão nova encontrada: ${nova.sha.slice(0, 7)} - ${nova.mensagem}`);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vistoria-ecv-'));
  let guardou = false;
  try {
    const novaPasta = await baixar(nova.sha, tmp);
    aviso(`Guardando a versão atual em ${ANTERIOR} ...`);
    await guardarAnterior();
    guardou = true;
    await limpar(RAIZ);
    await fsp.cp(novaPasta, RAIZ, { recursive: true, filter: (origem) => origem === novaPasta || !manter(path.basename(origem)) });
    await fsp.writeFile(ARQ_VERSAO, `${nova.sha}\n`);
  } catch (e) {
    aviso(`ERRO ao trocar os arquivos: ${e.message}`);
    if (guardou) {
      aviso('Voltando a versão anterior...');
      await limpar(RAIZ);
      await fsp.cp(ANTERIOR, RAIZ, { recursive: true });
    }
    throw e;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  aviso('Instalando as dependências...');
  await rodar('npm', ['run', 'instalar'], { cwd: RAIZ });
  await atualizarBanco();
  aviso(`Sistema atualizado para ${nova.sha.slice(0, 7)}.`);
}

main().catch((e) => {
  aviso(`ERRO: ${e.message}`);
  process.exit(1);
});
