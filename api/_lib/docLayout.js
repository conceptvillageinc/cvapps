import fs from 'node:fs';
import path from 'node:path';
import { toHalfWidth } from '../../src/lib/halfWidth.js';

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

export const PAGE = { width: 595.28, height: 841.89 };
export const MARGIN = 40;
export const CONTENT_W = PAGE.width - MARGIN * 2;
export const PAGE_MARGINS = { top: MARGIN, bottom: 14, left: MARGIN, right: MARGIN };
export const DEFAULT_STAMP_WIDTH = 52;

// 位置（pt）。参考帳票を実測したもの
export const L = {
  clientPostalY: 38,
  clientAddressY: 50,
  clientNameY: 68,
  clientW: 210,
  companyX: 358,
  companyNameY: 84, // 自社名（右上の日付・番号の下）
  companyBodyY: 100,
  stampY: 70,
  titleY: 196,
  subjectY: 262,
  metaY: 34, // 日付・番号（右上）
  metaStep: 13,
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
export const LINE = '#999999';
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

// 日本語フォント（Noto Sans JP）に無い文字（α β μ Ω などのギリシャ文字、Ⅰ Ⅱ のローマ数字、≒ ✔ など）は、
// 代わりのフォントで描く（そのままだと四角の文字化けになる）。順に Noto Sans → DejaVu Sans で探す。
const FALLBACKS = {
  jp: [['fb-noto', 'NotoSans-400.ttf'], ['fb-dejavu', 'DejaVuSans.ttf']],
  'jp-bold': [['fb-noto-bold', 'NotoSans-700.ttf'], ['fb-dejavu-bold', 'DejaVuSans-Bold.ttf']],
};
const fontCache = new Map();
const readFont = (file) => { if (!fontCache.has(file)) fontCache.set(file, fs.readFileSync(path.join(FONT_DIR, file))); return fontCache.get(file); };

export function registerFonts(pdf) {
  pdf.registerFont('jp', readFont('NotoSansJP-400.ttf'));
  pdf.registerFont('jp-bold', readFont('NotoSansJP-700.ttf'));
  for (const list of Object.values(FALLBACKS)) for (const [name, file] of list) pdf.registerFont(name, readFont(file));
  installFallback(pdf);
}

/**
 * pdf.text / widthOfString を、足りない文字だけ代わりのフォントで描く・測るようにする。
 *   今のフォント（jp / jp-bold）に無い文字を区切りにして、フォントを切り替えながら continued でつなぐ。
 */
function installFallback(pdf) {
  const origFont = pdf.font.bind(pdf);
  const origText = pdf.text.bind(pdf);
  const origWidth = pdf.widthOfString.bind(pdf);
  let alias = null;
  pdf.font = (src, ...rest) => { if (typeof src === 'string') alias = src; return origFont(src, ...rest); };
  const has = new Map(); // フォント名 → fontkit のフォント
  const fk = (name) => { if (!has.has(name)) { origFont(name); has.set(name, pdf._font.font); } return has.get(name); };
  const runsOf = (str) => {
    const chain = FALLBACKS[alias];
    if (!chain || !str) return null;
    const base = fk(alias);
    let missing = false;
    for (const ch of str) if (!base.hasGlyphForCodePoint(ch.codePointAt(0))) { missing = true; break; }
    if (!missing) { origFont(alias); return null; }
    const runs = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      let name = alias;
      if (!base.hasGlyphForCodePoint(cp)) name = chain.map(([n]) => n).find((n) => fk(n).hasGlyphForCodePoint(cp)) || alias;
      const last = runs[runs.length - 1];
      if (last && last.font === name) last.text += ch; else runs.push({ font: name, text: ch });
    }
    origFont(alias);
    return runs;
  };
  // 足りない文字を含む文字列は、折り返しも自分で行い、1 行ずつフォントを切り替えながら描く
  //   （pdfkit の continued + width は行をまとめて最後に描くため、途中のフォント切り替えが効かない）
  // 描く・測るあいだは alias も run のフォントにしておく（pdfkit が中で widthOfString を呼ぶと、
  // alias のままだと元のフォントに戻されて幅がずれるため）
  const runWidth = (runs) => runs.reduce((w, r) => { alias = r.font; origFont(r.font); return w + origWidth(r.text); }, 0);
  const drawLine = (line, x, y, w, align) => {
    const runs = runsOf(line) || [{ font: alias, text: line }];
    const keep = alias;
    const lw = runWidth(runs);
    let cx = align === 'right' && w ? x + w - lw : align === 'center' && w ? x + (w - lw) / 2 : x;
    for (const r of runs) { alias = r.font; origFont(r.font); origText(r.text, cx, y, { lineBreak: false }); cx += origWidth(r.text); }
    origFont(keep);
    alias = keep;
  };
  pdf.text = (text, x, y, options) => {
    const str = text === null || text === undefined ? '' : String(text);
    const runs = runsOf(str);
    if (!runs) return origText(text, x, y, options);
    const hasXY = typeof x === 'number';
    const opts = (hasXY ? options : x) || {};
    const x0 = hasXY ? x : pdf.x;
    const y0 = hasXY ? y : pdf.y;
    const width = opts.width;
    const lineH = pdf.currentLineHeight(true) + (opts.lineGap || 0);
    // 行に分ける（改行 → 幅で 1 文字ずつ折り返す）。幅が無い・lineBreak: false なら 1 行
    let lines = str.split('\n');
    if (width && opts.lineBreak !== false) {
      const wrapped = [];
      for (const para of lines) {
        let cur = '';
        for (const ch of para) {
          if (cur && pdf.widthOfString(cur + ch) > width) { wrapped.push(cur); cur = ch.trim() ? ch : ''; } else cur += ch;
        }
        wrapped.push(cur);
      }
      lines = wrapped;
    } else if (opts.lineBreak === false) {
      lines = [lines.join(' ')];
    }
    // 高さの指定があれば入る行数まで。あふれたら最後の行を省略記号にする
    if (opts.height) {
      const max = Math.max(1, Math.floor((opts.height + 0.01) / lineH));
      if (lines.length > max) {
        lines = lines.slice(0, max);
        let last = lines[max - 1];
        while (last && width && pdf.widthOfString(`${last}…`) > width) last = last.slice(0, -1);
        lines[max - 1] = `${last}…`;
      }
    }
    lines.forEach((line, i) => drawLine(line, x0, y0 + i * lineH, width, opts.align));
    pdf.x = x0;
    pdf.y = y0 + lines.length * lineH;
    return pdf;
  };
  pdf.widthOfString = (str, options) => {
    const runs = runsOf(String(str ?? ''));
    if (!runs) return origWidth(str, options);
    const keep = alias;
    let w = 0;
    for (const r of runs) { alias = r.font; origFont(r.font); w += origWidth(r.text, options); }
    origFont(keep);
    alias = keep;
    return w;
  };
}

/** 1行の文字を枠 (x, y, w, h) の上下中央に置く */
export function textV(pdf, text, x, y, w, h, { align = 'left', size = 8.5, bold = false, color = BLACK, minSize = 6.5 } = {}) {
  const str = String(text ?? '');
  pdf.font(bold ? 'jp-bold' : 'jp').fontSize(size).fillColor(color);
  // 収まらないときは少し小さくし、それでも長ければ省略記号
  let s = size;
  while (s > minSize && pdf.widthOfString(str) > w) { s -= 0.5; pdf.fontSize(s); }
  // それでも長ければ末尾を省略記号にする。pdfkit は width を渡すと lineBreak: false でも折り返して
  // 下の行に重なるので、幅は自分で測って 1 行で置く
  let out = str;
  if (pdf.widthOfString(out) > w) {
    while (out.length > 1 && pdf.widthOfString(`${out}…`) > w) out = out.slice(0, -1);
    out = `${out}…`;
  }
  const tw = pdf.widthOfString(out);
  const tx = align === 'right' ? x + w - tw : align === 'center' ? x + (w - tw) / 2 : x;
  const lh = pdf.currentLineHeight();
  pdf.text(out, tx, y + (h - lh) / 2, { lineBreak: false });
  pdf.fillColor(BLACK);
}

/** 複数行の文章を枠の上下中央に置く（折り返しあり） */
export function paragraphV(pdf, text, x, y, w, h, { align = 'left', size = 8.5, bold = false, color = BLACK } = {}) {
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
  if (client.address) textV(pdf, toHalfWidth(client.address), MARGIN, L.clientAddressY - 1.5, L.clientW + 60, 12, { size: 7.5, minSize: 5.5 });
  // 宛名は 1 行に収まるよう少し小さくする（「御中」が「御／中」に割れないように）。それでもとても長いときだけ折り返す
  const honor = client.honorific ?? '御中';
  const nameText = `${client.name || ''}　${honor}`;
  let ns = 12.5;
  pdf.font('jp').fontSize(ns);
  while (ns > 9.5 && pdf.widthOfString(nameText) > L.clientW + 60) { ns -= 0.5; pdf.fontSize(ns); }
  if (pdf.widthOfString(nameText) <= L.clientW + 60) pdf.text(nameText, MARGIN, L.clientNameY, { lineBreak: false });
  else pdf.text(nameText, MARGIN, L.clientNameY, { width: L.clientW + 60, lineGap: 1 });

  // ---- 自社情報 ----
  const rx = L.companyX;
  const rw = PAGE.width - MARGIN - rx;
  pdf.font('jp').fontSize(8.5).fillColor(BLACK);
  const who = person || company.representative || '';
  textV(pdf, `${company.name || ''}${who ? `　${who}` : ''}`, rx, L.companyNameY - 1.5, rw, 14, { size: 8.5, minSize: 6.5 });

  let ry = L.companyBodyY;
  pdf.fontSize(7).fillColor('#222');
  const locations = company.locations || [];
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    if (loc.label) { pdf.text(`［${loc.label}］`, rx, ry, { lineBreak: false }); ry += 10; }
    // 住所は英数字を半角にして 1 行に収める（長いときは文字を小さくする）
    textV(pdf, `〒${formatPostal(loc.postal)}　${toHalfWidth(loc.address || '')}`, rx, ry - 1.5, rw, 10, { size: 7, minSize: 5, color: '#222' });
    pdf.fontSize(7).fillColor('#222');
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
    try { pdf.image(stamp, PAGE.width - MARGIN - stampW + 4, L.stampY, { width: stampW }); } catch { /* 画像が読めなければ省略 */ }
  }
}

/** 表題（御見積書・納品書・御請求書） */
export function drawTitle(pdf, title) {
  pdf.font('jp').fontSize(17).fillColor(BLACK).text(title, MARGIN, L.titleY, { width: CONTENT_W, align: 'center', lineBreak: false });
}

/**
 * 件名（左）と日付・番号（右上。自社情報の上）
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
export function drawBandHead(pdf, x, y, cols, labels) {
  const w = cols.reduce((s, c) => s + c, 0);
  pdf.rect(x, y, w, L.headH).fill(BLACK);
  let cx = x;
  labels.forEach((l, i) => { textV(pdf, l, cx, y, cols[i], L.headH, { align: 'center', size: 8.5, color: '#fff' }); cx += cols[i]; });
  drawHeadSeparators(pdf, x, y, cols);
  pdf.fillColor(BLACK);
}

/** 黒帯の見出しの列の間に白い線を引く（見出しの区切りを見やすくする） */
export function drawHeadSeparators(pdf, x, y, widths, color = '#ffffff') {
  let cx = x;
  pdf.save().lineWidth(1).strokeColor(color);
  widths.slice(0, -1).forEach((w) => { cx += w; pdf.moveTo(cx, y).lineTo(cx, y + L.headH).stroke(); });
  pdf.restore();
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
const MAX_ROW_LINES = 3; // 名称が長いときは最大 3 行まで折り返す（それ以上は省略記号）

/** 行の高さを「標準の行の何倍か（units）」で測る。名称が 1 行に収まらないときは折り返す */
export function measureRow(pdf, row, columns) {
  const fixed = columns.reduce((s, c) => s + (c[1] || 0), 0);
  const widths = columns.map((c) => c[1] || CONTENT_W - fixed);
  let text = '';
  let w = CONTENT_W - 12;
  if (row.kind === 'text') { text = String(row.text || ''); }
  else if (row.kind === 'item') {
    const nameIdx = columns.findIndex((c) => !c[1]); // 幅 0（残り幅）の列が名称
    text = String(row.cells[nameIdx] ?? '');
    w = widths[nameIdx] - 12;
  } else return 1;
  pdf.font('jp').fontSize(8.5);
  if (pdf.widthOfString(text) <= w) return 1;
  const lines = Math.ceil(pdf.heightOfString(text, { width: w }) / pdf.currentLineHeight());
  return Math.max(1, Math.min(MAX_ROW_LINES, lines));
}

/** 行をページごとに分ける（1 ページ rowsPerPage 行分の高さ。折り返す行は複数行分を使う） */
export function packRows(pdf, rows, columns, rowsPerPage, restRowsPerPage = rowsPerPage) {
  const pages = [];
  let cur = [];
  let used = 0;
  for (const row of rows) {
    const units = measureRow(pdf, row, columns);
    const cap = pages.length === 0 ? rowsPerPage : restRowsPerPage; // 2 ページ目以降は見出しが小さい分、行が多く入る
    if (used + units > cap && cur.length > 0) { pages.push(cur); cur = []; used = 0; }
    cur.push({ ...row, units });
    used += units;
  }
  if (cur.length > 0 || pages.length === 0) pages.push(cur);
  return pages;
}

export function drawTable(pdf, y, { columns, rows, rowsPerPage }) {
  const fixed = columns.reduce((s, c) => s + (c[1] || 0), 0);
  const widths = columns.map((c) => c[1] || CONTENT_W - fixed);
  // 見出し
  pdf.rect(MARGIN, y, CONTENT_W, L.headH).fill(BLACK);
  let cx = MARGIN;
  columns.forEach(([label], i) => { textV(pdf, label, cx, y, widths[i], L.headH, { align: 'center', size: 8.5, color: '#fff' }); cx += widths[i]; });
  drawHeadSeparators(pdf, MARGIN, y, widths);
  pdf.fillColor(BLACK);

  const amountW = widths[widths.length - 1];
  const nameIdx = columns.findIndex((c) => !c[1]);
  // 行の高さは可変（長い名称は折り返す）。使った高さの合計は rowsPerPage 行分を超えない
  let ry = y + L.headH;
  let usedUnits = 0;
  let stripe = 0;
  const drawRowBox = (h) => {
    pdf.lineWidth(0.6).rect(MARGIN, ry, CONTENT_W, h).fillAndStroke(stripe % 2 === 0 ? GRAY : '#ffffff', LINE);
    pdf.fillColor(BLACK);
    stripe += 1;
  };
  for (const row of rows) {
    const units = row.units || measureRow(pdf, row, columns);
    if (usedUnits + units > rowsPerPage) break; // 念のため（packRows で分けているので通常は起きない）
    const h = L.rowH * units;
    drawRowBox(h);
    if (row.kind === 'text') {
      if (units > 1) paragraphV(pdf, row.text, MARGIN + 6, ry + 2, CONTENT_W - 12, h - 4, { size: 8.5, bold: true });
      else textV(pdf, row.text, MARGIN + 6, ry, CONTENT_W - 12, h, { size: 8.5, bold: true });
    } else if (row.kind === 'subtotal') {
      textV(pdf, row.name || '小計', MARGIN + 6, ry, CONTENT_W - amountW - 12, h, { align: 'right', size: 8.5, bold: true });
      textV(pdf, signedYen(row.amount), PAGE.width - MARGIN - amountW, ry, amountW - 6, h, { align: 'right', size: 8.5, bold: true });
    } else {
      cx = MARGIN;
      columns.forEach(([, , align], ci) => {
        const pad = align === 'center' ? 2 : 6;
        if (ci === nameIdx && units > 1) paragraphV(pdf, row.cells[ci], cx + pad, ry + 2, widths[ci] - pad * 2, h - 4, { align, size: 8.5 });
        else textV(pdf, row.cells[ci], cx + pad, ry, widths[ci] - pad * 2, h, { align, size: 8.5 });
        cx += widths[ci];
      });
    }
    ry += h;
    usedUnits += units;
  }
  // 残りは空行で埋める（表の下端をページごとに同じ位置にそろえる）
  for (let i = usedUnits; i < rowsPerPage; i++) { drawRowBox(L.rowH); ry += L.rowH; }
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

/**
 * 2 ページ目以降の見出し（宛名・自社情報・表題・金額欄は 1 ページ目だけに出し、ここでは 1 行にまとめる）
 *   左: 「御見積書（続き）」  右: 番号と宛名。戻り値は明細表を始める y
 */
export const CONT_TABLE_Y = MARGIN + 34;
export function drawContinuationHeader(pdf, { title, numberLabel, number, clientName, honorific = '御中' }) {
  textV(pdf, `${title}（続き）`, MARGIN, MARGIN, 220, 18, { size: 12.5 });
  const rx = MARGIN + 220;
  const rw = CONTENT_W - 220;
  textV(pdf, `${numberLabel}　${number || ''}`, rx, MARGIN - 1, rw, 10, { align: 'right', size: 8.5 });
  textV(pdf, `${clientName || ''}　${honorific}`, rx, MARGIN + 10, rw, 10, { align: 'right', size: 8, color: '#333' });
  pdf.lineWidth(0.6).moveTo(MARGIN, MARGIN + 24).lineTo(MARGIN + CONTENT_W, MARGIN + 24).stroke(LINE);
  return CONT_TABLE_Y;
}

/** 明細表の開始位置。請求書は振込先の枠がある分だけ下がる */
export function tableTop(bandBottom, { afterBank = false } = {}) {
  return bandBottom + (afterBank ? L.tableGap : L.tableGapNoBank);
}

/** 最後のページ以外に入る行数（内訳・備考は最後のページだけなので、ページ番号の上まで使う） */
export function rowsForFull(tableY) {
  return Math.max(5, Math.floor((L.pageNoY - 14 - tableY - L.headH) / L.rowH));
}

/**
 * 行をページに分ける。最後のページ以外は下まで使い、最後のページは内訳・備考の分を空ける。
 * @returns {{ pages: object[][], caps: number[] }}  caps はページごとの行数（drawTable の rowsPerPage）
 */
export function paginateRows(pdf, rows, columns, firstTableY, restTableY = CONT_TABLE_Y) {
  const full = (i) => rowsForFull(i === 0 ? firstTableY : restTableY);
  const last = (i) => rowsFor(i === 0 ? firstTableY : restTableY);
  const pages = [[]];
  const used = [0];
  for (const row of rows) {
    const units = measureRow(pdf, row, columns);
    const i = pages.length - 1;
    if (used[i] + units > full(i) && pages[i].length > 0) {
      // ページの最後が見出しの行（▼…）だけになるときは、見出しも次のページへ送る
      const carry = [];
      while (pages[i].length > 1 && pages[i][pages[i].length - 1].kind === 'text') { const h = pages[i].pop(); used[i] -= h.units; carry.unshift(h); }
      pages.push(carry); used.push(carry.reduce((n, r) => n + r.units, 0));
    }
    pages[pages.length - 1].push({ ...row, units });
    used[used.length - 1] += units;
  }
  // 最後のページに内訳・備考が入らなければ、あふれた行を次のページへ送る
  for (;;) {
    const i = pages.length - 1;
    if (used[i] <= last(i)) break;
    const move = [];
    while (pages[i].length > 1 && used[i] > last(i)) { const r = pages[i].pop(); used[i] -= r.units; move.unshift(r); }
    if (move.length === 0) break;
    pages.push(move); used.push(move.reduce((n, r) => n + r.units, 0));
  }
  const caps = pages.map((_, i) => (i === pages.length - 1 ? last(i) : full(i)));
  return { pages, caps };
}

/** 1ページに入る行数（表の開始位置から内訳・備考の分を空けて計算） */
export function rowsFor(tableY) {
  const reserved = L.breakdownGap + 27 + L.notesGap + L.notesH + 14; // 内訳（1税率）＋備考＋ページ番号
  return Math.max(5, Math.floor((L.pageNoY - reserved - tableY - L.headH) / L.rowH));
}
