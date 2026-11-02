// ============================================================================
// 案件の受注見込・発注見込を、見積の明細から入れる
//   受注見込 = チェックした明細の金額（税抜）の合計（値引きの行はマイナスのまま）
//   発注見込 = チェックした明細の 原価 × 数量 の合計
//   入れたときの見積（複数可）・明細・金額を project.forecast_source に残し、見積があとで変わったら差を出す
// ============================================================================
import { lineTaxRate } from "@/lib/estimateTotals";
import { submissionOf } from "@/lib/submission";
import { isAutoCost } from "@/lib/lineCost";

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
      // 原価が入っていない送料などは、出し値（税抜）と同じ額を原価にする（そのまま払う費用）
      const autoCost = isAutoCost(li);
      const hasCost = autoCost || (li.cost_price !== null && li.cost_price !== undefined && li.cost_price !== "" && Number(li.cost_price) !== 0);
      const cost = autoCost ? revenue : hasCost ? Math.round((Number(li.cost_price) || 0) * qty) : 0;
      return { id: li.id, name: li.name || li.category || "（名称なし）", category: li.category || "", qty, unit: li.unit || "", revenue, cost, hasCost, autoCost, isDiscount: amount < 0 };
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

// ----------------------------------------------------------------------------
// 見込みの入れ元（複数の見積にまたがれる）
//   project.forecast_source = { sources: [{ estimate_id, estimate_number, line_ids, unchecked_ids }], revenue, cost, applied_at, applied_by, dismissed_sig }
//   前の形（estimate_id・line_ids を 1 つだけ持つ）も読めるようにする
// ----------------------------------------------------------------------------
export function forecastSources(fs) {
  if (!fs) return [];
  if (Array.isArray(fs.sources)) return fs.sources;
  if (fs.estimate_id) return [{ estimate_id: fs.estimate_id, estimate_number: fs.estimate_number || "", line_ids: fs.line_ids || [], unchecked_ids: fs.unchecked_ids || [] }];
  return [];
}
/** 入れ元の見積番号（「CV-2610-001・CV-2610-002」） */
export const forecastSourceNumbers = (fs) => forecastSources(fs).map((s) => s.estimate_number).filter(Boolean).join("・");
/** 入れ元の明細の数 */
export const forecastSourceLineCount = (fs) => forecastSources(fs).reduce((n, s) => n + (s.line_ids || []).length, 0);

/** 改訂前の古い版か（同じ見積の版のうち、もっと新しい版がある） */
export function isOldRevision(estimate, estimates) {
  const gid = estimate?.project_group_id;
  if (!gid) return false;
  return (estimates || []).some((e) => e.id !== estimate.id && e.project_group_id === gid && String(e.created_date || "") > String(estimate.created_date || ""));
}

/** 最初にチェックを入れる見積（失注と、改訂前の古い版を除く） */
export function defaultForecastEstimateIds(estimates) {
  return (estimates || []).filter((e) => submissionOf(e) !== "lost" && !isOldRevision(e, estimates)).map((e) => e.id);
}

/** 入れ元ごとの、いまの見積での合計・増えた明細・なくなった明細 */
function sourcesNow(source, estimates) {
  let revenue = 0, cost = 0, missing = 0, found = 0;
  const newLines = [];
  const sources = forecastSources(source).map((s) => {
    const est = (estimates || []).find((e) => e.id === s.estimate_id);
    if (!est) { missing += (s.line_ids || []).length; return s; }
    found++;
    const lines = forecastLines(est);
    const ids = s.line_ids || [];
    const now = sumLines(lines, ids);
    revenue += now.revenue; cost += now.cost;
    const known = new Set([...ids, ...(s.unchecked_ids || [])]);
    const added = lines.filter((l) => !known.has(l.id));
    newLines.push(...added.map((l) => ({ ...l, estimate_number: est.estimate_number })));
    missing += ids.filter((id) => !lines.some((l) => l.id === id)).length;
    return { ...s, estimate_number: est.estimate_number || s.estimate_number, unchecked_ids: [...(s.unchecked_ids || []), ...added.map((l) => l.id)] };
  });
  return { revenue, cost, newLines, missing, found, sources };
}

/**
 * 入れたあとに見積が変わっていないか。変わっていれば { revenue, cost, newLines, missing, sig, dismissed } を返す（変わっていなければ null）
 *   dismissed: 「このままにする」を押したときから見積が変わっていない（お知らせは出さない。見積がまた変わったら出す）
 *   newLines: 入れたあとに見積に増えた明細（チェックしていないので見込みには入っていない）
 *   入れ元の見積が 1 つも見つからない（削除・別の案件へ移した）ときは null
 */
export function forecastDrift(source, estimates) {
  if (!forecastSources(source).length) return null;
  const now = sourcesNow(source, estimates);
  if (!now.found) return null;
  if (now.revenue === Number(source.revenue) && now.cost === Number(source.cost) && now.newLines.length === 0 && now.missing === 0) return null;
  // いまの見積の状態の印（「このままにする」を押したときの状態と同じなら、お知らせは出さない）
  const sig = [now.revenue, now.cost, now.newLines.map((l) => l.id).sort().join(","), now.missing].join("|");
  return { revenue: now.revenue, cost: now.cost, newLines: now.newLines, missing: now.missing, sig, dismissed: source.dismissed_sig === sig };
}

/** 同じチェックで入れ直した値（増えた明細はチェックしないまま覚える）。{ revenue, cost, source } */
export function reapplyForecast(source, estimates) {
  const now = sourcesNow(source, estimates);
  const { estimate_id, estimate_number, line_ids, unchecked_ids, ...rest } = source || {};
  return { revenue: now.revenue, cost: now.cost, source: { ...rest, sources: now.sources.filter((s) => (estimates || []).some((e) => e.id === s.estimate_id)), revenue: now.revenue, cost: now.cost, applied_at: new Date().toISOString(), dismissed_sig: null } };
}
