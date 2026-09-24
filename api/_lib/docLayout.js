import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// 見積書・納品書・請求書に共通の帳票レイアウト（A4縦）。
//
// 以前使っていた帳票（freee）の見た目に合わせている:
//   宛名（左）／自社情報（右・印影・ロゴ）／表題／件名（左）・日付・番号（右）
//   ／黒帯の金額欄（小計・消費税・合計）／請求書は入金期日・振込先の枠
//   ／黒帯見出しの明細表（固定行数・交互の網掛け）／税率別内訳／備考／ページ番号
// 文字は各セルの上下中央に置く。
// 日本語フォントは Noto Sans JP（api/_lib/fonts）。
// ============================================================================

const FONT_DIR = path.join(process.cwd(), 'api', '_lib', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansJP-400.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSansJP-700.ttf');

export const PAGE = { width: 595.28, height: 841.89 };
export const MARGIN = 40;
export const CONTENT_W = PAGE.width - MARGIN * 2;
export const PAGE_MARGINS = { top: MARGIN, bottom: 14, left: MARGIN, right: MARGIN };
export const DEFAULT_STAMP_WIDTH = 52;

// 位置（pt）。参考帳票を実測したもの
const L = {
  clientPostalY: 38,
  clientAddressY: 50,
  clientNameY: 68,
  clientW: 210,
  companyX: 358,
  companyNameY: 38,
  companyBodyY: 68,
  titleY: 196,
  subjectY: 262,
  metaY: 243,
  metaStep: 16,
  summaryY: 287,
  bandW: 294,
  headH: 16,
  summaryBodyH: 26,
  bankBodyH: 55,
  rowH: 17.4,
  tableGap: 8,
  tableGapNoBank: 26,
  breakdownGap: 24,
  notesGap: 12,
  notesH: 63,
  pageNoY: PAGE.height - 30,
};

const GRAY = '#e6e6e6';
const LINE = '#999999';
const BLACK = '#000000';

export const yen = (n) => `${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`;
export const signedYen = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('ja-JP')}`; };
export const fmtQty = (q) => {
  const n = Number(q);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? n.toLocaleString('ja-JP') : String(n);
};
export const fmtUnitPrice = (p) => {
  const n = Number(p) || 0;
  return Number.isInteger(n) ? signedYen(n) : n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
};
export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');
export function formatPostal(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : String(v || '');
}

export function registerFonts(pdf) {
  pdf.registerFont('jp', fs.readFileSync(FONT_REGULAR));
  pdf.registerFont('jp-bold', fs.readFileSync(FONT_BOLD));
}

/** 1行の文字を枠 (x, y, w, h) の上下中央に置く */
function textV(pdf, text, x, y, w, h, { align = 'left', size = 8.5, bold = false, color = BLACK, minSize = 6.5 } = {}) {
  const str = String(text ?? '');
  pdf.font(bold ? 'jp-bold' : 'jp').fontSize(size).fillColor(color);
  // 収まらないときは少し小さくし、それでも長ければ省略記号
  let s = size;
  while (s > minSize && pdf.widthOfString(str) > w) { s -= 0.5; pdf.fontSize(s); }
  const lh = pdf.currentLineHeight();
  pdf.text(str, x, y + (h - lh) / 2, { width: w, align, lineBreak: false, ellipsis: true });
  pdf.fillColor(BLACK);
}

/** 複数行の文章を枠の上下中央に置く（折り返しあり） */
function paragraphV(pdf, text, x, y, w, h, { align = 'left', size = 8.5, bold = false, color = BLACK } = {}) {
  const str = String(text ?? '');
  pdf.font(bold ? 'jp-bold' : 'jp').fontSize(size).fillColor(color);
  const th = Math.min(h, pdf.heightOfString(str, { width: w }));
  pdf.text(str, x, y + (h - th) / 2, { width: w, height: h, align, ellipsis: true });
  pdf.fillColor(BLACK);
}

/**
 * 宛名（左）・自社情報（右）・印影・ロゴ
 * @param {object} o
 * @param {{postal?:string,address?:string,name:string,honorific?:string}} o.client
 * @param {object} o.company  company_info（name, representative, locations[], tel, fax, stamp_width）
 * @param {string} [o.person] 担当者名（無ければ会社情報の代表者）
 * @param {Buffer|null} [o.stamp]
 * @param {Buffer|null} [o.logo]
 * @param {boolean} [o.allLocations=true] false なら最初の拠点だけ
 */
export function drawHeader(pdf, { client, company, person, stamp, logo, allLocations = true }) {
  // ---- 宛名 ----
  pdf.font('jp').fontSize(7.5).fillColor(BLACK);
  const postal = client.postal ? formatPostal(client.postal) : '';
  if (postal) pdf.text(postal, MARGIN, L.clientPostalY, { lineBreak: false });
  if (client.address) pdf.text(client.address, MARGIN, L.clientAddressY, { width: L.clientW + 60, lineBreak: false, ellipsis: true });
  pdf.font('jp').fontSize(12.5);
  pdf.text(`${client.name || ''}　${client.honorific ?? '御中'}`, MARGIN, L.clientNameY, { width: L.clientW, lineGap: 1 });

  // ---- 自社情報 ----
  const rx = L.companyX;
  const rw = PAGE.width - MARGIN - rx;
  pdf.font('jp').fontSize(8.5).fillColor(BLACK);
  const who = person || company.representative || '';
  pdf.text(`${company.name || ''}${who ? `　${who}` : ''}`, rx, L.companyNameY, { width: rw, lineBreak: false });

  let ry = L.companyBodyY;
  pdf.fontSize(7).fillColor('#222');
  const locations = company.locations || [];
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    if (loc.label) { pdf.text(`［${loc.label}］`, rx, ry, { lineBreak: false }); ry += 10; }
    pdf.text(`〒${formatPostal(loc.postal)}　${loc.address || ''}`, rx, ry, { width: rw, lineBreak: false, ellipsis: true });
    ry += allLocations ? 14 : 10;
    if (!allLocations) break;
  }
  const telFax = [company.tel ? `tel ${company.tel}` : '', company.fax ? `fax ${company.fax}` : ''].filter(Boolean).join('｜');
  if (telFax) { pdf.text(telFax, rx, ry, { lineBreak: false }); ry += 12; }
  pdf.fillColor(BLACK);

  // ---- ロゴ（自社情報の下） ----
  if (logo) {
    try { pdf.image(logo, rx, ry + 4, { height: 14 }); } catch { /* 画像が読めなければ省略 */ }
  }

  // ---- 印影（自社情報の右端に重ねる） ----
  if (stamp) {
    const stampW = Math.max(24, Math.min(120, Number(company.stamp_width) || DEFAULT_STAMP_WIDTH));
    try { pdf.image(stamp, PAGE.width - MARGIN - stampW + 4, 26, { width: stampW }); } catch { /* 画像が読めなければ省略 */ }
  }
}

/** 表題（御見積書・納品書・御請求書） */
export function drawTitle(pdf, title) {
  pdf.font('jp').fontSize(17).fillColor(BLACK).text(title, MARGIN, L.titleY, { width: CONTENT_W, align: 'center', lineBreak: false });
}

/**
 * 件名（左）と日付・番号（右）
 * @param {string} subject
 * @param {Array<[string,string]>} meta  例: [['請求日','2026-08-31'], ['請求書番号','INV-…']]
 */
export function drawSubjectAndMeta(pdf, subject, meta) {
  pdf.font('jp').fontSize(10.5).fillColor(BLACK).text('件名', MARGIN, L.subjectY, { lineBreak: false });
  // 件名は2行までに収める（長いときは少し小さくする）。2行のときは見出しの高さを中心に上下へ広げる
  const sw = 230;
  const text = subject || '';
  let size = 11.5;
  pdf.font('jp').fontSize(size);
  const lines = () => Math.round(pdf.heightOfString(text, { width: sw }) / pdf.currentLineHeight());
  while (size > 8 && lines() > 2) { size -= 0.5; pdf.fontSize(size); }
  pdf.text(text, MARGIN + 57, L.subjectY - 2 - (lines() > 1 ? 9 : 0), { width: sw, height: pdf.currentLineHeight() * 2 + 2, ellipsis: true });

  const mx = L.companyX;
  const mw = PAGE.width - MARGIN - mx;
  pdf.font('jp').fontSize(8.5);
  meta.forEach(([k, v], i) => {
    const y = L.metaY + i * L.metaStep;
    pdf.text(k, mx, y, { lineBreak: false });
    pdf.text(v || '', mx, y, { width: mw, align: 'right', lineBreak: false });
  });
}

/** 黒帯の見出し行 */
function drawBandHead(pdf, x, y, cols, labels) {
  const w = cols.reduce((s, c) => s + c, 0);
  pdf.rect(x, y, w, L.headH).fill(BLACK);
  let cx = x;
  labels.forEach((l, i) => { textV(pdf, l, cx, y, cols[i], L.headH, { align: 'center', size: 8.5, color: '#fff' }); cx += cols[i]; });
  pdf.fillColor(BLACK);
}

/**
 * 小計・消費税・合計の金額欄。戻り値は枠の下端 y
 * @param {string} totalLabel  請求金額 / 見積金額 / 合計金額
 */
export function drawSummary(pdf, { subtotal, tax, total, totalLabel, subtotalLabel = '小計' }) {
  const y = L.summaryY;
  const cols = [85, 74, 135];
  drawBandHead(pdf, MARGIN, y, cols, [subtotalLabel, '消費税', totalLabel]);
  const by = y + L.headH;
  pdf.lineWidth(0.8).rect(MARGIN, by, L.bandW, L.summaryBodyH).stroke(LINE);
  pdf.moveTo(MARGIN + cols[0], by).lineTo(MARGIN + cols[0], by + L.summaryBodyH).stroke(LINE);
  pdf.moveTo(MARGIN + cols[0] + cols[1], by).lineTo(MARGIN + cols[0] + cols[1], by + L.summaryBodyH).stroke(LINE);
  textV(pdf, `${yen(subtotal)}円`, MARGIN, by, cols[0] - 6, L.summaryBodyH, { align: 'right', size: 9.5 });
  textV(pdf, `${yen(tax)}円`, MARGIN + cols[0], by, cols[1] - 6, L.summaryBodyH, { align: 'right', size: 9.5 });
  textV(pdf, `${yen(total)}円`, MARGIN + cols[0] + cols[1], by, cols[2] - 6, L.summaryBodyH, { align: 'right', size: 16, bold: true });
  return by + L.summaryBodyH;
}

/** 入金期日・振込先（請求書）。戻り値は枠の下端 y */
export function drawBankBand(pdf, y, { dueDate, accounts }) {
  const cols = [85, L.bandW - 85];
  drawBandHead(pdf, MARGIN, y, cols, ['入金期日', '振込先']);
  const by = y + L.headH;
  const h = L.bankBodyH;
  pdf.lineWidth(0.8).rect(MARGIN, by, L.bandW, h).stroke(LINE);
  pdf.moveTo(MARGIN + cols[0], by).lineTo(MARGIN + cols[0], by + h).stroke(LINE);
  textV(pdf, fmtDate(dueDate), MARGIN, by, cols[0], h, { align: 'center', size: 9.5 });
  const list = (accounts || []).map((b) => `${b.bank || ''} ${b.branch || ''}（${b.type || '普通'}）${b.number || ''}${b.holder ? ` ${b.holder}` : ''}`.trim());
  paragraphV(pdf, list.join('\n\n'), MARGIN + cols[0] + 5, by + 2, cols[1] - 10, h - 4, { size: 7.5 });
  return by + h;
}

/**
 * 明細表（1ページ分）。固定行数で、足りない分は空行で埋める。戻り値は表の下端 y
 * @param {Array<[string, number, 'left'|'center'|'right']>} columns  [見出し, 幅, 揃え]（幅 0 の列は残り幅）
 * @param {Array<object>} rows  { kind:'item', cells:[...] } | { kind:'text', text } | { kind:'subtotal', name, amount }
 */
export function drawTable(pdf, y, { columns, rows, rowsPerPage }) {
  const fixed = columns.reduce((s, c) => s + (c[1] || 0), 0);
  const widths = columns.map((c) => c[1] || CONTENT_W - fixed);
  // 見出し
  pdf.rect(MARGIN, y, CONTENT_W, L.headH).fill(BLACK);
  let cx = MARGIN;
  columns.forEach(([label], i) => { textV(pdf, label, cx, y, widths[i], L.headH, { align: 'center', size: 8.5, color: '#fff' }); cx += widths[i]; });
  pdf.fillColor(BLACK);

  const amountW = widths[widths.length - 1];
  for (let i = 0; i < rowsPerPage; i++) {
    const ry = y + L.headH + i * L.rowH;
    pdf.lineWidth(0.6).rect(MARGIN, ry, CONTENT_W, L.rowH).fillAndStroke(i % 2 === 0 ? GRAY : '#ffffff', LINE);
    pdf.fillColor(BLACK);
    const row = rows[i];
    if (!row) continue;
    if (row.kind === 'text') {
      textV(pdf, row.text, MARGIN + 6, ry, CONTENT_W - 12, L.rowH, { size: 8.5, bold: true });
      continue;
    }
    if (row.kind === 'subtotal') {
      textV(pdf, row.name || '小計', MARGIN + 6, ry, CONTENT_W - amountW - 12, L.rowH, { align: 'right', size: 8.5, bold: true });
      textV(pdf, signedYen(row.amount), PAGE.width - MARGIN - amountW, ry, amountW - 6, L.rowH, { align: 'right', size: 8.5, bold: true });
      continue;
    }
    cx = MARGIN;
    columns.forEach(([, , align], ci) => {
      const pad = align === 'center' ? 2 : 6;
      textV(pdf, row.cells[ci], cx + pad, ry, widths[ci] - pad * 2, L.rowH, { align, size: 8.5 });
      cx += widths[ci];
    });
  }
  return y + L.headH + rowsPerPage * L.rowH;
}

/** 税率別内訳（右）。戻り値は枠の下端 y */
export function drawBreakdown(pdf, tableBottom, breakdown) {
  const y = tableBottom + L.breakdownGap;
  const bx = MARGIN + L.bandW + 1;
  const bw = PAGE.width - MARGIN - bx;
  const rows = breakdown.length ? breakdown : [{ rate: 10, taxable: 0, tax: 0 }];
  const lineH = 23;
  const bh = 4 + rows.length * lineH;
  pdf.lineWidth(0.8).rect(bx, y, bw, bh).stroke(LINE);
  rows.forEach((b, i) => {
    const ly = y + 2 + i * lineH;
    textV(pdf, `内訳　${b.rate}%対象(税抜)`, bx + 6, ly, bw - 12, 13, { size: 8.5 });
    textV(pdf, `${yen(b.taxable)}円`, bx, ly, bw - 6, 13, { align: 'right', size: 9 });
    textV(pdf, `${b.rate}%消費税`, bx + 36, ly + 11, bw - 42, 10, { size: 6.5, color: '#333' });
    textV(pdf, `${yen(b.tax)}円`, bx, ly + 11, bw - 6, 10, { align: 'right', size: 6.5, color: '#333' });
  });
  if (rows.some((b) => Number(b.rate) === 8)) {
    pdf.font('jp').fontSize(6.5).fillColor('#333').text('（軽減8%）は軽減税率対象', MARGIN, y + 3, { width: bx - MARGIN - 6, align: 'right', lineBreak: false });
    pdf.fillColor(BLACK);
  }
  return y + bh;
}

/** 備考（全幅の枠。内訳の下） */
export function drawNotes(pdf, breakdownBottom, notes) {
  const y = breakdownBottom + L.notesGap;
  const h = Math.max(30, Math.min(L.notesH, L.pageNoY - 10 - y));
  pdf.lineWidth(0.8).rect(MARGIN, y, CONTENT_W, h).stroke(LINE);
  pdf.font('jp').fontSize(8.5).fillColor(BLACK).text('備考', MARGIN + 14, y + 5, { lineBreak: false });
  const body = String(notes || '').trim();
  if (body) pdf.font('jp').fontSize(8).text(body, MARGIN + 14, y + 18, { width: CONTENT_W - 28, height: h - 22, ellipsis: true });
  return y + h;
}

/** ページ番号（中央下） */
export function drawPageNumber(pdf, page, pages) {
  pdf.font('jp').fontSize(8).fillColor(BLACK)
    .text(`${page} / ${pages}`, MARGIN, L.pageNoY, { width: CONTENT_W, align: 'center', lineBreak: false });
}

/** 明細表の開始位置。請求書は振込先の枠がある分だけ下がる */
export function tableTop(bandBottom, { afterBank = false } = {}) {
  return bandBottom + (afterBank ? L.tableGap : L.tableGapNoBank);
}

/** 1ページに入る行数（表の開始位置から内訳・備考の分を空けて計算） */
export function rowsFor(tableY) {
  const reserved = L.breakdownGap + 27 + L.notesGap + L.notesH + 14; // 内訳（1税率）＋備考＋ページ番号
  return Math.max(5, Math.floor((L.pageNoY - reserved - tableY - L.headH) / L.rowH));
}
