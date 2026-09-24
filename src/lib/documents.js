// ============================================================================
// 納品書・請求書の共通処理（明細・税計算・採番・会社情報）
// ============================================================================

import { supabase } from "@/lib/supabase";
import { nextMonthEnd } from "@/lib/fiscal";
import { toTaxExclusiveUnitPrice, lineTaxRate } from "@/lib/estimateTotals";

export const TAX_RATES = [10, 8];
export const DEFAULT_TAX_RATE = 10;

function uid() {
  return `di_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 空の明細行 */
export function newDocItem(defaults = {}) {
  return {
    id: uid(),
    name: "",
    quantity: 1,
    unit: "式",
    unit_price: 0,
    amount: 0,
    tax_rate: DEFAULT_TAX_RATE,
    ...defaults,
  };
}

/** 見積の明細（テキスト行を除く）を帳票の明細に写す */
export function docItemsFromEstimate(estimate) {
  // 税込見積の明細は税抜に直して写す（納品書・請求書は税抜で持つ）
  const inclusive = !!estimate?.tax_inclusive;
  return (estimate?.line_items || [])
    .filter((li) => li.row_type !== "text" && li.row_type !== "subtotal")
    .map((li) => {
      const rate = lineTaxRate(li);
      const qty = Number(li.quantity) || 1;
      const unitPrice = inclusive ? toTaxExclusiveUnitPrice(li.unit_price, rate) : (Number(li.unit_price) || 0);
      return { li, rate, qty, unitPrice };
    })
    .map(({ li, rate, qty, unitPrice }) => newDocItem({
      name: li.name || "",
      quantity: qty,
      unit: li.unit || "式",
      unit_price: unitPrice,
      amount: inclusive ? unitPrice * qty : (Number(li.amount) || 0),
      tax_rate: rate,
      ...(li.cost_price != null ? { cost_price: Number(li.cost_price) } : {}),
      source_line_id: li.id,
      source_type: li.source_type || null,
    }));
}

/**
 * 小計・税率ごとの消費税・合計。
 * 消費税は税率ごとに合計してから計算する（明細ごとに計算すると端数がずれるため）。
 */
export function computeDocTotals(items) {
  const rows = (items || []).filter((li) => li && li.name !== undefined);
  const byRate = new Map();
  for (const li of rows) {
    const rate = Number(li.tax_rate ?? DEFAULT_TAX_RATE);
    byRate.set(rate, (byRate.get(rate) || 0) + (Number(li.amount) || 0));
  }
  const breakdown = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, taxable]) => ({ rate, taxable, tax: Math.floor(taxable * rate / 100) }));
  const subtotal = breakdown.reduce((s, b) => s + b.taxable, 0);
  const tax = breakdown.reduce((s, b) => s + b.tax, 0);
  return { subtotal, tax, total: subtotal + tax, tax_breakdown: breakdown };
}

/** 採番（D-YYMM-連番 / I-YYMM-連番）。DB関数 next_document_number が行う */
export async function generateDocumentNumber(kind, dateStr) {
  const { data, error } = await supabase.rpc("next_document_number", {
    p_kind: kind,
    p_date: dateStr || new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error("番号の採番に失敗しました: " + error.message);
  return data;
}

/** 入金期日の既定値: 請求日の翌月末 */
export function defaultDueDate(invoiceDate) {
  return nextMonthEnd(invoiceDate);
}

export const DEFAULT_COMPANY_INFO = {
  name: "株式会社コンセプト・ヴィレッジ",
  representative: "",
  registration_number: "",
  tel: "",
  fax: "",
  locations: [],
  bank_accounts: [],
  stamp_path: "",
  logo_path: "",
  stamp_width: 52,
  invoice_notes: "",
  delivery_notes: "",
};

export function companyInfoFromSettings(settings) {
  const row = (settings || []).find((x) => x.setting_key === "company_info");
  if (!row) return DEFAULT_COMPANY_INFO;
  try {
    const v = JSON.parse(row.setting_value);
    return { ...DEFAULT_COMPANY_INFO, ...v, locations: v.locations || [], bank_accounts: v.bank_accounts || [] };
  } catch {
    return DEFAULT_COMPANY_INFO;
  }
}

export const DELIVERY_STATUS_MAP = {
  draft: { label: "下書き", color: "bg-muted text-muted-foreground" },
  issued: { label: "発行済", color: "bg-emerald-100 text-emerald-700" },
};

export const INVOICE_STATUS_MAP = {
  draft: { label: "下書き", color: "bg-muted text-muted-foreground" },
  sent: { label: "送付済", color: "bg-blue-100 text-blue-700" },
  paid: { label: "入金済", color: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "取消", color: "bg-slate-100 text-slate-600" },
};

/** ブラウザでPDFを開く／保存する */
/**
 * PDF を新しいタブで開く（印刷プレビュー用）。
 * ポップアップブロックを避けるため、クリック直後に空のタブを開いておき、PDF ができたらそこに表示する。
 *   const tab = openPreviewTab();   // クリックハンドラの先頭で
 *   showBlobInTab(tab, blob);       // 生成後
 */
export function openPreviewTab() {
  const win = window.open("", "_blank");
  if (win) {
    win.document.title = "PDFを作成しています…";
    win.document.body.innerHTML = '<p style="font-family:sans-serif;color:#64748b;padding:24px">PDFを作成しています…</p>';
  }
  return win;
}
export function showBlobInTab(tab, blob, filename) {
  const url = URL.createObjectURL(blob);
  if (tab && !tab.closed) {
    tab.location.href = url;
  } else {
    // タブが開けなかった（ブロックされた）ときはダウンロードに切り替える
    openBlob(blob, filename);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

export function openBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
