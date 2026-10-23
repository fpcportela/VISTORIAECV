import express from 'express';
import jwt from 'jsonwebtoken';
import { comoUsuario } from './db.js';

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

app.listen(PORTA, () => console.log(`API do Vistoria ECV rodando em http://localhost:${PORTA}`));
