// ============================================================================
// 作成者・更新者と変更の履歴（record_history。SQL 0062 のトリガーが書く）の見せ方
//   項目名（列名 → 日本語）と、値の見せ方（状態の名前・金額・日付など）
// ============================================================================
import { PROJECT_STATUS_MAP, INVOICE_DELIVERY_METHODS } from "@/lib/constants";
import { DELIVERY_STATUS_MAP, RECEIPT_STATUS_MAP, INVOICE_STATUS_MAP } from "@/lib/documents";

export const HISTORY_TABLE_LABEL = {
  projects: "案件", estimates: "見積書", delivery_notes: "納品書", invoices: "請求書",
  receipts: "領収書", partner_orders: "発注書", recurring_project_templates: "定期売上", clients: "クライアント",
};

// どの表でも同じ意味の列
const COMMON = {
  client_name: "クライアント", client_id: "クライアント（マスタ）", client_honorific: "敬称", client_postal_code: "郵便番号", client_address: "住所",
  title: "件名", notes: "備考", line_items: "明細", subtotal: "小計（税抜）", tax: "消費税", total: "合計（税込）", tax_breakdown: "税率ごとの内訳",
  status: "状態", sent_at: "送付日時", person_in_charge: "担当者", project_id: "案件", estimate_id: "見積", invoice_id: "請求書",
  delivery_note_id: "納品書", due_date: "期日", deal_probability: "受注確度", phase: "フェーズ（以前）", name: "名前",
};
const BY_TABLE = {
  projects: {
    project_number: "案件番号", name: "案件名", status: "進捗", expected_revenue: "受注見込", expected_cost: "発注見込", other_cost: "その他費用",
    confirmed_revenue: "受注合計（実績）", confirmed_cost: "発注合計（実績）", registered_at: "案件登録日", due_date: "完了予定日",
    payment_due_date: "入金予定日", vendor_payment_date: "仕入先 支払予定日", is_recurring: "定期売上", next_action: "ネクストアクション",
    next_action_updated_at: "ネクストアクションの更新日時", next_action_updated_by: "ネクストアクションの更新者", notes: "案件メモ",
    schedule_settings: "工程表の設定", forecast_source: "見込みの入れ元", actual_revenue_manual: "受注合計を手入力", actual_cost_manual: "発注合計を手入力",
    estimate_sections: "見積の区分", uses_subsidy: "補助金", delivery_state_manual: "納品・請求（手動）", attachments: "参考資料",
    recurring_start_month: "定期売上の開始月", recurring_end_month: "定期売上の終了月", recurring_template_id: "定期売上のひな形",
  },
  estimates: {
    estimate_number: "見積番号", estimate_title: "件名", estimate_date: "見積日", validity_period_months: "有効期限（か月）", print_specs: "印刷仕様",
    print_type: "印刷物種別", size: "サイズ", usage: "用途", paper_type: "用紙", quantities: "数量", color_count: "色数", desired_delivery_date: "希望納期",
    additional_notes: "備考", status: "ステータス", lost_reason: "失注理由", is_final_submitted: "最終提出版", submission_status: "提出", submitted_at: "提出日時",
    revision_label: "版", total_amount: "合計金額", reviewer_name: "確認者", approved_date: "承認日", review_comments: "確認コメント",
    approval_checklist: "確認チェック", review_requested_to_name: "確認の依頼先", review_requested_at: "確認の依頼日時", tax_inclusive: "税込で表示",
    finalized_at: "確定日時", finalized_by: "確定した人", internal_memo: "社内メモ", estimate_section: "区分", meeting_id: "議事録", meeting_budget: "予算",
  },
  delivery_notes: { delivery_number: "納品書番号", delivery_date: "納品日", status: "状態", invoiced_manual: "請求済（手動）" },
  invoices: { invoice_number: "請求書番号", invoice_date: "請求日", due_date: "入金期日", status: "状態", paid_at: "入金日", paid_amount: "入金額", delivery_method: "送付方法" },
  receipts: { receipt_number: "領収書番号", proviso: "但し書き", issue_date: "発行日", payment_method: "受領方法", status: "状態" },
  partner_orders: {
    po_number: "発注書番号", partner_type: "発注先の種類", partner_id: "発注先（マスタ）", partner_name: "発注先", partner_honorific: "敬称",
    partner_postal_code: "郵便番号", partner_address: "住所", partner_contact: "担当者（先方）", order_date: "発注日", due_date: "納期",
    delivery_to_kind: "納品先の種類", delivery_to: "納品先", payment_terms: "支払条件", status: "状態",
  },
  recurring_project_templates: {
    name: "案件名", expected_revenue: "月額（受注見込）", expected_cost: "月額（発注見込）", other_cost: "その他費用", start_month: "開始月",
    end_month: "終了月", is_active: "有効", auto_delivery_note: "納品書の下書きを自動作成", line_items: "明細", one_time_revenue: "初回費用（売上）",
    one_time_cost: "初回費用（原価）", ended_confirmed_at: "終了の確定", last_reviewed_month: "見直した月",
  },
  clients: {
    name: "クライアント名", name_kana: "フリガナ", contact_person: "担当者", contact_person_kana: "担当者（フリガナ）", email: "メール（To）",
    phone: "電話", postal_code: "郵便番号", address: "住所", notes: "メモ", invoice_delivery_method: "請求書の送付方法",
    invoice_delivery_notes: "送付の補足", has_recurring_billing: "定期請求あり", bank_payee_names: "振込名義", cc_emails: "メール（CC）",
  },
};
// 履歴に出さない列（自動で動くもの・内部用）
const HIDDEN = new Set(["quote_count", "legacy_id", "legacy_data", "legacy_parent_id", "search_text", "schema_version", "drift_dismissed_sig",
  "source_line_ids", "source_all_line_ids", "lines_applied_at", "first_note_one_time", "one_time_line_items", "source_estimate_id", "project_group_id",
  "parent_estimate_id", "reviewer_id", "review_requested_to_id", "client_id", "partner_id"]);

export const fieldLabel = (table, key) => BY_TABLE[table]?.[key] || COMMON[key] || key;
export const visibleFields = (fields = []) => fields.filter((f) => !HIDDEN.has(f));

const STATUS_BY_TABLE = {
  projects: PROJECT_STATUS_MAP, delivery_notes: DELIVERY_STATUS_MAP, invoices: INVOICE_STATUS_MAP, receipts: RECEIPT_STATUS_MAP,
};
const MONEY = /(revenue|cost|subtotal|tax|total|amount|price|budget|fee)$/;
const DATE = /(_date|_at|_month)$/;

/** 履歴の 1 つの値を読める形に */
export function formatValue(table, key, v) {
  if (v === null || v === undefined || v === "") return "（空）";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (key === "status") {
    if (table === "projects" && v === "cancelled") return "失注";
    const m = STATUS_BY_TABLE[table];
    if (m?.[v]) return m[v].label;
  }
  if (key === "invoice_delivery_method" || key === "delivery_method") return INVOICE_DELIVERY_METHODS[v] || v;
  if (typeof v === "number" && MONEY.test(key)) return `¥${Math.round(v).toLocaleString("ja-JP")}`;
  if (typeof v === "string" && DATE.test(key) && /^\d{4}-\d{2}/.test(v)) {
    return v.length > 10 ? new Date(v).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : v;
  }
  return String(v);
}
