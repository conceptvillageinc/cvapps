// ============================================================================
// 旧形式（schema_version 1: 仕様／印刷費／デザイン費タブ）の見積を、
// 新形式（schema_version 2: 見積書タブの line_items + 印刷仕様）へ変換する。
//
// 旧形式の列（vendor_prices, design_fees, cost_price ...）は消さずに残す。
// 変換に失敗しても元に戻せるように、また過去見積の複製元としても使えるようにするため。
// ============================================================================

import { TAX_RATE } from "@/lib/constants";
import { newPrintSpec } from "@/lib/printSpecs";

const NONPAPER = /パッケージ|ラベル|のぼり|パネル|ユニフォーム/;

function uid() {
  return `li_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 旧形式の見積から、新形式の更新内容を組み立てる */
export function convertLegacyEstimate(estimate) {
  const items = [];

  // 印刷費: 選択済みの印刷所価格を1行にする
  const sellingPrice = Number(estimate.selling_price) || 0;
  const costPrice = Number(estimate.cost_price) || 0;
  const quantity = (estimate.quantities || [])[0] || 1;
  if (sellingPrice > 0 || costPrice > 0) {
    const selected = (estimate.vendor_prices || []).find((v) => v.is_selected);
    const vendor = estimate.selected_vendor || selected?.vendor_name || "";
    // 出し値が枚数で割り切れないときは、金額を変えないよう「1式」にする
    const divisible = quantity > 1 && sellingPrice % quantity === 0;
    const qty = divisible ? quantity : 1;
    const unitPrice = divisible ? sellingPrice / quantity : sellingPrice;
    items.push({
      id: uid(),
      row_type: "item",
      category: NONPAPER.test(estimate.print_type || "") ? "印刷費（紙以外）" : "印刷費（紙）",
      name: `${estimate.print_type || "印刷費"}${vendor ? `（${vendor}）` : ""}${divisible ? "" : ` ${quantity.toLocaleString()}枚`}`,
      quantity: qty,
      unit: divisible ? "枚" : "式",
      unit_price: unitPrice,
      amount: unitPrice * qty,
      ...(costPrice > 0 ? { cost_price: Math.round((costPrice / qty) * 100) / 100 } : {}),
      ...(estimate.markup_rate ? { markup_rate: Number(estimate.markup_rate) } : {}),
      source_type: "manual",
      source_ref: vendor || undefined,
      converted_from: "legacy_print",
    });
  }

  // デザイン費
  for (const d of estimate.design_fees || []) {
    const qty = Number(d.quantity) || 1;
    const price = Number(d.selling_price) || 0;
    items.push({
      id: uid(),
      row_type: "item",
      category: "デザイン費",
      name: d.name || "デザイン費",
      quantity: qty,
      unit: "式",
      unit_price: price,
      amount: price * qty,
      source_type: "design_master",
      source_ref: d.category ? `${d.category}:${d.name}` : undefined,
      converted_from: "legacy_design",
    });
  }

  // 校正費・その他費用
  const proofreading = Number(estimate.proofreading_fee) || 0;
  if (proofreading > 0) {
    items.push({ id: uid(), row_type: "item", category: "校正費", name: "校正費", quantity: 1, unit: "式", unit_price: proofreading, amount: proofreading, source_type: "manual", converted_from: "legacy_proofreading" });
  }
  const other = Number(estimate.other_fees) || 0;
  if (other > 0) {
    items.push({ id: uid(), row_type: "item", category: "自由入力", name: "その他費用", quantity: 1, unit: "式", unit_price: other, amount: other, source_type: "manual", converted_from: "legacy_other" });
  }

  // 印刷仕様: 仕様タブの内容を1件にする
  const specs = [];
  if (estimate.print_type || (estimate.quantities || []).length > 0) {
    specs.push(newPrintSpec({
      print_type: estimate.print_type || "",
      size: estimate.size || "",
      paper_type: estimate.paper_type || "",
      color_count: estimate.color_count || "",
      quantities: [...(estimate.quantities || [])],
      usage: estimate.usage || "",
      desired_delivery_date: estimate.desired_delivery_date || "",
    }));
  }

  const subtotal = items.reduce((s, li) => s + (Number(li.amount) || 0), 0);
  const tax = Math.round(subtotal * TAX_RATE);

  return {
    schema_version: 2,
    line_items: items,
    print_specs: [...(estimate.print_specs || []), ...specs],
    total_amount: subtotal + tax,
    // 変換の記録（旧形式の列はそのまま残す）
    additional_notes: estimate.additional_notes || "",
  };
}

/** 変換の見出し用サマリ */
export function summarizeConversion(patch) {
  const items = patch.line_items || [];
  const count = (key) => items.filter((li) => li.converted_from === key).length;
  return {
    print: count("legacy_print"),
    design: count("legacy_design"),
    proofreading: count("legacy_proofreading"),
    other: count("legacy_other"),
    specs: (patch.print_specs || []).length,
    total: patch.total_amount,
  };
}
