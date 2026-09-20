// ============================================================================
// MF会計（マネーフォワード クラウド会計）の仕訳インポートCSVを作る。
//
// 列は MF の「仕訳帳」エクスポート形式（そのまま再インポートできる形）。
//   売上計上: 請求日に  借方 売掛金 / 貸方 売上高（税区分 課税売上）
//   入金:     入金日に  借方 普通預金（補助科目=銀行） / 貸方 売掛金
//             振込手数料分の差額があれば 借方 支払手数料
// 勘定科目・税区分の表記は system_settings の accounting_settings で変更できる。
// ============================================================================

export const MF_COLUMNS = [
  "取引No", "取引日",
  "借方勘定科目", "借方補助科目", "借方部門", "借方取引先", "借方税区分", "借方インボイス", "借方金額(円)", "借方税額",
  "貸方勘定科目", "貸方補助科目", "貸方部門", "貸方取引先", "貸方税区分", "貸方インボイス", "貸方金額(円)", "貸方税額",
  "摘要", "仕訳メモ", "タグ", "MF仕訳タイプ", "決算整理仕訳", "作成日時", "作成者", "最終更新日時", "最終更新者",
];

export const DEFAULT_ACCOUNTING_SETTINGS = {
  sales_account: "売上高",
  receivable_account: "売掛金",
  deposit_account: "普通預金",
  fee_account: "支払手数料",
  tax_category_sales: "課税売上 10%",
  tax_category_sales_reduced: "課税売上 8%（軽減）",
  tax_category_none: "対象外",
  bank_sub_accounts: { toho: "東邦銀行", ryukyu: "琉球銀行" },
  department: "",
};

export function accountingSettingsFrom(settings) {
  const row = (settings || []).find((x) => x.setting_key === "accounting_settings");
  if (!row) return DEFAULT_ACCOUNTING_SETTINGS;
  try {
    const v = JSON.parse(row.setting_value);
    return { ...DEFAULT_ACCOUNTING_SETTINGS, ...v, bank_sub_accounts: { ...DEFAULT_ACCOUNTING_SETTINGS.bank_sub_accounts, ...(v.bank_sub_accounts || {}) } };
  } catch {
    return DEFAULT_ACCOUNTING_SETTINGS;
  }
}

const fmtDate = (d) => (d ? String(d).slice(0, 10).replace(/-/g, "/") : "");

function entry({ no, date, dr, cr, summary, memo }) {
  return {
    "取引No": no, "取引日": fmtDate(date),
    "借方勘定科目": dr.account, "借方補助科目": dr.sub || "", "借方部門": dr.dept || "", "借方取引先": dr.partner || "",
    "借方税区分": dr.tax || "", "借方インボイス": "", "借方金額(円)": dr.amount, "借方税額": dr.taxAmount ?? 0,
    "貸方勘定科目": cr.account, "貸方補助科目": cr.sub || "", "貸方部門": cr.dept || "", "貸方取引先": cr.partner || "",
    "貸方税区分": cr.tax || "", "貸方インボイス": "", "貸方金額(円)": cr.amount, "貸方税額": cr.taxAmount ?? 0,
    "摘要": summary || "", "仕訳メモ": memo || "", "タグ": "", "MF仕訳タイプ": "", "決算整理仕訳": "",
    "作成日時": "", "作成者": "", "最終更新日時": "", "最終更新者": "",
  };
}

/**
 * 仕訳を作る。
 * @param {object[]} invoices  対象の請求書
 * @param {object[]} bankTxs   請求書に紐付いた銀行明細（入金の補助科目に使う）
 * @param {object} opts        { includeSales, includePayments, from, to, settings }
 */
export function buildJournal(invoices, bankTxs, opts) {
  const s = opts.settings || DEFAULT_ACCOUNTING_SETTINGS;
  const inRange = (d) => d && (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to);
  const txByInvoice = new Map();
  for (const t of bankTxs || []) if (t.invoice_id) txByInvoice.set(t.invoice_id, t);

  const rows = [];
  let no = 1;
  for (const inv of invoices) {
    if (inv.status === "cancelled") continue;
    const partner = inv.client_name;
    const total = Math.round(Number(inv.total) || 0);
    const label = `${inv.invoice_number} ${inv.title || ""}`.trim();

    // 売上計上（請求日）。税率ごとに1行ずつ
    if (opts.includeSales && inRange(inv.invoice_date)) {
      const breakdown = Array.isArray(inv.tax_breakdown) && inv.tax_breakdown.length > 0
        ? inv.tax_breakdown
        : [{ rate: 10, taxable: Number(inv.subtotal) || 0, tax: Number(inv.tax) || 0 }];
      for (const b of breakdown) {
        const gross = Math.round(Number(b.taxable) + Number(b.tax));
        if (gross === 0) continue;
        rows.push(entry({
          no: no++, date: inv.invoice_date,
          dr: { account: s.receivable_account, partner, tax: s.tax_category_none, amount: gross, taxAmount: 0, dept: s.department },
          cr: { account: s.sales_account, partner, tax: Number(b.rate) === 8 ? s.tax_category_sales_reduced : s.tax_category_sales, amount: gross, taxAmount: Math.round(Number(b.tax)), dept: s.department },
          summary: `売上 ${label}`,
        }));
      }
    }

    // 入金（入金日）
    if (opts.includePayments && inv.status === "paid" && inRange(inv.paid_at)) {
      const paid = Math.round(Number(inv.paid_amount ?? inv.total) || 0);
      const tx = txByInvoice.get(inv.id);
      const sub = tx ? (s.bank_sub_accounts[tx.bank] || tx.account_label || "") : "";
      rows.push(entry({
        no: no++, date: inv.paid_at,
        dr: { account: s.deposit_account, sub, partner, tax: s.tax_category_none, amount: paid, taxAmount: 0, dept: s.department },
        cr: { account: s.receivable_account, partner, tax: s.tax_category_none, amount: paid, taxAmount: 0, dept: s.department },
        summary: `入金 ${label}`,
      }));
      const fee = total - paid;
      if (fee > 0 && fee <= 2000) {
        rows.push(entry({
          no: no++, date: inv.paid_at,
          dr: { account: s.fee_account, partner, tax: s.tax_category_none, amount: fee, taxAmount: 0, dept: s.department },
          cr: { account: s.receivable_account, partner, tax: s.tax_category_none, amount: fee, taxAmount: 0, dept: s.department },
          summary: `振込手数料 ${label}`,
        }));
      }
    }
  }
  return rows;
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV文字列（UTF-8 BOM付き。Excel・MF のどちらでも文字化けしない） */
export function toCsv(rows) {
  const lines = [MF_COLUMNS.join(",")];
  for (const r of rows) lines.push(MF_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
