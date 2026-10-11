// ============================================================================
// 探した候補（価格マスタのセル・入稿記録・過去見積の明細）を、見積の明細の行にする。
//   見積書の画面（明細の上の検索バー・品名の「似た候補」）と、新規見積作成の「作るもの」で共通に使う。
// ============================================================================
import { LINE_ITEM_CATEGORIES, applyMarkup } from "@/lib/constants";
import { markupRateFor } from "@/lib/pricing";
import { toTaxExcluded } from "@/lib/priceTax";
import { linesFromOrder } from "@/lib/printOrders";

export const newLineId = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** 価格マスタのセルの原価・出し値（税別・その数量の合計） */
export function masterCellPrice(entry, cell, rules) {
  const quantity = cell.quantity || 1;
  const cost = toTaxExcluded(cell.price, entry.price_tax_mode);
  return { cost, price: applyMarkup(cost / quantity, markupRateFor(rules, entry.category)) * quantity };
}

/** 価格マスタのセル → 明細（区分は価格マスタの紙／紙以外から。仕入先・納期は社内メモに） */
export function masterCellToItem(entry, cell, rules) {
  const catLabel = LINE_ITEM_CATEGORIES.find((c) => c.paperGroup === entry.paper_type_group)?.label || "印刷費（紙）";
  const quantity = cell.quantity || 1;
  // 税込表示のマスタは原価を税別に直す
  const costPerUnit = toTaxExcluded(cell.price, entry.price_tax_mode) / quantity;
  const markupRate = markupRateFor(rules, entry.category);
  const unitPrice = applyMarkup(costPerUnit, markupRate);
  return {
    id: newLineId(),
    row_type: "item",
    category: catLabel,
    name: entry.category,
    memo: `${entry.vendor_name}・${cell.label}納期`,
    quantity,
    unit: "枚",
    unit_price: unitPrice,
    amount: unitPrice * quantity,
    cost_price: Math.round(costPerUnit * 100) / 100,
    markup_rate: markupRate,
    source_type: "price_master",
    source_ref: entry.id,
  };
}

/** 入稿記録 → 明細（内訳のある記録は内訳の行ごと） */
export const orderToItems = (order) => linesFromOrder(order).map((li) => ({ ...li, id: newLineId() }));

/** 過去見積の明細 → 明細（複製元を残す。価格確認の結果は持ってこない） */
export function pastLineToItem(line, estimate) {
  const { price_check: _pc, ...li } = line;
  return { ...li, id: newLineId(), copied_from: estimate.estimate_number, copied_from_id: estimate.id };
}
