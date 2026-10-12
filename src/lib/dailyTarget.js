// ============================================================================
// 速報デイリーの「1日あたりの粗利目標」の自動計算
//   1日の目標 ＝（今期の粗利目標 − 今の着地見込み粗利）÷ 今日から期末までの営業日数
//   ・今期の粗利目標 … 売上粗利管理表の「目標粗利」の 12 か月の合計（目標粗利が空なら 売上目標 − 仕入目標）
//   ・着地見込み粗利 … 売上粗利管理表と同じ計算（請求済みの実績粗利 ＋ 進行中で受注確度 A・A（定期）・要注意の案件の残りの粗利）
//   ・営業日 … 土日・祝日・年末年始（12/29〜1/3）・会社の休業日を除く
//   今日の目標は朝の時点で固定する（今日登録した案件は着地見込みに入れない）。今日登録した案件で、今日の目標そのものが下がって見えないように。
// ============================================================================
import { buildSalesReport } from "@/lib/salesReport";
import { fiscalYearRange } from "@/lib/fiscal";
import { isOffDay } from "@/lib/jpHolidays";

/** from〜to（YYYY-MM-DD、両端を含む）の営業日数 */
export function countBusinessDays(from, to, extra = null) {
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let n = 0;
  for (; d <= end; d.setDate(d.getDate() + 1)) if (!isOffDay(d, extra)) n += 1;
  return n;
}

/**
 * @param {object} p
 * @param {string} p.today  YYYY-MM-DD
 * @param {number} p.fiscalYear  期首の年
 * @param {number} p.startMonth
 * @param {object} p.data  { projects, invoices, bankTxs, payables, cardCharges, targets }（売上粗利管理表と同じ）
 * @param {Set<string>} [p.holidays]  会社の休業日
 * @param {number} [p.marginTarget]
 * @returns {{ target: number, landing: number, gap: number, days: number, daily: number, fyEnd: string, hasTarget: boolean }}
 */
export function autoDailyTarget({ today, fiscalYear, startMonth, data, holidays = null, marginTarget = 0.8 }) {
  const { to } = fiscalYearRange(fiscalYear, startMonth);
  const fyEnd = String(to).slice(0, 10);
  // 朝の時点: 今日登録した案件は入れない
  const projects = (data.projects || []).filter((p) => String(p.registered_at || "") < today);
  const report = buildSalesReport({
    fiscalYear, startMonth, projects,
    invoices: data.invoices || [], bankTxs: data.bankTxs || [], payables: data.payables || [], cardCharges: data.cardCharges || [],
    payablesMonthMode: data.payablesMonthMode, targets: data.targets, marginTarget,
  });
  const target = Math.round(report.annual.target.gross || 0);
  const landing = Math.round(report.annual.total.gross || 0);
  const gap = target - landing;
  const days = countBusinessDays(today, fyEnd, holidays);
  const daily = gap > 0 && days > 0 ? Math.ceil(gap / days) : 0;
  return { target, landing, gap, days, daily, fyEnd, hasTarget: target > 0 };
}
