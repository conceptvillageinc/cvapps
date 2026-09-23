// ============================================================================
// 見積の金額計算（見積書タブ・プレビュー・印刷・PDF で共通）
//
//   税別見積（既定）: 単価・金額は税抜。消費税 = 税率ごとの合計 × 税率（四捨五入）
//   税込見積        : 単価・金額は税込。消費税 = 税率ごとの合計 × 税率 ÷ (100+税率) を切り捨て、
//                     税抜 = 税込合計 − 消費税（税込の総額を優先し、そこから内訳を出す）
//   行の tax_rate（10 / 8）で軽減税率に対応。無い行は 10%。
//
// サーバー側（api/_lib/estimatePdf.js）にも同じ計算があるので、直すときは両方直す。
// ============================================================================

export const ESTIMATE_TAX_RATES = [10, 8];

export function lineTaxRate(li) {
  return Number(li?.tax_rate) === 8 ? 8 : 10;
}

/**
 * @param {Array} lineItems
 * @param {{ taxInclusive?: boolean }} opts
 * @returns {{ subtotal:number, tax:number, total:number, breakdown:Array<{rate:number, taxable:number, tax:number, gross:number}> }}
 */
export function computeEstimateTotals(lineItems, { taxInclusive = false } = {}) {
  const rows = (lineItems || []).filter((li) => li.row_type !== "text" && li.row_type !== "subtotal");
  const byRate = new Map();
  for (const li of rows) {
    const rate = lineTaxRate(li);
    byRate.set(rate, (byRate.get(rate) || 0) + (Number(li.amount) || 0));
  }
  const breakdown = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, sum]) => {
    if (taxInclusive) {
      const tax = Math.floor((sum * rate) / (100 + rate));
      return { rate, taxable: sum - tax, tax, gross: sum };
    }
    const tax = Math.round((sum * rate) / 100);
    return { rate, taxable: sum, tax, gross: sum + tax };
  });
  const subtotal = breakdown.reduce((s, b) => s + b.taxable, 0);
  const tax = breakdown.reduce((s, b) => s + b.tax, 0);
  return { subtotal, tax, total: subtotal + tax, breakdown: breakdown.length ? breakdown : [{ rate: 10, taxable: 0, tax: 0, gross: 0 }] };
}

/** 税込単価を税抜に直す（納品書・請求書は税抜で持つため） */
export function toTaxExclusiveUnitPrice(unitPrice, rate = 10) {
  const n = Number(unitPrice) || 0;
  return Math.round((n * 100) / (100 + Number(rate || 10)));
}
