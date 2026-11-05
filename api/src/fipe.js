import { comoUsuario } from './db.js';
import { Recusa, criarComRecusa } from './comum.js';

// Marcas e modelos de veículos vendidos no Brasil, pela tabela FIPE (API pública
// parallelum.com.br). O resultado fica guardado no banco por 30 dias; sem internet,
// usa o que já estiver guardado.

const FIPE_URL = process.env.FIPE_URL || 'https://parallelum.com.br/fipe/api/v1';
const SEGMENTO = { carro: 'carros', moto: 'motos', caminhao: 'caminhoes', outro: 'carros' };
const DIAS = 30;

async function buscarFipe(caminho) {
  const r = await fetch(`${FIPE_URL}${caminho}`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`FIPE respondeu ${r.status}`);
  return r.json();
}

const ordenarPorNome = (lista) => lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

export function rotasFipe(app, { exigeLogin, rota }) {
  const comRecusa = criarComRecusa(rota);

  app.get('/api/fipe/marcas', exigeLogin, comRecusa(async (req, res) => {
    const tipo = SEGMENTO[req.query.tipo] ? req.query.tipo : 'carro';
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const guardadas = (await db.query(
        `select codigo, nome, atualizado_em > now() - interval '${DIAS} days' as recente from fipe_marcas where tipo = $1`, [tipo])).rows;
      if (guardadas.length && guardadas.every((m) => m.recente)) return ordenarPorNome(guardadas.map(({ codigo, nome }) => ({ codigo, nome })));
      try {
        const lista = (await buscarFipe(`/${SEGMENTO[tipo]}/marcas`)).map((m) => ({ codigo: String(m.codigo), nome: String(m.nome) }));
        for (const m of lista) {
          await db.query(
            `insert into fipe_marcas (tipo, codigo, nome) values ($1, $2, $3)
             on conflict (tipo, codigo) do update set nome = excluded.nome, atualizado_em = now()`, [tipo, m.codigo, m.nome]);
        }
        return ordenarPorNome(lista);
      } catch (erro) {
        if (guardadas.length) return ordenarPorNome(guardadas.map(({ codigo, nome }) => ({ codigo, nome })));
        console.error('FIPE marcas:', erro.message);
        throw new Recusa(503, 'Não foi possível carregar a lista de marcas agora (sem internet?). Digite a marca.');
      }
    }));
  }));

  app.get('/api/fipe/modelos', exigeLogin, comRecusa(async (req, res) => {
    const tipo = SEGMENTO[req.query.tipo] ? req.query.tipo : 'carro';
    const marca = /^\d{1,6}$/.test(req.query.marca || '') ? req.query.marca : null;
    if (!marca) throw new Recusa(400, 'Escolha a marca.');
    res.json(await comoUsuario(req.usuarioId, async (db) => {
      const guardados = (await db.query(
        `select codigo, nome, atualizado_em > now() - interval '${DIAS} days' as recente
           from fipe_modelos where tipo = $1 and marca_codigo = $2`, [tipo, marca])).rows;
      if (guardados.length && guardados.every((m) => m.recente)) return ordenarPorNome(guardados.map(({ codigo, nome }) => ({ codigo, nome })));
      try {
        const lista = ((await buscarFipe(`/${SEGMENTO[tipo]}/marcas/${marca}/modelos`)).modelos || [])
          .map((m) => ({ codigo: String(m.codigo), nome: String(m.nome) }));
        for (const m of lista) {
          await db.query(
            `insert into fipe_modelos (tipo, marca_codigo, codigo, nome) values ($1, $2, $3, $4)
             on conflict (tipo, marca_codigo, codigo) do update set nome = excluded.nome, atualizado_em = now()`, [tipo, marca, m.codigo, m.nome]);
        }
        return ordenarPorNome(lista);
      } catch (erro) {
        if (guardados.length) return ordenarPorNome(guardados.map(({ codigo, nome }) => ({ codigo, nome })));
        console.error('FIPE modelos:', erro.message);
        throw new Recusa(503, 'Não foi possível carregar os modelos agora (sem internet?). Digite o modelo.');
      }
    }));
  }));
}
