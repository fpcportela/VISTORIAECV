import { comoUsuario } from './db.js';
import { Recusa, UUID, criarComRecusa, texto } from './comum.js';
import { cnpjValido } from './documentos.js';

// Grupos (empresas) e as suas unidades (lojas). Só o master cadastra e altera;
// quem tem "Ver as lojas" enxerga as unidades do próprio grupo.

const soMaster = async (db) => {
  if (!(await db.query('select eh_admin_rede() as m')).rows[0].m) {
    throw new Recusa(403, 'Só o usuário master pode cadastrar grupos e unidades.');
  }
};
// CNPJ é opcional; se vier, precisa ser válido
function cnpjOpcional(v) {
  const cnpj = String(v || '').replace(/\D/g, '');
  if (!cnpj) return null;
  if (!cnpjValido(cnpj)) throw new Recusa(400, 'CNPJ inválido. Confira os números.');
  return cnpj;
}
const duplicado = (e, msg) => { if (e.code === '23505') throw new Recusa(400, msg); throw e; };

export function rotasGrupos(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  app.get('/api/grupos', exigeLogin, comRecusa(async (req, res) => {
    const dados = await comoUsuario(req.usuarioId, async (db) => {
      const master = (await db.query('select eh_admin_rede() as m')).rows[0].m;
      const grupos = (await db.query(
        `select e.id, e.razao_social, e.nome_fantasia, e.cnpj, e.ativo, e.logo,
                coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'codigo', l.codigo, 'nome', l.nome, 'cnpj', l.cnpj,
                          'telefone', l.telefone, 'cidade', l.cidade, 'uf', l.uf, 'ativo', l.ativo) order by l.codigo)
                            from lojas l where l.empresa_id = e.id and ($1 or tem_loja(l.id))), '[]') as unidades
           from empresas e
          where $1 or tem_empresa(e.id)
          order by coalesce(e.nome_fantasia, e.razao_social)`, [master])).rows;
      return { master, grupos };
    });
    res.json(dados);
  }));

  // Grupo
  const salvarGrupo = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const razao = texto(b.razao_social, 120)?.toUpperCase();
    if (!razao) throw new Recusa(400, 'Informe o nome do grupo.');
    // logo: data URL de imagem de até ~300 KB (o navegador já reduz antes de mandar)
    const logo = b.logo ? String(b.logo) : null;
    if (logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 400000)) {
      throw new Recusa(400, 'Logo inválido. Use uma imagem PNG ou JPG.');
    }
    const campos = [razao, texto(b.nome_fantasia, 120)?.toUpperCase() || null, cnpjOpcional(b.cnpj), b.ativo !== false, logo];
    const novo = await comoUsuario(req.usuarioId, async (db) => {
      await soMaster(db);
      let gid = id;
      try {
        if (gid) {
          const ok = (await db.query(
            'update empresas set razao_social = $2, nome_fantasia = $3, cnpj = $4, ativo = $5, logo = $6 where id = $1', [gid, ...campos])).rowCount;
          if (!ok) throw new Recusa(404, 'Grupo não encontrado.');
        } else {
          gid = (await db.query(
            `insert into empresas (franquia_id, razao_social, nome_fantasia, cnpj, ativo, logo)
             values ((select id from franquias order by criado_em limit 1), $1, $2, $3, $4, $5) returning id`, campos)).rows[0].id;
        }
      } catch (e) { duplicado(e, 'Já existe um grupo com esse CNPJ.'); }
      await db.query('select app_preparar_grupo($1)', [gid]);
      return gid;
    });
    res.json({ id: novo });
  });
  app.post('/api/grupos', exigeLogin, (req, res) => salvarGrupo(null)(req, res));
  app.put('/api/grupos/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvarGrupo(req.params.id)(req, res) : res.status(404).json({ erro: 'Grupo não encontrado.' }));

  // Unidade (loja) de um grupo, com ou sem CNPJ próprio
  const salvarUnidade = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 80)?.toUpperCase();
    if (!nome) throw new Recusa(400, 'Informe o nome da unidade.');
    const uf = texto(b.uf, 2)?.toUpperCase() || null;
    const campos = [nome, cnpjOpcional(b.cnpj), texto(b.telefone, 20), texto(b.cidade, 80)?.toUpperCase() || null, uf, b.ativo !== false];
    const novo = await comoUsuario(req.usuarioId, async (db) => {
      await soMaster(db);
      let uid = id, empresa;
      if (uid) {
        empresa = (await db.query(
          `update lojas set nome = $2, cnpj = $3, telefone = $4, cidade = $5, uf = $6, ativo = $7 where id = $1 returning empresa_id`,
          [uid, ...campos])).rows[0]?.empresa_id;
        if (!empresa) throw new Recusa(404, 'Unidade não encontrada.');
      } else {
        empresa = b.grupo_id;
        if (!UUID.test(empresa || '') || !(await db.query('select 1 from empresas where id = $1', [empresa])).rowCount) {
          throw new Recusa(400, 'Escolha o grupo da unidade.');
        }
        // código sequencial dentro do grupo: 0001, 0002…
        const codigo = (await db.query(
          `select lpad((coalesce(max(nullif(regexp_replace(codigo, '\\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0') as c
             from lojas where empresa_id = $1`, [empresa])).rows[0].c;
        uid = (await db.query(
          `insert into lojas (empresa_id, codigo, nome, cnpj, telefone, cidade, uf, ativo)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [empresa, codigo, ...campos])).rows[0].id;
      }
      await db.query('select app_preparar_grupo($1)', [empresa]); // centro de custo da unidade nova
      return uid;
    });
    res.json({ id: novo });
  });
  app.post('/api/unidades', exigeLogin, (req, res) => salvarUnidade(null)(req, res));
  app.put('/api/unidades/:id', exigeLogin, (req, res) =>
    UUID.test(req.params.id) ? salvarUnidade(req.params.id)(req, res) : res.status(404).json({ erro: 'Unidade não encontrada.' }));
}
