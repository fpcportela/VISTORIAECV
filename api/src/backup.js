import { spawn } from 'node:child_process';
import { comoUsuario } from './db.js';

// Backup completo do banco (todas as lojas, vendas, financeiro, fotos do ponto e arquivos).
// Gera um arquivo do pg_dump (formato custom), que volta com pg_restore.
// Só o usuário master pode baixar, porque o arquivo tem os dados de toda a rede.
//
// Por padrão roda o pg_dump dentro do contêiner do banco (docker compose deste projeto).
// Em outro servidor, troque pela linha de comando certa em BACKUP_CMD.
const COMANDO = process.env.BACKUP_CMD || 'docker exec vistoria-ecv-banco pg_dump -U vistoria -Fc vistoria_ecv';

function rodarDump() {
  return new Promise((resolve, reject) => {
    const [programa, ...args] = COMANDO.split(/\s+/);
    const proc = spawn(programa, args);
    const partes = [];
    let erro = '';
    proc.stdout.on('data', (d) => partes.push(d));
    proc.stderr.on('data', (d) => { erro += d; });
    proc.on('error', (e) => reject(new Error(`não consegui rodar "${programa}": ${e.message}`)));
    proc.on('close', (codigo) => (codigo === 0 ? resolve(Buffer.concat(partes)) : reject(new Error(erro.trim() || `saiu com código ${codigo}`))));
  });
}

export function rotasBackup(app, { exigeLogin, rota }) {
  app.get('/api/backup', exigeLogin, rota(async (req, res) => {
    const master = await comoUsuario(req.usuarioId, async (db) => (await db.query('select eh_admin_rede() as ok')).rows[0].ok);
    if (!master) return res.status(403).json({ erro: 'Só o usuário master pode fazer o backup completo.' });
    let arquivo;
    try {
      arquivo = await rodarDump();
    } catch (e) {
      console.error('Backup:', e.message);
      return res.status(500).json({ erro: 'Não foi possível gerar o backup. Confira se o banco (Docker) está ligado.' });
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Length', String(arquivo.length));
    res.send(arquivo);
  }));
}
