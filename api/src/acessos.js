import { comoUsuario } from './db.js';

const UUID = /^[0-9a-f-]{36}$/i;
const lista = (v) => (Array.isArray(v) ? v.map(String) : []);

// Telas de "Usuários e permissões": perfis (o que cada função pode ver)
// e usuários (em quais lojas trabalham e com qual perfil).
// As regras de quem pode alterar o quê ficam nas funções do banco.
export function rotasAcessos(app, { exigeLogin, rota }) {
  app.get('/api/permissoes', exigeLogin, rota(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) =>
      (await db.query('select codigo, modulo, descricao from permissoes')).rows));
  }));

  app.get('/api/perfis', exigeLogin, rota(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) =>
      (await db.query('select * from app_perfis()')).rows));
  }));

  const salvarPerfil = (id) => rota(async (req, res) => {
    const { empresa_id, nome, descricao, permissoes } = req.body || {};
    if (id === undefined && !UUID.test(empresa_id || '')) return res.status(400).json({ erro: 'Escolha o grupo do perfil.' });
    const novoId = await comoUsuario(req.usuarioId, async (db) =>
      (await db.query('select app_salvar_perfil($1, $2, $3, $4, $5) as id',
        [id ?? null, empresa_id ?? null, nome, descricao || null, lista(permissoes)])).rows[0].id);
    res.json({ id: novoId });
  });
  app.post('/api/perfis', exigeLogin, (req, res) => salvarPerfil(undefined)(req, res));
  app.put('/api/perfis/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvarPerfil(req.params.id)(req, res) : res.status(404).json({ erro: 'Perfil não encontrado.' }));

  app.delete('/api/perfis/:id', exigeLogin, rota(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    await comoUsuario(req.usuarioId, (db) => db.query('select app_excluir_perfil($1)', [req.params.id]));
    res.json({ ok: true });
  }));

  app.get('/api/usuarios', exigeLogin, rota(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) =>
      (await db.query('select * from app_usuarios()')).rows));
  }));

  const salvarUsuario = (id) => rota(async (req, res) => {
    const { nome, email, senha, ativo, vinculos } = req.body || {};
    const limpos = (Array.isArray(vinculos) ? vinculos : [])
      .filter((v) => UUID.test(v?.loja_id || '') && UUID.test(v?.perfil_id || ''))
      .map((v) => ({ loja_id: v.loja_id, perfil_id: v.perfil_id }));
    const novoId = await comoUsuario(req.usuarioId, async (db) =>
      (await db.query('select app_salvar_usuario($1, $2, $3, $4, $5, $6) as id',
        [id ?? null, nome, email, senha || null, ativo !== false, JSON.stringify(limpos)])).rows[0].id);
    res.json({ id: novoId });
  });
  app.post('/api/usuarios', exigeLogin, (req, res) => salvarUsuario(undefined)(req, res));
  app.put('/api/usuarios/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvarUsuario(req.params.id)(req, res) : res.status(404).json({ erro: 'Usuário não encontrado.' }));
}
