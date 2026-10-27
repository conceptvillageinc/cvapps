// ============================================================================
// 案件の受注見込・発注見込を、見積の明細から入れる
//   受注見込 = チェックした明細の金額（税抜）の合計（値引きの行はマイナスのまま）
//   発注見込 = チェックした明細の 原価 × 数量 の合計
//   入れたときの見積・明細・金額を project.forecast_source に残し、見積があとで変わったら差を出す
// ============================================================================
import { lineTaxRate } from "@/lib/estimateTotals";
import { submissionOf } from "@/lib/submission";

/** 見積の明細のうち、見込みに使える行（見出し・小計を除く） */
export function forecastLines(estimate) {
  const inclusive = !!estimate?.tax_inclusive;
  return (estimate?.line_items || [])
    .filter((li) => li.row_type !== "text" && li.row_type !== "subtotal")
    .map((li) => {
      const qty = Number(li.quantity) || 0;
      const amount = Number(li.amount) || 0;
      const rate = lineTaxRate(li);
      const revenue = inclusive ? Math.round((amount * 100) / (100 + rate)) : Math.round(amount);
      const hasCost = li.cost_price !== null && li.cost_price !== undefined && li.cost_price !== "" && Number(li.cost_price) !== 0;
      const cost = hasCost ? Math.round((Number(li.cost_price) || 0) * qty) : 0;
      return { id: li.id, name: li.name || li.category || "（名称なし）", category: li.category || "", qty, unit: li.unit || "", revenue, cost, hasCost, isDiscount: amount < 0 };
    });
}

/** チェックした行の合計 */
export function sumLines(lines, ids) {
  const set = new Set(ids);
  return lines.filter((l) => set.has(l.id)).reduce((s, l) => ({ revenue: s.revenue + l.revenue, cost: s.cost + l.cost }), { revenue: 0, cost: 0 });
}

/** 最初に選ぶ見積: 提出済み → 最新 */
export function defaultEstimate(estimates) {
  const v2 = (estimates || []).filter((e) => e.schema_version === 2);
  const list = v2.length ? v2 : estimates || [];
  return list.find((e) => submissionOf(e) === "submitted") || list[0] || null;
}

/**
 * 入れたあとに見積が変わっていないか。変わっていれば { revenue, cost, newLines, missing } を返す（変わっていなければ null）
 *   newLines: 入れたあとに見積に増えた明細（チェックしていないので見込みには入っていない）
 */
export function forecastDrift(source, estimate) {
  if (!source?.estimate_id || !estimate || estimate.id !== source.estimate_id) return null;
  const lines = forecastLines(estimate);
  const ids = source.line_ids || [];
  const now = sumLines(lines, ids);
  const known = new Set([...(ids || []), ...(source.unchecked_ids || [])]);
  const newLines = lines.filter((l) => !known.has(l.id));
  const missing = ids.filter((id) => !lines.some((l) => l.id === id)).length;
  if (now.revenue === Number(source.revenue) && now.cost === Number(source.cost) && newLines.length === 0 && missing === 0) return null;
  return { revenue: now.revenue, cost: now.cost, newLines, missing };
}
