import PDFDocument from 'pdfkit';
import {
  PAGE_MARGINS, registerFonts, yen, fmtQty, fmtUnitPrice, fmtDate,
  drawHeader, drawTitle, drawSubjectAndMeta, drawSummary, drawBankBand,
  drawTable, drawBreakdown, drawNotes, drawPageNumber, tableTop, rowsFor,
} from './docLayout.js';

// ============================================================================
// 納品書・請求書のPDF（A4縦）。レイアウトは api/_lib/docLayout.js（見積書と共通）。
//   宛名（御中）／自社情報／表題／件名・日付・番号／小計・消費税・合計の帯／
//   請求書は入金期日・振込先／明細表（固定行数）／税率別内訳／備考
// ============================================================================

/**
 * @param {object} opts
 * @param {'delivery'|'invoice'} opts.type
 * @param {object} opts.doc        delivery_notes / invoices の行
 * @param {object} opts.company    company_info
 * @param {Buffer|null} opts.stamp 印影PNG
 * @param {Buffer|null} [opts.logo] ロゴ画像
 * @returns {Promise<Buffer>}
 */
export function renderDocumentPdf({ type, doc, company, stamp, logo = null }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, info: { Title: titleOf(type, doc) } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    registerFonts(pdf);

    const isInvoice = type === 'invoice';
    const items = Array.isArray(doc.line_items) ? doc.line_items : [];
    const rows = items.map((li) => {
      const reduced = Number(li.tax_rate) === 8 ? '（軽減8%）' : '';
      const name = `${li.name || ''}${reduced}`;
      const qty = `${fmtQty(li.quantity)} ${li.unit || ''}`.trim();
      return {
        kind: 'item',
        cells: isInvoice
          ? [fmtDate(li.transaction_date), name, qty, fmtUnitPrice(li.unit_price), yen(li.amount)]
          : [name, qty, fmtUnitPrice(li.unit_price), yen(li.amount)],
      };
    });

    // 表の開始位置は帯の下（請求書は振込先の枠の下）。行数はそこから決まる
    const summaryBottom = 287 + 16 + 26;
    const tableY = isInvoice ? tableTop(summaryBottom + 8 + 16 + 55, { afterBank: true }) : tableTop(summaryBottom);
    const rowsPerPage = rowsFor(tableY);
    const pages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

    try {
      for (let p = 0; p < pages; p++) {
        if (p > 0) pdf.addPage();
        drawPage(pdf, { type, doc, company, stamp, logo, rows: rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage), rowsPerPage, page: p + 1, pages });
      }
    } catch (err) {
      reject(err);
      return;
    }
    pdf.end();
  });
}

function titleOf(type, doc) {
  return type === 'invoice' ? `御請求書 ${doc.invoice_number}` : `納品書 ${doc.delivery_number}`;
}

function drawPage(pdf, { type, doc, company, stamp, logo, rows, rowsPerPage, page, pages }) {
  const isInvoice = type === 'invoice';

  drawHeader(pdf, {
    client: { postal: doc.client_postal_code, address: doc.client_address, name: doc.client_name, honorific: doc.client_honorific || '御中' },
    company,
    person: doc.person_in_charge || company.representative || '',
    stamp,
    logo,
  });

  drawTitle(pdf, isInvoice ? '御請求書' : '納品書');

  const meta = isInvoice
    ? [['請求日', fmtDate(doc.invoice_date)], ['請求書番号', doc.invoice_number], ['登録番号', company.registration_number || '']]
    : [['納品日', fmtDate(doc.delivery_date)], ['納品書番号', doc.delivery_number], ['登録番号', company.registration_number || '']];
  drawSubjectAndMeta(pdf, doc.title || '', meta);

  let y = drawSummary(pdf, { subtotal: doc.subtotal, tax: doc.tax, total: doc.total, totalLabel: isInvoice ? '請求金額' : '合計金額' });
  if (isInvoice) {
    y = drawBankBand(pdf, y + 8, { dueDate: doc.due_date, accounts: company.bank_accounts || [] });
    y = tableTop(y, { afterBank: true });
  } else {
    y = tableTop(y);
  }

  const columns = isInvoice
    ? [['取引日', 82, 'center'], ['摘要', 0, 'left'], ['数量', 63, 'center'], ['単価', 63, 'right'], ['明細金額', 88, 'right']]
    : [['摘要', 0, 'left'], ['数量', 63, 'center'], ['単価', 63, 'right'], ['明細金額', 88, 'right']];
  const tableBottom = drawTable(pdf, y, { columns, rows, rowsPerPage });

  if (page === pages) {
    const breakdown = Array.isArray(doc.tax_breakdown) && doc.tax_breakdown.length > 0
      ? doc.tax_breakdown
      : [{ rate: 10, taxable: doc.subtotal, tax: doc.tax }];
    const bb = drawBreakdown(pdf, tableBottom, breakdown);
    drawNotes(pdf, bb, doc.notes);
  }

  drawPageNumber(pdf, page, pages);
}
