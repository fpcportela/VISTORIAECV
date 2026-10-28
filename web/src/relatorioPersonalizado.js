// PDF do relatório personalizado (A4 deitado): logo do grupo, filtros, colunas escolhidas,
// linhas agrupadas com subtotal e o total geral. As bibliotecas só carregam quando usado.

const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// baixar = false devolve o PDF (Blob) em vez de baixar, para anexar em outro lugar
export async function gerarPdfRelatorio({ titulo, empresa, logo, filtros, cols, grupos, agrupado, baixar = true }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--forte').trim() || '#0774B8';
  const rgb = cor.match(/[0-9a-f]{2}/gi)?.map((h) => parseInt(h, 16)) || [7, 116, 184];

  let x = 14;
  if (logo) {
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = logo; });
    if (img?.width) {
      const escala = Math.min(14 / img.height, 45 / img.width);
      const w = img.width * escala, h = img.height * escala;
      doc.addImage(logo, /^data:image\/(\w+)/.exec(logo)[1].toUpperCase(), 14, 8 + (14 - h) / 2, w, h);
      x = 14 + w + 5;
    }
  }
  doc.setFontSize(16);
  doc.text(titulo, x, 14);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(empresa || '', x, 20);
  doc.text(filtros.join('  ·  ') || 'Sem filtros', 14, 27, { maxWidth: 250 });
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, 283, 14, { align: 'right' });

  const soma = (lista, id) => lista.reduce((t, v) => t + Number(v[id] || 0), 0);
  const celula = (c, v) => (c.soma ? moeda(v[c.id]) : String(c.valor(v) ?? ''));
  const corpo = [];
  const tipos = [];
  for (const [nome, lista] of grupos) {
    if (agrupado) {
      corpo.push([{ content: `${nome} (${lista.length})`, colSpan: cols.length }]); tipos.push('grupo');
    }
    for (const v of lista) { corpo.push(cols.map((c) => celula(c, v))); tipos.push('linha'); }
    if (agrupado && cols.some((c) => c.soma)) {
      corpo.push(cols.map((c, i) => (c.soma ? moeda(soma(lista, c.id)) : i === 0 ? 'Subtotal' : ''))); tipos.push('subtotal');
    }
  }
  const todas = grupos.flatMap(([, l]) => l);
  autoTable(doc, {
    startY: 32,
    head: [cols.map((c) => c.nome)],
    body: corpo,
    foot: [cols.map((c, i) => (c.soma ? moeda(soma(todas, c.id)) : i === 0 ? `TOTAL · ${todas.length} registro(s)` : ''))],
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: rgb },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, c.soma ? { halign: 'right' } : {}])),
    didParseCell: (d) => {
      if (d.section === 'head' || d.section === 'foot') { if (cols[d.column.index]?.soma) d.cell.styles.halign = 'right'; return; }
      const t = tipos[d.row.index];
      if (t === 'grupo') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [232, 238, 247]; d.cell.styles.textColor = 20; }
      if (t === 'subtotal') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [250, 251, 253]; }
    },
  });
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Página ${i} de ${paginas}`, 283, 203, { align: 'right' });
  }
  if (!baixar) return doc.output('blob');
  doc.save(`relatorio-${new Date().toISOString().slice(0, 10)}.pdf`);
  return null;
}
