// O que o atalho da área de trabalho faz, em ordem:
//   1. liga o Docker (e espera ele ficar pronto)
//   2. confere se há versão nova do sistema no GitHub e instala (scripts/atualizar.mjs)
//   3. liga o banco e, se estiver configurado, o WhatsApp
//   4. traz os dados mais novos do Google Drive, liga o app e abre no navegador (scripts/drive.mjs iniciar)
// Para fechar: Ctrl+C na janela e esperar a mensagem "Liberado".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function rodar(programa, args, opcoes = {}) {
  return new Promise((resolve) => {
    const proc = spawn(programa, args, { cwd: RAIZ, stdio: 'inherit', ...opcoes });
    proc.on('error', () => resolve(1));
    proc.on('close', (codigo) => resolve(codigo ?? 1));
  });
}

const dockerPronto = async () => (await rodar('docker', ['info'], { stdio: 'ignore' })) === 0;

async function ligarDocker() {
  if (await dockerPronto()) return;
  console.log('Abrindo o Docker...');
  if (process.platform === 'darwin') await rodar('open', ['-ga', 'Docker']);
  else if (process.platform === 'win32') spawn('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  for (let i = 0; i < 100; i++) {
    if (await dockerPronto()) return;
    await esperar(3000);
  }
  throw new Error('O Docker não abriu. Abra o Docker Desktop e tente de novo.');
}

async function main() {
  // Ctrl+C chega em todos; quem salva no Drive é o drive.mjs, então aqui só esperamos ele terminar
  process.on('SIGINT', () => {});
  process.on('SIGHUP', () => {});
  await ligarDocker();
  // Cada passo roda num processo novo, para já usar os arquivos da versão nova depois da atualização
  await rodar(process.execPath, ['scripts/atualizar.mjs']);
  await rodar('docker', ['compose', 'up', '-d', 'banco']);
  const env = fs.existsSync(path.join(RAIZ, '.env')) ? fs.readFileSync(path.join(RAIZ, '.env'), 'utf8') : '';
  if (process.platform !== 'win32' && /^\s*EVOLUTION_API_KEY\s*=\s*\S/m.test(env)) await rodar('npm', ['run', 'whatsapp:ligar']);
  process.exitCode = await rodar(process.execPath, ['scripts/drive.mjs', 'iniciar']);
}

main().catch((e) => {
  console.log(`\nERRO: ${e.message}`);
  process.exitCode = 1;
});
