// Textos da agenda usados na tela, no robô e na confirmação pelo WhatsApp
const FUSO = 'America/Sao_Paulo';

// "segunda, 27/10 às 09:00"
export function rotuloHorario(ts) {
  const d = new Date(ts);
  const dia = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long' }).replace('-feira', '');
  const data = d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  return `${dia}, ${data} às ${hora}`;
}

export const enderecoLoja = (l) => [[l?.logradouro, l?.numero].filter(Boolean).join(', '), l?.bairro, [l?.cidade, l?.uf].filter(Boolean).join('/')]
  .filter(Boolean).join(' - ');

// Link do Waze para o endereço da unidade (abre a rota no celular)
export function linkWaze(l) {
  const end = enderecoLoja(l);
  if (!end || !l?.logradouro) return '';
  const cep = String(l.cep || '').replace(/\D/g, '');
  return `https://waze.com/ul?q=${encodeURIComponent([end, cep && `${cep.slice(0, 5)}-${cep.slice(5)}`].filter(Boolean).join(', '))}&navigate=yes`;
}

// Horário de funcionamento: "Seg a Sex: 08:00 às 17:00 · Sáb: 08:00 às 12:00 · Dom: fechado"
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export function textoHorarios(horarios) {
  if (!horarios || typeof horarios !== 'object') return '';
  const de = (d) => { const h = horarios[d]; return h?.abre && h?.fecha ? `${h.abre} às ${h.fecha}` : 'fechado'; };
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const grupos = [];
  for (const d of ordem) {
    const t = de(d);
    const ult = grupos.at(-1);
    if (ult && ult.t === t) ult.ate = d; else grupos.push({ de: d, ate: d, t });
  }
  return grupos.map((g) => `${DIAS[g.de]}${g.ate !== g.de ? ` a ${DIAS[g.ate]}` : ''}: ${g.t}`).join(' · ');
}

// Link curto (is.gd, senão tinyurl) para o WhatsApp ficar mais bonito; se não der, fica o link inteiro.
// ENCURTADOR=0 no .env desliga.
const curtos = new Map();
export async function encurtar(url) {
  if (!url || process.env.ENCURTADOR === '0') return url;
  if (curtos.has(url)) return curtos.get(url);
  const servicos = [
    `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
    `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
  ];
  for (const s of servicos) {
    try {
      const r = await fetch(s, { signal: AbortSignal.timeout(4000) });
      const t = (await r.text()).trim();
      if (r.ok && /^https:\/\/\S+$/.test(t) && t.length < url.length) { curtos.set(url, t); return t; }
    } catch { /* tenta o próximo */ }
  }
  return url;
}

const primeiroNome = (nome) => { const p = String(nome || '').split(' ')[0]; return p ? p[0] + p.slice(1).toLowerCase() : ''; };

// Pergunta da confirmação (sem endereço nem Waze: esses vão depois que o cliente confirma)
export function textoConfirmacao({ nome, inicio, placa }, loja) {
  const nomeBonito = primeiroNome(nome);
  return [
    `Olá${nomeBonito ? `, ${nomeBonito}` : ''}! Sua vistoria está agendada para ${rotuloHorario(inicio)}${loja?.nome ? `, na ${loja.nome}` : ''}.`,
    placa ? `Placa: ${placa}.` : null,
    '',
    'Confirma o agendamento? Responda SIM ou NÃO.',
  ].filter((x) => x !== null).join('\n');
}

// Agendamento confirmado: data, unidade, endereço e o link (curto) do Waze
export async function textoConfirmado({ nome, inicio, placa }, loja, titulo = 'Agendamento confirmado!') {
  const nomeBonito = primeiroNome(nome);
  const end = enderecoLoja(loja);
  const waze = await encurtar(linkWaze(loja));
  return [
    `${titulo}${nomeBonito ? ` ${nomeBonito},` : ''} te esperamos ${rotuloHorario(inicio)}${loja?.nome ? `, na ${loja.nome}` : ''}.`,
    end ? `Endereço: ${end}.` : null,
    waze ? `Como chegar (Waze): ${waze}` : null,
    placa ? `Placa: ${placa}.` : null,
    'Até lá!',
  ].filter((x) => x !== null).join('\n');
}
