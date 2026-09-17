// 印刷仕様（estimates.print_specs の1要素）の共通処理

export function newPrintSpec(defaults = {}) {
  return {
    id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    print_type: "",
    size: "",
    paper_type: "",
    color_count: "",
    quantities: [],
    usage: "",
    finishing: "",
    desired_delivery_date: "",
    notes: "",
    ...defaults,
  };
}

/** 一覧やメール履歴に出す短い名前 */
export function specLabel(spec, index = 0) {
  if (!spec) return "";
  if (spec.label) return spec.label;
  const parts = [spec.print_type, spec.size].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : `印刷仕様 ${index + 1}`;
}

/** 依頼メールに載せる仕様の本文 */
export function specText(spec, index = 0) {
  const q = (spec.quantities || []).map((n) => `${Number(n).toLocaleString()}枚`).join(" / ");
  return [
    `【${specLabel(spec, index)}】`,
    `印刷物種別: ${spec.print_type || "未指定"}`,
    `サイズ: ${spec.size || "未指定"}`,
    `紙質・素材: ${spec.paper_type || "未指定"}`,
    `印刷色数: ${spec.color_count || "未指定"}`,
    `印刷枚数: ${q || "未指定"}`,
    spec.finishing ? `加工・オプション: ${spec.finishing}` : null,
    spec.usage ? `用途: ${spec.usage}` : null,
    `希望納期: ${spec.desired_delivery_date || "未指定"}`,
    spec.notes ? `備考: ${spec.notes}` : null,
  ].filter(Boolean).join("\n");
}

/** 仕様に足りない項目（依頼前の確認用） */
export function specMissing(spec) {
  const missing = [];
  if (!spec.print_type) missing.push("印刷物種別");
  if (!(spec.quantities || []).length) missing.push("印刷枚数");
  if (!spec.desired_delivery_date) missing.push("希望納期");
  return missing;
}
