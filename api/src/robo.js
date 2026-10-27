import Anthropic from '@anthropic-ai/sdk';
import { comoUsuario } from './db.js';
import { cnpjValido, cpfValido } from './documentos.js';
import { normalizarPlaca } from './placas.js';
import { enderecoLoja, linkWaze, rotuloHorario, textoHorarios } from './agendaTexto.js';
import { responderConfirmacao } from './confirmacaoAgenda.js';

// Robô do WhatsApp: segue o fluxo de atendimento do grupo, em blocos (mensagem, menu com
// caminhos, pergunta, conversa com IA, abrir venda, passar para atendente, encerrar). Junta nome,
// documento, veículo, serviço e horário e abre uma venda FUTURO. A IA (se o master liberou) usa o
// prompt da loja e a base de conhecimento (textos e PDFs) para responder.
// A IA usa a API da Anthropic (Claude). A chave fica só no servidor (api/.env):
//   ANTHROPIC_API_KEY=...
//   ANTHROPIC_MODELO=claude-opus-5-5   (opcional; claude-haiku-5-5 sai mais barato)

export const CAMPOS = {
  nome: 'Nome',
  cpf_cnpj: 'CPF ou CNPJ',
  placa: 'Placa',
  tipo_veiculo: 'Tipo de veículo',
  servico: 'Serviço',
  data: 'Data desejada',
  horario: 'Horário da vistoria (agenda)',
  email: 'E-mail',
  livre: 'Pergunta livre',
};

export const ROBO_PADRAO = {
  ativo: false,
  saudacao: 'Olá! Sou o assistente virtual. Vou pegar alguns dados para agilizar o seu atendimento. Se preferir falar com uma pessoa, escreva ATENDENTE.',
  etapas: [
    { campo: 'nome', pergunta: 'Qual é o seu nome completo?', obrigatorio: true },
    { campo: 'cpf_cnpj', pergunta: 'Qual é o seu CPF ou CNPJ?', obrigatorio: false },
    { campo: 'placa', pergunta: 'Qual é a placa do veículo?', obrigatorio: true },
    { campo: 'tipo_veiculo', pergunta: 'Qual é o tipo do veículo?', obrigatorio: true },
    { campo: 'servico', pergunta: 'Qual serviço você precisa?', obrigatorio: true },
    { campo: 'horario', pergunta: 'Escolha o melhor horário para a vistoria:', obrigatorio: true },
  ],
  mensagem_final: 'Obrigado, {nome}! Registramos o seu pedido nº {numero}. Em instantes um atendente confirma com você.',
  ia_ativa: false,
  ia_instrucoes: '',
  fluxo: null,
};

// ------------------------------------------------------------------ fluxo em blocos
export const BLOCOS = {
  mensagem: 'Mensagem',
  menu: 'Menu de opções',
  pergunta: 'Pergunta',
  ia: 'Conversa com IA',
  venda: 'Abrir venda',
  atendente: 'Passar para atendente',
  fim: 'Encerrar',
};

// Fluxo do robô; sem fluxo salvo, monta o antigo: as perguntas em ordem (ou a IA) e abre a venda
export function fluxoDe(robo) {
  if (Array.isArray(robo?.fluxo) && robo.fluxo.length) return robo.fluxo;
  const etapas = (robo?.etapas || []).filter((e) => CAMPOS[e.campo]);
  const venda = { id: 'venda', tipo: 'venda', nome: 'Abrir venda', texto: robo?.mensagem_final || '' };
  if (robo?.ia_ativa) {
    return [{ id: 'ia', tipo: 'ia', nome: 'Conversa com IA', texto: '', campos: etapas.map((e) => ({ campo: e.campo, obrigatorio: e.obrigatorio })) }, venda];
  }
  return [...etapas.map((e, i) => ({ id: `p${i + 1}`, tipo: 'pergunta', nome: CAMPOS[e.campo], texto: e.pergunta, campo: e.campo, obrigatorio: e.obrigatorio })), venda];
}

// Confere o fluxo vindo da tela; devolve { fluxo } ou { erro }
export function normalizarFluxo(lista) {
  if (!Array.isArray(lista) || !lista.length) return { erro: 'O fluxo precisa de pelo menos um bloco.' };
  if (lista.length > 60) return { erro: 'O fluxo pode ter até 60 blocos.' };
  const txt = (v, n) => String(v ?? '').trim().slice(0, n);
  const ids = new Set();
  const fluxo = lista.map((b, i) => {
    let id = txt(b?.id, 40).replace(/[^\w-]/g, '') || `b${i + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    return { ...b, id };
  }).map((b, i) => {
    const tipo = BLOCOS[b.tipo] ? b.tipo : 'mensagem';
    const destino = (v) => (ids.has(txt(v, 40)) ? txt(v, 40) : '');
    const r = { id: b.id, tipo, nome: txt(b.nome, 60) || `${BLOCOS[tipo]} ${i + 1}`, texto: txt(b.texto, 2000), ir: destino(b.ir) };
    if (tipo === 'pergunta') { r.campo = CAMPOS[b.campo] ? b.campo : 'livre'; r.obrigatorio = Boolean(b.obrigatorio); }
    if (tipo === 'menu') {
      r.opcoes = (Array.isArray(b.opcoes) ? b.opcoes : []).slice(0, 12)
        .map((o) => ({ rotulo: txt(o?.rotulo, 100), ir: destino(o?.ir) })).filter((o) => o.rotulo);
    }
    if (tipo === 'ia') {
      const vistos = new Set();
      r.campos = (Array.isArray(b.campos) ? b.campos : []).filter((c) => CAMPOS[c?.campo] && c.campo !== 'livre' && !vistos.has(c.campo) && vistos.add(c.campo))
        .map((c) => ({ campo: c.campo, obrigatorio: Boolean(c.obrigatorio) }));
    }
    return r;
  });
  for (const [i, b] of fluxo.entries()) {
    const nome = `o bloco ${i + 1} (${b.nome})`;
    if (['mensagem', 'menu', 'pergunta'].includes(b.tipo) && !b.texto) return { erro: `Escreva o texto d${nome}.` };
    if (b.tipo === 'menu' && !b.opcoes.length) return { erro: `Coloque pelo menos uma opção n${nome}.` };
  }
  return { fluxo };
}

const TIPOS = [['carro', 'CARRO'], ['moto', 'MOTO'], ['caminhao', 'CAMINHÃO'], ['outro', 'OUTRO']];
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const PULAR = ['PULAR', 'NAO', 'NAO SEI', 'NAO TENHO', '-', 'N'];
const QUER_ATENDENTE = /\b(ATENDENTE|HUMANO|PESSOA)\b/;

// Confere a resposta de um campo. Devolve { valor } ou { erro }.
export function conferir(campo, resposta, servicos) {
  const t = String(resposta ?? '').trim();
  const s = semAcento(t);
  switch (campo) {
    case 'nome': {
      const n = s.replace(/[^A-Z' ]/g, ' ').replace(/\s+/g, ' ').trim();
      return n.length >= 3 ? { valor: n.slice(0, 120) } : { erro: 'Não entendi o nome. Pode escrever de novo?' };
    }
    case 'cpf_cnpj': {
      const d = t.replace(/\D/g, '');
      if (d.length === 11 && cpfValido(d)) return { valor: d };
      if (d.length === 14 && cnpjValido(d)) return { valor: d };
      return { erro: 'Esse CPF/CNPJ não parece certo. Confira os números e mande de novo.' };
    }
    case 'placa': {
      const p = normalizarPlaca(t);
      return p ? { valor: p } : { erro: 'Não reconheci a placa. Mande no formato ABC1D23 ou ABC1234.' };
    }
    case 'tipo_veiculo': {
      const n = Number(s);
      const achado = TIPOS[n - 1] || TIPOS.find(([v, rot]) => s.includes(semAcento(rot)) || s.includes(v.toUpperCase()));
      return achado ? { valor: achado[0] } : { erro: 'Responda com o número da opção.' };
    }
    case 'servico': {
      const n = Number(s);
      const achado = (Number.isInteger(n) && servicos[n - 1]) || servicos.find((x) => semAcento(x.nome) === s)
        || servicos.find((x) => s.length >= 3 && semAcento(x.nome).includes(s));
      return achado ? { valor: achado.id, nome: achado.nome } : { erro: 'Responda com o número do serviço da lista.' };
    }
    case 'data': {
      let iso = null;
      const hoje = hojeSP();
      if (s === 'HOJE') iso = hoje;
      else if (s === 'AMANHA') { const d = new Date(`${hoje}T12:00:00`); d.setDate(d.getDate() + 1); iso = d.toISOString().slice(0, 10); }
      else {
        const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
        if (m) {
          const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : hoje.slice(0, 4);
          const d = new Date(`${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T12:00:00`);
          if (!Number.isNaN(d.getTime()) && d.getDate() === Number(m[1])) iso = d.toISOString().slice(0, 10);
        }
      }
      if (!iso) return { erro: 'Mande a data no formato DD/MM/AAAA (ou HOJE / AMANHÃ).' };
      if (iso < hoje) return { erro: 'Essa data já passou. Qual dia você quer?' };
      return { valor: iso };
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? { valor: t.toLowerCase().slice(0, 120) } : { erro: 'Esse e-mail não parece certo. Pode mandar de novo?' };
    default:
      return t ? { valor: t.slice(0, 500) } : { erro: 'Pode responder, por favor?' };
  }
}

// Pergunta da etapa, com as opções quando for escolha
function pergunta(etapa, servicos) {
  let p = etapa.pergunta || CAMPOS[etapa.campo] || '';
  if (etapa.campo === 'tipo_veiculo') p += `\n${TIPOS.map(([, rot], i) => `${i + 1} - ${rot}`).join('\n')}`;
  if (etapa.campo === 'servico') p += `\n${servicos.map((s, i) => `${i + 1} - ${s.nome}`).join('\n')}`;
  if (!etapa.obrigatorio) p += '\n(se não quiser informar, responda PULAR)';
  return p;
}

const formatar = (modelo, dados) => String(modelo || '')
  .replace(/\{nome\}/g, primeiroNome(dados.nome))
  .replace(/\{numero\}/g, dados.numero ?? '')
  .replace(/\{placa\}/g, dados.placa || '')
  .replace(/\{horario\}/g, dados.horario ? rotuloHorario(dados.horario) : '');

// ------------------------------------------------------------------ agenda
const POR_VEZ = 6;
const localSP = (ts) => new Date(ts).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 16).replace(' ', 'T');

// Próximos horários livres (a partir da data pedida, ou depois do último já oferecido)
async function horariosLivres(empresa, loja, { de, depois, limite = POR_VEZ }) {
  const dia = de || hojeSP();
  const r = await comoUsuario(null, (db) => db.query('select inicio from app_agenda_livres_unidade($1, $2, $3::date, $4)', [empresa, loja || null, dia, 200]));
  return r.rows.map((x) => new Date(x.inicio).toISOString()).filter((t) => !depois || t > depois).slice(0, limite);
}

const listaHorarios = (opcoes) => opcoes.map((t, i) => `${i + 1} - ${rotuloHorario(t)}`).join('\n');

// Reserva o horário na agenda; devolve o id do agendamento ou null se alguém pegou antes
async function reservar(ch, horario, dados, contato) {
  const r = await comoUsuario(null, (db) => db.query('select app_agenda_robo($1, $2, $3) as id', [ch.id, horario,
    JSON.stringify({ loja_id: dados.loja_id, nome: dados.nome, telefone: contato.telefone, placa: dados.placa, servico_id: dados.servico_id, observacao: 'Agendado pelo robô do WhatsApp.' })]));
  return r.rows[0].id;
}

// Dados prontos para a venda (o que não é campo fixo vai nas observações)
function paraVenda(dados, contato, nacional) {
  const extras = (dados.extras || []).map((e) => `${e.pergunta} ${e.resposta}`);
  if (dados.nome) extras.unshift(`Nome informado: ${dados.nome}`);
  if (dados.servico_nome && !dados.servico_id) extras.push(`Serviço pedido: ${dados.servico_nome}`);
  if (dados.observacoes) extras.push(dados.observacoes);
  return {
    loja_id: dados.loja_id, nome: dados.nome, cpf_cnpj: dados.cpf_cnpj, email: dados.email, placa: dados.placa, tipo_veiculo: dados.tipo_veiculo,
    servico_id: dados.servico_id, data: dados.data, whatsapp: nacional(contato.telefone),
    observacoes: ['Pedido feito pelo WhatsApp (robô).', ...extras].join('\n'),
  };
}

// ------------------------------------------------------------------ IA (Claude)
const iaConfigurada = () => Boolean(process.env.ANTHROPIC_API_KEY);
let cliente = null;
const anthropic = () => (cliente ||= new Anthropic());

const anulavel = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resposta', 'dados', 'pronto', 'chamar_atendente'],
  properties: {
    resposta: { type: 'string', description: 'Mensagem para mandar ao cliente agora, em português do Brasil.' },
    dados: {
      type: 'object',
      additionalProperties: false,
      required: ['nome', 'cpf_cnpj', 'placa', 'tipo_veiculo', 'servico', 'data', 'horario', 'email', 'observacoes'],
      properties: {
        nome: anulavel({ type: 'string' }),
        cpf_cnpj: anulavel({ type: 'string' }),
        placa: anulavel({ type: 'string' }),
        tipo_veiculo: anulavel({ type: 'string', enum: ['carro', 'moto', 'caminhao', 'outro'] }),
        servico: anulavel({ type: 'string', description: 'Nome exato do serviço, igual à lista.' }),
        data: anulavel({ type: 'string', description: 'DD/MM/AAAA' }),
        horario: anulavel({ type: 'string', description: 'Horário escolhido pelo cliente, exatamente como na lista de horários livres (AAAA-MM-DDTHH:MM).' }),
        email: anulavel({ type: 'string' }),
        observacoes: anulavel({ type: 'string', description: 'Outras informações úteis para a loja.' }),
      },
    },
    pronto: { type: 'boolean', description: 'true quando todos os dados obrigatórios foram informados e confirmados.' },
    chamar_atendente: { type: 'boolean', description: 'true se o cliente pediu uma pessoa ou se o assunto não é sobre agendar/comprar um serviço.' },
  },
};

// Base de conhecimento do grupo (textos e PDFs), guardada um minuto para não ler a cada mensagem
const conhecimentos = new Map();
async function baseDeConhecimento(empresa) {
  const c = conhecimentos.get(empresa);
  if (c && Date.now() - c.em < 60000) return c.docs;
  const docs = (await comoUsuario(null, (db) => db.query('select * from app_robo_conhecimento($1)', [empresa]))).rows;
  conhecimentos.set(empresa, { em: Date.now(), docs });
  return docs;
}
export const esquecerConhecimento = (empresa) => conhecimentos.delete(empresa);

// Bloco "Conversa com IA": campos = dados a coletar (vazio = só tira dúvidas e segue o fluxo)
async function perguntarIA(ctx, dados, livres, bloco) {
  const campos = bloco.campos || [];
  const lista = campos.map((e) => `- ${CAMPOS[e.campo]}${e.obrigatorio ? ' (obrigatório)' : ' (opcional)'}`).join('\n');
  // parte fixa (vai para o cache): regras, serviços, prompt da loja e o objetivo do bloco
  const system = [
    'Você é o atendente virtual de uma empresa de vistoria veicular (ECV) no WhatsApp.',
    'Escreva mensagens curtas e simpáticas, sem markdown. Não invente preços, horários nem informações:',
    'use só o que está aqui, nas instruções da loja e nos documentos da base de conhecimento. Se não souber, diga que um atendente confirma.',
    campos.length
      ? `\nObjetivo: coletar os dados abaixo, uma ou duas perguntas por vez, para a loja abrir o pedido.\nDados para coletar:\n${lista}`
      : '\nObjetivo: tirar as dúvidas do cliente. Marque "pronto" quando ele quiser seguir em frente (agendar, contratar) ou quando as dúvidas acabarem.',
    `\nServiços oferecidos:\n${ctx.servicos.map((x) => `- ${x.nome}`).join('\n') || '- (nenhum cadastrado)'}`,
    ctx.robo.ia_instrucoes ? `\nInstruções da loja (prompt):\n${ctx.robo.ia_instrucoes}` : '',
    '\nEm "dados", devolva tudo o que já sabe (inclusive o que já estava confirmado).',
    'Quando marcar "pronto", "resposta" é uma frase curta de transição (o atendimento continua no próximo passo do fluxo).',
    'Marque "chamar_atendente" se o cliente pedir uma pessoa ou se o assunto fugir do atendimento da loja.',
  ].filter(Boolean).join('\n');

  // histórico do chamado: entrada = cliente, saída = loja; junta mensagens seguidas do mesmo lado
  const messages = [];
  for (const m of ctx.mensagens) {
    const role = m.direcao === 'entrada' ? 'user' : 'assistant';
    if (!messages.length && role === 'assistant') continue;
    if (messages.at(-1)?.role === role) messages.at(-1).texto += `\n${m.texto}`;
    else messages.push({ role, texto: m.texto });
  }
  if (!messages.length || messages.at(-1).role !== 'user') return null;
  const conteudo = messages.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.texto }] }));

  // base de conhecimento no começo da conversa (fica no cache); o momento atual vai no fim
  const docs = (await baseDeConhecimento(ctx.empresa_id)).map((k) => ({
    type: 'document',
    title: k.titulo,
    source: k.tipo === 'pdf' ? { type: 'base64', media_type: 'application/pdf', data: k.pdf } : { type: 'text', media_type: 'text/plain', data: k.conteudo || '' },
  }));
  if (docs.length) {
    docs.at(-1).cache_control = { type: 'ephemeral' };
    conteudo[0].content.unshift({ type: 'text', text: 'Base de conhecimento da loja (consulte para responder):' }, ...docs);
  }
  conteudo.at(-1).content.push({ type: 'text', text: [
    `[Agora: ${hojeSP().split('-').reverse().join('/')}. Dados já confirmados: ${JSON.stringify(dados)}.`,
    unidadeDe(ctx, dados) ? `Unidade do atendimento: ${unidadeDe(ctx, dados)}.` : '',
    dados.cliente_id ? 'Cliente já cadastrado na loja: trate pelo nome e não peça de novo os dados já confirmados.' : '',
    livres ? `Horários livres para a vistoria (ofereça só estes; se pedir outro dia, diga os mais próximos): ${
      livres.length ? livres.map((t) => `${localSP(t)} (${rotuloHorario(t)})`).join('; ') : 'nenhum, diga que um atendente vai combinar o horário'}.` : '',
    ']'].filter(Boolean).join(' ') });

  const r = await anthropic().messages.create({
    model: process.env.ANTHROPIC_MODELO || 'claude-opus-5-5',
    max_tokens: 4000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: conteudo,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
  });
  if (r.stop_reason === 'refusal') return { resposta: '', dados: {}, pronto: false, chamar_atendente: true };
  const texto = r.content.find((b) => b.type === 'text')?.text;
  return JSON.parse(texto);
}

// ------------------------------------------------------------------ atendimento
// Um atendimento por vez em cada contato (mensagens seguidas esperam a anterior)
const filas = new Map();
export function atenderComRobo(contatoId, deps) {
  const anterior = filas.get(contatoId) || Promise.resolve();
  // resposta à confirmação do agendamento (SIM / NÃO e a remarcação) vem antes do robô
  const atual = anterior.then(async () => { if (!(await responderConfirmacao(contatoId, deps))) await atender(contatoId, deps); })
    .catch((e) => console.error('[robô]', e.message));
  filas.set(contatoId, atual);
  atual.finally(() => { if (filas.get(contatoId) === atual) filas.delete(contatoId); });
  return atual;
}

// Unidade escolhida (nome e endereço), para a IA falar da unidade certa
const unidadeDe = (ctx, dados) => {
  const l = (ctx.lojas || []).find((x) => x.id === dados.loja_id);
  return l ? [l.nome, enderecoLoja(l), textoHorarios(l.horarios) && `horário de funcionamento: ${textoHorarios(l.horarios)}`].filter(Boolean).join(' - ') : '';
};

// Campos que vêm do cadastro do cliente reconhecido
const DO_CADASTRO = ['nome', 'cpf_cnpj', 'email'];
const primeiroNome = (nome) => {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
};
// "Olá! ..." vira "Olá, Maria! ..."; sem cumprimento no começo, põe um antes
function saudarPeloNome(saudacao, nome) {
  const p = primeiroNome(nome);
  const texto = String(saudacao || '');
  if (!p) return texto;
  if (texto.includes('{nome}')) return texto.replace(/\{nome\}/g, p);
  const m = texto.match(/^(ol[aá]|oi|bom dia|boa tarde|boa noite)(?=[\s!,.]|$)[!,.]?/i);
  return m ? `${m[1]}, ${p}!${texto.slice(m[0].length)}` : `Olá, ${p}! Que bom falar com você de novo.\n\n${texto}`;
}

const textoUnidades = (lojas) => `Em qual unidade você deseja atendimento?\n${lojas
  .map((l, i) => {
    const end = enderecoLoja(l), hor = textoHorarios(l.horarios);
    return `${i + 1} - ${l.nome}${end ? `\n    ${end}` : ''}${hor ? `\n    ${hor}` : ''}`;
  }).join('\n')}\n(responda com o número)`;

const juntar = (falas) => falas.filter(Boolean).join('\n\n');
const textoMenu = (b) => `${b.texto}\n${b.opcoes.map((o, i) => `${i + 1} - ${o.rotulo}`).join('\n')}`;

async function atender(contatoId, { enviarTexto, nacional, retomar = false }) {
  const ctx = await comoUsuario(null, async (db) => (await db.query('select app_robo_contexto($1) as c', [contatoId])).rows[0].c);
  if (!ctx) return; // robô desligado ou sem chamado aberto
  const ch = ctx.chamado;
  if (ch.venda_id || ch.robo_estado === 'concluido' || ch.robo_estado === 'humano') return;
  const fluxo = fluxoDe(ctx.robo);
  const iaPode = ctx.ia_liberada && iaConfigurada();
  const dados = { ...(ch.robo_dados || {}) };
  const lojas = ctx.lojas || [];
  const ultima = ctx.mensagens.filter((m) => m.direcao === 'entrada').at(-1)?.texto || '';

  const falar = async (texto) => {
    if (!texto) return;
    let envio = null, falha = null;
    try { envio = await enviarTexto(ctx.phone_number_id, ctx.contato.telefone, texto); } catch (e) { falha = e; }
    await comoUsuario(null, (db) => db.query('select app_robo_registrar($1, $2, $3, $4, $5)',
      [ch.id, texto, falha ? 'falhou' : envio.status, falha?.message || null, envio?.id_externo || null]));
  };
  const estado = (e, etapa, d) => comoUsuario(null, (db) => db.query('select app_robo_estado($1, $2, $3, $4)', [ch.id, e, etapa, d]));
  // chamado vai para o responsável configurado no robô (o da unidade escolhida, senão o padrão)
  const atribuir = () => comoUsuario(null, (db) => db.query('select app_robo_atribuir($1, $2)', [ch.id, dados.loja_id || null]))
    .catch((e) => console.error('[robô] responsável:', e.message));
  const passarParaAtendente = async (msg, falas = []) => {
    await estado('humano', null, dados);
    await atribuir();
    await falar(juntar([...falas, msg || 'Certo! Um atendente vai continuar a conversa com você em instantes.']));
  };
  const posicao = (id) => fluxo.findIndex((b) => b.id === id);
  const depois = (n, ir) => (ir ? posicao(ir) : n + 1);
  // Pergunta do bloco; a do horário busca os horários livres e guarda as opções oferecidas
  const perguntar = async (b, aPartirDe) => {
    const etapa = { campo: b.campo, pergunta: b.texto, obrigatorio: b.obrigatorio };
    if (b.campo !== 'horario') return pergunta(etapa, ctx.servicos);
    const opcoes = await horariosLivres(ctx.empresa_id, dados.loja_id, { de: dados.data, depois: aPartirDe });
    if (!opcoes.length) return null;
    dados.opcoes_horario = opcoes;
    return `${b.texto || CAMPOS.horario}\n${listaHorarios(opcoes)}\n(responda com o número; para ver outros horários, escreva MAIS)`;
  };
  const abrirVenda = async (b, falas) => {
    let v;
    try {
      v = await comoUsuario(null, async (db) => (await db.query('select * from app_robo_abrir_venda($1, $2)',
        [ch.id, JSON.stringify(paraVenda(dados, ctx.contato, nacional))])).rows[0]);
    } catch (e) {
      console.error('[robô] não abriu a venda:', e.message);
      return passarParaAtendente('Recebemos os seus dados! Um atendente vai continuar o atendimento em instantes.', falas);
    }
    const modelo = b?.texto || ctx.robo.mensagem_final;
    let fim = modelo ? formatar(modelo, { ...dados, numero: v.numero }) : 'Recebemos o seu pedido! Em instantes um atendente confirma com você.';
    if (dados.horario && !/\{horario\}/.test(modelo || '')) {
      const loja = await comoUsuario(null, async (db) => (await db.query('select app_agenda_unidade_robo($1, $2) as l', [ctx.empresa_id, dados.loja_id || null])).rows[0].l);
      const end = enderecoLoja(loja);
      const waze = linkWaze(loja);
      fim += `\n\nSua vistoria ficou agendada para ${rotuloHorario(dados.horario)}${loja?.nome ? `, na ${loja.nome}` : ''}.${end ? `\nEndereço: ${end}.` : ''}${waze ? `\nComo chegar (Waze): ${waze}` : ''}`;
    } else if (dados.sem_horario) {
      fim += '\n\nNo momento não há horário livre na agenda; o atendente vai combinar o horário com você.';
    }
    await atribuir();
    await falar(juntar([...falas, fim]));
  };

  // Executa o fluxo a partir do bloco n até um bloco que espera resposta (ou que termina)
  const executar = async (n, falas = []) => {
    for (let passos = 0; passos < 60; passos += 1) {
      const b = fluxo[n];
      if (!b) return passarParaAtendente(null, falas); // fim do fluxo sem desfecho: uma pessoa continua
      if (b.tipo === 'mensagem') { falas.push(formatar(b.texto, dados)); n = depois(n, b.ir); continue; }
      if (b.tipo === 'menu') { await estado('coletando', n, dados); return falar(juntar([...falas, formatar(textoMenu(b), dados)])); }
      if (b.tipo === 'pergunta') {
        // cliente já cadastrado: não pergunta de novo o que já está no cadastro
        if (DO_CADASTRO.includes(b.campo) && dados[b.campo]) { n = depois(n, b.ir); continue; }
        const q = await perguntar(b);
        if (q) { await estado('coletando', n, dados); return falar(juntar([...falas, q])); }
        dados.sem_horario = true; n = depois(n, b.ir); continue;
      }
      if (b.tipo === 'ia') {
        await estado('coletando', n, dados);
        if (!iaPode) return passarParaAtendente(null, falas);
        return conversarIA(n, b, falas);
      }
      if (b.tipo === 'venda') return abrirVenda(b, falas);
      if (b.tipo === 'atendente') return passarParaAtendente(b.texto ? formatar(b.texto, dados) : null, falas);
      if (b.tipo === 'fim') { await estado('concluido', null, dados); return falar(juntar([...falas, formatar(b.texto, dados)])); }
      n += 1;
    }
    return passarParaAtendente(null, falas); // fluxo em círculo
  };

  // Bloco de IA: responde a última mensagem; quando termina, segue o fluxo
  const conversarIA = async (n, b, falas = []) => {
    const campos = b.campos || [];
    const querHorario = campos.some((e) => e.campo === 'horario') && !dados.horario;
    const livres = querHorario ? await horariosLivres(ctx.empresa_id, dados.loja_id, { de: dados.data, limite: 20 }) : null;
    let r;
    try { r = await perguntarIA(ctx, dados, livres, b); } catch (e) {
      console.error('[robô IA]', e.message);
      return passarParaAtendente('Recebemos a sua mensagem! Um atendente vai responder em instantes.', falas);
    }
    if (!r) return falas.length ? falar(juntar(falas)) : undefined;
    if (r.chamar_atendente) return passarParaAtendente(r.resposta || null, falas);
    // só guarda o que passa na conferência
    for (const [campo, valor] of Object.entries(r.dados || {})) {
      if (valor == null || valor === '') continue;
      if (campo === 'observacoes') { dados.observacoes = String(valor).slice(0, 1000); continue; }
      if (campo === 'horario') {
        const t = livres?.find((x) => localSP(x) === String(valor).slice(0, 16));
        if (t) dados.horario_escolhido = t;
        continue;
      }
      if (campo === 'servico') {
        const c = conferir('servico', valor, ctx.servicos);
        if (c.valor) { dados.servico_id = c.valor; dados.servico_nome = c.nome; } else dados.servico_nome = String(valor).slice(0, 120);
        continue;
      }
      const c = conferir(campo, valor, ctx.servicos);
      if (c.valor) dados[campo] = c.valor;
    }
    // reserva o horário assim que o cliente escolhe
    if (dados.horario_escolhido && !dados.horario) {
      const t = dados.horario_escolhido;
      delete dados.horario_escolhido;
      const id = await reservar(ch, t, dados, ctx.contato);
      if (!id) {
        await estado('coletando', n, dados);
        const novos = await horariosLivres(ctx.empresa_id, dados.loja_id, { de: dados.data });
        return falar(juntar([...falas, `Esse horário acabou de ser ocupado. ${novos.length ? `Estes ainda estão livres:\n${listaHorarios(novos)}` : 'Um atendente vai combinar o horário com você.'}`]));
      }
      dados.horario = t; dados.agendamento_id = id; dados.data = localSP(t).slice(0, 10);
    }
    if (querHorario && livres && !livres.length) dados.sem_horario = true;
    const faltando = campos.filter((e) => e.obrigatorio && !(e.campo === 'horario' && dados.sem_horario)
      && !dados[e.campo === 'servico' ? 'servico_id' : e.campo]);
    if (r.pronto && !faltando.length) return executar(depois(n, b.ir), [...falas, r.resposta]);
    await estado('coletando', n, dados);
    return falar(juntar([...falas, r.resposta || (faltando[0] && await perguntar({ ...faltando[0], texto: CAMPOS[faltando[0].campo] }))]));
  };

  // atendente devolveu a conversa para o robô: repete de onde parou
  if (retomar && dados.escolhendo_loja) return falar(textoUnidades(lojas));
  if (retomar) {
    const n = ch.robo_etapa || 0;
    const b = fluxo[n];
    if (b?.tipo === 'menu') return falar(textoMenu(b));
    if (b?.tipo === 'pergunta') {
      const q = await perguntar(b);
      if (b.campo === 'horario') await estado('coletando', null, dados); // guarda os horários oferecidos
      if (q) await falar(q);
    }
    return;
  }
  if (ch.robo_estado && QUER_ATENDENTE.test(semAcento(ultima))) return passarParaAtendente();

  // primeira mensagem: boas-vindas e o fluxo do começo. Cliente reconhecido pelo cadastro
  // (ligado ao contato ou achado pelo número): cumprimenta pelo nome e já traz os dados dele.
  if (!ch.robo_estado) {
    const cli = ctx.cliente;
    if (cli) {
      dados.cliente_id = cli.id;
      for (const campo of DO_CADASTRO) if (cli[campo] && !dados[campo]) dados[campo] = cli[campo];
    }
    const ola = cli ? saudarPeloNome(ctx.robo.saudacao, cli.nome) : ctx.robo.saudacao;
    // grupo com mais de uma unidade: primeiro o cliente escolhe a unidade (com o endereço de cada uma)
    if (lojas.length > 1) {
      dados.escolhendo_loja = true;
      await estado('coletando', 0, dados);
      return falar(juntar([ola, textoUnidades(lojas)]));
    }
    if (lojas[0]) dados.loja_id = lojas[0].id;
    await estado('coletando', 0, dados);
    return executar(0, [ola]);
  }

  if (dados.escolhendo_loja) {
    const s = semAcento(ultima);
    const k = Number(s.replace(/\D/g, '') || NaN);
    const loja = (Number.isInteger(k) && lojas[k - 1]) || lojas.find((l) => s.length >= 3 && semAcento(l.nome).includes(s));
    if (!loja) return falar(`Responda com o número da unidade.\n\n${textoUnidades(lojas)}`);
    delete dados.escolhendo_loja;
    dados.loja_id = loja.id; dados.loja_nome = loja.nome;
    return executar(0, [`Certo, unidade ${loja.nome}.`]);
  }

  const n = ch.robo_etapa || 0;
  const b = fluxo[n];
  if (!b || !['menu', 'pergunta', 'ia'].includes(b.tipo)) return executar(n);

  if (b.tipo === 'ia') return iaPode ? conversarIA(n, b) : passarParaAtendente();

  if (b.tipo === 'menu') {
    const s = semAcento(ultima);
    const k = Number(s.replace(/\D/g, '') || NaN);
    const opcao = (Number.isInteger(k) && b.opcoes[k - 1]) || b.opcoes.find((o) => semAcento(o.rotulo) === s)
      || b.opcoes.find((o) => s.length >= 3 && semAcento(o.rotulo).includes(s));
    if (!opcao) return falar(`Responda com o número de uma das opções.\n\n${textoMenu(b)}`);
    dados.extras = [...(dados.extras || []), { pergunta: b.texto, resposta: opcao.rotulo }];
    return executar(depois(n, opcao.ir));
  }

  // pergunta
  if (b.campo === 'horario') {
    const opcoes = dados.opcoes_horario || [];
    if (['MAIS', 'OUTROS', 'OUTRO'].includes(semAcento(ultima))) {
      const q = await perguntar(b, opcoes.at(-1));
      await estado('coletando', n, dados);
      return falar(q || `Não há mais horários livres depois desses.\n\n${await perguntar(b)}`);
    }
    const k = Number(semAcento(ultima));
    const escolhido = Number.isInteger(k) ? opcoes[k - 1] : null;
    if (!escolhido && !(!b.obrigatorio && PULAR.includes(semAcento(ultima)))) {
      return falar(`Responda com o número do horário (ou MAIS para ver outros).\n\n${listaHorarios(opcoes)}`);
    }
    if (escolhido) {
      const id = await reservar(ch, escolhido, dados, ctx.contato);
      if (!id) {
        const q = await perguntar(b);
        await estado('coletando', n, dados);
        return falar(q ? `Esse horário acabou de ser ocupado. Escolha outro:\n\n${q}` : 'Esse horário acabou de ser ocupado e não há outro livre agora.');
      }
      dados.horario = escolhido; dados.agendamento_id = id; dados.data = localSP(escolhido).slice(0, 10);
    }
  } else if (!b.obrigatorio && PULAR.includes(semAcento(ultima))) {
    // pulou
  } else {
    const c = conferir(b.campo, ultima, ctx.servicos);
    if (c.erro) return falar(`${c.erro}\n\n${await perguntar(b)}`);
    if (b.campo === 'livre') dados.extras = [...(dados.extras || []), { pergunta: b.texto, resposta: c.valor }];
    else if (b.campo === 'servico') { dados.servico_id = c.valor; dados.servico_nome = c.nome; }
    else dados[b.campo] = c.valor;
  }
  return executar(depois(n, b.ir));
}

export const iaDisponivel = iaConfigurada;
