// ============================================================================
// ネット印刷の価格の扱い
//   - ページの表示金額が税込か税別か（印刷所マスタ・価格マスタの price_tax_mode）
//   - キャンペーン価格ではなく通常価格を読む（読み取りプロンプトの共通文）
// ============================================================================

export const PRICE_TAX_MODES = {
  included: "税込表示",
  excluded: "税別表示",
};

/** 価格表の読み取りで、AI に必ず伝える注意書き */
export const PRICE_READ_NOTES = `
価格の読み取りで必ず守ること:
- キャンペーン価格（期間限定の値引き価格）が併記されている場合は、キャンペーン価格ではなく「通常価格」を読んでください。
  打ち消し線（取り消し線）が引かれた金額があれば、それが通常価格です。打ち消し線の元の金額を返してください。
  「キャンペーン」「SALE」「今だけ」「〇%OFF」などの表記が付いた金額は使わないでください。
- 金額はページの表記どおり（税込表示なら税込のまま）の数値で返してください。税の換算はしないでください。
- カンマ区切り（例: 2,120）は数値（2120）にしてください。`;

/** ページ表示の金額を税別（原価）に直す。excluded ならそのまま */
export function toTaxExcluded(price, mode = "included", taxRate = 0.1) {
  const n = Number(price) || 0;
  if (mode === "excluded") return n;
  return Math.round((n / (1 + taxRate)) * 100) / 100;
}

/** 印刷所マスタから、そのメーカーの税表示を引く（未登録なら税込表示とみなす） */
export function vendorTaxMode(printVendors, vendorName) {
  const v = (printVendors || []).find((x) => x.name === vendorName);
  return v?.price_tax_mode === "excluded" ? "excluded" : "included";
}
