import crypto from 'node:crypto';
import { jsPDF } from 'jspdf';
import { comoUsuario } from './db.js';
import { enviarDocumento, internacional, numeroDoGrupo } from './whatsapp.js';

// Comprovante do dia do ponto: gerado quando o colaborador registra a saída final e
// mandado para o celular dele pelo WhatsApp. Fica guardado (PDF + hash) no sistema.

const FUSO = 'America/Sao_Paulo';
const NOMES = { entrada: 'Entrada', saida_intervalo: 'Saída almoço', volta_intervalo: 'Volta almoço', saida: 'Saída' };
const ORDEM = Object.keys(NOMES);
const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
const dataBR = (iso) => iso.split('-').reverse().join('/');
const cpfBR = (c) => (String(c || '').length === 11 ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : c || 'NÃO INFORMADO');
const cnpjBR = (c) => (String(c || '').length === 14 ? c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : c || '');

function minutos(m) {
  const t = (k) => (m[k] ? new Date(m[k]).getTime() : null);
  const trecho = (a, b) => (t(a) && t(b) && t(b) > t(a) ? (t(b) - t(a)) / 60000 : 0);
  if (!m.saida_intervalo && !m.volta_intervalo) return trecho('entrada', 'saida');
  return trecho('entrada', 'saida_intervalo') + trecho('volta_intervalo', 'saida');
}

// Linhas de texto do comprovante (o hash é calculado sobre elas)
function linhas({ nsr, data, colaborador, empresa, loja, marcas, emitido }) {
  const min = minutos(marcas);
  const endereco = [[loja.logradouro, loja.numero].filter(Boolean).join(', '), loja.bairro, [loja.cidade, loja.uf].filter(Boolean).join('/')]
    .filter(Boolean).join(' - ');
  return [
    `NSR: ${String(nsr).padStart(9, '0')}`,
    `Data: ${dataBR(data)}`,
    '',
    `Nome: ${colaborador.nome}`,
    `CPF: ${cpfBR(colaborador.cpf)}`,
    colaborador.cargo ? `Cargo: ${colaborador.cargo}` : null,
    '',
    empresa.razao_social,
    empresa.cnpj || loja.cnpj ? `CNPJ: ${cnpjBR(loja.cnpj || empresa.cnpj)}` : null,
    loja.nome,
    endereco || null,
    '',
    'Marcações do dia:',
    ...ORDEM.map((k) => `${NOMES[k]}: ${marcas[k] ? hora(marcas[k]) : '--:--'}`),
    `Horas trabalhadas: ${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`,
    '',
    `Emitido por Vistoria ECV em ${emitido}`,
  ].filter((l) => l !== null);
}

function pdf(texto, hash) {
  const doc = new jsPDF({ unit: 'mm', format: [80, 42 + texto.length * 4.6] }); // formato de cupom
  doc.setFillColor(255, 251, 214);
  doc.rect(0, 0, 80, doc.internal.pageSize.getHeight(), 'F');
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('COMPROVANTE DE REGISTRO DE PONTO', 40, 10, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  let y = 18;
  for (const l of texto) {
    const partes = doc.splitTextToSize(l || ' ', 70);
    doc.text(partes, 5, y); y += partes.length * 4.4;
  }
  y += 2;
  doc.setFontSize(7.5);
  doc.text(doc.splitTextToSize(`Hash (SHA-256): ${hash}`, 70), 5, y);
  return Buffer.from(doc.output('arraybuffer'));
}

// Gera, guarda e envia. Roda depois da resposta do registro (não atrasa quem bateu o ponto).
export async function comprovanteDoDia(usuarioId, colaboradorId, data) {
  const ctx = await comoUsuario(usuarioId, async (db) => {
    const colaborador = (await db.query('select id, nome, cpf, cargo, celular, loja_id from colaboradores where id = $1', [colaboradorId])).rows[0];
    if (!colaborador) return null;
    const regs = (await db.query('select tipo, hora, loja_id from ponto_registros where colaborador_id = $1 and data = $2 and ativo order by hora', [colaboradorId, data])).rows;
    const lojaId = regs.at(-1)?.loja_id || colaborador.loja_id;
    const loja = (await db.query('select * from lojas where id = $1', [lojaId])).rows[0];
    const empresa = (await db.query('select razao_social, nome_fantasia, cnpj from empresas where id = $1', [loja.empresa_id])).rows[0];
    const nsr = (await db.query('select app_ponto_nsr($1) as n', [lojaId])).rows[0].n;
    const phone = await numeroDoGrupo(db, lojaId);
    return { colaborador, loja, empresa, nsr, phone, marcas: Object.fromEntries(regs.map((r) => [r.tipo, r.hora])) };
  });
  if (!ctx) return;
  const emitido = new Date().toLocaleString('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' });
  const texto = linhas({ ...ctx, data, emitido });
  const hash = crypto.createHash('sha256').update(texto.join('\n')).digest('hex').toUpperCase();
  const arquivo = pdf(texto, hash);
  const nome = `comprovante-ponto-${data}.pdf`;

  let envio = 'pendente', erro = null;
  const tel = ctx.colaborador.celular ? internacional(ctx.colaborador.celular) : null;
  if (!tel) envio = 'sem_celular';
  else if (!ctx.phone) envio = 'sem_whatsapp';
  else {
    try {
      const r = await enviarDocumento(ctx.phone, tel, { bytes: arquivo, nome, parametros: [ctx.colaborador.nome.split(' ')[0], dataBR(data)] });
      envio = r.status === 'simulada' ? 'simulado' : 'enviado';
    } catch (e) { envio = 'falhou'; erro = e.message; }
  }
  await comoUsuario(usuarioId, (db) => db.query(
    `insert into ponto_comprovantes (colaborador_id, loja_id, data, nsr, hash, pdf, telefone, envio, erro)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (colaborador_id, data) do update set loja_id = $2, nsr = $4, hash = $5, pdf = $6, telefone = $7, envio = $8, erro = $9, criado_em = now()`,
    [ctx.colaborador.id, ctx.loja.id, data, ctx.nsr, hash, arquivo, tel, envio, erro]));
}
