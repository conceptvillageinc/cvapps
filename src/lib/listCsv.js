// ============================================================================
// 各一覧の CSV の列（案件・見積・納品書・請求書・クライアント）。列名は CVアプリの画面の表示名にそろえる。
//   見積・納品書・請求書は 1 ファイルで 1行＝1明細（書類の列は各行にくり返す。書類ごとに数えるときは「行」が 1 の行）。
//   どれも「書き出した行数」を返す（CsvExportButton のお知らせに使う）。
// ============================================================================
import { exportCsv, docLineRows, lineColumns, rowsById, num, day, oneLine, mark } from "@/lib/csvExport";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { forecastLines } from "@/lib/projectForecast";
import { PROJECT_STATUS_MAP, STATUS_MAP, INVOICE_DELIVERY_METHODS } from "@/lib/constants";
import { DELIVERY_STATUS_MAP, INVOICE_STATUS_MAP } from "@/lib/documents";
import { SUBMISSION_STATUS, submissionOf } from "@/lib/submission";

const list = (v) => (Array.isArray(v) ? v.filter(Boolean).join(" / ") : oneLine(v));
const rate = (profit, base) => (Number(base) > 0 ? `${Math.round((Number(profit) / Number(base)) * 100)}%` : "");

// ---------------------------------------------------------------------------
// 案件
// ---------------------------------------------------------------------------
/** ctx.deliveryLabel(p): 納品・請求の状況（一覧と同じ判定） */
export function exportProjectsCsv(rows, { deliveryLabel } = {}) {
  const columns = [
    { label: "案件番号", value: (p) => p.project_number || "" },
    { label: "登録日", value: (p) => day(p.registered_at) },
    { label: "完了予定", value: (p) => day(p.due_date) },
    { label: "入金予定", value: (p) => day(p.payment_due_date) },
    { label: "支払予定", value: (p) => day(p.vendor_payment_date) },
    { label: "クライアント", value: (p) => p.client_name || "" },
    { label: "案件名", value: (p) => oneLine(p.name) },
    { label: "受注見込", value: (p) => num(p.expected_revenue) },
    { label: "発注見込（仕入）", value: (p) => num(p.expected_cost) },
    { label: "その他費用", value: (p) => num(p.other_cost) },
    { label: "粗利見込", value: (p) => num(p.expected_gross_profit) },
    { label: "粗利率", value: (p) => rate(p.expected_gross_profit, p.expected_revenue) },
    { label: "受注確度", value: (p) => p.deal_probability || "" },
    { label: "フェーズ", value: (p) => p.phase || "" },
    { label: "状態", value: (p) => PROJECT_STATUS_MAP[p.status]?.label || p.status || "" },
    { label: "定期売上", value: (p) => mark(p.is_recurring) },
    { label: "受注合計（実績）", value: (p) => num(p.confirmed_revenue) },
    { label: "発注合計（実績）", value: (p) => num(p.confirmed_cost) },
    { label: "粗利（実績）", value: (p) => (p.confirmed_revenue == null && p.confirmed_cost == null ? "" : num((Number(p.confirmed_revenue) || 0) - (Number(p.confirmed_cost) || 0))) },
    { label: "納品・請求", value: (p) => (deliveryLabel ? deliveryLabel(p) : "") },
    { label: "ネクストアクション", value: (p) => oneLine(p.next_action) },
    { label: "案件メモ", value: (p) => oneLine(p.notes) },
  ];
  exportCsv("案件一覧", columns, rows);
  return rows.length;
}

// ---------------------------------------------------------------------------
// 見積
// ---------------------------------------------------------------------------
/** 見積の税抜・消費税・税込・原価（新形式は明細から。旧形式は保存した金額） */
export function estimateAmounts(e) {
  if (e.schema_version === 2) {
    const t = computeEstimateTotals(e.line_items, { taxInclusive: !!e.tax_inclusive });
    const lines = forecastLines(e);
    const hasCost = lines.some((l) => l.hasCost);
    return { subtotal: t.subtotal, tax: t.tax, total: t.total, cost: hasCost ? lines.reduce((s, l) => s + l.cost, 0) : null };
  }
  const subtotal = Number(e.total_amount) || 0;
  return { subtotal, tax: null, total: null, cost: Number(e.cost_price) > 0 ? Number(e.cost_price) : null };
}

/** ctx: { projectById, probabilityOf, phaseOf, deliveryLabel } */
function estimateHead({ projectById = {}, probabilityOf, phaseOf, deliveryLabel } = {}) {
  return [
    { label: "見積番号", value: (e) => e.estimate_number || "" },
    { label: "版", value: (e) => e.revision_label || "" },
    { label: "見積日", value: (e) => day(e.estimate_date) },
    { label: "作成日", value: (e) => day(e.created_date) },
    { label: "案件番号", value: (e) => projectById[e.project_id]?.project_number || "" },
    { label: "クライアント", value: (e) => e.client_name || "" },
    { label: "件名", value: (e) => oneLine(e.estimate_title) },
    { label: "印刷物種別", value: (e) => e.print_type || "" },
    { label: "希望納期", value: (e) => day(e.desired_delivery_date) },
    { label: "ステータス", value: (e) => STATUS_MAP[e.status]?.label || e.status || "" },
    { label: "提出", value: (e) => SUBMISSION_STATUS[submissionOf(e)]?.label || "" },
    { label: "受注確度", value: (e) => (probabilityOf ? probabilityOf(e) : e.deal_probability || "") },
    { label: "フェーズ", value: (e) => (phaseOf ? phaseOf(e) : e.phase || "") },
    { label: "納品・請求", value: (e) => { const v = deliveryLabel ? deliveryLabel(e) : ""; return v === "—" ? "" : v; } },
    { label: "作成担当者", value: (e) => e.person_in_charge || "" },
    { label: "レビュー担当", value: (e) => e.reviewer_name || e.review_requested_to_name || "" },
  ];
}

/** 1行＝1明細（見積の列は各行にくり返す） */
export function exportEstimatesCsv(rows, ctx) {
  const doc = [
    ...estimateHead(ctx),
    { label: "金額（税抜）", value: (e) => num(estimateAmounts(e).subtotal) },
    { label: "消費税", value: (e) => num(estimateAmounts(e).tax) },
    { label: "金額（税込）", value: (e) => num(estimateAmounts(e).total) },
    { label: "原価", value: (e) => num(estimateAmounts(e).cost) },
    { label: "粗利", value: (e) => { const a = estimateAmounts(e); return a.cost === null ? "" : num(a.subtotal - a.cost); } },
    { label: "粗利率", value: (e) => { const a = estimateAmounts(e); return a.cost === null ? "" : rate(a.subtotal - a.cost, a.subtotal); } },
    { label: "税込で見積", value: (e) => mark(e.tax_inclusive) },
  ];
  const lines = docLineRows(rows);
  exportCsv("見積一覧", lineColumns(doc, { cost: true, internal: true }), lines);
  return lines.length;
}

// ---------------------------------------------------------------------------
// 納品書
// ---------------------------------------------------------------------------
async function noteRefs(notes) {
  const [projects, estimates, invoices] = await Promise.all([
    rowsById("Project", notes.map((n) => n.project_id)),
    rowsById("Estimate", notes.map((n) => n.estimate_id)),
    rowsById("Invoice", notes.map((n) => n.invoice_id)),
  ]);
  return { projects, estimates, invoices };
}

function noteHead({ projects, estimates, invoices }) {
  return [
    { label: "納品書番号", value: (n) => n.delivery_number || "" },
    { label: "納品日", value: (n) => day(n.delivery_date) },
    { label: "案件番号", value: (n) => projects[n.project_id]?.project_number || "" },
    { label: "案件名", value: (n) => oneLine(projects[n.project_id]?.name) },
    { label: "元の見積番号", value: (n) => estimates[n.estimate_id]?.estimate_number || "" },
    { label: "クライアント", value: (n) => n.client_name || "" },
    { label: "件名", value: (n) => oneLine(n.title) },
    { label: "状態", value: (n) => DELIVERY_STATUS_MAP[n.status]?.label || n.status || "" },
    { label: "請求書番号", value: (n) => invoices[n.invoice_id]?.invoice_number || "" },
    { label: "定期売上の月", value: (n) => (n.recurring_month ? String(n.recurring_month).slice(0, 7) : "") },
    { label: "担当者", value: (n) => n.person_in_charge || "" },
  ];
}

/** 1行＝1明細（納品書の列は各行にくり返す） */
export async function exportDeliveryNotesCsv(rows) {
  const doc = [
    ...noteHead(await noteRefs(rows)),
    { label: "小計（税抜）", value: (n) => num(n.subtotal) },
    { label: "消費税", value: (n) => num(n.tax) },
    { label: "合計（税込）", value: (n) => num(n.total) },
    { label: "備考", value: (n) => oneLine(n.notes) },
  ];
  const lines = docLineRows(rows);
  exportCsv("納品書一覧", lineColumns(doc), lines);
  return lines.length;
}

// ---------------------------------------------------------------------------
// 請求書
// ---------------------------------------------------------------------------
const deliveryMethodLabel = (k) => INVOICE_DELIVERY_METHODS[k] || k || "";

function invoiceHead(projects) {
  return [
    { label: "請求書番号", value: (i) => i.invoice_number || "" },
    { label: "請求日", value: (i) => day(i.invoice_date) },
    { label: "支払期限", value: (i) => day(i.due_date) },
    { label: "案件番号", value: (i) => projects[i.project_id]?.project_number || "" },
    { label: "案件名", value: (i) => oneLine(projects[i.project_id]?.name) },
    { label: "クライアント", value: (i) => i.client_name || "" },
    { label: "件名", value: (i) => oneLine(i.title) },
    { label: "状態", value: (i) => INVOICE_STATUS_MAP[i.status]?.label || i.status || "" },
  ];
}

const invoiceProjectIds = (rows) => rows.flatMap((i) => [i.project_id, ...(i.line_items || []).map((li) => li.project_id)]);

/** 1行＝1明細（請求書の列は各行にくり返す） */
export async function exportInvoicesCsv(rows) {
  const projects = await rowsById("Project", invoiceProjectIds(rows));
  const doc = [
    ...invoiceHead(projects),
    { label: "小計（税抜）", value: (i) => num(i.subtotal) },
    { label: "消費税", value: (i) => num(i.tax) },
    { label: "合計（税込）", value: (i) => num(i.total) },
    { label: "送付日", value: (i) => day(i.sent_at) },
    { label: "送付方法", value: (i) => deliveryMethodLabel(i.delivery_method) },
    { label: "入金日", value: (i) => day(i.paid_at) },
    { label: "入金額", value: (i) => num(i.paid_amount) },
    { label: "担当者", value: (i) => i.person_in_charge || "" },
    { label: "備考", value: (i) => oneLine(i.notes) },
  ];
  const lines = docLineRows(rows);
  exportCsv("請求書一覧", lineColumns(doc, {
    extra: [
      { label: "明細の案件番号", value: (r) => projects[r.li.project_id]?.project_number || "" },
      { label: "提供月", value: (r) => (r.li.service_month ? String(r.li.service_month).slice(0, 7) : "") },
    ],
  }), lines);
  return lines.length;
}

// ---------------------------------------------------------------------------
// クライアント
// ---------------------------------------------------------------------------
/** ctx.lastProjectOf(c): 最終案件日 */
export function exportClientsCsv(rows, { lastProjectOf } = {}) {
  exportCsv("クライアント一覧", [
    { label: "会社名", value: (c) => c.name || "" },
    { label: "フリガナ", value: (c) => c.name_kana || "" },
    { label: "担当者", value: (c) => c.contact_person || "" },
    { label: "担当者フリガナ", value: (c) => c.contact_person_kana || "" },
    { label: "メール", value: (c) => c.email || "" },
    { label: "CC", value: (c) => list(c.cc_emails) },
    { label: "電話", value: (c) => c.phone || "" },
    { label: "郵便番号", value: (c) => c.postal_code || "" },
    { label: "住所", value: (c) => oneLine(c.address) },
    { label: "請求書の送り方", value: (c) => deliveryMethodLabel(c.invoice_delivery_method) },
    { label: "送り方のメモ", value: (c) => oneLine(c.invoice_delivery_notes) },
    { label: "定期請求あり", value: (c) => mark(c.has_recurring_billing) },
    { label: "見積件数", value: (c) => num(c.quote_count) },
    { label: "最終案件日", value: (c) => (lastProjectOf ? lastProjectOf(c) : "") },
    { label: "振込名義", value: (c) => list(c.bank_payee_names) },
    { label: "メモ", value: (c) => oneLine(c.notes) },
  ], rows);
  return rows.length;
}
