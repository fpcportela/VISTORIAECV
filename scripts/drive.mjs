// Usar o sistema em dois computadores (um de cada vez), passando os dados pelo Google Drive.
//
// O banco de verdade nunca fica no Drive: ao fechar, o sistema salva um backup (pg_dump) numa
// pasta do Drive; ao abrir no outro computador, restaura o backup mais novo dessa pasta.
// Um arquivo "em-uso.json" no Drive diz qual computador está com o sistema aberto.
//
//   node scripts/drive.mjs iniciar     abre (restaura se precisar), liga o app e, ao fechar (Ctrl+C), salva no Drive
//   node scripts/drive.mjs abrir       só a parte de abrir: confere a trava e restaura o mais novo
//   node scripts/drive.mjs salvar      salva um backup no Drive agora (continua marcado como em uso)
//   node scripts/drive.mjs fechar      salva no Drive e libera para o outro computador
//   node scripts/drive.mjs restaurar   restaura o backup mais novo do Drive, mesmo que pareça já estar em dia
//   node scripts/drive.mjs status      mostra a pasta, quem está usando e o último backup
//
// Configuração (opcional, no arquivo .env da pasta do projeto):
//   VISTORIA_DRIVE_PASTA=/caminho/da/pasta    (sem isso, procura o Google Drive sozinho)
//   VISTORIA_MAQUINA=Mac do escritório        (sem isso, usa o nome do computador)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTEINER = 'vistoria-ecv-banco';
const NOME_PASTA = 'Vistoria ECV - backups';
const MANTER_NO_DRIVE = 20;
const MANTER_LOCAIS = 5;
const SALVAR_A_CADA_MIN = 60;
const PASTA_LOCAL = path.join(os.homedir(), '.vistoria-ecv');
const ESTADO_LOCAL = path.join(PASTA_LOCAL, 'sincronizacao.json');

lerEnv(path.join(RAIZ, '.env'));
const MAQUINA = (process.env.VISTORIA_MAQUINA || os.hostname().replace(/\.local$/, '')).trim();

function lerEnv(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { return; }
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(linha);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const aviso = (texto) => console.log(`\n[Drive] ${texto}`);
const agora = () => new Date();
const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Pasta do Drive ----------

function existe(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function acharDrive() {
  if (process.env.VISTORIA_DRIVE_PASTA) return process.env.VISTORIA_DRIVE_PASTA;
  const raizes = [];
  if (process.platform === 'darwin') {
    const nuvem = path.join(os.homedir(), 'Library', 'CloudStorage');
    if (existe(nuvem)) for (const n of fs.readdirSync(nuvem)) if (n.startsWith('GoogleDrive')) raizes.push(path.join(nuvem, n));
  } else if (process.platform === 'win32') {
    for (const letra of 'GHIJKLMNOPQRSTUVWXYZDEF') raizes.push(`${letra}:\\`);
  }
  raizes.push(os.homedir(), path.join(os.homedir(), 'Google Drive'));
  for (const r of raizes) {
    for (const n of ['Meu Drive', 'My Drive']) {
      const p = path.join(r, n);
      if (existe(p)) return path.join(p, NOME_PASTA);
    }
  }
  return null;
}

function pastaDrive() {
  const p = acharDrive();
  if (!p) {
    throw new Error('Não achei o Google Drive neste computador. Instale o "Google Drive para computador", entre na conta '
      + 'e rode de novo. Se ele estiver em outro lugar, coloque no arquivo .env do projeto: VISTORIA_DRIVE_PASTA=caminho-da-pasta');
  }
  fs.mkdirSync(p, { recursive: true });
  return p;
}

async function lerJson(arquivo) {
  try { return JSON.parse(await fsp.readFile(arquivo, 'utf8')); } catch { return null; }
}

async function gravarJson(arquivo, dados) {
  const tmp = `${arquivo}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(dados, null, 2));
  await fsp.rename(tmp, arquivo);
}

async function backupsNoDrive(pasta) {
  const nomes = (await fsp.readdir(pasta)).filter((n) => /^vistoria_.*\.dump$/.test(n));
  return nomes.sort(); // o nome começa com data e hora, então a ordem alfabética é a ordem do tempo
}

// O banco "mais novo" do sistema = o último arquivo .sql da pasta db (as atualizações são numeradas)
function versaoBanco() {
  return fs.readdirSync(path.join(RAIZ, 'db')).filter((n) => /^\d+-.*\.sql$/.test(n)).sort().pop() || '';
}

// ---------- Docker / Postgres ----------

function rodar(programa, args, { entrada, saida, silencioso } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(programa, args, { stdio: ['pipe', saida ? 'pipe' : (silencioso ? 'ignore' : 'inherit'), 'pipe'] });
    let erro = '';
    proc.stderr.on('data', (d) => { erro += d; });
    proc.on('error', (e) => reject(new Error(`não consegui rodar "${programa}": ${e.message}`)));
    if (saida) proc.stdout.pipe(saida);
    proc.on('close', (codigo) => (codigo === 0 ? resolve(erro) : reject(new Error(erro.trim() || `${programa} saiu com código ${codigo}`))));
    proc.stdin.on('error', () => {});
    if (entrada) fs.createReadStream(entrada).pipe(proc.stdin); else proc.stdin.end();
  });
}

async function bancoNoAr() {
  try {
    await rodar('docker', ['info'], { silencioso: true });
  } catch {
    throw new Error('O Docker não está ligado. Abra o Docker Desktop, espere ele ficar pronto e rode de novo.');
  }
  await rodar('docker', ['compose', 'up', '-d', 'banco'], { silencioso: true }).catch(() => {});
  // Pela rede (127.0.0.1): na primeira vez o Postgres prepara o banco sem rede e só depois fica pronto de verdade
  for (let i = 0; i < 90; i++) {
    try {
      await rodar('docker', ['exec', CONTEINER, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'vistoria', '-d', 'vistoria_ecv'], { silencioso: true });
      return;
    } catch { await esperar(1000); }
  }
  throw new Error('O banco (Docker) não respondeu. Confira se o contêiner vistoria-ecv-banco está ligado.');
}

async function dumpPara(arquivo) {
  const saida = fs.createWriteStream(arquivo);
  const fim = new Promise((resolve, reject) => { saida.on('finish', resolve); saida.on('error', reject); });
  await rodar('docker', ['exec', CONTEINER, 'pg_dump', '-U', 'vistoria', '-Fc', 'vistoria_ecv'], { saida });
  await fim;
  if ((await fsp.stat(arquivo)).size < 1000) throw new Error('o backup saiu vazio');
}

async function restaurarDe(arquivo) {
  // Mesmo jeito da tela Configurações > Backup: numa transação só, se der erro nada muda
  await rodar('docker', ['exec', CONTEINER, 'psql', '-q', '-U', 'vistoria', '-d', 'postgres', '-c',
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'vistoria_ecv' and pid <> pg_backend_pid()"], { silencioso: true });
  await rodar('docker', ['exec', '-i', CONTEINER, 'pg_restore', '-U', 'vistoria', '-d', 'vistoria_ecv',
    '--clean', '--if-exists', '--no-owner', '--single-transaction'], { entrada: arquivo });
  // Se o backup veio de uma versão um pouco mais antiga, deixa as funções e permissões iguais às deste computador
  const script = 'cd /docker-entrypoint-initdb.d && for f in 02-*.sql 0[5-9]-*.sql [1-9][0-9]-*.sql; do '
    + 'psql -q -v ON_ERROR_STOP=1 -U vistoria -d vistoria_ecv -f $f > /dev/null || exit 1; done';
  await rodar('docker', ['exec', CONTEINER, 'sh', '-c', script], { silencioso: true })
    .catch((e) => aviso(`Restaurado, mas a atualização do banco deu erro (rode "npm run banco:atualizar"): ${e.message}`));
}

// ---------- Estado ----------

async function estadoLocal() {
  return (await lerJson(ESTADO_LOCAL)) || {};
}

async function gravarEstadoLocal(dados) {
  await fsp.mkdir(PASTA_LOCAL, { recursive: true });
  await gravarJson(ESTADO_LOCAL, { ...(await estadoLocal()), ...dados });
}

async function perguntar(texto) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(`${texto} `);
  rl.close();
  return /^\s*sim\s*$/i.test(r);
}

// O Drive pode ainda estar baixando o backup que o outro computador acabou de salvar
async function ultimoCompleto(pasta) {
  for (let i = 0; i < 18; i++) {
    const ultimo = await lerJson(path.join(pasta, 'ultimo.json'));
    if (!ultimo) return null;
    try {
      if ((await fsp.stat(path.join(pasta, ultimo.arquivo))).size === ultimo.tamanho) return ultimo;
    } catch { /* ainda não chegou */ }
    if (i === 0) aviso(`Esperando o Google Drive baixar o último backup (${ultimo.arquivo}, de ${ultimo.maquina})...`);
    await esperar(10000);
  }
  const ultimo = await lerJson(path.join(pasta, 'ultimo.json'));
  aviso(`O último backup (${ultimo.arquivo}) ainda não chegou neste computador. Confira se o Google Drive está sincronizando.`);
  if (await perguntar('Digite SIM para abrir mesmo assim, sem esse backup (os dados podem estar atrasados):')) return { pular: true };
  throw new Error('Abertura cancelada. Espere o Google Drive terminar de sincronizar e abra de novo.');
}

// ---------- Comandos ----------

async function travar(pasta) {
  const trava = path.join(pasta, 'em-uso.json');
  const atual = await lerJson(trava);
  if (atual && atual.maquina !== MAQUINA) {
    aviso(`ATENÇÃO: o sistema está marcado como ABERTO no computador "${atual.maquina}" desde ${hora(atual.desde)}`
      + ` (último sinal: ${hora(atual.atualizado || atual.desde)}).`);
    console.log('Se os dois computadores forem usados ao mesmo tempo, o que for feito em um deles vai se perder.');
    console.log(`Feche o sistema no "${atual.maquina}" (Ctrl+C na janela dele) e espere o Drive sincronizar.`);
    if (!(await perguntar(`Só continue se tiver certeza de que o "${atual.maquina}" está fechado. Digite SIM para continuar:`))) {
      throw new Error('Abertura cancelada.');
    }
  } else if (atual) {
    aviso('Da última vez o sistema não foi fechado direito neste computador (o backup final pode não ter ido para o Drive). Os dados daqui continuam aqui.');
  }
  await gravarJson(trava, { maquina: MAQUINA, desde: atual?.maquina === MAQUINA ? atual.desde : agora().toISOString(), atualizado: agora().toISOString() });
}

async function restaurar(pasta, { forcar = false } = {}) {
  let ultimo = await ultimoCompleto(pasta);
  if (ultimo?.pular) return;
  if (!ultimo) {
    const lista = await backupsNoDrive(pasta);
    if (!lista.length) { aviso('Ainda não há backup no Drive. Os dados deste computador serão a base.'); return; }
    ultimo = { arquivo: lista.at(-1) };
  }
  const local = await estadoLocal();
  if (!forcar && local.ultimoArquivo === ultimo.arquivo) {
    aviso(`Este computador já está com os dados mais novos (${ultimo.arquivo}).`);
    return;
  }
  if (ultimo.versao && ultimo.versao > versaoBanco()) {
    aviso(`O backup veio de uma versão MAIS NOVA do sistema (${ultimo.versao}) do que a deste computador (${versaoBanco()}).`);
    if (!(await perguntar('O certo é atualizar o sistema aqui antes. Digite SIM para restaurar mesmo assim:'))) {
      throw new Error('Abertura cancelada. Atualize o sistema neste computador e abra de novo.');
    }
  }
  // Guarda o banco atual deste computador antes de trocar, por segurança
  const pastaSeg = path.join(PASTA_LOCAL, 'antes-de-restaurar');
  await fsp.mkdir(pastaSeg, { recursive: true });
  const seg = path.join(pastaSeg, `antes_${carimbo()}.dump`);
  await dumpPara(seg);
  for (const n of (await fsp.readdir(pastaSeg)).sort().slice(0, -MANTER_LOCAIS)) await fsp.rm(path.join(pastaSeg, n), { force: true });

  aviso(`Restaurando os dados de ${ultimo.maquina || 'outro computador'} (${ultimo.arquivo})...`);
  await restaurarDe(path.join(pasta, ultimo.arquivo));
  await gravarEstadoLocal({ ultimoArquivo: ultimo.arquivo, restauradoEm: agora().toISOString() });
  aviso(`Pronto, dados restaurados. O banco anterior deste computador ficou guardado em ${seg}`);
}

function carimbo() {
  const d = agora();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function salvar(pasta) {
  const nome = `vistoria_${carimbo()}_${MAQUINA.replace(/[^\w-]+/g, '-')}.dump`;
  // Gera fora do Drive e só depois copia, para o Drive não subir um arquivo pela metade
  const tmp = path.join(os.tmpdir(), nome);
  await dumpPara(tmp);
  const tamanho = (await fsp.stat(tmp)).size;
  await fsp.copyFile(tmp, path.join(pasta, `${nome}.parcial`));
  await fsp.rename(path.join(pasta, `${nome}.parcial`), path.join(pasta, nome));
  await fsp.rm(tmp, { force: true });
  await gravarJson(path.join(pasta, 'ultimo.json'), { arquivo: nome, tamanho, maquina: MAQUINA, quando: agora().toISOString(), versao: versaoBanco() });
  await gravarEstadoLocal({ ultimoArquivo: nome, salvoEm: agora().toISOString() });
  for (const n of (await backupsNoDrive(pasta)).slice(0, -MANTER_NO_DRIVE)) await fsp.rm(path.join(pasta, n), { force: true });
  const trava = path.join(pasta, 'em-uso.json');
  const atual = await lerJson(trava);
  if (atual?.maquina === MAQUINA) await gravarJson(trava, { ...atual, atualizado: agora().toISOString() });
  aviso(`Backup salvo no Drive: ${nome} (${(tamanho / 1024 / 1024).toFixed(1)} MB)`);
}

async function liberar(pasta) {
  const trava = path.join(pasta, 'em-uso.json');
  const atual = await lerJson(trava);
  if (atual?.maquina === MAQUINA) await fsp.rm(trava, { force: true });
}

async function abrir() {
  const pasta = pastaDrive();
  aviso(`Pasta do Drive: ${pasta}`);
  await bancoNoAr();
  await travar(pasta);
  await restaurar(pasta);
  return pasta;
}

async function fechar(pasta) {
  await bancoNoAr();
  await salvar(pasta);
  await liberar(pasta);
  aviso('Liberado. Espere o ícone do Google Drive terminar de sincronizar antes de abrir no outro computador.');
}

async function status() {
  const pasta = pastaDrive();
  const trava = await lerJson(path.join(pasta, 'em-uso.json'));
  const ultimo = await lerJson(path.join(pasta, 'ultimo.json'));
  const local = await estadoLocal();
  console.log(`Este computador: ${MAQUINA}`);
  console.log(`Pasta do Drive:  ${pasta}`);
  console.log(`Em uso:          ${trava ? `${trava.maquina} desde ${hora(trava.desde)}` : 'ninguém'}`);
  console.log(`Último backup:   ${ultimo ? `${ultimo.arquivo} (${ultimo.maquina}, ${hora(ultimo.quando)})` : 'nenhum'}`);
  console.log(`Este computador está com: ${local.ultimoArquivo || 'nada do Drive ainda'}`);
}

// Quando o app responder, abre no navegador
async function abrirNavegador() {
  if (process.env.VISTORIA_NAO_ABRIR) return;
  const endereco = 'http://localhost:5173';
  for (let i = 0; i < 180; i++) {
    await esperar(2000);
    try {
      if ((await fetch(endereco, { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch { /* ainda subindo */ }
  }
  const [programa, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', endereco]] : ['open', [endereco]];
  spawn(programa, args, { stdio: 'ignore' }).on('error', () => {});
}

// Abre, liga o app (npm run iniciar) e, quando ele for fechado, salva no Drive e libera
async function iniciar() {
  const pasta = await abrir();
  aviso(`Ligando o sistema. Para FECHAR, aperte Ctrl+C nesta janela e espere a mensagem "Liberado" (salva no Drive a cada ${SALVAR_A_CADA_MIN} min também).`);
  const app = spawn('npm', ['run', 'iniciar'], { cwd: RAIZ, stdio: 'inherit', shell: process.platform === 'win32' });
  abrirNavegador();
  let salvando = Promise.resolve();
  const timer = setInterval(() => {
    salvando = salvando.then(() => salvar(pasta)).catch((e) => aviso(`Não consegui salvar no Drive agora: ${e.message}`));
  }, SALVAR_A_CADA_MIN * 60 * 1000);

  let fechando = false;
  const encerrar = async () => {
    if (fechando) return;
    fechando = true;
    clearInterval(timer);
    aviso('Fechando: salvando os dados no Drive, não feche esta janela...');
    try {
      await salvando;
      await fechar(pasta);
    } catch (e) {
      aviso(`ERRO ao salvar no Drive: ${e.message}`);
      console.log('Antes de abrir no outro computador, rode aqui: npm run drive:fechar');
      process.exitCode = 1;
    }
    process.exit();
  };
  // Ctrl+C chega também no app; esperamos ele sair e então salvamos
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sinal, () => setTimeout(() => { if (app.exitCode === null) app.kill(); encerrar(); }, 15000).unref());
  }
  // Se a janela for fechada, não deixa a falta do terminal derrubar o salvamento
  process.stdout.on('error', () => {});
  app.on('exit', encerrar);
}

const comandos = {
  iniciar,
  abrir,
  salvar: async () => { const p = pastaDrive(); await bancoNoAr(); await salvar(p); },
  fechar: async () => fechar(pastaDrive()),
  restaurar: async () => { const p = pastaDrive(); await bancoNoAr(); await restaurar(p, { forcar: true }); },
  status,
};

const qual = process.argv[2];
if (!comandos[qual]) {
  console.log(`Use: node scripts/drive.mjs ${Object.keys(comandos).join(' | ')}`);
  process.exit(1);
}
comandos[qual]().catch((e) => {
  aviso(`ERRO: ${e.message}`);
  process.exit(1);
});
