import { EMAIL_VENDOR_MAP } from "@/lib/constants";
import { specText } from "@/lib/printSpecs";

// ============================================================================
// 見積依頼メールの宛先と、依頼に載せる仕様テキスト。
//
// 旧形式は「印刷物種別」から宛先を自動判定していたが、新形式の見積は
// 印刷物種別を持たない（代わりに明細行で管理する）。そのため新形式では
// 印刷所マスタから人が宛先を選ぶ。見積依頼の送り先は人が決める性質の
// 作業なので、明細からAIに推測させるより確実性を優先している。
// ============================================================================

/**
 * 印刷物種別から決まる既定の宛先。
 * 旧形式は見積の印刷物種別、新形式は選んだ印刷仕様の種別から決める。
 */
export function defaultRecipients(estimate, specs = []) {
  if (estimate?.schema_version === 2) {
    const names = specs.flatMap((sp) => EMAIL_VENDOR_MAP[sp.print_type] || []);
    return [...new Set(names)];
  }
  return EMAIL_VENDOR_MAP[estimate?.print_type] || [];
}

/**
 * 宛先の候補。印刷所マスタ（メール依頼先）を基本にしつつ、
 * 旧形式の既定宛先がマスタに無くても選べるように足しておく。
 */
export function recipientOptions(printVendors, estimate, specs = []) {
  const fromMaster = (printVendors || [])
    .filter(v => v.vendor_type === "email")
    .map(v => v.name);

  const merged = [...new Set([...fromMaster, ...defaultRecipients(estimate, specs)])];
  return merged.sort((a, b) => a.localeCompare(b, "ja"));
}

/** 明細行1件を、依頼メールに載せる1行にする。 */
function lineSummary(item) {
  const quantity = item.quantity != null ? `${Number(item.quantity).toLocaleString()}${item.unit || ""}` : "";
  return ["・" + (item.name || "（名称未設定）"), quantity].filter(Boolean).join(" ");
}

/**
 * 依頼メールに載せる仕様テキスト。
 * 新形式は印刷仕様（print_specs）から組み立てる。仕様が無い場合は明細行から。
 * 旧形式は仕様欄から。
 */
export function buildSpecText(estimate, specs = []) {
  if (estimate?.schema_version === 2 && specs.length > 0) {
    return [
      `件名: ${estimate.estimate_title || "未指定"}`,
      "",
      specs.map((sp, i) => specText(sp, i)).join("\n\n"),
      estimate.additional_notes ? `\n備考:\n${estimate.additional_notes}` : "",
    ].filter(Boolean).join("\n");
  }

  if (estimate?.schema_version === 2) {
    const items = (estimate.line_items || []).filter(li => li.row_type !== "text" && li.row_type !== "subtotal");
    const lines = items.length > 0
      ? items.map(lineSummary).join("\n")
      : "（明細が未入力です）";

    return [
      `件名: ${estimate.estimate_title || "未指定"}`,
      `希望納期: ${estimate.desired_delivery_date || "未指定"}`,
      "",
      "内容:",
      lines,
      estimate.additional_notes ? `\n備考:\n${estimate.additional_notes}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    `印刷物種別: ${estimate?.print_type || "未指定"}`,
    `サイズ: ${estimate?.size || "未指定"}`,
    `用途: ${estimate?.usage || "未指定"}`,
    `紙質: ${estimate?.paper_type || "未指定"}`,
    `印刷枚数: ${(estimate?.quantities || []).map(q => q.toLocaleString() + "枚").join(", ") || "未指定"}`,
    `印刷色数: ${estimate?.color_count || "未指定"}`,
    `希望納期: ${estimate?.desired_delivery_date || "未指定"}`,
  ].join("\n");
}

export const EMAIL_SCHEMA = {
  type: "object",
  properties: {
    emails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
      },
    },
  },
};

export function buildEmailPrompt(recipients, specText) {
  return `以下の印刷仕様に基づいて、印刷会社への見積依頼メールを生成してください。
丁寧なビジネスメールの形式で、以下の情報を含めてください：
- 件名
- 挨拶
- 見積依頼の趣旨
- 印刷仕様の詳細
- 希望納期（必ず強調して記載）
- 返信期限の目安（希望納期の1週間前程度）
- 締めの挨拶

送信先の会社名リスト: ${recipients.join(", ")}

印刷仕様:
${specText}

差出人: 株式会社コンセプト・ヴィレッジ

各社宛にカスタマイズしたメールをJSON配列で返してください。
company_name には上記の会社名リストの表記をそのまま使ってください。`;
}
