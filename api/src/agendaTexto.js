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

export function textoConfirmacao({ nome, inicio, placa }, loja) {
  const primeiro = String(nome || '').split(' ')[0];
  const nomeBonito = primeiro ? primeiro[0] + primeiro.slice(1).toLowerCase() : '';
  const end = enderecoLoja(loja);
  return [
    `Olá${nomeBonito ? `, ${nomeBonito}` : ''}! Sua vistoria está agendada para ${rotuloHorario(inicio)}${loja?.nome ? `, na ${loja.nome}` : ''}.`,
    end ? `Endereço: ${end}.` : null,
    linkWaze(loja) ? `Como chegar (Waze): ${linkWaze(loja)}` : null,
    placa ? `Placa: ${placa}.` : null,
    '',
    'Confirma o agendamento? Responda SIM ou NÃO.',
  ].filter((x) => x !== null).join('\n');
}
