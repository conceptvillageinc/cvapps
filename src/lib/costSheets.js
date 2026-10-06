// 社内見積（原価計算表）の表示用ヘルパー
import { guessCategory } from "@/lib/sheetImport";

export const COST_SHEET_STATUS = {
  submitted: { label: "入稿済", color: "bg-emerald-100 text-emerald-700" },
  lost: { label: "失注", color: "bg-slate-200 text-slate-600" },
  open: { label: "未確定", color: "bg-amber-100 text-amber-700" },
};

/** 大区分の見出し「【パッケージ1.3掛】印刷費」→ 表示用に短くする */
export function groupLabel(title) {
  return String(title || "").replace(/^【(.+?)】\s*/, "$1 ").replace(/／/g, "・").trim();
}

/** 行を大区分ごとにまとめる（シートの順） */
export function groupLines(lines) {
  const out = [];
  for (const l of lines || []) {
    let g = out[out.length - 1];
    if (!g || g.title !== l.group) { g = { title: l.group, lines: [] }; out.push(g); }
    g.lines.push(l);
  }
  return out;
}

/** 「最終納品」の行だけの合計（候補が並ぶタブ用）。最終納品の印が 1 つも無ければ null */
export function finalTotals(lines) {
  const fin = (lines || []).filter((l) => l.final);
  if (fin.length === 0) return null;
  const sell = fin.reduce((s, l) => s + Number(l.adjusted || l.sell_total || 0), 0);
  const cost = fin.reduce((s, l) => s + Number(l.cost_total || 0), 0);
  return { count: fin.length, sell, cost, gross: sell - cost, margin: sell > 0 ? (sell - cost) / sell : null };
}

/** 検索用の文字列（件名・明細名・備考・仕入先・記入者） */
export function searchText(cs) {
  return [cs.title, cs.sheet_title, cs.period, ...(cs.lines || []).flatMap((l) => [l.name, l.memo, l.vendor, l.section]), ...(cs.authors || [])].filter(Boolean).join(" ");
}

/**
 * 新規見積に使う行の初期選択（シートの行番号の配列）。
 *   調整後売価が 0 の行（使っていない割引の候補・空の行）は外す。
 *   最終納品の印がある区分では、印の付いた行だけ（数量違いの候補のうち採用した行）。
 */
export function defaultSelectedRows(cs) {
  const lines = cs.lines || [];
  const finalGroups = new Set(lines.filter((l) => l.final).map((l) => l.group));
  return lines
    .filter((l) => Math.round(Number(l.adjusted || 0)) !== 0)
    .filter((l) => !finalGroups.has(l.group) || l.final)
    .map((l) => l.row);
}

/**
 * 社内見積の行を、新しい見積の明細にする。
 * @param {object} cs        cost_sheets の 1 行
 * @param {number[]} [rows]  使う行（シートの行番号）。省略時は defaultSelectedRows
 */
export function linesToEstimateItems(cs, rows) {
  const uid = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wanted = new Set((rows && rows.length ? rows : defaultSelectedRows(cs)).map(Number));
  const picked = (cs.lines || []).filter((l) => wanted.has(Number(l.row)));
  const imgByRow = new Map((cs.images || []).filter((im) => im.near_row).map((im) => [im.near_row, im.path]));
  return picked.map((l) => {
    const qty = Number(l.qty) > 0 ? Number(l.qty) : 1;
    const amount = Math.round(Number(l.adjusted || 0) || Number(l.sell_total || 0));
    const unitPrice = Math.round(amount / qty);
    const name = l.name === "〃" || !l.name
      ? `${l.section || groupLabel(l.group)}${l.qty ? ` ${Number(l.qty).toLocaleString()}${l.unit || ""}` : ""}`.trim()
      : l.name;
    const costTotal = Number(l.cost_total) || 0;
    return {
      id: uid(),
      row_type: "item",
      category: guessCategory(`${l.group} ${l.section} ${l.name}`),
      name: /割引/.test(name) && l.memo ? `${name}（${l.memo.split("\n")[0]}）` : name,
      quantity: qty,
      unit: (l.unit || "式").replace(/／.*$/, "") || "式",
      unit_price: unitPrice,
      amount: unitPrice * qty,
      tax_rate: 10,
      cost_price: costTotal ? Math.round((costTotal / qty) * 100) / 100 : (Number(l.cost_unit) && Number(l.qty) ? Number(l.cost_unit) : null),
      markup_rate: Number(l.markup) || null,
      source_type: l.vendor ? "vendor_quote" : "manual",
      source_ref: l.vendor || null,
      source_url: l.url || null,
      screenshot_path: imgByRow.get(l.row) || null,
      notes: [l.memo, `原価計算表 ${cs.period} ${cs.title} より`].filter(Boolean).join("\n"),
      copied_from: `原価計算表 ${cs.period} ${cs.title}`,
    };
  });
}
