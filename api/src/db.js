import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

// Valores numéricos do Postgres chegam como texto; converte para número
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Datas (sem hora) chegam como texto AAAA-MM-DD, sem conversão de fuso
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app_api:app_dev@localhost:5432/vistoria_ecv',
});

// Grupo escolhido pelo master no topo da tela (cabeçalho X-Grupo), guardado por requisição
export const contexto = new AsyncLocalStorage();

// Roda as consultas em uma transação "em nome" do usuário logado,
// para que as regras de acesso por loja do banco sejam aplicadas.
export async function comoUsuario(usuarioId, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.usuario_id', $1, true)", [usuarioId || '']);
    await client.query("select set_config('app.grupo', $1, true)", [contexto.getStore()?.grupo || '']);
    // "hoje" e o mês são os do Brasil, não os do servidor
    await client.query("set local time zone 'America/Sao_Paulo'");
    const resultado = await fn(client);
    await client.query('commit');
    return resultado;
  } catch (erro) {
    await client.query('rollback');
    throw erro;
  } finally {
    client.release();
  }
}
