// ============================================================================
// 値付けルール（「デザイン制作原価売価計算表」の再現）
//
// 各%・単価は system_settings の pricing_rules（JSON）で変更できる。
// ここには既定値と計算式だけを置く。既定値は計算表の xlsx から写した。
//
//   印刷費      : 出し値 = 原価 × 掛け率（パッケージ 1.3 / それ以外 1.35）
//   外注        : 売価   = 仕入 ÷ 率（デザイン 0.6 / 構築 0.75 / 撮影 0.6）を 5,000円単位で切り上げ
//   コンセプト設計費: 印刷費を除く合計 × 20% を 5,000円単位で切り上げ
//   校正費      : デザイン費合計 × 7% を 1,000円単位で切り上げ
//   CV割引      : デザイン費合計 × 5% / 10% / 20%、Draw up 事業割引 25%（マイナス行）
// ============================================================================

import { useMemo } from "react";
import { useSystemSettings } from "@/lib/useSystemSettings";

export const DEFAULT_PRICING_RULES = {
  // 印刷費の掛け率
  markup: { package: 1.3, other: 1.35 },
  // 外注: 売価 = 仕入 ÷ 率
  outsourcing: { design: 0.6, build: 0.75, photo: 0.6 },
  // 切り上げの単位（円）
  rounding: { outsourcing: 5000, concept: 5000, proofreading: 1000 },
  // 自動計算行
  concept_fee: { rate: 0.2 },
  proofreading_fee: { rate: 0.07 },
  discounts: [
    { key: "cv5", label: "CV割引（5%）", rate: 0.05 },
    { key: "cv10", label: "CV割引（10%）", rate: 0.1 },
    { key: "cv20", label: "CV割引（20%）", rate: 0.2 },
    { key: "drawup", label: "Draw up 事業割引（25%）", rate: 0.25 },
  ],
  // 社内の時間単価（手入力の目安として表示）
  hourly: {
    produce: 15000,        // プロデュース・企画・コンサル
    model: 20000,          // モデル対応
    other_work: 3000,      // 撮影同行サポート等
    inhouse_design: 16000, // 社内デザイン
    inhouse_photo: 15000,  // 社内撮影
    labeling: 10000,       // 一括表示作成費（商品あたり）
  },
};

export const OUTSOURCING_KINDS = [
  { key: "design", label: "外注デザイン" },
  { key: "build", label: "構築（外注）" },
  { key: "photo", label: "外注撮影" },
];

/** n を unit 単位で切り上げる（Excel の CEILING と同じ）。unit が 0 以下なら 1円単位。 */
export function ceilTo(n, unit) {
  const u = Number(unit) > 0 ? Number(unit) : 1;
  const v = Number(n) || 0;
  // 浮動小数点の誤差で 1単位多く切り上がらないよう、先にまるめる
  return Math.ceil(Number((v / u).toFixed(6))) * u;
}

/** 保存された JSON と既定値を合成する（欠けている項目は既定値で補う） */
export function mergePricingRules(saved, legacyMarkup) {
  const s = saved && typeof saved === "object" ? saved : {};
  const d = DEFAULT_PRICING_RULES;
  const markup = { ...d.markup, ...(s.markup || {}) };
  // 旧設定（markup_rates: { package_label, other }）が残っていれば引き継ぐ
  if (!s.markup && legacyMarkup) {
    if (Number(legacyMarkup.package_label) > 0) markup.package = Number(legacyMarkup.package_label);
    if (Number(legacyMarkup.other) > 0) markup.other = Number(legacyMarkup.other);
  }
  return {
    markup,
    outsourcing: { ...d.outsourcing, ...(s.outsourcing || {}) },
    rounding: { ...d.rounding, ...(s.rounding || {}) },
    concept_fee: { ...d.concept_fee, ...(s.concept_fee || {}) },
    proofreading_fee: { ...d.proofreading_fee, ...(s.proofreading_fee || {}) },
    discounts: Array.isArray(s.discounts) && s.discounts.length > 0 ? s.discounts : d.discounts,
    hourly: { ...d.hourly, ...(s.hourly || {}) },
  };
}

export function pricingRulesFromSettings(settings) {
  const parse = (key) => {
    const row = (settings || []).find((x) => x.setting_key === key);
    if (!row) return null;
    try { return JSON.parse(row.setting_value); } catch { return null; }
  };
  return mergePricingRules(parse("pricing_rules"), parse("markup_rates"));
}

/** 画面用フック */
export function usePricingRules() {
  const { settings, isLoading } = useSystemSettings();
  const rules = useMemo(() => pricingRulesFromSettings(settings), [settings]);
  return { rules, isLoading };
}

/** 印刷物種別（または価格マスタのカテゴリ名）から掛け率を決める */
export function markupRateFor(rules, printType) {
  const r = rules || DEFAULT_PRICING_RULES;
  return String(printType || "").includes("パッケージ") ? r.markup.package : r.markup.other;
}

/** 外注の売価: 仕入 ÷ 率 を切り上げ */
export function outsourcingPrice(rules, kind, cost) {
  const r = rules || DEFAULT_PRICING_RULES;
  const rate = Number(r.outsourcing[kind]) || 1;
  return ceilTo((Number(cost) || 0) / rate, r.rounding.outsourcing);
}

// ----------------------------------------------------------------------------
// 自動計算行
//
// line_items の中に source_type: "rule" の行を置くと、他の行の合計から
// 金額が決まる。見積の明細が変わるたびに recomputeRuleRows で計算し直す。
//   rule: "concept_fee"      印刷費を除く合計 × rate
//   rule: "proofreading_fee" デザイン費合計 × rate
//   rule: "discount"         デザイン費合計 × rate のマイナス
// ----------------------------------------------------------------------------
const PRINT_CATEGORY = /印刷費/;
const DESIGN_CATEGORY = "デザイン費";

const isAmountRow = (li) => li.row_type !== "text";
const isRuleRow = (li) => li.source_type === "rule";

function sumAmount(items) {
  return items.reduce((s, li) => s + (Number(li.amount) || 0), 0);
}

export function ruleRowLabel(rule, rate, discountLabel) {
  const pct = `${Math.round(Number(rate) * 1000) / 10}%`;
  if (rule === "concept_fee") return `コンセプト設計費（印刷費を除く合計の${pct}）`;
  if (rule === "proofreading_fee") return `校正費（デザイン費の${pct}）`;
  return discountLabel || `割引（デザイン費の${pct}）`;
}

/** 自動計算行を作る（金額は recomputeRuleRows が入れる） */
export function makeRuleRow(rules, rule, discount) {
  const r = rules || DEFAULT_PRICING_RULES;
  if (rule === "concept_fee") {
    return { category: "コンセプト設計費", name: ruleRowLabel(rule, r.concept_fee.rate), quantity: 1, unit: "式", unit_price: 0, amount: 0, source_type: "rule", rule, rate: r.concept_fee.rate };
  }
  if (rule === "proofreading_fee") {
    return { category: "校正費", name: ruleRowLabel(rule, r.proofreading_fee.rate), quantity: 1, unit: "式", unit_price: 0, amount: 0, source_type: "rule", rule, rate: r.proofreading_fee.rate };
  }
  return { category: "割引", name: ruleRowLabel("discount", discount.rate, discount.label), quantity: 1, unit: "式", unit_price: 0, amount: 0, source_type: "rule", rule: "discount", rate: discount.rate, discount_key: discount.key };
}

/** 明細一式を受け取り、自動計算行の金額を入れ直して返す */
export function recomputeRuleRows(lineItems, rules) {
  const r = rules || DEFAULT_PRICING_RULES;
  const items = (lineItems || []).map((li) => ({ ...li }));
  const rows = items.filter(isAmountRow);
  if (!rows.some(isRuleRow)) return items;

  const designBase = sumAmount(rows.filter((li) => !isRuleRow(li) && li.category === DESIGN_CATEGORY));

  // 1) 校正費（デザイン費に依存）
  for (const li of items) {
    if (isRuleRow(li) && li.rule === "proofreading_fee") {
      li.unit_price = ceilTo(designBase * (Number(li.rate) || 0), r.rounding.proofreading);
      li.quantity = 1;
      li.amount = li.unit_price;
    }
  }
  // 2) コンセプト設計費（印刷費と割引・自分自身を除く合計に依存。校正費は含む）
  const conceptBase = sumAmount(rows.filter((li) =>
    !PRINT_CATEGORY.test(li.category || "") && !(isRuleRow(li) && (li.rule === "concept_fee" || li.rule === "discount"))
  ).map((li) => items.find((x) => x.id === li.id) || li));
  for (const li of items) {
    if (isRuleRow(li) && li.rule === "concept_fee") {
      li.unit_price = ceilTo(conceptBase * (Number(li.rate) || 0), r.rounding.concept);
      li.quantity = 1;
      li.amount = li.unit_price;
    }
  }
  // 3) 割引（デザイン費に依存。マイナス）
  for (const li of items) {
    if (isRuleRow(li) && li.rule === "discount") {
      li.unit_price = -Math.round(designBase * (Number(li.rate) || 0));
      li.quantity = 1;
      li.amount = li.unit_price;
    }
  }
  return items;
}

/**
 * 小計行（row_type: "subtotal"）の金額を入れ直す。
 * 直前の小計行（または先頭）から、その行までの明細（自動計算行・テキスト行を除く）の合計。
 * 小計行は合計には含めない（表示用）。
 */
export function recomputeSubtotals(lineItems) {
  let running = 0;
  return (lineItems || []).map((li) => {
    if (li.row_type === "subtotal") {
      const out = { ...li, amount: running, quantity: 1, unit_price: running };
      running = 0;
      return out;
    }
    if (li.row_type !== "text" && li.source_type !== "rule") running += Number(li.amount) || 0;
    return li;
  });
}

/** 自動計算行の根拠を短く説明する（画面の注記用） */
export function ruleRowHint(li) {
  if (li.rule === "concept_fee") return "印刷費を除く合計から自動計算";
  if (li.rule === "proofreading_fee") return "デザイン費の合計から自動計算";
  if (li.rule === "discount") return "デザイン費の合計から自動計算（値引き）";
  return "";
}
