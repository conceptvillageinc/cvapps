// ============================================================================
// 売上粗利管理表（スプレッドシート「目標管理」の再現）
//
// 4段 × 12ヶ月（期首の月から）＋年計:
//   目標     売上 / 仕入 / 目標粗利（ジャンプ） / 目標粗利 / 必達粗利 / 粗利率
//   着地見込 売上（案件見込 A） / 売上（要注意A） / 発注見込A / 発注見込（要注意）/ 粗利 / 粗利率 / 必要売上 / 必要粗利×3
//   実績     売上（請求） / 調達（仕入） / その他原価 / 粗利 / 粗利率 / 必要売上 / 必要粗利×3
//   計       売上 / 仕入 / 粗利 / 粗利率 / 必要売上 / 必要粗利×3
//
// 見込は案件の見込から、実績は請求書（税抜）と銀行明細の出金（または手入力）から作る。
// 請求済みの案件は、見込から請求済み分を差し引く（二重計上を避ける）。
// ============================================================================

import { fiscalYearRange } from "@/lib/fiscal";

const n = (v) => Number(v) || 0;

/** 期の12ヶ月の { key: "yyyy-MM", label: "10月" } */
export function fiscalMonths(fiscalYear, startMonth) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = ((startMonth - 1 + i) % 12) + 1;
    const y = fiscalYear + (startMonth - 1 + i >= 12 ? 1 : 0);
    out.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: `${m}月`, index: i });
  }
  return out;
}

const monthKey = (d) => (d ? String(d).slice(0, 7) : null);
const arr12 = (a) => Array.from({ length: 12 }, (_, i) => (Array.isArray(a) && a[i] !== null && a[i] !== undefined && a[i] !== "" ? Number(a[i]) : null));

/** 年額を12等分（端数は期首の月に寄せる） */
export function splitAnnual(total) {
  const base = Math.floor(n(total) / 12);
  const rest = n(total) - base * 12;
  return Array.from({ length: 12 }, (_, i) => base + (i === 0 ? rest : 0));
}

export function emptyTargets(fiscalYear) {
  return {
    fiscal_year: fiscalYear,
    sales: Array(12).fill(0),
    purchase: Array(12).fill(0),
    gross_jump: Array(12).fill(0),
    gross_must: Array(12).fill(0),
    actual_purchase: Array(12).fill(null),
    actual_other_cost: Array(12).fill(null),
  };
}

/**
 * @param {object} p
 * @param {number} p.fiscalYear
 * @param {number} p.startMonth
 * @param {object[]} p.projects   全案件（見込に使う）
 * @param {object[]} p.invoices   全請求書（実績と、案件の請求済み額に使う）
 * @param {object[]} p.bankTxs    銀行明細（出金を仕入の実績に使う）
 * @param {object} p.targets      fiscal_targets の行（無ければ emptyTargets）
 * @param {number} p.marginTarget 粗利率の目標（0.8）
 */
export function buildSalesReport({ fiscalYear, startMonth, projects, invoices, bankTxs, targets, marginTarget }) {
  const months = fiscalMonths(fiscalYear, startMonth);
  const idx = new Map(months.map((m) => [m.key, m.index]));
  const { from, to } = fiscalYearRange(fiscalYear, startMonth);
  const t = { ...emptyTargets(fiscalYear), ...(targets || {}) };
  const T = {
    sales: arr12(t.sales).map((v) => v ?? 0),
    purchase: arr12(t.purchase).map((v) => v ?? 0),
    gross_jump: arr12(t.gross_jump).map((v) => v ?? 0),
    gross_must: arr12(t.gross_must).map((v) => v ?? 0),
    actual_purchase: arr12(t.actual_purchase),
    actual_other_cost: arr12(t.actual_other_cost),
  };

  // 請求済み額（税抜）を案件ごとに集計（見込から差し引く）
  const invoicedByProject = new Map();
  const actualSales = Array(12).fill(0);
  const actualSalesCount = Array(12).fill(0);
  for (const inv of invoices || []) {
    if (inv.status === "cancelled") continue;
    if (inv.project_id) invoicedByProject.set(inv.project_id, (invoicedByProject.get(inv.project_id) || 0) + n(inv.subtotal));
    const k = monthKey(inv.invoice_date);
    if (idx.has(k)) { actualSales[idx.get(k)] += n(inv.subtotal); actualSalesCount[idx.get(k)]++; }
  }

  // 銀行明細の出金（仕入の実績の既定値）
  const bankOut = Array(12).fill(0);
  for (const tx of bankTxs || []) {
    if (tx.match_status === "ignored") continue;
    const k = monthKey(tx.transaction_date);
    if (idx.has(k)) bankOut[idx.get(k)] += n(tx.amount_out);
  }

  // 見込（案件）
  const fc = {
    salesA: Array(12).fill(0), salesA2: Array(12).fill(0),
    costA: Array(12).fill(0), costA2: Array(12).fill(0),
    recurring: Array(12).fill(0), countA: Array(12).fill(0), countA2: Array(12).fill(0),
    projectsByMonth: Array.from({ length: 12 }, () => []),
  };
  for (const p of projects || []) {
    if (p.status !== "open") continue;
    const prob = p.deal_probability || "";
    const isA = prob === "A" || prob === "A（定期売上）";
    const isA2 = /要注意/.test(prob);
    if (!isA && !isA2) continue;
    const k = monthKey(p.due_date || p.payment_due_date || p.registered_at);
    if (!idx.has(k)) continue;
    const i = idx.get(k);
    const invoiced = invoicedByProject.get(p.id) || 0;
    const remaining = Math.max(0, n(p.expected_revenue) - invoiced);
    if (remaining <= 0) continue;
    const ratio = n(p.expected_revenue) > 0 ? remaining / n(p.expected_revenue) : 1;
    const cost = (n(p.expected_cost) + n(p.other_cost)) * ratio;
    if (isA) { fc.salesA[i] += remaining; fc.costA[i] += cost; fc.countA[i]++; }
    else { fc.salesA2[i] += remaining; fc.costA2[i] += cost; fc.countA2[i]++; }
    if (p.is_recurring) fc.recurring[i] += remaining;
    fc.projectsByMonth[i].push({ id: p.id, project_number: p.project_number, name: p.name, client_name: p.client_name, remaining, cost, prob });
  }

  const rows = months.map((m, i) => {
    const target = {
      sales: T.sales[i], purchase: T.purchase[i], gross_jump: T.gross_jump[i],
      gross: T.sales[i] - T.purchase[i], gross_must: T.gross_must[i],
    };
    target.margin = target.sales > 0 ? target.gross / target.sales : null;

    const forecast = {
      sales_a: Math.round(fc.salesA[i]), sales_a2: Math.round(fc.salesA2[i]),
      cost_a: Math.round(fc.costA[i]), cost_a2: Math.round(fc.costA2[i]),
      recurring: Math.round(fc.recurring[i]), count: fc.countA[i] + fc.countA2[i],
      projects: fc.projectsByMonth[i],
    };
    forecast.sales = forecast.sales_a + forecast.sales_a2;
    forecast.cost = forecast.cost_a + forecast.cost_a2;
    forecast.gross = forecast.sales - forecast.cost;
    forecast.margin = forecast.sales > 0 ? forecast.gross / forecast.sales : null;
    forecast.need_sales = forecast.sales - target.sales;
    forecast.need_gross_jump = forecast.gross - target.gross_jump;
    forecast.need_gross = forecast.gross - target.gross;
    forecast.need_gross_must = forecast.gross - target.gross_must;

    const purchase = T.actual_purchase[i] ?? Math.round(bankOut[i]);
    const other = T.actual_other_cost[i] ?? 0;
    const actual = {
      sales: Math.round(actualSales[i]), count: actualSalesCount[i],
      purchase, other_cost: other, purchase_from_bank: T.actual_purchase[i] === null, bank_out: Math.round(bankOut[i]),
    };
    actual.gross = actual.sales - actual.purchase - actual.other_cost;
    actual.margin = actual.sales > 0 ? actual.gross / actual.sales : null;
    actual.need_sales = actual.sales - target.sales;
    actual.need_gross_jump = actual.gross - target.gross_jump;
    actual.need_gross = actual.gross - target.gross;
    actual.need_gross_must = actual.gross - target.gross_must;

    const total = {
      sales: actual.sales + forecast.sales,
      purchase: actual.purchase + actual.other_cost + forecast.cost,
      gross: actual.gross + forecast.gross,
    };
    total.margin = total.sales > 0 ? total.gross / total.sales : null;
    total.need_sales = total.sales - target.sales;
    total.need_gross_jump = total.gross - target.gross_jump;
    total.need_gross = total.gross - target.gross;
    total.need_gross_must = total.gross - target.gross_must;
    total.margin_ok = total.margin === null ? null : total.margin >= marginTarget;
    total.achieved = target.gross > 0 ? total.gross >= target.gross : null;

    return { ...m, target, forecast, actual, total };
  });

  // 年計
  const sumKey = (block, key) => rows.reduce((s, r) => s + n(r[block][key]), 0);
  const annual = {};
  for (const block of ["target", "forecast", "actual", "total"]) {
    const b = {};
    for (const key of Object.keys(rows[0][block])) {
      if (typeof rows[0][block][key] === "number") b[key] = sumKey(block, key);
    }
    if (block === "target") b.margin = b.sales > 0 ? b.gross / b.sales : null;
    else b.margin = b.sales > 0 ? b.gross / b.sales : null;
    annual[block] = b;
  }
  annual.total.margin_ok = annual.total.margin === null ? null : annual.total.margin >= marginTarget;
  annual.total.achieved = annual.target.gross > 0 ? annual.total.gross >= annual.target.gross : null;

  return { fiscalYear, startMonth, from, to, months, rows, annual, marginTarget };
}
