import Anthropic from '@anthropic-ai/sdk';
import { comoUsuario } from './db.js';
import { cnpjValido, cpfValido } from './documentos.js';
import { normalizarPlaca } from './placas.js';
import { enderecoLoja, rotuloHorario } from './agendaTexto.js';

// Robô do WhatsApp: segue o fluxo de perguntas do grupo (ou conversa com IA, se o master
// liberou), junta nome, documento, veículo, serviço e data, e abre uma venda FUTURO.
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
};

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
  .replace(/\{nome\}/g, String(dados.nome || '').split(' ')[0] || '')
  .replace(/\{numero\}/g, dados.numero ?? '')
  .replace(/\{placa\}/g, dados.placa || '')
  .replace(/\{horario\}/g, dados.horario ? rotuloHorario(dados.horario) : '');

// ------------------------------------------------------------------ agenda
const POR_VEZ = 6;
const localSP = (ts) => new Date(ts).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 16).replace(' ', 'T');

// Próximos horários livres (a partir da data pedida, ou depois do último já oferecido)
async function horariosLivres(empresa, { de, depois, limite = POR_VEZ }) {
  const dia = de || hojeSP();
  const r = await comoUsuario(null, (db) => db.query('select inicio from app_agenda_livres_robo($1, $2::date, $3)', [empresa, dia, 200]));
  return r.rows.map((x) => new Date(x.inicio).toISOString()).filter((t) => !depois || t > depois).slice(0, limite);
}

const listaHorarios = (opcoes) => opcoes.map((t, i) => `${i + 1} - ${rotuloHorario(t)}`).join('\n');

// Reserva o horário na agenda; devolve o id do agendamento ou null se alguém pegou antes
async function reservar(ch, horario, dados, contato) {
  const r = await comoUsuario(null, (db) => db.query('select app_agenda_robo($1, $2, $3) as id', [ch.id, horario,
    JSON.stringify({ nome: dados.nome, telefone: contato.telefone, placa: dados.placa, servico_id: dados.servico_id, observacao: 'Agendado pelo robô do WhatsApp.' })]));
  return r.rows[0].id;
}

// Dados prontos para a venda (o que não é campo fixo vai nas observações)
function paraVenda(dados, contato, nacional) {
  const extras = (dados.extras || []).map((e) => `${e.pergunta} ${e.resposta}`);
  if (dados.nome) extras.unshift(`Nome informado: ${dados.nome}`);
  if (dados.servico_nome && !dados.servico_id) extras.push(`Serviço pedido: ${dados.servico_nome}`);
  if (dados.observacoes) extras.push(dados.observacoes);
  return {
    nome: dados.nome, cpf_cnpj: dados.cpf_cnpj, email: dados.email, placa: dados.placa, tipo_veiculo: dados.tipo_veiculo,
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

async function perguntarIA(ctx, dados, livres) {
  const etapas = ctx.robo.etapas || [];
  const lista = etapas.map((e) => `- ${e.campo === 'livre' ? e.pergunta : CAMPOS[e.campo]}${e.obrigatorio ? ' (obrigatório)' : ' (opcional)'}`).join('\n');
  const system = [
    'Você é o atendente virtual de uma empresa de vistoria veicular (ECV) no WhatsApp.',
    'Seu objetivo é coletar os dados abaixo de forma simpática e breve, uma ou duas perguntas por vez, para a loja abrir o pedido.',
    'Escreva mensagens curtas, sem markdown. Não invente preços, horários nem informações que não estão aqui.',
    `Hoje é ${hojeSP().split('-').reverse().join('/')}.`,
    `\nDados para coletar:\n${lista || '- Nome (obrigatório)'}`,
    `\nServiços oferecidos:\n${ctx.servicos.map((s) => `- ${s.nome}`).join('\n') || '- (nenhum cadastrado)'}`,
    livres ? `\nHorários livres para a vistoria (ofereça só estes; se o cliente pedir outro dia, diga os mais próximos):\n${
      livres.length ? livres.map((t) => `- ${localSP(t)} (${rotuloHorario(t)})`).join('\n') : '- nenhum horário livre: diga que um atendente vai combinar o horário'}` : '',
    ctx.robo.ia_instrucoes ? `\nInstruções da loja:\n${ctx.robo.ia_instrucoes}` : '',
    `\nDados já confirmados até agora: ${JSON.stringify(dados)}`,
    '\nEm "dados", devolva tudo o que já sabe (inclusive o que já estava confirmado). Marque "pronto" só quando tiver todos os obrigatórios;',
    'nessa hora "resposta" é a despedida, dizendo que um atendente vai confirmar o pedido.',
  ].join('\n');

  // histórico do chamado: entrada = cliente, saída = loja; junta mensagens seguidas do mesmo lado
  const messages = [];
  for (const m of ctx.mensagens) {
    const role = m.direcao === 'entrada' ? 'user' : 'assistant';
    if (!messages.length && role === 'assistant') continue;
    if (messages.at(-1)?.role === role) messages.at(-1).content += `\n${m.texto}`;
    else messages.push({ role, content: m.texto });
  }
  if (!messages.length || messages.at(-1).role !== 'user') return null;

  const r = await anthropic().messages.create({
    model: process.env.ANTHROPIC_MODELO || 'claude-opus-5-5',
    max_tokens: 4000,
    system,
    messages,
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
  const atual = anterior.then(() => atender(contatoId, deps)).catch((e) => console.error('[robô]', e.message));
  filas.set(contatoId, atual);
  atual.finally(() => { if (filas.get(contatoId) === atual) filas.delete(contatoId); });
  return atual;
}

async function atender(contatoId, { enviarTexto, nacional, retomar = false }) {
  const ctx = await comoUsuario(null, async (db) => (await db.query('select app_robo_contexto($1) as c', [contatoId])).rows[0].c);
  if (!ctx) return; // robô desligado ou sem chamado aberto
  const ch = ctx.chamado;
  if (ch.venda_id || ch.robo_estado === 'concluido' || ch.robo_estado === 'humano') return;
  const usaIA = ctx.robo.ia_ativa && ctx.ia_liberada && iaConfigurada();
  const etapas = (ctx.robo.etapas || []).filter((e) => CAMPOS[e.campo]);
  const dados = { ...(ch.robo_dados || {}) };
  const ultima = ctx.mensagens.filter((m) => m.direcao === 'entrada').at(-1)?.texto || '';

  const falar = async (texto) => {
    if (!texto) return;
    let envio = null, falha = null;
    try { envio = await enviarTexto(ctx.phone_number_id, ctx.contato.telefone, texto); } catch (e) { falha = e; }
    await comoUsuario(null, (db) => db.query('select app_robo_registrar($1, $2, $3, $4, $5)',
      [ch.id, texto, falha ? 'falhou' : envio.status, falha?.message || null, envio?.id_externo || null]));
  };
  const estado = (e, etapa, d) => comoUsuario(null, (db) => db.query('select app_robo_estado($1, $2, $3, $4)', [ch.id, e, etapa, d]));
  const passarParaAtendente = async (msg) => {
    await estado('humano', null, dados);
    await falar(msg || 'Certo! Um atendente vai continuar a conversa com você em instantes.');
  };
  // Pergunta da etapa; a do horário busca os horários livres e guarda as opções oferecidas
  const perguntar = async (etapa, depois) => {
    if (etapa.campo !== 'horario') return pergunta(etapa, ctx.servicos);
    const opcoes = await horariosLivres(ctx.empresa_id, { de: dados.data, depois });
    if (!opcoes.length) return null;
    dados.opcoes_horario = opcoes;
    return `${etapa.pergunta || CAMPOS.horario}\n${listaHorarios(opcoes)}\n(responda com o número; para ver outros horários, escreva MAIS)`;
  };
  // Vai para a etapa n (pula a do horário se não houver horário livre) ou fecha o pedido
  const seguir = async (n, prefixo) => {
    while (n < etapas.length) {
      const q = await perguntar(etapas[n]);
      if (q) {
        await estado('coletando', n, dados);
        return falar([prefixo, q].filter(Boolean).join('\n\n'));
      }
      dados.sem_horario = true;
      n += 1;
    }
    await estado('coletando', n, dados);
    return abrirVenda('Recebemos o seu pedido! Em instantes um atendente confirma com você.');
  };
  const abrirVenda = async (despedida) => {
    let v;
    try {
      v = await comoUsuario(null, async (db) => (await db.query('select * from app_robo_abrir_venda($1, $2)',
        [ch.id, JSON.stringify(paraVenda(dados, ctx.contato, nacional))])).rows[0]);
    } catch (e) {
      console.error('[robô] não abriu a venda:', e.message);
      return passarParaAtendente('Recebemos os seus dados! Um atendente vai continuar o atendimento em instantes.');
    }
    let fim = ctx.robo.mensagem_final ? formatar(ctx.robo.mensagem_final, { ...dados, numero: v.numero }) : despedida;
    if (dados.horario && !/\{horario\}/.test(ctx.robo.mensagem_final || '')) {
      const loja = await comoUsuario(null, async (db) => (await db.query('select app_agenda_loja_robo($1) as l', [ctx.empresa_id])).rows[0].l);
      const end = enderecoLoja(loja);
      fim += `\n\nSua vistoria ficou agendada para ${rotuloHorario(dados.horario)}${loja?.nome ? `, na ${loja.nome}` : ''}.${end ? `\nEndereço: ${end}.` : ''}`;
    } else if (dados.sem_horario) {
      fim += '\n\nNo momento não há horário livre na agenda; o atendente vai combinar o horário com você.';
    }
    await falar(fim);
  };

  // atendente devolveu a conversa para o robô: repete a pergunta de onde parou
  if (retomar) {
    const etapa = etapas[ch.robo_etapa || 0];
    if (!usaIA && etapa) {
      const q = await perguntar(etapa);
      if (etapa.campo === 'horario') await estado('coletando', null, dados); // guarda os horários oferecidos
      if (q) await falar(q);
    }
    return;
  }
  if (ch.robo_estado && QUER_ATENDENTE.test(semAcento(ultima))) return passarParaAtendente();

  // ---------------- com IA
  if (usaIA) {
    if (!ch.robo_estado) await estado('coletando', 0, dados);
    const querHorario = etapas.some((e) => e.campo === 'horario') && !dados.horario;
    const livres = querHorario ? await horariosLivres(ctx.empresa_id, { de: dados.data, limite: 20 }) : null;
    let r;
    try { r = await perguntarIA(ctx, dados, livres); } catch (e) {
      console.error('[robô IA]', e.message);
      return passarParaAtendente('Recebemos a sua mensagem! Um atendente vai responder em instantes.');
    }
    if (!r) return;
    if (r.chamar_atendente) return passarParaAtendente(r.resposta || undefined);
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
        await estado('coletando', null, dados);
        const novos = await horariosLivres(ctx.empresa_id, { de: dados.data });
        return falar(`Esse horário acabou de ser ocupado. ${novos.length ? `Estes ainda estão livres:\n${listaHorarios(novos)}` : 'Um atendente vai combinar o horário com você.'}`);
      }
      dados.horario = t; dados.agendamento_id = id; dados.data = localSP(t).slice(0, 10);
    }
    if (querHorario && livres && !livres.length) dados.sem_horario = true;
    const faltando = etapas.filter((e) => e.obrigatorio && e.campo !== 'livre' && !(e.campo === 'horario' && dados.sem_horario)
      && !dados[e.campo === 'servico' ? 'servico_id' : e.campo]);
    if (r.pronto && !faltando.length) {
      await estado('coletando', null, dados);
      return abrirVenda(r.resposta);
    }
    await estado('coletando', null, dados);
    return falar(r.resposta || (faltando[0] && await perguntar(faltando[0])));
  }

  // ---------------- fluxo fixo
  if (!ch.robo_estado) {
    await estado('coletando', 0, dados);
    if (!etapas.length) { await falar(ctx.robo.saudacao); return abrirVenda('Recebemos o seu pedido!'); }
    return seguir(0, ctx.robo.saudacao);
  }
  let n = ch.robo_etapa || 0;
  const etapa = etapas[n];
  if (!etapa) return abrirVenda('Recebemos o seu pedido!');
  if (etapa.campo === 'horario') {
    const opcoes = dados.opcoes_horario || [];
    if (['MAIS', 'OUTROS', 'OUTRO'].includes(semAcento(ultima))) {
      const q = await perguntar(etapa, opcoes.at(-1));
      await estado('coletando', n, dados);
      return falar(q || `Não há mais horários livres depois desses.\n\n${await perguntar(etapa)}`);
    }
    const k = Number(semAcento(ultima));
    const escolhido = Number.isInteger(k) ? opcoes[k - 1] : null;
    if (!escolhido && !(!etapa.obrigatorio && PULAR.includes(semAcento(ultima)))) {
      return falar(`Responda com o número do horário (ou MAIS para ver outros).\n\n${listaHorarios(opcoes)}`);
    }
    if (escolhido) {
      const id = await reservar(ch, escolhido, dados, ctx.contato);
      if (!id) {
        const q = await perguntar(etapa);
        await estado('coletando', n, dados);
        return falar(q ? `Esse horário acabou de ser ocupado. Escolha outro:\n\n${q}` : 'Esse horário acabou de ser ocupado e não há outro livre agora.');
      }
      dados.horario = escolhido; dados.agendamento_id = id; dados.data = localSP(escolhido).slice(0, 10);
    }
  } else if (!etapa.obrigatorio && PULAR.includes(semAcento(ultima))) {
    // pulou
  } else {
    const c = conferir(etapa.campo, ultima, ctx.servicos);
    if (c.erro) return falar(`${c.erro}\n\n${await perguntar(etapa)}`);
    if (etapa.campo === 'livre') dados.extras = [...(dados.extras || []), { pergunta: etapa.pergunta, resposta: c.valor }];
    else if (etapa.campo === 'servico') { dados.servico_id = c.valor; dados.servico_nome = c.nome; }
    else dados[etapa.campo] = c.valor;
  }
  return seguir(n + 1);
}

export const iaDisponivel = iaConfigurada;
