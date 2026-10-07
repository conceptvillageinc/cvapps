import { EMAIL_VENDOR_MAP, COMPANY_INFO } from "@/lib/constants";
import { specText } from "@/lib/printSpecs";
import { nextBusinessDay } from "@/lib/jpHolidays";

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
 * 宛先の候補。印刷所マスタ（種別: メール）だけから出す。
 * マスタに無い名前は候補に出ないので、「印刷所情報」で消せば候補からも消える。
 */
export function recipientOptions(printVendors) {
  const fromMaster = (printVendors || [])
    .filter(v => v.vendor_type === "email")
    .map(v => v.name);
  return [...new Set(fromMaster)].sort((a, b) => a.localeCompare(b, "ja"));
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
      // 希望納期は依頼メールに載せない（返信期限はアプリで決めた日付を別に渡す）
      specs.map((sp, i) => specText(sp, i, { withDelivery: false })).join("\n\n"),
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

/**
 * @param {string[]} recipients  送信先の印刷会社名
 * @param {string} specText      印刷仕様の本文
 * @param {{greeting?:string, signature?:string}} sender  名乗り（「コンセプト・ヴィレッジ　馬場です。」）と署名
 */
/** 件名: 「【御見積のご相談】パッケージラベル印刷関連」。複数の種別なら「・」でつなぐ */
export function requestSubject(estimate, specs = []) {
  const types = [...new Set((specs || []).map((sp) => sp?.print_type).filter(Boolean))];
  const label = types.length ? types.join("・") : (estimate?.print_type || "印刷物");
  return `【御見積のご相談】${label}関連`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 見積依頼の「ご返信期限」: 今日から 1 週間後。土日・祝日に当たるときは次の平日。
 * @param {Date} [today]
 * @returns {Date}
 */
export function replyDeadline(today = new Date()) {
  return nextBusinessDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
}

/** 「2026年10月14日（水）」（画面の表示用） */
export const formatJpDate = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;

/** メール本文に書く返信期限の一文（文面を統一する） */
export function replySentence(d = replyDeadline()) {
  return `つきましては、恐れ入りますが【${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日】頃までに御見積書をご送付いただけますと幸いです。`;
}

/**
 * AI が書いた本文に、返信期限の一文がそのまま入っているようにする。
 * 入っていなければ、返信・期限に触れた行を置き換えるか、締めの挨拶の前に入れる。
 */
export function ensureReplySentence(body, sentence = replySentence()) {
  const text = String(body || "");
  if (text.includes(sentence)) return text;
  const lines = text.split("\n");
  const hit = lines.findIndex((l) => /返信|ご返答|ご回答|期限|までに.*(御見積|お見積|見積書)/.test(l));
  if (hit >= 0) { lines[hit] = sentence; return lines.join("\n"); }
  const close = lines.findIndex((l) => /^(何卒|どうぞ|よろしく|以上、?よろしく|ご多忙)/.test(l.trim()));
  if (close >= 0) { lines.splice(close, 0, sentence, ""); return lines.join("\n"); }
  return `${text}\n\n${sentence}`;
}

export function buildEmailPrompt(recipients, specText, sender = {}, subject = "", sentence = replySentence()) {
  const senderLine = sender.greeting || "コンセプト・ヴィレッジです。";
  const signature = sender.signature || COMPANY_INFO.name;
  return `以下の印刷仕様に基づいて、印刷会社への見積依頼メールを生成してください。
丁寧なビジネスメールの形式で、以下の情報を含めてください：
- 件名（${subject ? `必ず「${subject}」とする` : "「【御見積のご相談】○○印刷関連」の形"}）
- 挨拶
- 見積依頼の趣旨
- 印刷仕様の詳細
- ご返信期限: 次の一文を一字一句そのまま、独立した 1 行で書く（日付・言い回しを変えない。曜日も足さない）
  ${sentence}
  返信期限について、これ以外の書き方の文は書かない
- 締めの挨拶

希望納期・納期・納品日は本文に書かないでください（仕様にも載せていません）。

送信先の会社名リスト: ${recipients.join(", ")}

印刷仕様:
${specText}

差出人の名乗り: ${senderLine}
本文の冒頭は「いつも大変お世話になっております。」の次の行に「${senderLine}」をそのまま書いてください（社名の前に「株式会社」は付けず、名前は苗字だけ）。
末尾に次の署名を一字一句そのまま付けてください（追加・変更しない）:
${signature}

注意: 仕様の文中に、送信先とは別の印刷会社名（例: 他社の見積から取り込んだ名称に含まれる社名）が入っていることがあります。
その社名は送信先に見せるべきではないので、本文には出さず、仕様の内容（サイズ・色数・数量など）だけを書いてください。

各社宛にカスタマイズしたメールをJSON配列で返してください。
company_name には上記の会社名リストの表記をそのまま使ってください。`;
}
