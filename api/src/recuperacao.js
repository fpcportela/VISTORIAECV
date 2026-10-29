import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { comoUsuario } from './db.js';
import { rodarDump } from './backup.js';

// Importar um arquivo de recuperação (o .dump do backup). Dois modos:
//  - SOBRESCREVER: o banco inteiro volta a ser o do arquivo (pg_restore --clean).
//  - COMBINAR: compara o arquivo com o banco atual, registro por registro (pela chave):
//      novos       -> entram
//      iguais      -> duplicidade (o mesmo registro com os mesmos dados em todos os campos)
//      diferentes  -> o mesmo registro com dados diferentes
//    e, para iguais e diferentes, a pessoa escolhe: SUBSCREVE (fica o do arquivo),
//    MANTÉM o antigo ou APAGA (tira o registro do sistema).
// Antes de mexer, o sistema sempre guarda um backup automático do banco atual.
// Só o master usa. Os comandos rodam como o dono do banco (dentro do contêiner, por padrão):
const CMD_TEXTO = process.env.BACKUP_TEXTO_CMD || 'docker exec -i vistoria-ecv-banco pg_restore --data-only -f -';
const CMD_RESTAURAR = process.env.BACKUP_RESTAURAR_CMD
  || 'docker exec -i vistoria-ecv-banco pg_restore -U vistoria -d vistoria_ecv --clean --if-exists --no-owner --single-transaction';
const CMD_PSQL = process.env.BACKUP_PSQL_CMD || 'docker exec -i vistoria-ecv-banco psql -U vistoria -d vistoria_ecv -v ON_ERROR_STOP=1 -1 -q';
const PASTA_AUTOMATICOS = process.env.BACKUP_DIR || path.resolve('backups-automaticos');

// Tabelas que não entram na comparação (são recriadas sozinhas ou não fazem sentido voltar)
const IGNORAR = new Set(['senha_codigos']);
// Tabelas de histórico com id sequencial: o que não existir igual entra como novo (com id novo)
const HISTORICO = new Set(['auditoria', 'venda_historico']);
const NOMES = {
  clientes: 'Clientes', vendas: 'Vendas', venda_itens: 'Itens das vendas', venda_pagamentos: 'Pagamentos das vendas',
  lancamentos: 'Lançamentos do financeiro', lancamento_baixas: 'Recebimentos e pagamentos', usuarios: 'Usuários',
  colaboradores: 'Colaboradores', ponto_registros: 'Marcações do ponto', servicos: 'Serviços e produtos', lojas: 'Lojas',
  empresas: 'Grupos', veiculos: 'Veículos', contas_financeiras: 'Contas (caixa e bancos)', categorias_financeiras: 'Plano de contas',
  centros_custo: 'Centros de custo', perfis: 'Perfis', whatsapp_contatos: 'Contatos do WhatsApp', whatsapp_conversa: 'Mensagens do WhatsApp',
};
const CAMPOS_RESUMO = ['numero', 'nome', 'razao_social', 'descricao', 'placa', 'email', 'cpf_cnpj', 'cpf', 'data', 'data_venda', 'vencimento', 'valor', 'tipo', 'texto'];
const ACOES = ['subscreve', 'mantem', 'apaga'];

function rodar(comando, entrada) {
  return new Promise((resolve, reject) => {
    const [programa, ...args] = comando.split(/\s+/);
    const proc = spawn(programa, args);
    const saida = [];
    let erro = '';
    proc.stdout.on('data', (d) => saida.push(d));
    proc.stderr.on('data', (d) => { erro += d; });
    proc.on('error', (e) => reject(new Error(`não consegui rodar "${programa}": ${e.message}`)));
    proc.on('close', (codigo) => (codigo === 0 ? resolve({ saida: Buffer.concat(saida), erro }) : reject(new Error(erro.trim() || `saiu com código ${codigo}`))));
    proc.stdin.on('error', () => {});
    if (entrada) proc.stdin.end(entrada); else proc.stdin.end();
  });
}

// Texto do pg_restore -> { tabela: { colunas: [...], linhas: [texto da linha, ...] } }
function lerCopias(texto) {
  const tabelas = {};
  const linhas = texto.split('\n');
  for (let i = 0; i < linhas.length; i++) {
    const m = /^COPY (?:"?public"?\.)?"?([\w]+)"? \((.*)\) FROM stdin;$/.exec(linhas[i]);
    if (!m) continue;
    const t = { colunas: m[2].split(', ').map((c) => c.replace(/^"|"$/g, '')), linhas: [] };
    for (i++; i < linhas.length && linhas[i] !== '\\.'; i++) t.linhas.push(linhas[i]);
    tabelas[m[1]] = t;
  }
  return tabelas;
}

// Campo do COPY -> literal SQL ('\N' é nulo)
function literal(campo) {
  if (campo === '\\N') return 'NULL';
  const texto = campo.replace(/\\(\\|t|n|r|b|f|v|[0-7]{1,3})/g, (_, c) => (
    c === '\\' ? '\\' : c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c === 'b' ? '\b' : c === 'f' ? '\f' : c === 'v' ? '\v' : String.fromCharCode(parseInt(c, 8))));
  return `'${texto.replace(/'/g, "''")}'`;
}
const legivel = (campo) => (campo === '\\N' ? '' : campo.startsWith('\\\\x') ? '[arquivo]' : campo.replace(/\\t/g, ' ').replace(/\\n/g, ' ').slice(0, 80));
const ident = (n) => `"${n.replace(/"/g, '""')}"`;

function resumo(colunas, campos) {
  const v = Object.fromEntries(colunas.map((c, i) => [c, legivel(campos[i])]));
  const escolhidos = CAMPOS_RESUMO.filter((c) => v[c]).slice(0, 4);
  const lista = escolhidos.length ? escolhidos : colunas.filter((c) => c !== 'id' && v[c]).slice(0, 3);
  return lista.map((c) => `${c}: ${v[c]}`).join(' · ');
}

// Análises guardadas por 1 hora (o arquivo fica numa pasta temporária)
const analises = new Map();
setInterval(() => {
  for (const [id, a] of analises) if (Date.now() - a.criado > 3600000) { fs.rm(a.arquivo, { force: true }); analises.delete(id); }
}, 600000).unref();

async function chavesPrimarias() {
  return comoUsuario(null, async (db) => Object.fromEntries((await db.query(
    `select c.relname as tabela, array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum)) as colunas
       from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
      where i.indisprimary and n.nspname = 'public' group by c.relname`)).rows.map((r) => [r.tabela, r.colunas])));
}

async function guardarAutomatico() {
  await fs.mkdir(PASTA_AUTOMATICOS, { recursive: true });
  const nome = `antes-de-importar_${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
  await fs.writeFile(path.join(PASTA_AUTOMATICOS, nome), await rodarDump());
  return nome;
}

function comparar(arquivo, atual, pks) {
  const resultado = [];
  for (const [tabela, b] of Object.entries(arquivo)) {
    if (IGNORAR.has(tabela)) continue;
    const a = atual[tabela];
    if (!a) { resultado.push({ tabela, nome: NOMES[tabela] || tabela, ausente: true, novos: [], iguais: [], diferentes: [], colunas: b.colunas }); continue; }
    // colunas na ordem do banco atual (o arquivo pode ser de uma versão com outras colunas)
    const comuns = b.colunas.filter((c) => a.colunas.includes(c));
    const idxB = comuns.map((c) => b.colunas.indexOf(c));
    const idxA = comuns.map((c) => a.colunas.indexOf(c));
    const historico = HISTORICO.has(tabela);
    const chave = historico ? comuns.filter((c) => c !== 'id') : (pks[tabela] || comuns).filter((c) => comuns.includes(c));
    const kB = chave.map((c) => comuns.indexOf(c));
    const linhasA = new Map();
    for (const l of a.linhas) {
      const campos = l.split('\t'); const v = idxA.map((i) => campos[i]);
      linhasA.set(kB.map((i) => v[i]).join('\u0001'), v);
    }
    const t = { tabela, nome: NOMES[tabela] || tabela, colunas: comuns, chave, historico, novos: [], iguais: [], diferentes: [] };
    for (const l of b.linhas) {
      const campos = l.split('\t'); const v = idxB.map((i) => campos[i]);
      const k = kB.map((i) => v[i]).join('\u0001');
      const atualV = linhasA.get(k);
      if (!atualV) t.novos.push(v);
      else if (atualV.join('\t') === v.join('\t')) { if (!historico) t.iguais.push({ k, v }); }
      else t.diferentes.push({ k, v, atual: atualV });
    }
    resultado.push(t);
  }
  return resultado;
}

export function rotasRecuperacao(app, { exigeLogin, rota }) {
  const exigirMaster = async (req, res) => {
    const ok = await comoUsuario(req.usuarioId, async (db) => (await db.query('select eh_admin_rede() as ok')).rows[0].ok);
    if (!ok) res.status(403).json({ erro: 'Só o usuário master pode importar um arquivo de recuperação.' });
    return ok;
  };

  // 1) Recebe o arquivo e mostra o que muda (nada é gravado ainda)
  app.post('/api/backup/importar/analisar', exigeLogin, express.raw({ type: () => true, limit: '1gb' }), rota(async (req, res) => {
    if (!(await exigirMaster(req, res))) return;
    const dump = req.body;
    if (!Buffer.isBuffer(dump) || dump.length < 5 || dump.subarray(0, 5).toString() !== 'PGDMP') {
      return res.status(400).json({ erro: 'Este arquivo não é um backup do sistema (.dump).' });
    }
    let arquivo, atual;
    try {
      arquivo = lerCopias((await rodar(CMD_TEXTO, dump)).saida.toString('utf8'));
      atual = lerCopias((await rodar(CMD_TEXTO, await rodarDump())).saida.toString('utf8'));
    } catch (e) {
      console.error('Importar backup:', e.message);
      return res.status(500).json({ erro: 'Não foi possível ler o arquivo. Confira se o banco (Docker) está ligado e se o arquivo é um backup deste sistema.' });
    }
    if (!arquivo.lojas || !arquivo.usuarios) return res.status(400).json({ erro: 'Este arquivo não parece ser um backup do Vistoria ECV.' });
    const id = crypto.randomUUID();
    const caminho = path.join(os.tmpdir(), `vistoria-importar-${id}.dump`);
    await fs.writeFile(caminho, dump);
    const tabelas = comparar(arquivo, atual, await chavesPrimarias());
    analises.set(id, { arquivo: caminho, tabelas, criado: Date.now() });
    const LIMITE = 300;
    res.json({
      id,
      tamanho: dump.length,
      tabelas: tabelas.filter((t) => t.ausente || t.novos.length || t.iguais.length || t.diferentes.length).map((t) => ({
        tabela: t.tabela, nome: t.nome, ausente: Boolean(t.ausente), historico: Boolean(t.historico),
        novos: t.novos.length, iguais: t.iguais.length, diferentes: t.diferentes.length,
        registros: [
          ...t.diferentes.slice(0, LIMITE).map((r) => ({
            chave: r.k, tipo: 'diferente', resumo: resumo(t.colunas, r.v),
            campos: t.colunas.map((c, i) => (r.v[i] !== r.atual[i] ? { coluna: c, atual: legivel(r.atual[i]), arquivo: legivel(r.v[i]) } : null)).filter(Boolean),
          })),
          ...t.iguais.slice(0, LIMITE).map((r) => ({ chave: r.k, tipo: 'igual', resumo: resumo(t.colunas, r.v) })),
        ],
      })).sort((a, b) => (b.diferentes - a.diferentes) || (b.novos - a.novos)),
    });
  }));

  // 2) Aplica: sobrescrever tudo, ou combinar com as ações escolhidas
  app.post('/api/backup/importar/aplicar', exigeLogin, rota(async (req, res) => {
    if (!(await exigirMaster(req, res))) return;
    const b = req.body || {};
    const a = analises.get(b.id);
    if (!a) return res.status(400).json({ erro: 'A análise venceu. Escolha o arquivo de novo.' });
    let automatico;
    try { automatico = await guardarAutomatico(); } catch (e) {
      console.error('Backup automático:', e.message);
      return res.status(500).json({ erro: 'Não foi possível guardar o backup automático antes de importar. Nada foi mudado.' });
    }

    if (b.modo === 'sobrescrever') {
      if (b.confirmacao !== 'SOBRESCREVER') return res.status(400).json({ erro: 'Digite SOBRESCREVER para confirmar.' });
      try { await rodar(CMD_RESTAURAR, await fs.readFile(a.arquivo)); } catch (e) {
        console.error('Restaurar:', e.message);
        return res.status(500).json({ erro: `Não foi possível restaurar. O banco ficou como estava (backup automático: ${automatico}).` });
      }
      analises.delete(b.id); fs.rm(a.arquivo, { force: true });
      return res.json({ ok: true, automatico, resumo: 'O banco voltou a ser o do arquivo.' });
    }

    // combinar
    const acoes = b.acoes || {};
    const sql = ['set session_replication_role = replica;'];
    const apagar = [];
    const conta = { inseridos: 0, atualizados: 0, apagados: 0, mantidos: 0 };
    for (const t of a.tabelas) {
      if (t.ausente) continue;
      const cols = t.historico ? t.colunas.filter((c) => c !== 'id') : t.colunas;
      const idx = cols.map((c) => t.colunas.indexOf(c));
      const lista = cols.map(ident).join(', ');
      for (const v of t.novos) {
        sql.push(`insert into ${ident(t.tabela)} (${lista}) values (${idx.map((i) => literal(v[i])).join(', ')}) on conflict do nothing;`);
        conta.inseridos++;
      }
      const escolha = acoes[t.tabela] || {};
      const onde = (k) => t.chave.map((c, i) => `${ident(c)} = ${literal(k.split('\u0001')[i])}`).join(' and ');
      for (const [grupo, tipo] of [[t.iguais, 'iguais'], [t.diferentes, 'diferentes']]) {
        for (const r of grupo) {
          let acao = escolha.registros?.[r.k] || escolha[tipo] || 'mantem';
          if (!ACOES.includes(acao)) acao = 'mantem';
          // numeração (contadores) nunca volta para trás: fica o maior
          if (t.tabela === 'contadores' && tipo === 'diferentes') {
            const iu = t.colunas.indexOf('ultimo');
            sql.push(`update contadores set ultimo = greatest(ultimo, ${literal(r.v[iu])}) where ${onde(r.k)};`); conta.atualizados++;
            continue;
          }
          if (acao === 'subscreve') {
            sql.push(`update ${ident(t.tabela)} set (${lista}) = row(${idx.map((i) => literal(r.v[i])).join(', ')}) where ${onde(r.k)};`);
            conta.atualizados++;
          } else if (acao === 'apaga') {
            apagar.push(`do $$ begin delete from ${ident(t.tabela)} where ${onde(r.k)}; exception when others then raise notice 'NAO_APAGOU ${t.tabela}: %', sqlerrm; end $$;`);
            conta.apagados++;
          } else conta.mantidos++;
        }
      }
    }
    // sequências dos históricos continuam do maior id
    sql.push(`do $$ declare r record; begin
      for r in select c.relname as t, a.attname as col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) as s
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
                where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and pg_get_serial_sequence(quote_ident(c.relname), a.attname) is not null
      loop execute format('select setval(%L, coalesce((select max(%I) from %I), 0) + 1, false)', r.s, r.col, r.t); end loop; end $$;`);
    sql.push('set session_replication_role = origin;', ...apagar);
    let saida;
    try { saida = await rodar(CMD_PSQL, Buffer.from(sql.join('\n'), 'utf8')); } catch (e) {
      console.error('Combinar:', e.message);
      return res.status(500).json({ erro: `Não foi possível combinar. Nada foi mudado (backup automático: ${automatico}).` });
    }
    const naoApagados = (saida.erro.match(/NAO_APAGOU [^\n]+/g) || []).map((l) => l.replace('NAO_APAGOU ', ''));
    conta.apagados -= naoApagados.length;
    analises.delete(b.id); fs.rm(a.arquivo, { force: true });
    res.json({ ok: true, automatico, ...conta, nao_apagados: naoApagados.slice(0, 50) });
  }));
}
