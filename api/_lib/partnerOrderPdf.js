import PDFDocument from 'pdfkit';
import {
  PAGE, MARGIN, CONTENT_W, PAGE_MARGINS, L, LINE, registerFonts, yen, fmtQty, fmtUnitPrice, fmtDate,
  drawHeader, drawTitle, drawSubjectAndMeta, drawSummary, drawBandHead, textV, paragraphV,
  drawTable, drawBreakdown, drawNotes, drawPageNumber, tableTop, rowsFor, packRows,
} from './docLayout.js';

// ============================================================================
// 発注書（CV → 連携先）の PDF（A4 縦）。納品書・請求書と同じ体裁。
//   宛名 = 連携先（御中）／発行元 = CV（社印）／表題「発注書」
//   発注日・発注書番号・登録番号／発注金額の帯／納期・納品先・支払条件の枠
//   「下記のとおり発注いたします。」／明細表／税率別内訳／備考
// ============================================================================

const KIND_LABEL = { cv: 'CV（自社）', client: 'クライアント直送', other: '' };

export function renderPartnerOrderPdf({ order, company, stamp, logo = null }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, info: { Title: `発注書 ${order.po_number || ''}` } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    registerFonts(pdf);

    const items = Array.isArray(order.line_items) ? order.line_items : [];
    const rows = items.map((li) => ({
      kind: 'item',
      cells: [`${li.name || ''}${Number(li.tax_rate) === 8 ? '（軽減8%）' : ''}`, `${fmtQty(li.quantity)} ${li.unit || ''}`.trim(), fmtUnitPrice(li.unit_price), yen(li.amount)],
    }));
    const columns = [['名称', 0, 'left'], ['数量', 63, 'center'], ['単価', 63, 'right'], ['金額', 88, 'right']];
    const summaryBottom = L.summaryY + L.headH + L.summaryBodyH;
    const bandBottom = summaryBottom + 8 + L.headH + 55;
    const tableY = tableTop(bandBottom + 14, { afterBank: true });
    const rowsPerPage = rowsFor(tableY);
    const pagedRows = packRows(pdf, rows, columns, rowsPerPage);
    const pages = pagedRows.length;
    try {
      for (let p = 0; p < pages; p++) {
        if (p > 0) pdf.addPage();
        drawPage(pdf, { order, company, stamp, logo, rows: pagedRows[p], rowsPerPage, page: p + 1, pages, columns });
      }
    } catch (err) { reject(err); return; }
    pdf.end();
  });
}

function drawOrderBand(pdf, y, { dueDate, deliveryTo, paymentTerms }) {
  const cols = [85, 120, L.bandW - 205];
  drawBandHead(pdf, MARGIN, y, cols, ['納期', '納品先', '支払条件']);
  const by = y + L.headH;
  const h = 55;
  pdf.lineWidth(0.8).rect(MARGIN, by, L.bandW, h).stroke(LINE);
  pdf.moveTo(MARGIN + cols[0], by).lineTo(MARGIN + cols[0], by + h).stroke(LINE);
  pdf.moveTo(MARGIN + cols[0] + cols[1], by).lineTo(MARGIN + cols[0] + cols[1], by + h).stroke(LINE);
  textV(pdf, fmtDate(dueDate), MARGIN, by, cols[0], h, { align: 'center', size: 9.5 });
  paragraphV(pdf, deliveryTo || '', MARGIN + cols[0] + 5, by + 2, cols[1] - 10, h - 4, { size: 7.5 });
  paragraphV(pdf, paymentTerms || '', MARGIN + cols[0] + cols[1] + 5, by + 2, cols[2] - 10, h - 4, { size: 7.5 });
  return by + h;
}

function drawPage(pdf, { order, company, stamp, logo, rows, rowsPerPage, page, pages, columns }) {
  drawHeader(pdf, {
    client: { postal: order.partner_postal_code, address: order.partner_address, name: order.partner_name, honorific: order.partner_honorific || '御中' },
    company,
    person: order.person_in_charge || company.representative || '',
    stamp,
    logo,
  });
  drawTitle(pdf, '発 注 書');
  drawSubjectAndMeta(pdf, order.title || '', [['発注日', fmtDate(order.order_date)], ['発注書番号', order.po_number], ['登録番号', company.registration_number || '']]);
  let y = drawSummary(pdf, { subtotal: order.subtotal, tax: order.tax, total: order.total, totalLabel: '発注金額' });
  const deliveryTo = [KIND_LABEL[order.delivery_to_kind] || '', order.delivery_to || ''].filter(Boolean).join('\n');
  y = drawOrderBand(pdf, y + 8, { dueDate: order.due_date, deliveryTo, paymentTerms: order.payment_terms });
  pdf.font('jp').fontSize(9).fillColor('#000').text('下記のとおり発注いたします。', MARGIN, y + 6, { lineBreak: false });
  y = tableTop(y + 14, { afterBank: true });
  const tableBottom = drawTable(pdf, y, { columns, rows, rowsPerPage });
  if (page === pages) {
    const breakdown = Array.isArray(order.tax_breakdown) && order.tax_breakdown.length ? order.tax_breakdown : [{ rate: 10, taxable: order.subtotal, tax: order.tax }];
    const bb = drawBreakdown(pdf, tableBottom, breakdown);
    drawNotes(pdf, bb, order.notes);
  }
  drawPageNumber(pdf, page, pages);
}
