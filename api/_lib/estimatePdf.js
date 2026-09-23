import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

// ============================================================================
// 御見積書のPDF（A4縦）。
//
// ブラウザ印刷（見積書タブの「印刷用に新しいタブで開く」）で崩れていた点を直す:
//   - 名称が長い行は行の高さを伸ばす（固定行数ではなく流し込み）
//   - 冒頭の金額は1行の帯にまとめてコンパクトに
//   - 見出し行（テキスト行）・小計行はそのまま表に載せる
//   - ページをまたぐときは表の見出しを繰り返す
//   - 印影は「あり／なし」を選べる（郵送・持参のときは押印するので無し）
// 日本語フォントは Noto Sans JP（api/_lib/fonts）。
// ============================================================================

const FONT_DIR = path.join(process.cwd(), 'api', '_lib', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansJP-400.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSansJP-700.ttf');

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = PAGE.width - MARGIN * 2;
const BOTTOM = PAGE.height - MARGIN - 18; // ページ番号の分を空ける
const DEFAULT_STAMP_WIDTH = 52;

const yen = (n) => `${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`;
const signedYen = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('ja-JP')}`; };
const fmtQty = (q) => {
  const n = Number(q);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? n.toLocaleString('ja-JP') : String(n);
};
const fmtUnitPrice = (p) => {
  const n = Number(p) || 0;
  return Number.isInteger(n) ? signedYen(n) : n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
};
const fmtDate = (d) => (d ? String(d).slice(0, 10).replace(/-/g, '/') : '');

function formatPostal(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : String(v || '');
}

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months || 0));
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * 小計・税率別の消費税・合計。src/lib/estimateTotals.js と同じ計算（直すときは両方直す）。
 *   税別見積: 消費税 = 税率ごとの合計 × 税率（四捨五入）
 *   税込見積: 消費税 = 税率ごとの合計 × 税率 ÷ (100+税率) の切り捨て、税抜 = 税込 − 消費税
 */
export function estimateTotals(lineItems, taxInclusive = false) {
  const rows = (lineItems || []).filter((li) => li.row_type !== 'text' && li.row_type !== 'subtotal');
  const byRate = new Map();
  for (const li of rows) {
    const rate = Number(li.tax_rate) === 8 ? 8 : 10;
    byRate.set(rate, (byRate.get(rate) || 0) + (Number(li.amount) || 0));
  }
  const breakdown = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, sum]) => {
    if (taxInclusive) {
      const tax = Math.floor((sum * rate) / (100 + rate));
      return { rate, taxable: sum - tax, tax };
    }
    return { rate, taxable: sum, tax: Math.round((sum * rate) / 100) };
  });
  const subtotal = breakdown.reduce((s, b) => s + b.taxable, 0);
  const tax = breakdown.reduce((s, b) => s + b.tax, 0);
  return { subtotal, tax, total: subtotal + tax, breakdown: breakdown.length ? breakdown : [{ rate: 10, taxable: 0, tax: 0 }] };
}

/** ダウンロード用のファイル名（【クライアント名】見積書_件名.pdf） */
export function estimateFilename(estimate) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim();
  const title = clean(estimate.estimate_title) || clean(estimate.estimate_number) || '見積書';
  return `【${clean(estimate.client_name) || 'クライアント'}】見積書_${title}.pdf`;
}

/**
 * @param {object} opts
 * @param {object} opts.estimate   estimates の行（schema_version 2）
 * @param {object} opts.client     clients の行（住所用。無くてもよい）
 * @param {object} opts.company    company_info
 * @param {Buffer|null} opts.stamp 印影PNG（null なら押さない）
 * @returns {Promise<Buffer>}
 */
export function renderEstimatePdf({ estimate, client, company, stamp }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: `御見積書 ${estimate.estimate_number || ''}` } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    pdf.registerFont('jp', fs.readFileSync(FONT_REGULAR));
    pdf.registerFont('jp-bold', fs.readFileSync(FONT_BOLD));

    try {
      drawEstimate(pdf, { estimate, client: client || {}, company, stamp });
    } catch (err) {
      reject(err);
      return;
    }

    // ページ番号（全ページ確定後に入れる）
    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      // 下余白に掛かると pdfkit が改ページしてしまうので、余白の内側に置く
      pdf.font('jp').fontSize(8).fillColor('#555')
        .text(`${i + 1} / ${range.count}`, MARGIN, PAGE.height - MARGIN - 16, { width: CONTENT_W, align: 'center', lineBreak: false });
    }
    pdf.fillColor('#000');
    pdf.end();
  });
}

// 明細表の列（名称は残り幅）。税込見積は単価・金額の見出しに（税込）を付ける
const COLS = [
  ['名称', 0, 'left'],
  ['数量', 52, 'right'],
  ['単位', 40, 'right'],
  ['単価', 78, 'right'],
  ['金額', 88, 'right'],
];
const NAME_W = CONTENT_W - COLS.slice(1).reduce((s, c) => s + c[1], 0);
const ROW_PAD = 4;
const HEAD_H = 16;

function drawTableHeader(pdf, y, taxInclusive = false) {
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

function drawEstimate(pdf, { estimate, client, company, stamp }) {
  const items = Array.isArray(estimate.line_items) ? estimate.line_items : [];
  const taxInclusive = !!estimate.tax_inclusive;
  const totals = estimateTotals(items, taxInclusive);
  const estimateDate = estimate.estimate_date || new Date().toISOString().slice(0, 10);
  const validityMonths = estimate.validity_period_months ?? 6;
  const validUntil = addMonths(estimateDate, validityMonths);

  let y = MARGIN;

  // ---- 宛名（左） ----
  pdf.font('jp').fontSize(8.5).fillColor('#333');
  const postal = client.postal_code ? `〒${formatPostal(client.postal_code)}` : '';
  if (postal) { pdf.text(postal, MARGIN, y, { lineBreak: false }); y += 11; }
  if (client.address) { pdf.text(client.address, MARGIN, y, { width: 270 }); y += pdf.heightOfString(client.address, { width: 270 }) + 1; }
  y += 3;
  pdf.font('jp-bold').fontSize(13).fillColor('#000');
  const clientLine = `${estimate.client_name || ''} ${estimate.client_honorific ?? '御中'}`;
  const clientW = 240;
  pdf.text(clientLine, MARGIN, y, { width: clientW });
  const clientH = pdf.heightOfString(clientLine, { width: clientW });
  pdf.moveTo(MARGIN, y + clientH + 2).lineTo(MARGIN + Math.min(clientW, pdf.widthOfString(clientLine) + 4), y + clientH + 2).lineWidth(1.2).stroke('#1e293b');
  const leftBottom = y + clientH + 8;

  // ---- 自社情報（右） ----
  const stampW = Math.max(24, Math.min(120, Number(company.stamp_width) || DEFAULT_STAMP_WIDTH));
  const rx = 292;
  // 印影があるときは、その分だけ自社情報を左に寄せて重ならないようにする
  const rw = PAGE.width - MARGIN - rx - (stamp ? stampW + 6 : 0);
  let ry = MARGIN;
  // 長い行は折り返す（印影の分だけ幅が狭くなるため）
  const rline = (text, size, bold) => {
    pdf.font(bold ? 'jp-bold' : 'jp').fontSize(size);
    pdf.text(text, rx, ry, { width: rw, align: 'right' });
    ry += pdf.heightOfString(text, { width: rw }) + 1;
  };
  pdf.fillColor('#000');
  rline(`${company.name}${estimate.person_in_charge ? `　${estimate.person_in_charge}` : ''}`, 10, true);
  ry += 2;
  pdf.fillColor('#333');
  for (const loc of company.locations || []) rline(`［${loc.label}］〒${formatPostal(loc.postal)}　${loc.address}`, 7, false);
  const telFax = [company.tel ? `tel ${company.tel}` : '', company.fax ? `fax ${company.fax}` : ''].filter(Boolean).join('｜');
  if (telFax) rline(telFax, 7, false);
  if (company.registration_number) rline(`登録番号 ${company.registration_number}`, 7, false);
  pdf.fillColor('#000');

  // 印影（自社名の右端に重ねる）
  if (stamp) {
    try { pdf.image(stamp, PAGE.width - MARGIN - stampW, MARGIN - 6, { width: stampW }); } catch { /* 画像が読めなければ省略 */ }
  }

  y = Math.max(leftBottom, ry) + 8;

  // ---- 表題 ----
  pdf.font('jp-bold').fontSize(17).fillColor('#1e293b').text('御 見 積 書', MARGIN, y, { width: CONTENT_W, align: 'center', characterSpacing: 2 });
  y += 30;

  // ---- 件名（左）・見積日・番号・有効期限（右） ----
  pdf.font('jp').fontSize(8).fillColor('#555').text('件名', MARGIN, y, { lineBreak: false });
  pdf.font('jp-bold').fontSize(11).fillColor('#000');
  const title = estimate.estimate_title || estimate.print_type || '—';
  pdf.text(title, MARGIN, y + 11, { width: 300 });
  const titleH = pdf.heightOfString(title, { width: 300 });

  const metaX = 380;
  const metaValX = 450;
  const meta = [['見積日', fmtDate(estimateDate)], ['見積書番号', estimate.estimate_number || ''], ['有効期限', `${fmtDate(validUntil)}（${validityMonths}ヶ月）`]];
  pdf.font('jp').fontSize(8.5);
  meta.forEach(([k, v], i) => {
    pdf.fillColor('#555').text(k, metaX, y + i * 12, { lineBreak: false });
    pdf.fillColor('#000').text(v, metaValX, y + i * 12, { width: PAGE.width - MARGIN - metaValX, align: 'right', lineBreak: false });
  });
  y += Math.max(11 + titleH, meta.length * 12) + 8;

  // ---- 金額の帯（1行でコンパクトに） ----
  const bandH = 26;
  pdf.rect(MARGIN, y, CONTENT_W, bandH).fillAndStroke('#f1f5f9', '#cbd5e1');
  pdf.fillColor('#555').font('jp').fontSize(8);
  pdf.text('見積金額（税込）', MARGIN + 10, y + 9, { lineBreak: false });
  pdf.fillColor('#1e3a8a').font('jp-bold').fontSize(15);
  pdf.text(`${yen(totals.total)}円`, MARGIN + 90, y + 5, { width: 150, lineBreak: false });
  pdf.fillColor('#555').font('jp').fontSize(8);
  const sub = `小計（税抜）${yen(totals.subtotal)}円　　消費税 ${yen(totals.tax)}円`;
  pdf.text(sub, MARGIN, y + 9, { width: CONTENT_W - 10, align: 'right', lineBreak: false });
  pdf.fillColor('#000');
  y += bandH + 10;

  // ---- 明細表（流し込み・改ページあり） ----
  y = drawTableHeader(pdf, y, taxInclusive);
  const nameFont = () => pdf.font('jp').fontSize(8.5);

  const ensure = (h) => {
    if (y + h <= BOTTOM) return;
    pdf.addPage();
    y = MARGIN;
    y = drawTableHeader(pdf, y, taxInclusive);
  };

  for (const li of items) {
    if (li.row_type === 'text') {
      const text = String(li.text || '');
      nameFont();
      const h = Math.max(14, pdf.heightOfString(text, { width: CONTENT_W - 8 }) + ROW_PAD * 2 - 2);
      ensure(h);
      pdf.rect(MARGIN, y, CONTENT_W, h).fillAndStroke('#f8fafc', '#e2e8f0');
      pdf.fillColor('#1e293b').font('jp-bold').fontSize(8.5).text(text, MARGIN + 6, y + ROW_PAD - 1, { width: CONTENT_W - 12 });
      pdf.fillColor('#000');
      y += h;
      continue;
    }
    if (li.row_type === 'subtotal') {
      const h = 16;
      ensure(h);
      pdf.rect(MARGIN, y, CONTENT_W, h).fillAndStroke('#f1f5f9', '#94a3b8');
      pdf.fillColor('#1e293b').font('jp-bold').fontSize(8.5);
      const amtW = COLS[4][1];
      pdf.text(li.name || '小計', MARGIN + 4, y + 4, { width: CONTENT_W - amtW - 8, align: 'right', lineBreak: false, ellipsis: true });
      pdf.text(signedYen(li.amount), PAGE.width - MARGIN - amtW + 4, y + 4, { width: amtW - 8, align: 'right', lineBreak: false });
      pdf.fillColor('#000');
      y += h;
      continue;
    }

    const name = String(li.name || '') + (Number(li.tax_rate) === 8 ? '（軽減8%）' : '');
    nameFont();
    const nameH = pdf.heightOfString(name, { width: NAME_W - 8 });
    const h = Math.max(15, nameH + ROW_PAD * 2 - 1);
    ensure(h);
    pdf.rect(MARGIN, y, CONTENT_W, h).fillAndStroke('#ffffff', '#e2e8f0');
    pdf.fillColor('#000');
    nameFont().text(name, MARGIN + 4, y + ROW_PAD - 1, { width: NAME_W - 8 });
    const cells = [fmtQty(li.quantity), String(li.unit || ''), fmtUnitPrice(li.unit_price), signedYen(li.amount)];
    let x = MARGIN + NAME_W;
    COLS.slice(1).forEach(([, w, align], ci) => {
      pdf.font('jp').fontSize(8.5).text(cells[ci], x + 4, y + ROW_PAD - 1, { width: w - 8, align, lineBreak: false, ellipsis: true });
      x += w;
    });
    y += h;
  }
  if (items.length === 0) {
    ensure(15);
    pdf.rect(MARGIN, y, CONTENT_W, 15).stroke('#e2e8f0');
    y += 15;
  }
  y += 8;

  // ---- 税率別内訳（右寄せ・コンパクト） ----
  const bwX = 360;
  const bwW = PAGE.width - MARGIN - bwX;
  const bh = 6 + totals.breakdown.length * 20;
  ensure(bh + 4);
  pdf.rect(bwX, y, bwW, bh).stroke('#cbd5e1');
  let ly = y + 4;
  if (totals.breakdown.some((b) => b.rate === 8)) {
    pdf.font('jp').fontSize(6.5).fillColor('#333').text('（軽減8%）は軽減税率対象', MARGIN, y + 4, { width: bwX - MARGIN - 6, align: 'right', lineBreak: false });
  }
  for (const b of totals.breakdown) {
    pdf.font('jp').fontSize(7.5).fillColor('#333').text(`${b.rate}%対象（税抜）`, bwX + 6, ly, { lineBreak: false });
    pdf.text(`${yen(b.taxable)}円`, bwX, ly, { width: bwW - 6, align: 'right', lineBreak: false });
    pdf.fontSize(7).text(`${b.rate}%消費税`, bwX + 6, ly + 9.5, { lineBreak: false });
    pdf.text(`${yen(b.tax)}円`, bwX, ly + 9.5, { width: bwW - 6, align: 'right', lineBreak: false });
    ly += 20;
  }
  pdf.fillColor('#000');
  y += bh + 8;

  // ---- 備考（あるときだけ。高さは文章に合わせる） ----
  const notes = String(estimate.additional_notes || '').trim();
  if (notes) {
    pdf.font('jp').fontSize(8);
    const nh = Math.min(200, pdf.heightOfString(notes, { width: CONTENT_W - 12 }) + 20);
    ensure(nh);
    pdf.rect(MARGIN, y, CONTENT_W, nh).stroke('#cbd5e1');
    pdf.fillColor('#555').text('備考', MARGIN + 6, y + 4, { lineBreak: false });
    pdf.fillColor('#000').text(notes, MARGIN + 6, y + 14, { width: CONTENT_W - 12, height: nh - 16, ellipsis: true });
    y += nh;
  }
}
