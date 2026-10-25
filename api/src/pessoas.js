import express from 'express';
import { comoUsuario } from './db.js';
import { cpfValido } from './documentos.js';
import { Recusa, UUID, criarComRecusa, exigir, texto } from './comum.js';

// Colaboradores (cadastro de funcionários, com arquivos) e controle de ponto com foto.
// O acesso por loja vem do banco (RLS); aqui ficam as permissões de cada ação.

const FUSO = 'America/Sao_Paulo';
const ORDEM_PONTO = ['entrada', 'saida_intervalo', 'volta_intervalo', 'saida'];
const MAX_ARQUIVO = 15 * 1024 * 1024;
const dataValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : null);

async function colaborador(db, id) {
  if (!UUID.test(id || '')) throw new Recusa(404, 'Colaborador não encontrado.');
  const c = (await db.query('select * from colaboradores where id = $1', [id])).rows[0];
  if (!c) throw new Recusa(404, 'Colaborador não encontrado.');
  return c;
}

// Foto do ponto: data URL JPEG/PNG/WebP de até ~1,5 MB
function lerFoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Recusa(400, 'Tire a foto para registrar o ponto.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 1.5 * 1024 * 1024) throw new Recusa(400, 'A foto ficou grande demais. Tente de novo.');
  return { bytes, mime: m[1] };
}

// Permissão em alguma das unidades do colaborador
async function exigirColab(db, c, permissao, mensagem) {
  const ok = (await db.query('select pode_colaborador($1, $2) as ok', [c.id, permissao])).rows[0].ok;
  if (!ok) throw new Recusa(403, mensagem);
}

export function rotasPessoas(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  // ------------------------------------------------------------ colaboradores
  app.get('/api/colaboradores', exigeLogin, comRecusa(async (req, res) => {
    const loja = UUID.test(req.query.loja || '') ? req.query.loja : null;
    const busca = texto(req.query.busca, 60);
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select c.id, c.loja_id, c.nome, c.data_nascimento, c.cpf, c.celular, c.cargo, c.ativo,
              (select string_agg(l.nome, ', ' order by l.codigo) from colaborador_lojas cl join lojas l on l.id = cl.loja_id
                where cl.colaborador_id = c.id) as loja,
              (select count(*)::int from colaborador_arquivos a where a.colaborador_id = c.id) as arquivos
         from colaboradores c
        where (pode_colaborador(c.id, 'colaboradores.ver') or pode_colaborador(c.id, 'colaboradores.editar'))
          and ($1::uuid is null or c.loja_id = $1 or exists (select 1 from colaborador_lojas cl where cl.colaborador_id = c.id and cl.loja_id = $1))
          and ($2::text is null or c.nome ilike '%' || $2 || '%' or c.cpf like regexp_replace($2, '\\D', '', 'g') || '%')
          and ($3 or c.ativo)
        order by c.ativo desc, c.nome`, [loja, busca, req.query.inativos === '1'])).rows));
  }));

  app.get('/api/colaboradores/:id', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const c = await colaborador(db, req.params.id);
      const ve = (await db.query("select pode_colaborador($1, 'colaboradores.ver') or pode_colaborador($1, 'colaboradores.editar') as ok", [c.id])).rows[0].ok;
      if (!ve) throw new Recusa(403, 'Seu perfil não pode ver colaboradores.');
      c.loja_ids = (await db.query('select loja_id from colaborador_lojas where colaborador_id = $1', [c.id])).rows.map((x) => x.loja_id);
      c.arquivos = (await db.query(
        `select a.id, a.tipo_id, t.nome as tipo, a.nome_arquivo, a.mime, a.tamanho, a.observacao, a.enviado_em, u.nome as enviado_por
           from colaborador_arquivos a left join tipos_arquivo t on t.id = a.tipo_id left join usuarios u on u.id = a.enviado_por
          where a.colaborador_id = $1 order by a.enviado_em desc`, [c.id])).rows;
      c.pode_editar = (await db.query("select pode_colaborador($1, 'colaboradores.editar') as ok", [c.id])).rows[0].ok;
      // login do colaborador no sistema (usuário e perfil; a senha nunca volta)
      c.acesso = (await db.query('select * from app_colaborador_ver_acesso($1)', [c.id])).rows[0] || null;
      return c;
    }));
  }));

  const salvarColaborador = (id) => comRecusa(async (req, res) => {
    const b = req.body || {};
    const nome = texto(b.nome, 120);
    if (!nome) throw new Recusa(400, 'Informe o nome do colaborador.');
    const cpf = String(b.cpf || '').replace(/\D/g, '') || null;
    if (cpf && !cpfValido(cpf)) throw new Recusa(400, 'CPF inválido. Confira os números.');
    const celular = String(b.celular || '').replace(/\D/g, '') || null;
    if (celular && !/^\d{10,11}$/.test(celular)) throw new Recusa(400, 'Celular inválido. Use DDD + número.');
    const nascimento = b.data_nascimento ? dataValida(b.data_nascimento) : null;
    if (b.data_nascimento && !nascimento) throw new Recusa(400, 'Data de nascimento inválida.');
    // Unidades em que trabalha (a primeira é a principal); aceita o formato antigo, com uma só
    const lojas = [...new Set((Array.isArray(b.loja_ids) ? b.loja_ids : [b.loja_id]).filter((l) => UUID.test(String(l || ''))))];
    if (!lojas.length) throw new Recusa(400, 'Escolha pelo menos uma unidade do colaborador.');
    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      for (const l of lojas) await exigir(db, l, 'colaboradores.editar', 'Seu perfil não pode cadastrar colaboradores em uma das unidades escolhidas.');
      const empresas = (await db.query('select distinct empresa_id from lojas where id = any($1)', [lojas])).rows;
      if (empresas.length !== 1) throw new Recusa(400, 'As unidades precisam ser do mesmo grupo.');
      const empresa = empresas[0].empresa_id;
      if (cpf && (await db.query('select 1 from colaboradores where empresa_id = $1 and cpf = $2 and id is distinct from $3',
        [empresa, cpf, id ?? null])).rowCount) throw new Recusa(400, 'Já existe um colaborador com este CPF.');
      // cargo do cadastro de cargos (o nome fica gravado também, para o ponto e os relatórios)
      const cargoId = UUID.test(b.cargo_id || '') ? b.cargo_id : null;
      const cargoNome = cargoId ? (await db.query('select nome from cargos where id = $1 and empresa_id = $2', [cargoId, empresa])).rows[0]?.nome : null;
      if (cargoId && !cargoNome) throw new Recusa(400, 'Cargo não encontrado.');
      const campos = [lojas[0], nome.toUpperCase(), nascimento, cpf, celular, cargoNome ?? (texto(b.cargo, 60)?.toUpperCase() || null), b.ativo !== false, cargoId];
      let cid = id;
      if (cid) {
        const atual = await colaborador(db, cid);
        await exigirColab(db, atual, 'colaboradores.editar', 'Seu perfil não pode alterar este colaborador.');
        await db.query(
          `update colaboradores set loja_id = $2, nome = $3, data_nascimento = $4, cpf = $5, celular = $6, cargo = $7, ativo = $8, cargo_id = $9
            where id = $1`, [cid, ...campos]);
        // tira só as unidades que a pessoa pode gerenciar; as outras ficam
        await db.query("delete from colaborador_lojas where colaborador_id = $1 and pode(loja_id, 'colaboradores.editar')", [cid]);
      } else {
        cid = (await db.query(
          `insert into colaboradores (empresa_id, loja_id, nome, data_nascimento, cpf, celular, cargo, ativo, cargo_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [empresa, ...campos])).rows[0].id;
      }
      for (const l of lojas) await db.query('insert into colaborador_lojas (colaborador_id, loja_id) values ($1, $2) on conflict do nothing', [cid, l]);
      // "Acessa sistema": cria ou atualiza o login (usuário e senha) ligado ao colaborador; desmarcado, desativa o login
      if (b.acesso && typeof b.acesso === 'object') {
        const a = b.acesso;
        const atual = (await db.query('select usuario_id from colaboradores where id = $1', [cid])).rows[0]?.usuario_id;
        if (a.ativo || atual) {
          if (a.ativo && !atual && String(a.senha || '').length < 6) throw new Recusa(400, 'Crie uma senha de pelo menos 6 caracteres para o acesso.');
          await db.query('select app_colaborador_acesso($1, $2, $3, $4, $5)',
            [cid, Boolean(a.ativo), texto(a.usuario, 80), a.senha ? String(a.senha) : null, UUID.test(a.perfil_id || '') ? a.perfil_id : null]);
        }
      }
      return cid;
    });
    res.json({ id: novoId });
  });
  app.post('/api/colaboradores', exigeLogin, salvarColaborador(null));
  app.put('/api/colaboradores/:id', exigeLogin, (req, res) =>
    (UUID.test(req.params.id) ? salvarColaborador(req.params.id)(req, res) : res.status(404).json({ erro: 'Colaborador não encontrado.' })));

  // ------------------------------------------------------------ tipos de arquivo (por grupo)
  app.get('/api/tipos-arquivo', exigeLogin, comRecusa(async (req, res) => {
    res.json(await comoUsuario(req.usuarioId, async (db) => (await db.query(
      `select t.id, t.nome, (select count(*)::int from colaborador_arquivos a where a.tipo_id = t.id) as usos
         from tipos_arquivo t join lojas l on l.empresa_id = t.empresa_id
        where l.id = $1 order by t.nome`, [UUID.test(req.query.loja || '') ? req.query.loja : null])).rows));
  }));

  const salvarTipo = (id) => comRecusa(async (req, res) => {
    const nome = texto(req.body?.nome, 60);
    if (!nome) throw new Recusa(400, 'Informe o nome do tipo de arquivo.');
    const loja = req.body?.loja_id;
    if (!UUID.test(loja || '')) throw new Recusa(400, 'Filial inválida.');
    const novoId = await comoUsuario(req.usuarioId, async (db) => {
      await exigir(db, loja, 'colaboradores.editar', 'Seu perfil não pode criar tipos de arquivo.');
      const empresa = (await db.query('select empresa_id from lojas where id = $1', [loja])).rows[0].empresa_id;
      if ((await db.query('select 1 from tipos_arquivo where empresa_id = $1 and lower(nome) = lower($2) and id is distinct from $3',
        [empresa, nome, id ?? null])).rowCount) throw new Recusa(400, 'Já existe um tipo com este nome.');
      if (id) {
        const r = await db.query('update tipos_arquivo set nome = $3 where id = $1 and empresa_id = $2', [id, empresa, nome]);
        if (!r.rowCount) throw new Recusa(404, 'Tipo não encontrado.');
        return id;
      }
      return (await db.query('insert into tipos_arquivo (empresa_id, nome) values ($1, $2) returning id', [empresa, nome])).rows[0].id;
    });
    res.json({ id: novoId });
  });
  app.post('/api/tipos-arquivo', exigeLogin, salvarTipo(null));
  app.put('/api/tipos-arquivo/:id', exigeLogin, (req, res) =>
    (UUID.test(req.params.id) ? salvarTipo(req.params.id)(req, res) : res.status(404).json({ erro: 'Tipo não encontrado.' })));
  app.delete('/api/tipos-arquivo/:id', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id) || !UUID.test(req.query.loja || '')) throw new Recusa(404, 'Tipo não encontrado.');
    await comoUsuario(req.usuarioId, async (db) => {
      await exigir(db, req.query.loja, 'colaboradores.editar', 'Seu perfil não pode excluir tipos de arquivo.');
      await db.query(
        'delete from tipos_arquivo t using lojas l where t.id = $1 and l.id = $2 and l.empresa_id = t.empresa_id', [req.params.id, req.query.loja]);
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ arquivos do colaborador
  // O corpo é o próprio arquivo (enviado como octet-stream); nome, tipo do arquivo, mime e observação vão na URL
  app.post('/api/colaboradores/:id/arquivos', exigeLogin,
    express.raw({ type: () => true, limit: MAX_ARQUIVO }),
    comRecusa(async (req, res) => {
      const conteudo = req.body;
      if (!Buffer.isBuffer(conteudo) || !conteudo.length) throw new Recusa(400, 'Escolha o arquivo.');
      const nome = texto(req.query.nome, 150) || 'arquivo';
      const tipo = UUID.test(req.query.tipo || '') ? req.query.tipo : null;
      const mime = /^[\w.+-]+\/[\w.+-]+$/.test(req.query.mime || '') ? req.query.mime : 'application/octet-stream';
      const id = await comoUsuario(req.usuarioId, async (db) => {
        const c = await colaborador(db, req.params.id);
        await exigirColab(db, c, 'colaboradores.editar', 'Seu perfil não pode anexar arquivos.');
        if (tipo && !(await db.query('select 1 from tipos_arquivo where id = $1 and empresa_id = $2', [tipo, c.empresa_id])).rowCount) {
          throw new Recusa(400, 'Tipo de arquivo inválido.');
        }
        return (await db.query(
          `insert into colaborador_arquivos (colaborador_id, tipo_id, nome_arquivo, mime, tamanho, conteudo, observacao, enviado_por)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [c.id, tipo, nome, mime, conteudo.length, conteudo, texto(req.query.obs, 300), req.usuarioId])).rows[0].id;
      });
      res.json({ id });
    }));

  app.get('/api/colaboradores/:id/arquivos/:arq', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.arq)) throw new Recusa(404, 'Arquivo não encontrado.');
    const a = await comoUsuario(req.usuarioId, async (db) => {
      const c = await colaborador(db, req.params.id);
      const ve = (await db.query("select pode_colaborador($1, 'colaboradores.ver') or pode_colaborador($1, 'colaboradores.editar') as ok", [c.id])).rows[0].ok;
      if (!ve) throw new Recusa(403, 'Seu perfil não pode ver os arquivos.');
      return (await db.query('select nome_arquivo, mime, conteudo from colaborador_arquivos where id = $1 and colaborador_id = $2',
        [req.params.arq, c.id])).rows[0];
    });
    if (!a) throw new Recusa(404, 'Arquivo não encontrado.');
    res.set('Content-Type', a.mime);
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome_arquivo)}`);
    res.send(a.conteudo);
  }));

  app.delete('/api/colaboradores/:id/arquivos/:arq', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.arq)) throw new Recusa(404, 'Arquivo não encontrado.');
    await comoUsuario(req.usuarioId, async (db) => {
      const c = await colaborador(db, req.params.id);
      await exigirColab(db, c, 'colaboradores.editar', 'Seu perfil não pode excluir arquivos.');
      await db.query('delete from colaborador_arquivos where id = $1 and colaborador_id = $2', [req.params.arq, c.id]);
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ ponto: registrar
  // Colaboradores da filial, com as marcações de hoje (para saber a próxima). Serve ao registro e ao espelho.
  app.get('/api/ponto/colaboradores', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.query.loja || '')) throw new Recusa(400, 'Escolha a filial.');
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const ok = (await db.query("select pode($1, 'ponto.registrar') or pode($1, 'ponto.ver_equipe') as ok", [req.query.loja])).rows[0].ok;
      if (!ok) throw new Recusa(403, 'Seu perfil não pode usar o ponto nesta filial.');
      return (await db.query(
        `select c.id, c.nome, c.cargo,
                coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'hora', r.hora) order by r.hora)
                            from ponto_registros r
                           where r.colaborador_id = c.id and r.ativo and r.data = (now() at time zone '${FUSO}')::date), '[]') as hoje
           from colaboradores c
          where (c.loja_id = $1 or exists (select 1 from colaborador_lojas cl where cl.colaborador_id = c.id and cl.loja_id = $1))
            and (c.ativo or $2) order by c.nome`, [req.query.loja, req.query.inativos === '1'])).rows;
    }));
  }));

  app.post('/api/ponto/registrar', exigeLogin, comRecusa(async (req, res) => {
    const foto = lerFoto(req.body?.foto);
    const r = await comoUsuario(req.usuarioId, async (db) => {
      const c = await colaborador(db, req.body?.colaborador_id);
      if (!c.ativo) throw new Recusa(400, 'Este colaborador está inativo.');
      // o ponto fica na unidade em que foi batido (se o colaborador trabalha nela); senão, na principal
      const lojaPonto = UUID.test(req.body?.loja_id || '')
        && (await db.query('select 1 from colaborador_lojas where colaborador_id = $1 and loja_id = $2', [c.id, req.body.loja_id])).rowCount
        ? req.body.loja_id : c.loja_id;
      await exigir(db, lojaPonto, 'ponto.registrar', 'Seu perfil não pode registrar ponto nesta unidade.');
      const feitos = (await db.query(
        `select tipo from ponto_registros where colaborador_id = $1 and ativo and data = (now() at time zone '${FUSO}')::date`, [c.id]))
        .rows.map((x) => x.tipo);
      const tipo = ORDEM_PONTO.find((t) => !feitos.includes(t));
      if (!tipo) throw new Recusa(400, 'As quatro marcações de hoje já foram registradas. Para corrigir, use a edição no espelho do ponto.');
      return (await db.query(
        `insert into ponto_registros (colaborador_id, loja_id, data, tipo, hora, foto, foto_mime, registrado_por)
         values ($1, $2, (now() at time zone '${FUSO}')::date, $3, now(), $4, $5, $6) returning id, tipo, hora`,
        [c.id, lojaPonto, tipo, foto.bytes, foto.mime, req.usuarioId])).rows[0];
    });
    res.json(r);
  }));

  // ------------------------------------------------------------ ponto: espelho, foto, edição e justificativa
  app.get('/api/ponto/espelho', exigeLogin, comRecusa(async (req, res) => {
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : null;
    if (!mes) throw new Recusa(400, 'Mês inválido.');
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const c = await colaborador(db, req.query.colaborador);
      await exigirColab(db, c, 'ponto.ver_equipe', 'Seu perfil não pode ver o ponto dos colaboradores.');
      const registros = (await db.query(
        `select r.id, r.data, r.tipo, r.hora, r.origem, r.motivo, r.ativo, r.ajuste_de, r.foto is not null as tem_foto,
                u.nome as registrado_por, r.criado_em
           from ponto_registros r left join usuarios u on u.id = r.registrado_por
          where r.colaborador_id = $1 and to_char(r.data, 'YYYY-MM') = $2
          order by r.data, r.criado_em`, [c.id, mes])).rows;
      const justificativas = (await db.query(
        `select j.data, j.texto, u.nome as criado_por, j.criado_em
           from ponto_justificativas j left join usuarios u on u.id = j.criado_por
          where j.colaborador_id = $1 and to_char(j.data, 'YYYY-MM') = $2`, [c.id, mes])).rows;
      const pode = (await db.query("select pode_colaborador($1, 'ponto.ajustar') as ajustar, pode_colaborador($1, 'ponto.justificar') as justificar", [c.id])).rows[0];
      return { colaborador: { id: c.id, nome: c.nome, cargo: c.cargo, loja_id: c.loja_id }, registros, justificativas, pode };
    }));
  }));

  app.get('/api/ponto/registros/:id/foto', exigeLogin, comRecusa(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new Recusa(404, 'Foto não encontrada.');
    const f = await comoUsuario(req.usuarioId, async (db) => {
      const r = (await db.query('select loja_id, foto, foto_mime from ponto_registros where id = $1', [req.params.id])).rows[0];
      if (!r?.foto) throw new Recusa(404, 'Foto não encontrada.');
      await exigir(db, r.loja_id, 'ponto.ver_equipe', 'Seu perfil não pode ver as fotos do ponto.');
      return r;
    });
    res.set('Content-Type', f.foto_mime || 'image/jpeg');
    res.send(f.foto);
  }));

  // Edita (ou inclui) uma marcação: a anterior fica guardada, inativa
  app.post('/api/ponto/ajustar', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const data = dataValida(b.data);
    if (!data) throw new Recusa(400, 'Data inválida.');
    if (!ORDEM_PONTO.includes(b.tipo)) throw new Recusa(400, 'Marcação inválida.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hora || '')) throw new Recusa(400, 'Informe a hora no formato 08:00.');
    const motivo = texto(b.motivo, 300);
    if (!motivo) throw new Recusa(400, 'Informe o motivo da alteração.');
    const id = await comoUsuario(req.usuarioId, async (db) => {
      const c = await colaborador(db, b.colaborador_id);
      await exigirColab(db, c, 'ponto.ajustar', 'Seu perfil não pode editar o ponto.');
      const anterior = (await db.query(
        'update ponto_registros set ativo = false where colaborador_id = $1 and data = $2 and tipo = $3 and ativo returning id, foto, foto_mime',
        [c.id, data, b.tipo])).rows[0];
      return (await db.query(
        `insert into ponto_registros (colaborador_id, loja_id, data, tipo, hora, foto, foto_mime, origem, ajuste_de, motivo, registrado_por)
         values ($1, $2, $3, $4, ($3::date + $5::time) at time zone '${FUSO}', $6, $7, 'ajuste', $8, $9, $10) returning id`,
        [c.id, c.loja_id, data, b.tipo, b.hora, anterior?.foto ?? null, anterior?.foto_mime ?? null, anterior?.id ?? null, motivo, req.usuarioId])).rows[0].id;
    });
    res.json({ id });
  }));

  app.put('/api/ponto/justificativa', exigeLogin, comRecusa(async (req, res) => {
    const b = req.body || {};
    const data = dataValida(b.data);
    if (!data) throw new Recusa(400, 'Data inválida.');
    const textoJ = texto(b.texto, 500);
    await comoUsuario(req.usuarioId, async (db) => {
      const c = await colaborador(db, b.colaborador_id);
      await exigirColab(db, c, 'ponto.justificar', 'Seu perfil não pode justificar o ponto.');
      if (!textoJ) return db.query('delete from ponto_justificativas where colaborador_id = $1 and data = $2', [c.id, data]);
      return db.query(
        `insert into ponto_justificativas (colaborador_id, data, texto, criado_por) values ($1, $2, $3, $4)
         on conflict (colaborador_id, data) do update set texto = excluded.texto, criado_por = excluded.criado_por, criado_em = now()`,
        [c.id, data, textoJ, req.usuarioId]);
    });
    res.json({ ok: true });
  }));
}
