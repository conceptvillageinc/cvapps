// ============================================================================
// 入稿記録: 見積書のどの明細（品名・枚数・金額）で、どの入稿先に入稿したか。
//   print_orders に 1 行ずつ残し、見積書・案件詳細・クライアントカルテの「入稿履歴」に出す。
//   追加印刷のときは、記録した内容を引き継いで新しい見積を作る。
// ============================================================================
import { todayString } from "@/lib/fiscal";

/** 印刷の明細か（入稿の候補にする行）。区分が印刷費、または入稿先 URL・仕入先がある行 */
export function isPrintLine(li) {
  if (!li || li.row_type === "text" || li.row_type === "subtotal" || li.source_type === "rule") return false;
  return /印刷/.test(String(li.category || "")) || !!li.source_url || li.source_type === "price_master" || li.source_type === "vendor_quote";
}

/** 見積の明細から、入稿記録の初期値を作る */
export function orderFromLine(estimate, li, { project = null, user = null } = {}) {
  return {
    estimate_id: estimate.id,
    estimate_number: estimate.estimate_number || "",
    estimate_line_id: li.id,
    project_id: estimate.project_id || project?.id || null,
    client_id: estimate.client_id || project?.client_id || null,
    client_name: estimate.client_name || project?.client_name || "",
    ordered_on: todayString(),
    name: li.name || "",
    category: li.category || "",
    quantity: li.quantity != null && li.quantity !== "" ? Number(li.quantity) : null,
    unit: li.unit || "",
    unit_price: li.unit_price != null && li.unit_price !== "" ? Number(li.unit_price) : null,
    amount: li.amount != null && li.amount !== "" ? Number(li.amount) : null,
    cost_price: li.cost_price != null && li.cost_price !== "" ? Number(li.cost_price) : null,
    vendor: li.source_type === "vendor_quote" && li.source_ref ? String(li.source_ref) : (li.vendor || ""), // 価格マスタの行は仕入先名を持たないので空
    source_url: li.source_url || "",
    screenshot_path: li.screenshot_path || null,
    memo: "",
    created_by: user?.id || null,
    created_by_name: user?.full_name || user?.email || "",
  };
}

/** 入稿記録から、追加印刷の見積の明細を作る */
export function lineFromOrder(o) {
  const qty = Number(o.quantity) > 0 ? Number(o.quantity) : 1;
  const unitPrice = o.unit_price != null ? Number(o.unit_price) : Math.round((Number(o.amount) || 0) / qty);
  return {
    id: `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    row_type: "item",
    category: o.category || "印刷費（紙）",
    name: o.name,
    quantity: qty,
    unit: o.unit || "式",
    unit_price: unitPrice,
    amount: Math.round(unitPrice * qty),
    tax_rate: 10,
    cost_price: o.cost_price != null ? Number(o.cost_price) : null,
    source_type: o.vendor ? "vendor_quote" : "manual",
    source_ref: o.vendor || null,
    source_url: o.source_url || null,
    screenshot_path: o.screenshot_path || null,
    notes: `前回の入稿: ${o.ordered_on}${o.estimate_number ? `（見積 ${o.estimate_number}）` : ""}${o.memo ? `\n${o.memo}` : ""}`,
    copied_from: `入稿記録 ${o.ordered_on}${o.estimate_number ? ` ${o.estimate_number}` : ""}`,
    cost_as_of: o.ordered_on, // 価格確認で「前回の原価の時点」に使う
  };
}

/** 入稿記録の内訳（社内見積の小見出しごとにまとめた記録の行）。1 行だけのときは内訳として出さない */
export const orderItems = (o) => (Array.isArray(o?.items) && o.items.length > 1 ? o.items : []);

/**
 * 入稿記録から、追加印刷の見積の明細を作る（内訳があれば内訳の行ごと。M 4枚・XL 1枚・送料 など）
 * @returns {object[]}
 */
export function linesFromOrder(o) {
  const items = orderItems(o);
  if (items.length === 0) return [lineFromOrder(o)];
  return items.map((it, i) => {
    const line = lineFromOrder({
      ...o,
      name: it.extra || String(o.name).includes(it.name) ? it.name : `${o.name} ${it.name}`,
      quantity: it.quantity, unit: it.unit || "式", unit_price: it.unit_price, amount: it.amount, cost_price: it.cost_price,
      vendor: it.vendor || "", source_url: it.source_url || "",
      screenshot_path: i === 0 ? o.screenshot_path : null,
    });
    return { ...line, id: `${line.id}_${i}` };
  });
}

export const fmtOrderDate = (ymd) => String(ymd || "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3");
