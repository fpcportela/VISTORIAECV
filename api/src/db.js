import pg from 'pg';

// Valores numéricos do Postgres chegam como texto; converte para número
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app_api:app_dev@localhost:5432/vistoria_ecv',
});

// Roda as consultas em uma transação "em nome" do usuário logado,
// para que as regras de acesso por loja do banco sejam aplicadas.
export async function comoUsuario(usuarioId, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.usuario_id', $1, true)", [usuarioId || '']);
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
