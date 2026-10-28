import { comoUsuario } from './db.js';
import { rotuloHorario } from './agendaTexto.js';

// Resposta do cliente à confirmação do agendamento mandada pela agenda:
//   SIM -> fica Confirmado
//   NÃO -> pergunta o dia, depois a hora, e remarca (o histórico guarda de onde saiu)
// Roda antes do robô. Devolve true quando a mensagem era sobre a confirmação.

const FUSO = 'America/Sao_Paulo';
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const horaSP = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const diaSP = (ts) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: FUSO });
const somarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const rotuloDia = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const sem = d.toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long' }).replace('-feira', '');
  return `${sem}, ${iso.slice(8)}/${iso.slice(5, 7)}`;
};

const SIM = /^(S|SIM|SS|CONFIRMO|CONFIRMADO|CONFIRMA|OK|PODE SER|ISSO|CLARO|CERTO|COM CERTEZA)\b/;
const NAO = /^(N|NAO|NN|NEGATIVO|NAO POSSO|NAO VOU|REMARCAR|QUERO REMARCAR|MUDAR)\b/;
const QUER_ATENDENTE = /\b(ATENDENTE|HUMANO|PESSOA|CANCELAR)\b/;
const SEMANA = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];

// "30/10", "30/10/2026", "30", "dia 30", "hoje", "amanhã", "sexta"
export function lerDia(texto, hoje = hojeSP()) {
  const s = semAcento(texto).replace(/^(PARA |PRA |NO |NA )?(O |A )?(DIA )?/, '').replace(/[.!?]+$/, '').trim();
  if (s === 'HOJE') return hoje;
  if (s === 'AMANHA') return somarDias(hoje, 1);
  if (s === 'DEPOIS DE AMANHA') return somarDias(hoje, 2);
  const sem = SEMANA.findIndex((d) => s.startsWith(d));
  if (sem >= 0) {
    const atual = new Date(`${hoje}T12:00:00Z`).getUTCDay();
    return somarDias(hoje, ((sem - atual + 7) % 7) || 7);
  }
  const m = /^(\d{1,2})(?:\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2}|\d{4}))?)?$/.exec(s);
  if (!m) return null;
  const dia = Number(m[1]);
  let mes = m[2] ? Number(m[2]) : Number(hoje.slice(5, 7));
  let ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(hoje.slice(0, 4));
  const montar = () => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const valido = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return !Number.isNaN(d.getTime()) && d.getUTCDate() === dia && d.getUTCMonth() + 1 === mes; };
  let iso = montar();
  // só o dia, que já passou neste mês: é o do mês seguinte
  if (valido(iso) && iso < hoje && !m[2]) {
    mes += 1; if (mes > 12) { mes = 1; ano += 1; }
    iso = montar();
  }
  return valido(iso) ? iso : null;
}

// Número da lista ou a hora ("14:30", "14h", "14h30")
export function lerHora(texto, opcoes) {
  const s = semAcento(texto).replace(/^(PARA AS |PRA AS |AS )/, '').replace(/\s*(HORAS?|HRS?)$/, '').trim();
  // número sozinho é a opção da lista; a hora vem com ":" ou "h"
  if (/^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= opcoes.length) return opcoes[Number(s) - 1];
  const m = /^(\d{1,2})(?:\s*(?:[:H.])\s*(\d{2})?)?$/.exec(s);
  if (!m) return null;
  const hora = `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
  return opcoes.find((t) => horaSP(t) === hora) || null;
}

const listaHoras = (opcoes) => opcoes.map((t, i) => `${i + 1} - ${horaSP(t)}`).join('\n');

async function livresNoDia(loja, dia) {
  const r = await comoUsuario(null, (db) => db.query('select inicio from agenda_livres($1, $2::date, $2::date) order by inicio', [loja, dia]));
  return r.rows.map((x) => new Date(x.inicio).toISOString());
}
async function proximosDias(loja, dia) {
  const r = await comoUsuario(null, (db) => db.query('select inicio from agenda_livres($1, $2::date, $3::date) order by inicio', [loja, dia, somarDias(dia, 30)]));
  return [...new Set(r.rows.map((x) => diaSP(x.inicio)))].slice(0, 3);
}

export async function responderConfirmacao(contatoId, { enviarTexto }) {
  const p = await comoUsuario(null, async (db) => (await db.query('select app_agenda_confirmacao_pendente($1) as p', [contatoId])).rows[0].p);
  if (!p || !p.phone_number_id) return false;
  const a = p.ag;
  // resposta pelo botão vem como "1. SIM" / "2. NÃO"
  const s = semAcento(p.ultima).replace(/^\d{1,2}\s*[.)–-]\s+/, '').replace(/[.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const dados = a.confirmacao_dados || {};

  const falar = async (texto) => {
    let envio = null, falha = null;
    try { envio = await enviarTexto(p.phone_number_id, p.telefone, texto); } catch (e) { falha = e; }
    await comoUsuario(null, (db) => db.query('select app_agenda_registrar_conversa($1, $2, $3, $4, $5, $6)',
      [contatoId, p.chamado_id || a.chamado_id || null, texto, falha ? 'falhou' : envio.status, falha?.message || null, envio?.id_externo || null]));
  };
  const passo = (etapa, d) => comoUsuario(null, (db) => db.query('select app_agenda_confirmacao_passo($1, $2, $3)', [a.id, etapa, d ? JSON.stringify(d) : null]));
  // pediu uma pessoa (ou não entendeu duas vezes): sai da confirmação e o atendimento segue normal
  const largar = async () => { await passo(null, null); return false; };
  const naoEntendeu = async (msg) => {
    if ((dados.tentativas || 0) >= 2) return largar();
    await passo(a.confirmacao_etapa, { ...dados, tentativas: (dados.tentativas || 0) + 1 });
    await falar(msg);
    return true;
  };
  if (QUER_ATENDENTE.test(s)) return largar();

  if (a.confirmacao_etapa === 'aguardando') {
    if (SIM.test(s)) {
      await comoUsuario(null, (db) => db.query('select app_agenda_resposta_cliente($1, true)', [a.id]));
      await falar(`Agendamento confirmado! Te esperamos ${rotuloHorario(a.inicio)}${p.loja?.nome ? `, na ${p.loja.nome}` : ''}. Até lá!`);
      return true;
    }
    if (NAO.test(s)) {
      await comoUsuario(null, (db) => db.query('select app_agenda_resposta_cliente($1, false)', [a.id]));
      await passo('dia', {});
      await falar('Sem problema! Para qual dia você quer remarcar? (ex.: 30/10)');
      return true;
    }
    return naoEntendeu(`Responda SIM para confirmar o agendamento de ${rotuloHorario(a.inicio)} ou NÃO para remarcar.`);
  }

  if (a.confirmacao_etapa === 'dia') {
    const hoje = hojeSP();
    const dia = lerDia(p.ultima, hoje);
    if (!dia) return naoEntendeu('Não entendi o dia. Mande no formato DD/MM (ex.: 30/10).');
    if (dia < hoje) return naoEntendeu('Esse dia já passou. Para qual dia você quer remarcar?');
    const opcoes = await livresNoDia(a.loja_id, dia);
    if (!opcoes.length) {
      const outros = await proximosDias(a.loja_id, dia);
      await passo('dia', { tentativas: 0 });
      await falar(`Não temos horário livre em ${rotuloDia(dia)}.${outros.length ? ` Os próximos dias com horário são: ${outros.map(rotuloDia).join('; ')}.` : ''}\nPara qual dia você quer remarcar?`);
      return true;
    }
    await passo('hora', { dia, opcoes, tentativas: 0 });
    await falar(`Que horas? Horários livres em ${rotuloDia(dia)}:\n${listaHoras(opcoes)}\n(responda com o número ou com a hora, ex.: 14:30)`);
    return true;
  }

  if (a.confirmacao_etapa === 'hora') {
    if (lerDia(p.ultima) && /\//.test(p.ultima)) { // mandou outro dia: volta a perguntar a hora desse dia
      await passo('dia', {});
      return responderConfirmacao(contatoId, { enviarTexto });
    }
    const opcoes = dados.opcoes || [];
    const escolhido = lerHora(p.ultima, opcoes);
    if (!escolhido) return naoEntendeu(`Não achei esse horário. Escolha um da lista:\n${listaHoras(opcoes)}`);
    const ok = await comoUsuario(null, async (db) => (await db.query('select app_agenda_remarcar_cliente($1, $2) as ok', [a.id, escolhido])).rows[0].ok);
    if (!ok) {
      const novas = await livresNoDia(a.loja_id, dados.dia);
      if (!novas.length) {
        await passo('dia', {});
        await falar(`Esse horário acabou de ser ocupado e não sobrou outro em ${rotuloDia(dados.dia)}. Para qual dia você quer remarcar?`);
      } else {
        await passo('hora', { ...dados, opcoes: novas });
        await falar(`Esse horário acabou de ser ocupado. Escolha outro:\n${listaHoras(novas)}`);
      }
      return true;
    }
    await falar(`Pronto! Seu agendamento foi remarcado para ${rotuloHorario(escolhido)}${p.loja?.nome ? `, na ${p.loja.nome}` : ''}. Te esperamos!`);
    return true;
  }
  return false;
}
