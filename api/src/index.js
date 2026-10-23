import express from 'express';
import jwt from 'jsonwebtoken';
import { comoUsuario } from './db.js';
import { CACHE_DIAS, ErroPlaca, consultarApiPlacas, mapearVeiculo, normalizarPlaca } from './placas.js';

const app = express();
app.use(express.json());

const SEGREDO = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';
const PORTA = Number(process.env.PORT || 3001);
const UUID = /^[0-9a-f-]{36}$/i;

const rota = (fn) => (req, res) =>
  fn(req, res).catch((erro) => {
    console.error(erro);
    res.status(500).json({ erro: 'Erro interno. Veja o terminal da API.' });
  });

function exigeLogin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.usuarioId = jwt.verify(token, SEGREDO).sub;
    next();
  } catch {
    res.status(401).json({ erro: 'Faça login novamente.' });
  }
}

app.get('/api/saude', (req, res) => res.json({ ok: true }));

app.post('/api/login', rota(async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  const usuario = await comoUsuario(null, async (db) =>
    (await db.query('select * from app_login($1, $2)', [email, senha])).rows[0]);
  if (!usuario) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  const token = jwt.sign({ sub: usuario.id }, SEGREDO, { expiresIn: '12h' });
  res.json({ token });
}));

app.get('/api/eu', exigeLogin, rota(async (req, res) => {
  const dados = await comoUsuario(req.usuarioId, async (db) => {
    const usuario = (await db.query('select id, nome, email, admin_rede from usuarios where id = $1', [req.usuarioId])).rows[0];
    const lojas = (await db.query('select * from app_minhas_lojas()')).rows;
    const cor = (await db.query('select app_cor_tema() as cor')).rows[0].cor;
    return { usuario, lojas, cor };
  });
  res.json(dados);
}));

app.put('/api/tema', exigeLogin, rota(async (req, res) => {
  const cor = String(req.body?.cor || '');
  if (!/^#[0-9a-f]{6}$/i.test(cor)) return res.status(400).json({ erro: 'Cor inválida.' });
  await comoUsuario(req.usuarioId, (db) => db.query('select app_salvar_cor_tema($1)', [cor]));
  res.json({ cor });
}));

// Números da tela inicial. ?loja=<id> filtra uma loja; sem loja = todas as liberadas
app.get('/api/inicio', exigeLogin, rota(async (req, res) => {
  const loja = UUID.test(req.query.loja || '') ? req.query.loja : null;
  const dados = await comoUsuario(req.usuarioId, async (db) => {
    const contas = (await db.query(
      `select tipo,
              coalesce(sum(vencidos), 0)     as vencidos,
              coalesce(sum(vencem_hoje), 0)  as vencem_hoje,
              coalesce(sum(restante_mes), 0) as restante_mes
         from resumo_contas
        where $1::uuid is null or loja_id = $1
        group by tipo`, [loja])).rows;
    const vistorias = (await db.query(
      `select v.tipo, count(vi.id)::int as total
         from unnest(enum_range(null::tipo_veiculo)) as v(tipo)
         left join veiculos ve on ve.tipo = v.tipo
         left join vistorias vi on vi.veiculo_id = ve.id
              and vi.status <> 'cancelada'
              and coalesce(vi.agendada_para, vi.criado_em)::date = current_date
              and ($1::uuid is null or vi.loja_id = $1)
        group by v.tipo`, [loja])).rows;
    const royalties = (await db.query(
      `select coalesce(sum(valor_total), 0) as total
         from apuracoes_royalty
        where competencia = date_trunc('month', current_date)::date
          and ($1::uuid is null or loja_id = $1)`, [loja])).rows[0].total;

    const vazio = { vencidos: 0, vencem_hoje: 0, restante_mes: 0 };
    const porTipo = (t) => contas.find((c) => c.tipo === t) || vazio;
    const qtd = (t) => vistorias.find((v) => v.tipo === t)?.total || 0;
    return {
      receber: porTipo('receber'),
      pagar: porTipo('pagar'),
      vistoriasHoje: { carros: qtd('carro'), motos: qtd('moto'), caminhoes: qtd('caminhao') },
      royaltiesMes: royalties,
    };
  });
  res.json(dados);
}));

// Consulta de placa: usa o que já está no banco (até CACHE_DIAS dias) e só
// chama a API Placas, que é paga, quando não tem ou quando pedem para atualizar.
app.get('/api/placa/:placa', exigeLogin, rota(async (req, res) => {
  const placa = normalizarPlaca(req.params.placa);
  if (!placa) return res.status(400).json({ erro: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.' });
  const atualizar = req.query.atualizar === '1';

  const resultado = await comoUsuario(req.usuarioId, async (db) => {
    const loja = UUID.test(req.query.loja || '')
      ? req.query.loja
      : (await db.query('select id from app_minhas_lojas() limit 1')).rows[0]?.id;
    if (!loja) return { status: 403, erro: 'Você não tem acesso a nenhuma loja.' };
    const pode = (await db.query("select pode($1, 'placa.consultar') as ok", [loja])).rows[0].ok;
    if (!pode) return { status: 403, erro: 'Seu perfil não tem permissão para consultar placas.' };

    const salvo = (await db.query(
      `select *, consultado_em > now() - make_interval(days => $2) as recente
         from veiculos where placa = $1`, [placa, CACHE_DIAS])).rows[0];

    if (salvo?.recente && !atualizar) {
      await db.query(
        `insert into consultas_placa (loja_id, usuario_id, placa, origem, sucesso, veiculo_id)
         values ($1, $2, $3, 'cache', true, $4)`, [loja, req.usuarioId, placa, salvo.id]);
      return { veiculo: salvo, origem: 'cache' };
    }

    let resposta;
    try {
      resposta = await consultarApiPlacas(placa);
    } catch (erro) {
      if (!(erro instanceof ErroPlaca)) throw erro;
      await db.query(
        `insert into consultas_placa (loja_id, usuario_id, placa, origem, sucesso, resposta)
         values ($1, $2, $3, 'api_placas', false, $4)`,
        [loja, req.usuarioId, placa, { erro: erro.message, status: erro.status, request_id: erro.requestId }]);
      // Sem a API, devolve o último dado guardado, se houver
      if (salvo && erro.status !== 404) return { veiculo: salvo, origem: 'cache', aviso: erro.message };
      return { status: erro.status === 404 ? 404 : 502, erro: erro.message };
    }

    const v = mapearVeiculo(resposta);
    const veiculo = (await db.query(
      `insert into veiculos (placa, tipo, marca, modelo, versao, ano_fabricacao, ano_modelo, cor, combustivel,
                             chassi, renavam, motor, municipio, uf, dados_consulta, consultado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
       on conflict (placa) do update set
         tipo = excluded.tipo, marca = excluded.marca, modelo = excluded.modelo, versao = excluded.versao,
         ano_fabricacao = excluded.ano_fabricacao, ano_modelo = excluded.ano_modelo, cor = excluded.cor,
         combustivel = excluded.combustivel,
         chassi = coalesce(excluded.chassi, veiculos.chassi), renavam = coalesce(excluded.renavam, veiculos.renavam),
         motor = coalesce(excluded.motor, veiculos.motor), municipio = excluded.municipio, uf = excluded.uf,
         dados_consulta = excluded.dados_consulta, consultado_em = now()
       returning *`,
      [placa, v.tipo, v.marca, v.modelo, v.versao, v.ano_fabricacao, v.ano_modelo, v.cor, v.combustivel,
       v.chassi, v.renavam, v.motor, v.municipio, v.uf, resposta])).rows[0];
    await db.query(
      `insert into consultas_placa (loja_id, usuario_id, placa, origem, sucesso, resposta, veiculo_id)
       values ($1, $2, $3, 'api_placas', true, $4, $5)`, [loja, req.usuarioId, placa, resposta, veiculo.id]);
    return { veiculo, origem: 'api_placas' };
  });

  if (resultado.erro) return res.status(resultado.status).json({ erro: resultado.erro });
  const { dados_consulta: _bruto, recente: _r, ...veiculo } = resultado.veiculo;
  res.json({ veiculo, origem: resultado.origem, aviso: resultado.aviso });
}));

app.listen(PORTA, () => console.log(`API do Vistoria ECV rodando em http://localhost:${PORTA}`));
