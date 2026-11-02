// ============================================================================
// 明細の原価（仕入単価）
//   原価が入っていればその値。入っていない送料・配送料などの行は、そのまま払う費用なので
//   出し値（税抜）と同じ額を原価として数える（見積の総原価・案件の発注見込に入れる）
// ============================================================================
import { lineTaxRate } from "@/lib/estimateTotals";

export const PASS_THROUGH_NAME = /送料|配送料|配送費|運賃|発送料|発送費|郵送料|宅配料|宅急便|ゆうパック/;

/** 送料など、出し値と同じ額を原価にする行か（原価が入っていないとき） */
export const isPassThroughLine = (li) => PASS_THROUGH_NAME.test(String(li?.name || "")) && Number(li?.amount ?? li?.unit_price) > 0;

const hasCostPrice = (li) => li?.cost_price !== null && li?.cost_price !== undefined && li?.cost_price !== "";

/**
 * 原価単価（税抜）。入っていなければ、送料などは出し値（税抜）と同じ。どちらでもなければ null
 *   taxInclusive: 税込見積（出し値は税込なので税抜に直す）
 */
export function costPriceOf(li, { taxInclusive = false } = {}) {
  if (hasCostPrice(li)) return Number(li.cost_price) || 0;
  if (!isPassThroughLine(li)) return null;
  const up = Number(li.unit_price) || 0;
  return taxInclusive ? (up * 100) / (100 + lineTaxRate(li)) : up;
}

/** 原価を出し値から自動で入れている行か（原価の欄が空の送料など） */
export const isAutoCost = (li) => !hasCostPrice(li) && isPassThroughLine(li);
