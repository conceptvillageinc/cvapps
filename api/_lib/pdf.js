import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

// ============================================================================
// 納品書・請求書のPDF（A4縦）。freee で出していた帳票の骨格に合わせている:
//   宛名（御中）／自社情報／表題／件名・日付・番号／小計・消費税・合計の帯／
//   明細表（20行枠）／税率別内訳／備考
// 日本語フォントは Noto Sans JP（api/_lib/fonts）。
// ============================================================================

const FONT_DIR = path.join(process.cwd(), 'api', '_lib', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansJP-400.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSansJP-700.ttf');

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = PAGE.width - MARGIN * 2;
// 1ページの明細行数。請求書は入金期日・振込先の枠がある分、行数を減らす
const ROWS_PER_PAGE = { delivery: 20, invoice: 16 };

const yen = (n) => `${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`;
const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');
const fmtQty = (q) => {
  const n = Number(q);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? n.toLocaleString('ja-JP') : String(n);
};
const fmtUnitPrice = (p) => {
  const n = Number(p) || 0;
  return Number.isInteger(n) ? n.toLocaleString('ja-JP') : n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
};

/**
 * @param {object} opts
 * @param {'delivery'|'invoice'} opts.type
 * @param {object} opts.doc        delivery_notes / invoices の行
 * @param {object} opts.company    company_info
 * @param {Buffer|null} opts.stamp 印影PNG
 * @returns {Promise<Buffer>}
 */
export function renderDocumentPdf({ type, doc, company, stamp }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: titleOf(type, doc) } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    pdf.registerFont('jp', fs.readFileSync(FONT_REGULAR));
    pdf.registerFont('jp-bold', fs.readFileSync(FONT_BOLD));

    const items = Array.isArray(doc.line_items) ? doc.line_items : [];
    const rows = ROWS_PER_PAGE[type] || 20;
    const pages = Math.max(1, Math.ceil(items.length / rows));

    for (let p = 0; p < pages; p++) {
      if (p > 0) pdf.addPage();
      const pageItems = items.slice(p * rows, (p + 1) * rows);
      drawPage(pdf, { type, doc, company, stamp, items: pageItems, page: p + 1, pages, isLast: p === pages - 1 });
    }
    pdf.end();
  });
}

function titleOf(type, doc) {
  return type === 'invoice' ? `御請求書 ${doc.invoice_number}` : `納品書 ${doc.delivery_number}`;
}

function drawPage(pdf, { type, doc, company, stamp, items, page, pages, isLast }) {
  const isInvoice = type === 'invoice';
  const rowsPerPage = ROWS_PER_PAGE[type] || 20;
  let y = MARGIN;

  // ---- 宛名（左） ----
  pdf.font('jp').fontSize(9).fillColor('#000');
  const postal = doc.client_postal_code ? formatPostal(doc.client_postal_code) : '';
  if (postal) { pdf.text(postal, MARGIN, y); y += 12; }
  if (doc.client_address) { pdf.text(doc.client_address, MARGIN, y, { width: 260 }); y += 12; }
  y += 4;
  pdf.font('jp-bold').fontSize(13).text(`${doc.client_name} ${doc.client_honorific || '御中'}`, MARGIN, y, { width: 280 });

  // ---- 自社情報（右） ----
  const rx = 330;
  let ry = MARGIN;
  pdf.font('jp').fontSize(10).text(`${company.name}${company.representative ? `　${company.representative}` : ''}`, rx, ry, { width: 225 });
  ry += 18;
  pdf.fontSize(7).fillColor('#333');
  for (const loc of company.locations || []) {
    pdf.text(`［${loc.label}］`, rx, ry); ry += 9;
    pdf.text(`〒${formatPostal(loc.postal)}　${loc.address}`, rx, ry, { width: 225 }); ry += 9;
    // 納品書は福島のみ（freee 版の体裁に合わせる）
    if (!isInvoice) break;
  }
  const telFax = [company.tel ? `tel ${company.tel}` : '', company.fax ? `fax ${company.fax}` : ''].filter(Boolean).join(' | ');
  if (telFax) { pdf.text(telFax, rx, ry); ry += 9; }
  pdf.fillColor('#000');

  // 印影（自社情報に重ねる）
  if (stamp) {
    try { pdf.image(stamp, 500, MARGIN - 6, { width: 52 }); } catch { /* 画像が読めなければ省略 */ }
  }

  // ---- 表題 ----
  y = 150;
  pdf.font('jp-bold').fontSize(18).text(isInvoice ? '御請求書' : '納品書', MARGIN, y, { width: CONTENT_W, align: 'center' });

  // ---- 件名・日付・番号 ----
  y = 190;
  pdf.font('jp').fontSize(9);
  pdf.text('件名', MARGIN, y + 14);
  pdf.font('jp-bold').fontSize(11).text(doc.title || '', MARGIN + 50, y + 12, { width: 260 });

  const metaX = 360;
  const metaValX = 450;
  const meta = isInvoice
    ? [['請求日', fmtDate(doc.invoice_date)], ['請求書番号', doc.invoice_number], ['登録番号', company.registration_number || '']]
    : [['納品日', fmtDate(doc.delivery_date)], ['納品書番号', doc.delivery_number]];
  pdf.font('jp').fontSize(9);
  meta.forEach(([k, v], i) => {
    pdf.text(k, metaX, y + i * 14);
    pdf.text(v || '', metaValX, y + i * 14, { width: 105, align: 'right' });
  });

  // ---- 小計・消費税・合計の帯 ----
  y = 250;
  const bandW = 300;
  const cols = [80, 100, 120];
  pdf.rect(MARGIN, y, bandW, 14).fill('#000');
  pdf.fillColor('#fff').font('jp').fontSize(8);
  const bandLabels = ['小計', '消費税', isInvoice ? '請求金額' : '合計金額'];
  let bx = MARGIN;
  bandLabels.forEach((l, i) => { pdf.text(l, bx, y + 3, { width: cols[i], align: 'center' }); bx += cols[i]; });
  pdf.fillColor('#000');
  pdf.rect(MARGIN, y + 14, bandW, 24).stroke('#999');
  bx = MARGIN;
  [yen(doc.subtotal) + '円', yen(doc.tax) + '円'].forEach((v, i) => {
    pdf.font('jp').fontSize(9).text(v, bx, y + 21, { width: cols[i] - 6, align: 'right' }); bx += cols[i];
  });
  pdf.font('jp-bold').fontSize(14).text(yen(doc.total) + '円', bx, y + 17, { width: cols[2] - 6, align: 'right' });

  // ---- 入金期日・振込先（請求書のみ） ----
  y += 46;
  if (isInvoice) {
    const accounts = company.bank_accounts || [];
    const h = Math.max(30, 10 + accounts.length * 22);
    pdf.rect(MARGIN, y, bandW, 14).fill('#000');
    pdf.fillColor('#fff').font('jp').fontSize(8);
    pdf.text('入金期日', MARGIN, y + 3, { width: 90, align: 'center' });
    pdf.text('振込先', MARGIN + 90, y + 3, { width: bandW - 90, align: 'center' });
    pdf.fillColor('#000');
    pdf.rect(MARGIN, y + 14, bandW, h).stroke('#999');
    pdf.moveTo(MARGIN + 90, y + 14).lineTo(MARGIN + 90, y + 14 + h).stroke('#999');
    pdf.font('jp').fontSize(9).text(fmtDate(doc.due_date), MARGIN, y + 14 + h / 2 - 5, { width: 90, align: 'center' });
    accounts.forEach((b, i) => {
      const ly = y + 19 + i * 22;
      pdf.fontSize(8).text(`${b.bank} ${b.branch}（${b.type}）${b.number}`, MARGIN + 96, ly, { width: bandW - 100, lineBreak: false });
      if (b.holder) pdf.fontSize(6.5).fillColor('#333').text(b.holder, MARGIN + 96, ly + 10, { width: bandW - 100, lineBreak: false });
      pdf.fillColor('#000');
    });
    y += 14 + h + 12;
  } else {
    y += 4;
  }

  // ---- 明細表 ----
  const tableY = Math.max(y, isInvoice ? 380 : 320);
  const colDefs = isInvoice
    ? [['取引日', 70, 'center'], ['摘要', 235, 'left'], ['数量', 60, 'right'], ['単価', 70, 'right'], ['明細金額', 80, 'right']]
    : [['摘要', 305, 'left'], ['数量', 60, 'right'], ['単価', 70, 'right'], ['明細金額', 80, 'right']];
  const rowH = 16;
  pdf.rect(MARGIN, tableY, CONTENT_W, rowH).fill('#000');
  pdf.fillColor('#fff').font('jp').fontSize(8);
  let cx = MARGIN;
  for (const [label, w, align] of colDefs) {
    pdf.text(label, cx + 4, tableY + 4, { width: w - 8, align });
    cx += w;
  }
  pdf.fillColor('#000');

  for (let i = 0; i < rowsPerPage; i++) {
    const ry2 = tableY + rowH + i * rowH;
    const li = items[i];
    pdf.rect(MARGIN, ry2, CONTENT_W, rowH).fillAndStroke(i % 2 === 0 ? '#f2f2f2' : '#ffffff', '#cccccc');
    pdf.fillColor('#000').font('jp').fontSize(8);
    if (!li) continue;
    const cells = isInvoice
      ? [fmtDate(li.transaction_date), li.name || '', `${fmtQty(li.quantity)} ${li.unit || ''}`.trim(), fmtUnitPrice(li.unit_price), yen(li.amount)]
      : [li.name || '', `${fmtQty(li.quantity)} ${li.unit || ''}`.trim(), fmtUnitPrice(li.unit_price), yen(li.amount)];
    const reduced = Number(li.tax_rate) === 8 ? '（軽減8%）' : '';
    cx = MARGIN;
    colDefs.forEach(([, w, align], ci) => {
      let text = cells[ci];
      if (colDefs[ci][0] === '摘要' && reduced) text = `${text}${reduced}`;
      pdf.text(text, cx + 4, ry2 + 4, { width: w - 8, align, lineBreak: false, ellipsis: true });
      cx += w;
    });
  }

  // ---- 税率別内訳（最終ページ） ----
  let by = tableY + rowH * (rowsPerPage + 1) + 10;
  if (isLast) {
    const breakdown = Array.isArray(doc.tax_breakdown) && doc.tax_breakdown.length > 0
      ? doc.tax_breakdown
      : [{ rate: 10, taxable: doc.subtotal, tax: doc.tax }];
    const bwX = 330;
    const bwW = PAGE.width - MARGIN - bwX;
    const bh = 8 + breakdown.length * 22;
    pdf.rect(bwX, by, bwW, bh).stroke('#999');
    let ly = by + 5;
    for (const b of breakdown) {
      pdf.font('jp').fontSize(8).text(`内訳　${b.rate}%対象(税抜)`, bwX + 6, ly);
      pdf.text(`${yen(b.taxable)}円`, bwX, ly, { width: bwW - 6, align: 'right' });
      pdf.fontSize(6.5).fillColor('#333').text(`${b.rate}%消費税`, bwX + 40, ly + 11);
      pdf.text(`${yen(b.tax)}円`, bwX, ly + 11, { width: bwW - 6, align: 'right' });
      pdf.fillColor('#000');
      ly += 22;
    }
    if (breakdown.some((b) => Number(b.rate) === 8)) {
      pdf.fontSize(6.5).fillColor('#333').text('（軽減8%）は軽減税率対象', bwX, by + bh + 3, { width: bwW, align: 'right' });
      pdf.fillColor('#000');
    }
    by += bh + 14;

    // ---- 備考 ----
    const notes = doc.notes || '';
    const nh = 60;
    pdf.rect(MARGIN, by, CONTENT_W, nh).stroke('#999');
    pdf.font('jp').fontSize(8).text('備考', MARGIN + 6, by + 5);
    pdf.text(notes, MARGIN + 6, by + 17, { width: CONTENT_W - 12, height: nh - 20, ellipsis: true });
  }

  // ---- ページ番号 ----
  // 下余白の内側に置く（余白を越えると pdfkit が勝手に改ページする）
  pdf.font('jp').fontSize(8).fillColor('#333')
    .text(`${page} / ${pages}`, MARGIN, PAGE.height - MARGIN - 12, { width: CONTENT_W, align: 'center', lineBreak: false });
  pdf.fillColor('#000');
}

function formatPostal(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : String(v || '');
}
