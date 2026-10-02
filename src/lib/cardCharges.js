// 支払い先まとめ: クレジットカード利用明細 CSV の読み取り・集計・CSV 出力
import { decodeCsv, parseCsvText as parseCsv } from "@/lib/bankImport";
import { downloadText } from "@/lib/mfExport";
import { BILL_TO } from "@/lib/payables";

/** 列の役割と、見出しから当てる手がかり */
export const CARD_FIELDS = [
  { key: "charged_at", label: "利用日", match: /利用日|ご利用日|取引日|決済日|日付|^日$/ },
  { key: "merchant", label: "利用先", match: /利用先|ご利用先|加盟店|店名|利用店|摘要|内容|取引先|明細/ },
  { key: "amount", label: "金額", match: /利用金額|ご利用金額|請求額|金額|支払額/ },
  { key: "holder", label: "利用者・カード", match: /利用者|名義|カード名|カード番号|カード|社員|メンバー/ },
  { key: "memo", label: "メモ", match: /備考|メモ|コメント|経費|科目|部門|プロジェクト|タグ/ },
];

const num = (v) => {
  const s = String(v ?? "").replace(/[\\￥¥,\s円]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** "2026/09/03" "2026-9-3" "20260903" "令和8年9月3日" → "2026-09-03" */
export function toIsoDate(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/. 年]\s*(\d{1,2})[-/. 月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^令和\s*(\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return `${2018 + Number(m[1])}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

/** 見出し行を探し、列の役割を当てる。返り値 { headerIndex, header, mapping: { charged_at: colIdx, ... } } */
export function guessCardMapping(grid) {
  const rows = grid || [];
  let headerIndex = -1; let best = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    const hits = CARD_FIELDS.filter((f) => cells.some((c) => f.match.test(c))).length;
    if (hits > best && hits >= 2) { best = hits; headerIndex = i; }
  }
  const header = headerIndex >= 0 ? rows[headerIndex].map((c) => String(c ?? "").trim()) : [];
  const mapping = {};
  const used = new Set();
  for (const f of CARD_FIELDS) {
    const idx = header.findIndex((h, i) => !used.has(i) && f.match.test(h));
    if (idx >= 0) { mapping[f.key] = idx; used.add(idx); }
  }
  // 金額の列が複数ある CSV（利用金額／請求額）は「利用金額」を優先
  const amountIdx = header.findIndex((h) => /利用金額|ご利用金額/.test(h));
  if (amountIdx >= 0) mapping.amount = amountIdx;
  // メモは「備考／メモ」があればそれを優先（経費科目などより）
  const memoIdx = header.findIndex((h, i) => i !== mapping.charged_at && i !== mapping.merchant && i !== mapping.amount && i !== mapping.holder && /備考|メモ|コメント/.test(h));
  if (memoIdx >= 0) mapping.memo = memoIdx;
  return { headerIndex, header, mapping };
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const fingerprintOf = (c) => `${c.charged_at}|${clean(c.merchant).normalize("NFKC").toLowerCase()}|${Math.round(c.amount)}|${clean(c.holder).normalize("NFKC").toLowerCase()}`;

/** 2 次元配列と列の対応から利用明細を作る。日付か金額が無い行、合計行は飛ばす */
export function rowsFromGrid(grid, headerIndex, mapping, entity = "cv", cardLabel = "") {
  const out = []; const skipped = [];
  const get = (row, key) => (mapping[key] === undefined || mapping[key] === "" ? "" : row[mapping[key]]);
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    const charged_at = toIsoDate(get(row, "charged_at"));
    const amount = num(get(row, "amount"));
    const merchant = clean(get(row, "merchant"));
    if (!charged_at || !amount) { skipped.push(i + 1); continue; }
    if (/^(合計|小計|総計)/.test(merchant)) continue;
    const c = { charged_at, charge_month: charged_at.slice(0, 7), merchant: merchant || "（利用先不明）", amount: Math.round(amount), holder: clean(get(row, "holder")) || null, memo: clean(get(row, "memo")) || null, entity, card_label: cardLabel || null, source: "csv" };
    c.fingerprint = fingerprintOf(c);
    out.push(c);
  }
  return { rows: out, skipped };
}

/** ファイル（CSV）→ 2 次元配列 */
export async function cardCsvToGrid(file) {
  const text = await decodeCsv(file);
  return parseCsv(text);
}

export function sumCharges(list) {
  const t = { count: list.length, total: 0, byEntity: {}, byHolder: new Map() };
  for (const b of BILL_TO) t.byEntity[b.code] = 0;
  for (const c of list) {
    const a = Number(c.amount) || 0;
    t.total += a;
    t.byEntity[c.entity] = (t.byEntity[c.entity] || 0) + a;
    const h = c.holder || "（利用者なし）";
    t.byHolder.set(h, (t.byHolder.get(h) || 0) + a);
  }
  t.total_ex_tax = Math.round(t.total / 1.1);
  return t;
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function chargesToCsv(list, month) {
  const head = ["利用月", "利用日", "利用先", "金額（税込）", "利用者・カード", "会社", "メモ"];
  const lines = [head.join(",")];
  for (const c of list) {
    const b = BILL_TO.find((x) => x.code === c.entity);
    lines.push([c.charge_month, c.charged_at, c.merchant, Number(c.amount) || 0, c.holder || "", b ? b.label : c.entity, c.memo || ""].map(csvCell).join(","));
  }
  const t = sumCharges(list);
  lines.push(["", "", "合計", t.total, "", "", `税抜 ${t.total_ex_tax}`].map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
export function downloadChargesCsv(list, month) { downloadText(chargesToCsv(list, month), `カード利用明細まとめ_${month}.csv`); }
