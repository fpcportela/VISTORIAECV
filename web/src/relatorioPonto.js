// PDF do relatório do ponto: uma página por colaborador com os dias do mês, as marcações,
// as horas, a justificativa, e embaixo o nome do colaborador com a linha para assinatura.

const FUSO = 'America/Sao_Paulo';
const ORDEM = ['entrada', 'saida_intervalo', 'volta_intervalo', 'saida'];
const NOMES = { entrada: 'Entrada', saida_intervalo: 'Saída almoço', volta_intervalo: 'Volta almoço', saida: 'Saída' };
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
const duracao = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const cpfBR = (c) => (String(c || '').length === 11 ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : 'NÃO INFORMADO');
const cnpjBR = (c) => (String(c || '').length === 14 ? c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : '');
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function minutos(m) {
  const t = (k) => (m[k] ? new Date(m[k].hora).getTime() : null);
  const trecho = (a, b) => (t(a) && t(b) && t(b) > t(a) ? (t(b) - t(a)) / 60000 : 0);
  if (!m.saida_intervalo && !m.volta_intervalo) return trecho('entrada', 'saida');
  return trecho('entrada', 'saida_intervalo') + trecho('volta_intervalo', 'saida');
}

export async function gerarPdfPonto({ loja, colaboradores, mes }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--forte').trim() || '#0774B8';
  const rgb = cor.match(/[0-9a-f]{2}/gi)?.map((h) => parseInt(h, 16)) || [7, 116, 184];
  const [ano, m] = mes.split('-').map(Number);
  const dias = Array.from({ length: new Date(ano, m, 0).getDate() }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
  const logo = loja.logo ? await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = loja.logo; }) : null;

  colaboradores.forEach((c, n) => {
    if (n > 0) doc.addPage();
    let x = 14;
    if (logo?.width) {
      const esc = Math.min(14 / logo.height, 40 / logo.width);
      doc.addImage(loja.logo, /^data:image\/(\w+)/.exec(loja.logo)[1].toUpperCase(), 14, 8 + (14 - logo.height * esc) / 2, logo.width * esc, logo.height * esc);
      x = 14 + logo.width * esc + 5;
    }
    doc.setTextColor(20); doc.setFontSize(14);
    doc.text(`Espelho de ponto · ${String(m).padStart(2, '0')}/${ano}`, x, 13);
    doc.setFontSize(9); doc.setTextColor(90);
    doc.text([loja.razao_social, [loja.nome, cnpjBR(loja.cnpj || loja.cnpj_grupo) && `CNPJ ${cnpjBR(loja.cnpj || loja.cnpj_grupo)}`].filter(Boolean).join(' · ')], x, 18);
    doc.setTextColor(20); doc.setFontSize(10);
    doc.text(`Colaborador: ${c.nome}`, 14, 31);
    doc.text(`CPF: ${cpfBR(c.cpf)}${c.cargo ? `   ·   Cargo: ${c.cargo}` : ''}`, 14, 36);

    const doDia = (d) => Object.fromEntries(c.registros.filter((r) => r.data === d).map((r) => [r.tipo, r]));
    let total = 0;
    const corpo = dias.map((d) => {
      const marcas = doDia(d);
      const min = minutos(marcas); total += min;
      const sem = new Date(`${d}T12:00:00`).getDay();
      return [
        `${d.slice(8)}/${d.slice(5, 7)} ${SEMANA[sem]}`,
        ...ORDEM.map((k) => (marcas[k] ? `${hora(marcas[k].hora)}${marcas[k].ajuste ? '*' : ''}` : '')),
        min ? duracao(min) : '',
        c.justificativas.find((j) => j.data === d)?.texto || '',
      ];
    });
    autoTable(doc, {
      startY: 40,
      head: [['Dia', ...ORDEM.map((k) => NOMES[k]), 'Horas', 'Justificativa']],
      body: corpo,
      foot: [['Total', '', '', '', '', duracao(total), '']],
      styles: { fontSize: 7.5, cellPadding: 1.1 },
      headStyles: { fillColor: rgb },
      footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 18 }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { cellWidth: 60 } },
      didParseCell: (h) => {
        if (h.section !== 'body') return;
        const sem = new Date(`${dias[h.row.index]}T12:00:00`).getDay();
        if (sem === 0 || sem === 6) h.cell.styles.fillColor = [246, 247, 249];
      },
      margin: { bottom: 40 },
    });

    // assinatura no pé da página
    const altura = doc.internal.pageSize.getHeight();
    let y = Math.max(doc.lastAutoTable.finalY + 8, altura - 38);
    if (y > altura - 20) { doc.addPage(); y = 40; }
    doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text('* horário editado (o registro original fica guardado no sistema).', 14, y - 2);
    doc.setDrawColor(60); doc.setTextColor(20); doc.setFontSize(10);
    doc.line(14, y + 16, 100, y + 16);
    doc.text(c.nome, 14, y + 21);
    doc.setFontSize(8); doc.setTextColor(90);
    doc.text(`CPF: ${cpfBR(c.cpf)} · Assinatura do colaborador`, 14, y + 25);
    doc.line(116, y + 16, 196, y + 16);
    doc.setTextColor(20); doc.setFontSize(10);
    doc.text('Responsável', 116, y + 21);
  });

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · Página ${i} de ${paginas}`, 196, 290, { align: 'right' });
  }
  const nome = colaboradores.length === 1 ? colaboradores[0].nome.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'equipe';
  doc.save(`ponto-${nome}-${mes}.pdf`);
}
