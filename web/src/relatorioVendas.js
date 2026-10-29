import { formatarDoc } from './documentos.js';

const real = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const SITUACOES = { aberta: 'Aberta', finalizada: 'Finalizada', cancelada: 'Cancelada' };

// Gera o PDF da lista de vendas filtrada (A4 deitado) e baixa o arquivo.
// As bibliotecas só são carregadas quando o botão é usado.
export async function gerarPdfVendas({ lista, filtros, empresa, logo }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--forte').trim() || '#0774B8';
  const rgb = cor.match(/[0-9a-f]{2}/gi)?.map((h) => parseInt(h, 16)) || [7, 116, 184];

  // logo do grupo no canto esquerdo (até 14 mm de altura e 45 mm de largura); o texto vem ao lado
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
  doc.text('Relatório de vendas', x, 14);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(empresa || '', x, 20);
  doc.text(filtros.join('  ·  ') || 'Sem filtros', 14, 27, { maxWidth: 200 });
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, 283, 16, { align: 'right' });

  const validas = lista.filter((v) => v.situacao !== 'cancelada');
  // Venda com vários veículos: a linha da venda mostra DIVERSOS e, logo abaixo do cliente,
  // uma linha por veículo (placa e marca/modelo), com recuo.
  const linhas = [];
  const corpo = [];
  for (const v of lista) {
    const veiculos = v.veiculos || [];
    const varios = veiculos.length > 1;
    linhas.push({ venda: v });
    corpo.push([v.numero, dataBR(v.data_venda), v.cliente, formatarDoc(v.cpf_cnpj), varios ? 'DIVERSOS' : veiculos[0]?.placa || '',
      varios ? `${veiculos.length} veículos` : veiculos[0]?.modelo || '', v.loja, SITUACOES[v.situacao], v.desconto ? real(v.desconto) : '', real(v.valor_total)]);
    if (varios) {
      for (const ve of veiculos) {
        linhas.push({ venda: v, veiculo: true });
        corpo.push(['', '', { content: `${ve.placa}${ve.modelo ? `   ${ve.modelo}` : ''}`, colSpan: 8, styles: { cellPadding: { top: 0.6, bottom: 0.6, left: 6, right: 1.8 } } }]);
      }
    }
  }
  autoTable(doc, {
    startY: 32,
    head: [['Nº', 'Data', 'Cliente', 'CPF/CNPJ', 'Placa', 'Marca/Modelo', 'Loja', 'Situação', 'Desconto', 'Total']],
    body: corpo,
    foot: [['', '', `${lista.length} registro(s)`, '', '', '', '', 'Vendas (sem canceladas)', '', real(validas.reduce((t, v) => t + v.valor_total, 0))]],
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: rgb },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 12 }, 5: { cellWidth: 48 }, 8: { halign: 'right' }, 9: { halign: 'right' } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      const l = linhas[d.row.index];
      if (l?.veiculo) { d.cell.styles.fontSize = 7.5; d.cell.styles.textColor = [70, 70, 70]; d.cell.styles.fillColor = [250, 251, 253]; }
      if (l?.venda.situacao !== 'cancelada') return;
      d.cell.styles.textColor = d.column.index === 7 && !l.veiculo ? [197, 34, 31] : [150, 150, 150];
      if (d.column.index === 7) d.cell.styles.fontStyle = 'bold';
    },
  });
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Página ${i} de ${paginas}`, 283, 203, { align: 'right' });
  }
  doc.save(`vendas-${new Date().toISOString().slice(0, 10)}.pdf`);
}
