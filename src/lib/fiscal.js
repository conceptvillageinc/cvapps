// 会計期（10月始まり）の計算。
// 「第N期」ではなく、期首の年で呼ぶ（例: 2025年10月〜2026年9月 = 「2025年度」）。

import { DEFAULT_FISCAL_YEAR_START_MONTH } from "@/lib/constants";

const pad = (n) => String(n).padStart(2, "0");

/** 日付（"yyyy-MM-dd" または Date）が属する期の開始年 */
export function fiscalYearOf(date, startMonth = DEFAULT_FISCAL_YEAR_START_MONTH) {
  const d = typeof date === "string" ? new Date(date + (date.length === 10 ? "T00:00:00" : "")) : date;
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= startMonth ? y : y - 1;
}

/** 期の開始日・終了日（"yyyy-MM-dd"） */
export function fiscalYearRange(fiscalYear, startMonth = DEFAULT_FISCAL_YEAR_START_MONTH) {
  const from = `${fiscalYear}-${pad(startMonth)}-01`;
  const endYear = startMonth === 1 ? fiscalYear : fiscalYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate();
  const to = `${endYear}-${pad(endMonth)}-${pad(lastDay)}`;
  return { from, to };
}

/** 表示用ラベル（例: "2025年度（2025/10〜2026/9）"） */
export function fiscalYearLabel(fiscalYear, startMonth = DEFAULT_FISCAL_YEAR_START_MONTH) {
  const { from, to } = fiscalYearRange(fiscalYear, startMonth);
  return `${fiscalYear}年度（${from.slice(0, 7).replace("-", "/")}〜${to.slice(0, 7).replace("-", "/")}）`;
}

/** 翌月末日（"yyyy-MM-dd"）。請求の入金期日の既定値に使う。 */
export function nextMonthEnd(dateStr) {
  if (!dateStr) return "";
  const [y, m] = dateStr.slice(0, 10).split("-").map(Number);
  if (!y || !m) return "";
  const end = new Date(y, m + 1, 0); // 翌月の0日 = 翌月末
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

/** 今日（ローカル）を "yyyy-MM-dd" で */
export function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
