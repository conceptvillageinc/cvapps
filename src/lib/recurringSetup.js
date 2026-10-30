// ============================================================================
// 見積から定期売上にする（RecurringSetupDialog・案件詳細のお知らせで共通）
//   チェックした明細 … 毎月請求する分（月額・毎月の納品書の明細）
//   チェックしない明細 … 初回だけの費用（開始月の見込みに足す。納品書はふつうに作る）
// ============================================================================
import { docItemsFromEstimate } from "@/lib/documents";
import { forecastLines } from "@/lib/projectForecast";

export const MONTH_TOKEN = "{年月}";

/** 月額・初回だけの費用（税抜）と、それぞれの原価 */
export function recurringSums(estimate, checkedIds) {
  const set = new Set(checkedIds || []);
  const out = { monthly: 0, monthlyCost: 0, oneTime: 0, oneTimeCost: 0 };
  for (const l of forecastLines(estimate)) {
    if (set.has(l.id)) { out.monthly += l.revenue; out.monthlyCost += l.cost; } else { out.oneTime += l.revenue; out.oneTimeCost += l.cost; }
  }
  return out;
}

/** 毎月の納品書の明細（見積の明細を税抜で写す。addMonth なら品名の後ろに「（{年月}）」） */
export function recurringNoteLines(estimate, checkedIds, addMonth) {
  if (!estimate) return [];
  const set = new Set(checkedIds || []);
  return docItemsFromEstimate(estimate)
    .filter((li) => set.has(li.source_line_id))
    .map((li) => ({
      name: addMonth && !String(li.name).includes(MONTH_TOKEN) ? `${li.name}（${MONTH_TOKEN}）` : li.name,
      quantity: li.quantity, unit: li.unit, unit_price: li.unit_price, tax_rate: li.tax_rate, sales_category: li.sales_category || null,
    }));
}

/** ひな形の明細の品名に月が付いているか（入れ直すときに同じ付け方にする） */
export const templateAddsMonth = (template) => !(template?.line_items || []).length || (template.line_items || []).some((l) => String(l.name || "").includes(MONTH_TOKEN));

/** ひな形に入れる値（見積の明細から） */
export function recurringPayloadFromEstimate(estimate, checkedIds, addMonth) {
  const s = recurringSums(estimate, checkedIds);
  return {
    expected_revenue: s.monthly,
    expected_cost: s.monthlyCost,
    one_time_revenue: s.oneTime,
    one_time_cost: s.oneTimeCost,
    line_items: recurringNoteLines(estimate, checkedIds, addMonth),
    source_estimate_id: estimate?.id || null,
    source_line_ids: [...(checkedIds || [])],
    source_all_line_ids: forecastLines(estimate).map((l) => l.id),
    lines_applied_at: new Date().toISOString(),
    drift_dismissed_sig: null,
  };
}

/**
 * 元にした見積が、定期売上にしたあとに変わっていないか。変わっていれば
 *   { monthly, oneTime, newLines, missing, sig, dismissed } を返す（変わっていなければ null）
 *   dismissed: 「このままにする」を押したときから見積が変わっていない
 */
export function recurringDrift(template, estimate) {
  if (!template?.source_estimate_id || !estimate || estimate.id !== template.source_estimate_id) return null;
  const lines = forecastLines(estimate);
  const ids = template.source_line_ids || [];
  const s = recurringSums(estimate, ids);
  const known = new Set(template.source_all_line_ids?.length ? template.source_all_line_ids : lines.map((l) => l.id));
  const newLines = lines.filter((l) => !known.has(l.id));
  const missing = ids.filter((id) => !lines.some((l) => l.id === id)).length;
  // 新しく増えた明細は「初回だけ」に数えているので、増えた分は初回の差から除いて比べる
  const oneTimeKnown = s.oneTime - newLines.reduce((a, l) => a + l.revenue, 0);
  if (s.monthly === Number(template.expected_revenue || 0) && oneTimeKnown === Number(template.one_time_revenue || 0) && newLines.length === 0 && missing === 0) return null;
  const sig = [s.monthly, s.oneTime, newLines.map((l) => l.id).sort().join(","), missing].join("|");
  return { monthly: s.monthly, oneTime: oneTimeKnown, newLines, missing, sig, dismissed: template.drift_dismissed_sig === sig };
}
