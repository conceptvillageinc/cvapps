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
 * 社内見積の行を、新しい見積の明細にする。
 * 最終納品の印がある行があればそれだけ、無ければ金額のある行すべて。割引・コンセプト設計・校正の自動計算行は除く。
 */
export function linesToEstimateItems(cs) {
  const uid = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const lines = cs.lines || [];
  const hasFinal = lines.some((l) => l.final);
  const picked = lines.filter((l) => (hasFinal ? l.final : true) && l.name && !/^【?CV割引|Draw up|^コンセプト設計費$|^校正費$/.test(l.name) && (l.adjusted || l.sell_total));
  const imgByRow = new Map((cs.images || []).filter((im) => im.near_row).map((im) => [im.near_row, im.path]));
  return picked.map((l) => {
    const qty = Number(l.qty) || 1;
    const amount = Math.round(Number(l.adjusted || l.sell_total) || 0);
    const unitPrice = Math.round(amount / qty);
    return {
      id: uid(),
      row_type: "item",
      category: guessCategory(`${l.group} ${l.section} ${l.name}`),
      name: l.name === "〃" ? `${l.section} ${l.qty ? `${Number(l.qty).toLocaleString()}${l.unit || ""}` : ""}`.trim() : l.name,
      quantity: qty,
      unit: (l.unit || "式").replace(/／.*$/, ""),
      unit_price: unitPrice,
      amount,
      tax_rate: 10,
      cost_price: Number(l.cost_unit) || (Number(l.cost_total) ? Number(l.cost_total) / qty : null),
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
