import { createHash } from 'node:crypto';
import { cellRef } from './xlsx.js';

// ============================================================================
// 「【原価計算表】◯期_クライアント名_社内見積」のタブ 1 枚を、アプリの「社内見積（原価計算表）」1 件にする。
//
// タブの作り（テンプレ）:
//   G7 外注／仕入合計（税別）  H7 調整後売価合計（税別）
//   B 列に「【CV割引】」「コンセプト設計費」「【社内】デザイン費／…」「【パッケージ1.3掛】印刷費」などの見出し、
//   その下に行が並ぶ。行の列: C NO. / D 記入日時 / E 記入者 / F 項目 / G 備考 / H 金額・単価 / I 数量・時間 / J 単位 /
//   K 仕入計 / L 掛け率 / M 売価単価 / N 売価計 / O 調整後売価 / P 粗利額 / Q 粗利率 / R 仕入先・URL等 / S URL / T 最終納品チェック
//   B 列の小見出し（社内デザイン・パッケージ など）は、次の小見出しまで下の行にも効く。
//   V 列より右は料金の目安表なので読まない。
// 画像: 行の近くに貼った仕入先の見積スクショ（原価の根拠）や、提出した見積書の画像。
//   見出しの行の範囲で、どの区分の画像かを決める。全タブに同じ画像（ロゴ・注意書き）があるものはテンプレとして外す。
// ============================================================================

const COL = { no: 'C', date: 'D', author: 'E', name: 'F', memo: 'G', cost_unit: 'H', qty: 'I', unit: 'J', cost_total: 'K', markup: 'L', sell_unit: 'M', sell_total: 'N', adjusted: 'O', gross: 'P', margin: 'Q', vendor: 'R', url: 'S', final: 'T' };
const END_RE = /見積り?作成注意事項|注意事項チェック/;
const num = (v) => { if (v === null || v === undefined || v === '') return 0; const n = Number(String(v).replace(/[,¥￥\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const isTrue = (v) => v === true || /^(true|1|✓|〇|○)$/i.test(str(v));

/** 「20251002」「251002」「2025/10/02」→ 2025-10-02。読めなければ "" */
export function parseEntryDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel のシリアル値
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).replace(/\.0+$/, '').replace(/[^\d]/g, '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{6}$/.test(s)) return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return '';
}

/** ファイル名「【原価計算表】14期_ホップジャパン_社内見積」→ { period: "14期", client_name: "ホップジャパン" } */
export function parseFileTitle(title) {
  const t = String(title || '').trim();
  const m = /(\d+)\s*期[_＿\s]+(.+?)[_＿\s]*社内見積/.exec(t);
  if (m) return { period: `${m[1]}期`, client_name: m[2].trim() };
  const p = /(\d+)\s*期/.exec(t);
  return { period: p ? `${p[1]}期` : '', client_name: t.replace(/【[^】]*】/g, '').replace(/社内見積/g, '').replace(/^[_＿\s]+|[_＿\s]+$/g, '') };
}

/** タブ名「高島屋お歳暮ラベル_260120」→ { title, status: submitted|lost|open, sheet_date } */
export function parseTabName(name) {
  let t = String(name || '').trim();
  let status = 'open'; let date = '';
  const dm = /[_＿\s]+(\d{6}|\d{8})\s*$/.exec(t);
  if (dm) { date = parseEntryDate(dm[1]); status = 'submitted'; t = t.slice(0, dm.index); }
  if (/失注/.test(t)) { status = 'lost'; t = t.replace(/[_＿\s]*失注[_＿\s]*/g, ''); }
  else if (/入稿/.test(t)) { status = 'submitted'; t = t.replace(/[_＿\s]*入稿日?[_＿\s]*$/g, ''); }
  return { title: t.replace(/[_＿\s]+$/g, '').trim() || String(name || '').trim(), status, sheet_date: date };
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

/**
 * タブ 1 枚を読む。
 * @param {{ name, sheetId, cells: Map, maxRow, images }} sheet  readXlsx の 1 シート
 * @param {{ templateHashes?: Set<string> }} [opts]  全タブ共通の画像（外す）のハッシュ
 * @returns {{ title, status, sheet_date, sell_total, cost_total, gross, margin, authors, last_entry_date, lines, images }}
 *   images は { row, col, group, section, data, ext, sha } で、保存先は呼び出し側が決める。
 */
export function parseCostSheet(sheet, { templateHashes = new Set() } = {}) {
  const get = (col, row) => sheet.cells.get(`${col}${row}`);
  const { title, status, sheet_date } = parseTabName(sheet.name);
  const cost_total = Math.round(num(get('G', 7)));
  const sell_total = Math.round(num(get('H', 7)));

  // 見出し（大区分）と小見出し（区分）を行の順に拾う
  const groups = []; // { title, start, end }
  let endRow = sheet.maxRow;
  for (let r = 8; r <= sheet.maxRow; r++) {
    const b = str(get('B', r));
    if (!b) continue;
    if (END_RE.test(b)) { endRow = r - 1; break; }
    const isGroup = /^【/.test(b) || /^コンセプト設計費$/.test(b);
    if (isGroup) groups.push({ title: b.replace(/\s+/g, ' '), start: r, end: sheet.maxRow });
  }
  for (let i = 0; i < groups.length; i++) groups[i].end = (groups[i + 1]?.start ?? endRow + 1) - 1;
  const groupAt = (row) => groups.find((g) => row >= g.start && row <= g.end) || null;

  const lines = [];
  let section = '';
  let currentGroup = null;
  for (let r = 8; r <= endRow; r++) {
    const g = groupAt(r);
    if (g && g !== currentGroup) { currentGroup = g; section = ''; }
    const b = str(get('B', r));
    if (b && !/^【/.test(b) && !/^コンセプト設計費$/.test(b)) section = b.replace(/\s+/g, ' ');
    if (!currentGroup) continue;
    const name = str(get(COL.name, r));
    const noCell = get(COL.no, r);
    const costTotal = num(get(COL.cost_total, r));
    const sellTotal = num(get(COL.sell_total, r));
    const adjusted = num(get(COL.adjusted, r));
    const qty = num(get(COL.qty, r));
    const isHeader = /^(項目|NO\.?)$/i.test(name) || /^NO\.?$/i.test(str(noCell));
    if (isHeader) continue;
    // 値の無いテンプレの行（単価や掛け率だけ入っている）は飛ばす。金額があるか、名前と記入者・記入日がある行だけ
    const author = str(get(COL.author, r)).replace(/^記入者$/, '');
    const entered = parseEntryDate(get(COL.date, r));
    const hasAmount = Math.round(costTotal) !== 0 || Math.round(sellTotal) !== 0 || Math.round(adjusted) !== 0;
    if (!hasAmount && !(name && (author || entered))) continue;
    lines.push({
      row: r,
      group: currentGroup.title,
      section: section || (currentGroup.title === 'コンセプト設計費' ? 'コンセプト設計費' : ''),
      no: str(noCell).replace(/\.0$/, ''),
      entered_on: entered,
      author,
      name,
      memo: str(get(COL.memo, r)),
      cost_unit: num(get(COL.cost_unit, r)),
      qty,
      unit: str(get(COL.unit, r)),
      cost_total: Math.round(costTotal * 100) / 100,
      markup: num(get(COL.markup, r)),
      sell_unit: num(get(COL.sell_unit, r)),
      sell_total: Math.round(sellTotal),
      adjusted: Math.round(adjusted),
      vendor: str(get(COL.vendor, r)),
      url: str(get(COL.url, r)) || (/^https?:\/\//.test(str(get(COL.vendor, r))) ? str(get(COL.vendor, r)) : ''),
      final: isTrue(get(COL.final, r)),
    });
  }
  // 仕入先の列に URL が入っているときは、仕入先名を空にする
  for (const l of lines) if (l.vendor && /^https?:\/\//.test(l.vendor)) l.vendor = '';

  const images = [];
  for (const im of sheet.images || []) {
    const sha = sha1(im.data);
    if (templateHashes.has(sha)) continue;
    if (im.row <= 16 || im.col >= 21) continue; // 見出しの上と、右の料金目安表のところ
    // 表の下（注意事項チェックより下）に貼った画像は、いちばん下の区分のものとみなす
    const g = groupAt(im.row) || (im.row > endRow && lines.length > 0 ? groups.find((x) => x.title === lines[lines.length - 1].group) || null : null);
    // 画像の位置より上で、いちばん近い行の区分
    const near = [...lines].reverse().find((l) => l.row <= im.row && (!g || l.group === g.title));
    images.push({ row: im.row, col: im.col, group: g?.title || '', section: near?.section || '', near_row: near?.row || null, data: im.data, ext: im.ext, sha, width: Math.round(im.cx / 9525), height: Math.round(im.cy / 9525) });
  }

  const authors = [...new Set(lines.map((l) => l.author).filter(Boolean))];
  const last_entry_date = lines.map((l) => l.entered_on).filter(Boolean).sort().slice(-1)[0] || '';
  const gross = sell_total - cost_total;
  return { title, status, sheet_date, sell_total, cost_total, gross, margin: sell_total > 0 ? gross / sell_total : null, authors, last_entry_date, lines, images };
}

/** ブック全体で 3 タブ以上（または半分以上）に同じ画像があれば、テンプレの画像とみなす */
export function templateImageHashes(sheets) {
  const count = new Map();
  for (const s of sheets) {
    const seen = new Set((s.images || []).map((im) => sha1(im.data)));
    for (const h of seen) count.set(h, (count.get(h) || 0) + 1);
  }
  const n = sheets.length;
  const out = new Set();
  for (const [h, c] of count) if (c >= 3 || (n >= 2 && c * 2 >= n)) out.add(h);
  return out;
}

/** テンプレのタブ（値の無いもの）か */
export function isEmptySheet(parsed) {
  return parsed.lines.length === 0 && !parsed.sell_total && !parsed.cost_total;
}
