import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { estimateTotals } from './estimatePdf.js';

// ============================================================================
// 発注書の雛形（A4縦）。見積書の内容から作り、クライアントが CV へ発注するときに使う。
//
//   宛先   = CV（自社）。社名のみで「御中」は付けない（クライアントの要望）
//   発行元 = クライアント（クライアント一覧の住所・担当者を入れ、空欄は手書きできるように罫線）
//   内容   = 見積の明細（税抜・消費税・税込）と「上記のとおり発注いたします」の文言
//   署名欄 = 発注日／会社名／ご担当者／ご署名（印）
//   印影は押さない（クライアントが記入する書類のため）
// 番号は「見積番号-PO」。
// ============================================================================

const FONT_DIR = path.join(process.cwd(), 'api', '_lib', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansJP-400.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSansJP-700.ttf');

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = PAGE.width - MARGIN * 2;
const BOTTOM = PAGE.height - MARGIN - 18;

const yen = (n) => `${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`;
const signedYen = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('ja-JP')}`; };
const fmtQty = (q) => { const n = Number(q); return Number.isFinite(n) ? (Number.isInteger(n) ? n.toLocaleString('ja-JP') : String(n)) : ''; };
const fmtDate = (d) => (d ? String(d).slice(0, 10).replace(/-/g, '/') : '');
const formatPostal = (v) => { const d = String(v || '').replace(/[^0-9]/g, ''); return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : String(v || ''); };

export function purchaseOrderFilename(estimate) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim();
  return `【${clean(estimate.client_name) || 'クライアント'}】発注書_${clean(estimate.estimate_title) || clean(estimate.estimate_number)}.pdf`;
}

const COLS = [['名称', 0, 'left'], ['数量', 52, 'right'], ['単位', 40, 'right'], ['単価', 78, 'right'], ['金額', 88, 'right']];
const NAME_W = CONTENT_W - COLS.slice(1).reduce((s, c) => s + c[1], 0);
const HEAD_H = 16;

function drawTableHeader(pdf, y, taxInclusive) {
  pdf.rect(MARGIN, y, CONTENT_W, HEAD_H).fill('#1e293b');
  pdf.fillColor('#fff').font('jp').fontSize(8);
  let x = MARGIN;
  for (const [label0, w0, align] of COLS) {
    const w = w0 || NAME_W;
    const label = taxInclusive && (label0 === '単価' || label0 === '金額') ? `${label0}(税込)` : label0;
    pdf.text(label, x + 4, y + 4, { width: w - 8, align, lineBreak: false });
    x += w;
  }
  pdf.fillColor('#000');
  return y + HEAD_H;
}

/**
 * @param {object} opts
 * @param {object} opts.estimate  estimates の行
 * @param {object} opts.client    clients の行（無くてもよい）
 * @param {object} opts.company   company_info（宛先として使う）
 */
export function renderPurchaseOrderPdf({ estimate, client, company }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: `発注書 ${estimate.estimate_number || ''}` } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.registerFont('jp', fs.readFileSync(FONT_REGULAR));
    pdf.registerFont('jp-bold', fs.readFileSync(FONT_BOLD));
    try {
      draw(pdf, { estimate, client: client || {}, company });
    } catch (err) { reject(err); return; }
    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      pdf.font('jp').fontSize(8).fillColor('#555').text(`${i + 1} / ${range.count}`, MARGIN, PAGE.height - MARGIN - 16, { width: CONTENT_W, align: 'center', lineBreak: false });
    }
    pdf.fillColor('#000');
    pdf.end();
  });
}

function draw(pdf, { estimate, client, company }) {
  const items = Array.isArray(estimate.line_items) ? estimate.line_items : [];
  const taxInclusive = !!estimate.tax_inclusive;
  const totals = estimateTotals(items, taxInclusive);
  let y = MARGIN;

  // ---- 宛先 = CV ----
  pdf.font('jp').fontSize(8.5).fillColor('#333');
  const loc = (company.locations || [])[0];
  if (loc) { pdf.text(`〒${formatPostal(loc.postal)}　${loc.address}`, MARGIN, y, { width: 280 }); y += pdf.heightOfString(`〒${formatPostal(loc.postal)}　${loc.address}`, { width: 280 }) + 3; }
  pdf.font('jp-bold').fontSize(13).fillColor('#000');
  const toLine = company.name;
  pdf.text(toLine, MARGIN, y, { width: 280 });
  const toH = pdf.heightOfString(toLine, { width: 280 });
  pdf.moveTo(MARGIN, y + toH + 2).lineTo(MARGIN + Math.min(280, pdf.widthOfString(toLine) + 4), y + toH + 2).lineWidth(1.2).stroke('#1e293b');
  const leftBottom = y + toH + 8;

  // ---- 発行元 = クライアント（右） ----
  const rx = 320;
  const rw = PAGE.width - MARGIN - rx;
  let ry = MARGIN;
  pdf.font('jp').fontSize(7).fillColor('#555').text('発注者', rx, ry, { width: rw, align: 'right', lineBreak: false }); ry += 10;
  pdf.font('jp-bold').fontSize(10).fillColor('#000');
  pdf.text(estimate.client_name || '', rx, ry, { width: rw, align: 'right' }); ry += pdf.heightOfString(estimate.client_name || '', { width: rw }) + 2;
  pdf.font('jp').fontSize(7.5).fillColor('#333');
  const addr = [client.postal_code ? `〒${formatPostal(client.postal_code)}` : '', client.address || ''].filter(Boolean).join('　');
  const rline = (t) => { pdf.text(t, rx, ry, { width: rw, align: 'right' }); ry += pdf.heightOfString(t, { width: rw }) + 1; };
  rline(addr || '住所: ____________________________');
  rline(client.contact_person ? `ご担当: ${client.contact_person}` : 'ご担当: ______________');
  rline(client.phone ? `tel ${client.phone}` : 'tel ______________');
  pdf.fillColor('#000');

  y = Math.max(leftBottom, ry) + 8;
  pdf.font('jp-bold').fontSize(17).fillColor('#1e293b').text('発 注 書', MARGIN, y, { width: CONTENT_W, align: 'center', characterSpacing: 2 });
  y += 30;

  // ---- 件名・番号・発注日 ----
  pdf.font('jp').fontSize(8).fillColor('#555').text('件名', MARGIN, y, { lineBreak: false });
  pdf.font('jp-bold').fontSize(11).fillColor('#000');
  const title = estimate.estimate_title || '—';
  pdf.text(title, MARGIN, y + 11, { width: 300 });
  const titleH = pdf.heightOfString(title, { width: 300 });
  const metaX = 380; const metaValX = 450;
  const meta = [['発注日', '　　　年　　月　　日'], ['発注書番号', `${estimate.estimate_number || ''}-PO`], ['御見積書番号', estimate.estimate_number || '']];
  pdf.font('jp').fontSize(8.5);
  meta.forEach(([k, v], i) => {
    pdf.fillColor('#555').text(k, metaX, y + i * 12, { lineBreak: false });
    pdf.fillColor('#000').text(v, metaValX, y + i * 12, { width: PAGE.width - MARGIN - metaValX, align: 'right', lineBreak: false });
  });
  y += Math.max(11 + titleH, meta.length * 12) + 8;

  // ---- 文言 ----
  pdf.font('jp').fontSize(9).fillColor('#000');
  const lead = `御見積書（${estimate.estimate_number || ''}）の内容にて、下記のとおり発注いたします。`;
  pdf.text(lead, MARGIN, y, { width: CONTENT_W });
  y += pdf.heightOfString(lead, { width: CONTENT_W }) + 8;

  // ---- 金額の帯 ----
  const bandH = 26;
  pdf.rect(MARGIN, y, CONTENT_W, bandH).fillAndStroke('#f1f5f9', '#cbd5e1');
  pdf.fillColor('#555').font('jp').fontSize(8).text('発注金額（税込）', MARGIN + 10, y + 9, { lineBreak: false });
  pdf.fillColor('#1e3a8a').font('jp-bold').fontSize(15).text(`${yen(totals.total)}円`, MARGIN + 90, y + 5, { width: 150, lineBreak: false });
  pdf.fillColor('#555').font('jp').fontSize(8).text(`小計（税抜）${yen(totals.subtotal)}円　　消費税 ${yen(totals.tax)}円`, MARGIN, y + 9, { width: CONTENT_W - 10, align: 'right', lineBreak: false });
  pdf.fillColor('#000');
  y += bandH + 10;

  // ---- 明細 ----
  y = drawTableHeader(pdf, y, taxInclusive);
  const ensure = (h) => { if (y + h <= BOTTOM) return; pdf.addPage(); y = MARGIN; y = drawTableHeader(pdf, y, taxInclusive); };
  for (const li of items) {
    if (li.row_type === 'text') {
      const text = String(li.text || '');
      pdf.font('jp-bold').fontSize(8.5);
      const h = Math.max(14, pdf.heightOfString(text, { width: CONTENT_W - 12 }) + 6);
      ensure(h);
      pdf.rect(MARGIN, y, CONTENT_W, h).fillAndStroke('#f8fafc', '#e2e8f0');
      pdf.fillColor('#1e293b').text(text, MARGIN + 6, y + 3, { width: CONTENT_W - 12 });
      pdf.fillColor('#000'); y += h; continue;
    }
    if (li.row_type === 'subtotal') {
      ensure(16);
      pdf.rect(MARGIN, y, CONTENT_W, 16).fillAndStroke('#f1f5f9', '#94a3b8');
      pdf.fillColor('#1e293b').font('jp-bold').fontSize(8.5);
      pdf.text(li.name || '小計', MARGIN + 4, y + 4, { width: CONTENT_W - 96, align: 'right', lineBreak: false, ellipsis: true });
      pdf.text(signedYen(li.amount), PAGE.width - MARGIN - 84, y + 4, { width: 80, align: 'right', lineBreak: false });
      pdf.fillColor('#000'); y += 16; continue;
    }
    const name = String(li.name || '') + (Number(li.tax_rate) === 8 ? '（軽減8%）' : '');
    pdf.font('jp').fontSize(8.5);
    const h = Math.max(15, pdf.heightOfString(name, { width: NAME_W - 8 }) + 7);
    ensure(h);
    pdf.rect(MARGIN, y, CONTENT_W, h).fillAndStroke('#ffffff', '#e2e8f0');
    pdf.fillColor('#000').text(name, MARGIN + 4, y + 3, { width: NAME_W - 8 });
    const cells = [fmtQty(li.quantity), String(li.unit || ''), signedYen(li.unit_price), signedYen(li.amount)];
    let x = MARGIN + NAME_W;
    COLS.slice(1).forEach(([, w, align], ci) => { pdf.text(cells[ci], x + 4, y + 3, { width: w - 8, align, lineBreak: false, ellipsis: true }); x += w; });
    y += h;
  }
  y += 10;

  // ---- 税率別内訳 ----
  const bwX = 360; const bwW = PAGE.width - MARGIN - bwX; const bh = 6 + totals.breakdown.length * 20;
  ensure(bh + 4);
  pdf.rect(bwX, y, bwW, bh).stroke('#cbd5e1');
  let ly = y + 4;
  for (const b of totals.breakdown) {
    pdf.font('jp').fontSize(7.5).fillColor('#333').text(`${b.rate}%対象（税抜）`, bwX + 6, ly, { lineBreak: false });
    pdf.text(`${yen(b.taxable)}円`, bwX, ly, { width: bwW - 6, align: 'right', lineBreak: false });
    pdf.fontSize(7).text(`${b.rate}%消費税`, bwX + 6, ly + 9.5, { lineBreak: false });
    pdf.text(`${yen(b.tax)}円`, bwX, ly + 9.5, { width: bwW - 6, align: 'right', lineBreak: false });
    ly += 20;
  }
  pdf.fillColor('#000');
  y += bh + 14;

  // ---- 納期・備考 ----
  const notesH = 44;
  ensure(notesH);
  pdf.rect(MARGIN, y, CONTENT_W, notesH).stroke('#cbd5e1');
  pdf.font('jp').fontSize(8).fillColor('#555').text('希望納期・備考', MARGIN + 6, y + 4, { lineBreak: false });
  pdf.fillColor('#000').text(estimate.desired_delivery_date ? `希望納期: ${fmtDate(estimate.desired_delivery_date)}` : '', MARGIN + 6, y + 16, { width: CONTENT_W - 12, lineBreak: false });
  y += notesH + 14;

  // ---- 署名欄 ----
  const sigH = 70;
  ensure(sigH + 10);
  pdf.font('jp').fontSize(8).fillColor('#555').text('上記のとおり発注いたします。', MARGIN, y, { lineBreak: false });
  y += 12;
  const sigX = PAGE.width - MARGIN - 300;
  pdf.rect(sigX, y, 300, sigH).stroke('#94a3b8');
  const rows = [['発注日', '　　　年　　月　　日'], ['会社名', estimate.client_name || ''], ['ご担当者', client.contact_person || ''], ['ご署名（印）', '']];
  rows.forEach(([k, v], i) => {
    const ry2 = y + 4 + i * 16;
    pdf.font('jp').fontSize(8).fillColor('#555').text(k, sigX + 6, ry2, { width: 70, lineBreak: false });
    pdf.fillColor('#000').text(v, sigX + 80, ry2, { width: 210, lineBreak: false });
    if (i < rows.length - 1) pdf.moveTo(sigX + 76, ry2 + 12).lineTo(sigX + 294, ry2 + 12).lineWidth(0.5).stroke('#cbd5e1');
  });
  pdf.fillColor('#000');
}
