import { formatarDoc } from './documentos.js';

const real = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const SITUACOES = { aberta: 'Aberta', finalizada: 'Finalizada', cancelada: 'Cancelada' };

// Gera o PDF da lista de vendas filtrada (A4 deitado) e baixa o arquivo.
// As bibliotecas só são carregadas quando o botão é usado.
export async function gerarPdfVendas({ lista, filtros, empresa }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--forte').trim() || '#0774B8';
  const rgb = cor.match(/[0-9a-f]{2}/gi)?.map((h) => parseInt(h, 16)) || [7, 116, 184];

  doc.setFontSize(16);
  doc.text('Relatório de vendas', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(empresa || '', 14, 22);
  doc.text(filtros.join('  ·  ') || 'Sem filtros', 14, 27, { maxWidth: 200 });
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, 283, 16, { align: 'right' });

  const validas = lista.filter((v) => v.situacao !== 'cancelada');
  autoTable(doc, {
    startY: 32,
    head: [['Nº', 'Data', 'Cliente', 'CPF/CNPJ', 'Placas', 'Loja', 'Situação', 'Desconto', 'Total']],
    body: lista.map((v) => [v.numero, dataBR(v.data_venda), v.cliente, formatarDoc(v.cpf_cnpj), v.placas || '',
      v.loja, SITUACOES[v.situacao], v.desconto ? real(v.desconto) : '', real(v.valor_total)]),
    foot: [['', '', `${lista.length} registro(s)`, '', '', '', 'Vendas (sem canceladas)', '', real(validas.reduce((t, v) => t + v.valor_total, 0))]],
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: rgb },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 12 }, 7: { halign: 'right' }, 8: { halign: 'right' } },
    didParseCell: (d) => {
      if (d.section !== 'body' || lista[d.row.index]?.situacao !== 'cancelada') return;
      d.cell.styles.textColor = d.column.index === 6 ? [197, 34, 31] : [150, 150, 150];
      if (d.column.index === 6) d.cell.styles.fontStyle = 'bold';
    },
  });
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Página ${i} de ${paginas}`, 283, 203, { align: 'right' });
  }
  doc.save(`vendas-${new Date().toISOString().slice(0, 10)}.pdf`);
}
