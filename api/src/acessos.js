import { comoUsuario } from './db.js';
import { cpfValido } from './documentos.js';

const UUID = /^[0-9a-f-]{36}$/i;
const lista = (v) => (Array.isArray(v) ? v.map(String) : []);

// Telas de "Usuários e permissões": perfis (o que cada função pode ver)
// e usuários (em quais lojas trabalham e com qual perfil).
// As regras de quem pode alterar o quê ficam nas funções do banco.
export function rotasAcessos(app, { exigeLogin, rota }) {
  app.get('/api/permissoes', exigeLogin, rota(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) =>
      (await db.query('select codigo, modulo, descricao, nivel from permissoes')).rows));
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

  // Cargos do grupo (SÊNIOR, ATENDENTE…), com o perfil sugerido
  app.get('/api/cargos', exigeLogin, rota(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select c.id, c.empresa_id, coalesce(e.nome_fantasia, e.razao_social) as empresa, c.nome, c.perfil_id, p.nome as perfil, c.ativo,
              (select count(*)::int from usuarios u where u.cargo_id = c.id) + (select count(*)::int from colaboradores k where k.cargo_id = c.id) as usos
         from cargos c join empresas e on e.id = c.empresa_id left join perfis p on p.id = c.perfil_id
        order by e.razao_social, c.nome`)).rows));
  }));

  const salvarCargo = (id) => rota(async (req, res) => {
    const b = req.body || {};
    const nome = String(b.nome || '').trim().toUpperCase().slice(0, 60);
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do cargo.' });
    const perfil = UUID.test(b.perfil_id || '') ? b.perfil_id : null;
    const novo = await comoUsuario(req.usuarioId, async (db) => {
      const empresa = id ? (await db.query('select empresa_id from cargos where id = $1', [id])).rows[0]?.empresa_id : b.empresa_id;
      if (!UUID.test(empresa || '')) throw Object.assign(new Error('Escolha o grupo.'), { status: 400 });
      const ok = (await db.query("select eh_admin_rede() or exists (select 1 from lojas l where l.empresa_id = $1 and pode(l.id, 'usuarios.gerenciar')) as ok", [empresa])).rows[0].ok;
      if (!ok) throw Object.assign(new Error('Seu perfil não pode cadastrar cargos.'), { status: 403 });
      if (perfil && !(await db.query('select 1 from perfis where id = $1 and empresa_id = $2', [perfil, empresa])).rowCount) {
        throw Object.assign(new Error('O perfil escolhido não é deste grupo.'), { status: 400 });
      }
      if ((await db.query('select 1 from cargos where empresa_id = $1 and lower(nome) = lower($2) and id is distinct from $3', [empresa, nome, id ?? null])).rowCount) {
        throw Object.assign(new Error('Já existe um cargo com este nome.'), { status: 400 });
      }
      if (id) {
        await db.query('update cargos set nome = $2, perfil_id = $3, ativo = $4 where id = $1', [id, nome, perfil, b.ativo !== false]);
        return id;
      }
      return (await db.query('insert into cargos (empresa_id, nome, perfil_id) values ($1, $2, $3) returning id', [empresa, nome, perfil])).rows[0].id;
    }).catch((e) => { if (e.status) { res.status(e.status).json({ erro: e.message }); return null; } throw e; });
    if (novo) res.json({ id: novo });
  });
  app.post('/api/cargos', exigeLogin, (req, res) => salvarCargo(undefined)(req, res));
  app.put('/api/cargos/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvarCargo(req.params.id)(req, res) : res.status(404).json({ erro: 'Cargo não encontrado.' }));

  app.get('/api/usuarios', exigeLogin, rota(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) =>
      (await db.query(
        'select a.*, c.cargo_id, c.cargo from app_usuarios() a left join app_cargos_usuarios() c on c.usuario_id = a.id')).rows));
  }));

  const salvarUsuario = (id) => rota(async (req, res) => {
    const { nome, email, senha, ativo, vinculos } = req.body || {};
    const cpf = String(req.body?.cpf || '').replace(/\D/g, '') || null;
    const telefone = String(req.body?.telefone || '').replace(/\D/g, '') || null;
    if (cpf && !cpfValido(cpf)) return res.status(400).json({ erro: 'CPF inválido. Confira os números.' });
    if (telefone && !/^\d{10,11}$/.test(telefone)) return res.status(400).json({ erro: 'Celular inválido. Use DDD + número.' });
    const limpos = (Array.isArray(vinculos) ? vinculos : [])
      .filter((v) => UUID.test(v?.loja_id || '') && UUID.test(v?.perfil_id || ''))
      .map((v) => ({ loja_id: v.loja_id, perfil_id: v.perfil_id }));
    const cargo = UUID.test(req.body?.cargo_id || '') ? req.body.cargo_id : null;
    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      const uid = (await db.query('select app_salvar_usuario($1, $2, $3, $4, $5, $6, $7, $8) as id',
        [id ?? null, nome, email, senha || null, ativo !== false, JSON.stringify(limpos), cpf, telefone])).rows[0].id;
      await db.query('select app_definir_cargo($1, $2)', [uid, cargo]);
      return uid;
    });
    res.json({ id: novoId });
  });
  app.post('/api/usuarios', exigeLogin, (req, res) => salvarUsuario(undefined)(req, res));
  app.put('/api/usuarios/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvarUsuario(req.params.id)(req, res) : res.status(404).json({ erro: 'Usuário não encontrado.' }));
}
