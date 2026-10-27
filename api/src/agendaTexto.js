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

export function textoConfirmacao({ nome, inicio, placa }, loja) {
  const primeiro = String(nome || '').split(' ')[0];
  const nomeBonito = primeiro ? primeiro[0] + primeiro.slice(1).toLowerCase() : '';
  const end = enderecoLoja(loja);
  return [
    `Olá${nomeBonito ? `, ${nomeBonito}` : ''}! Sua vistoria está agendada para ${rotuloHorario(inicio)}${loja?.nome ? `, na ${loja.nome}` : ''}.`,
    end ? `Endereço: ${end}.` : null,
    placa ? `Placa: ${placa}.` : null,
    '',
    'Confirma o agendamento? Responda SIM ou NÃO.',
  ].filter((x) => x !== null).join('\n');
}
