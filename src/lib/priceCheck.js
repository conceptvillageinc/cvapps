// ============================================================================
// 印刷費・仕入の行の「今の価格」確認
//   社内見積（原価計算表）や過去の見積から引き継いだ行、価格マスタ・入稿先 URL・仕入先見積から入れた行について、
//   見積に入れたときの原価と今の原価を比べる。
//   今の原価の出どころ:
//     url    … 行の入稿先 URL の価格表を読み直す（価格マスタの URL 取り込みと同じ仕組み）
//     master … 価格マスタの同じ仕入先・同じ数量の価格
//   どちらも無い／読めない行は「要確認」。
//   結果は明細の price_check に残す: { status, checked_at, old_cost, current_cost, source, label, ref, error }
//     status: same | up | down | unknown | replaced
// ============================================================================

import { toTaxExcluded, vendorTaxMode } from "@/lib/priceTax";

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/株式会社|（株）|\(株\)|㈱/g, "");
const urlKey = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`; } catch { return ""; } };

/**
 * 価格確認の対象の行。
 *   価格マスタ・仕入先見積・入稿先 URL から入れた行と、社内見積・過去の見積から引き継いだ印刷費・仕入先の行。
 *   社内のデザイン費・自動計算の行・割引は、外で値段が変わらないので対象外。
 */
export function priceCheckTargets(items) {
  return (items || []).filter((li) => {
    if (li.row_type === "text" || li.row_type === "subtotal" || li.source_type === "rule" || li.source_type === "design_master") return false;
    if (/割引/.test(li.name || "") || !(Number(li.amount) > 0)) return false;
    if (li.source_type === "price_master" || li.source_type === "vendor_quote" || li.source_url) return true;
    return !!li.copied_from && (!!li.source_ref || /印刷/.test(li.category || ""));
  });
}
/** 旧名（互換） */
export const carriedItems = priceCheckTargets;

/** 価格マスタから入れた行なら、その価格マスタ */
export const masterOf = (li, masters) => (li.source_type === "price_master" ? (masters || []).find((m) => m.id === li.source_ref) || null : null);

/** 仕入先名（価格マスタから入れた行は source_ref がマスタの id なので、マスタの仕入先名） */
export function vendorOf(li, masters) {
  const m = masterOf(li, masters);
  if (m) return m.vendor_name || "";
  return li.source_type === "price_master" ? "" : (li.source_ref || "");
}

/** 行の出どころの説明（一覧の小さい字） */
export function originLabel(li, masters) {
  if (li.copied_from) return /^原価計算表/.test(li.copied_from) ? li.copied_from.replace(/^原価計算表\s*/, "社内見積 ") : `見積 ${li.copied_from}`;
  if (li.source_type === "price_master") { const m = masterOf(li, masters); return m ? `価格マスタ ${m.vendor_name || ""} ${m.spec_summary || ""}`.trim() : "価格マスタ（削除済み）"; }
  if (li.source_type === "vendor_quote") return "仕入先の見積";
  return li.source_url ? "入稿先 URL" : "";
}

/** 原価計算表から来た行か */
export const fromCostSheet = (li) => /^原価計算表/.test(li.copied_from || "");

/** 前回の原価（1 単位あたり・税別） */
export function oldUnitCost(li) {
  const c = li.price_check?.old_cost ?? li.cost_price;
  return c === null || c === undefined || c === "" ? null : Number(c);
}

/**
 * 価格表（price_grid）から、同じ数量の行で、前回の原価にいちばん近いマス（同じ納期・同じ仕様とみなす）を選ぶ。
 * @returns {{ unitCost, label, quantity } | null}
 */
export function pickFromGrid(grid, quantity, oldCost, taxMode) {
  const q = Number(quantity) || 0;
  const row = (grid || []).find((r) => Number(r.quantity) === q);
  if (!row || !(row.cells || []).length) return null;
  const cells = row.cells.filter((c) => Number(c.price) > 0).map((c) => ({ label: c.label, unitCost: toTaxExcluded(c.price, taxMode) / q }));
  if (cells.length === 0) return null;
  const best = oldCost != null
    ? cells.reduce((a, b) => (Math.abs(b.unitCost - oldCost) < Math.abs(a.unitCost - oldCost) ? b : a))
    : cells[0];
  return { unitCost: Math.round(best.unitCost * 100) / 100, label: best.label, quantity: q };
}

/** 価格マスタから候補を探す（入稿先 URL が同じもの → 仕入先が同じもの の順。同じ数量の行があるものだけ） */
export function findMaster(li, masters) {
  const qty = Number(li.quantity) || 0;
  const hasQty = (m) => (m.price_grid || []).some((r) => Number(r.quantity) === qty);
  const own = masterOf(li, masters);
  if (own && hasQty(own)) return own;
  const byUrl = li.source_url ? (masters || []).filter((m) => m.source_url && urlKey(m.source_url) === urlKey(li.source_url) && hasQty(m)) : [];
  if (byUrl.length) return byUrl[0];
  const v = norm(vendorOf(li, masters));
  if (!v) return null;
  return (masters || []).find((m) => norm(m.vendor_name) === v && hasQty(m)) || null;
}

/** 前回と今を比べて status を決める（1 円未満・0.5% 未満の差は「変わりなし」） */
export function compareCost(oldCost, nowCost) {
  if (oldCost == null || nowCost == null) return "unknown";
  const diff = nowCost - oldCost;
  if (Math.abs(diff) < 1 && Math.abs(diff) <= Math.abs(oldCost) * 0.005 + 0.01) return "same";
  if (oldCost > 0 && Math.abs(diff) / oldCost < 0.005) return "same";
  return diff > 0 ? "up" : "down";
}

/** 価格マスタで確認する（通信なし） */
export function checkWithMaster(li, masters, printVendors) {
  const m = findMaster(li, masters);
  if (!m) return null;
  const mode = m.price_tax_mode === "excluded" ? "excluded" : m.price_tax_mode === "included" ? "included" : vendorTaxMode(printVendors, m.vendor_name);
  const old = oldUnitCost(li);
  const p = pickFromGrid(m.price_grid, li.quantity, old, mode);
  if (!p) return null;
  return { status: compareCost(old, p.unitCost), checked_at: new Date().toISOString(), old_cost: old, current_cost: p.unitCost, source: "master", label: p.label || "", ref: `${m.vendor_name || ""} ${m.spec_summary || ""}`.trim(), master_date: m.last_updated || null, error: "" };
}

/** URL の価格表で確認する（fetchPriceFromUrl の結果を渡す） */
export function checkWithGrid(li, grid, printVendors, masters = [], url = li.source_url) {
  const old = oldUnitCost(li);
  const m = masterOf(li, masters);
  const mode = m?.price_tax_mode === "excluded" ? "excluded" : m?.price_tax_mode === "included" ? "included" : vendorTaxMode(printVendors, vendorOf(li, masters));
  const p = pickFromGrid(grid, li.quantity, old, mode);
  if (!p) return { status: "unknown", checked_at: new Date().toISOString(), old_cost: old, current_cost: null, source: "url", label: "", ref: url, error: `価格表に ${Number(li.quantity).toLocaleString()} の行がありませんでした` };
  return { status: compareCost(old, p.unitCost), checked_at: new Date().toISOString(), old_cost: old, current_cost: p.unitCost, source: "url", label: p.label || "", ref: url, error: "" };
}

/** 今の原価に置き換える。売価は前回の「売価 ÷ 原価」の比率をそのまま使う（無ければ掛け率） */
export function replaceWithCurrent(li) {
  const pc = li.price_check || {};
  const now = Number(pc.current_cost);
  const old = Number(pc.old_cost ?? li.cost_price);
  const qty = Number(li.quantity) || 1;
  const ratio = old > 0 ? Number(li.unit_price) / old : Number(li.markup_rate) || 1;
  // 単価の小数の桁は前回にそろえる（38.9 のような小数単価はそのまま小数で）
  const digits = Math.min(2, (String(li.unit_price ?? "").split(".")[1] || "").length);
  const f = 10 ** digits;
  const unitPrice = Math.ceil(Number((now * ratio * f).toFixed(6))) / f;
  return { ...li, cost_price: now, unit_price: unitPrice, amount: Math.round(unitPrice * qty), price_check: { ...pc, status: "replaced", replaced_at: new Date().toISOString(), old_unit_price: li.unit_price } };
}

export const PRICE_CHECK_STATUS = {
  none: { label: "未確認", cls: "bg-slate-100 text-slate-600" },
  same: { label: "変わりなし", cls: "bg-emerald-100 text-emerald-700" },
  up: { label: "値上がり", cls: "bg-red-100 text-red-700" },
  down: { label: "値下がり", cls: "bg-sky-100 text-sky-700" },
  unknown: { label: "要確認", cls: "bg-amber-100 text-amber-800" },
  replaced: { label: "置き換え済み", cls: "bg-violet-100 text-violet-700" },
};

/**
 * 確認できなかった理由の種類（次にやることの出し分けに使う）
 *   url_unreadable … 入稿先 URL はあるが読めなかった（JavaScript で価格を出すページ・ボット対策・時間切れ）
 *   no_quantity    … 価格表は読めたが、同じ数量の行が無かった
 *   no_source      … 入稿先 URL も価格マスタの登録も無い
 */
export function unknownReason(li, masters) {
  const pc = li.price_check || {};
  if (/の行がありませんでした/.test(pc.error || "")) return "no_quantity";
  if (li.source_url || masterOf(li, masters)?.source_url || pc.source === "url") return "url_unreadable";
  return "no_source";
}

/**
 * 手で入れた今の金額で比べる（入稿先や仕入先の見積を見て入力した値）。
 * @param {number} total   見た金額（数量分の合計）
 * @param {"included"|"excluded"} taxMode
 */
export function checkManual(li, total, taxMode, userName = "") {
  const old = oldUnitCost(li);
  const qty = Number(li.quantity) || 1;
  const unit = Math.round((toTaxExcluded(total, taxMode) / qty) * 100) / 100;
  return { ...(li.price_check || {}), status: compareCost(old, unit), checked_at: new Date().toISOString(), old_cost: old, current_cost: unit, source: "manual", label: taxMode === "included" ? "税込で入力" : "税別で入力", ref: "", error: "", checked_by: userName, manual_total: Number(total) };
}

/** 「前回と同じでよい」として確認済みにする */
export function markSame(li, userName = "") {
  const old = oldUnitCost(li);
  return { ...(li.price_check || {}), status: "same", checked_at: new Date().toISOString(), old_cost: old, current_cost: old, source: "manual_same", label: "", ref: "", error: "", checked_by: userName };
}
