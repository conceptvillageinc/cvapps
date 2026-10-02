// ============================================================================
// 売上粗利管理表（スプレッドシート「目標管理」の再現）
//
// 4段 × 12ヶ月（期首の月から）＋年計:
//   目標     売上 / 仕入 / 目標粗利（ジャンプ） / 目標粗利 / 必達粗利 / 粗利率
//   着地見込 売上（案件見込 A） / 売上（要注意A） / 発注見込A / 発注見込（要注意）/ 粗利 / 粗利率 / 必要売上 / 必要粗利×3
//   実績     売上（請求） / 調達（仕入） / その他原価 / 粗利 / 粗利率 / 必要売上 / 必要粗利×3
//   計       売上 / 仕入 / 粗利 / 粗利率 / 必要売上 / 必要粗利×3
//
// 見込は案件の見込から、実績は請求書（税抜）と、支払い先まとめ（税込→税抜）・カード利用明細
// （税込→税抜）から作る。支払い先まとめが無い月は銀行明細の出金、手入力があればそれが優先。
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

/** 支払月（"yyyy-MM"）を、仕入の実績としてどの月に数えるか */
export function payablesCostMonth(payMonth, mode = "prev") {
  const m = String(payMonth || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  if (mode !== "prev") return payMonth;
  let y = Number(m[1]); let mm = Number(m[2]) - 1;
  if (mm < 1) { mm = 12; y -= 1; }
  return `${y}-${String(mm).padStart(2, "0")}`;
}
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
 * @param {object[]} p.bankTxs    銀行明細（支払い先まとめが無い月の仕入の実績に使う）
 * @param {object[]} [p.payables]  支払い先まとめの行（税込。仕入の実績）
 * @param {object[]} [p.cardCharges] カード利用明細（税込。その他原価の実績）
 * @param {string}  [p.payablesMonthMode] 支払月をどの月に数えるか: "prev"（支払月の前月＝請求月）/ "same"（支払月）
 * @param {object} p.targets      fiscal_targets の行（無ければ emptyTargets）
 * @param {number} p.marginTarget 粗利率の目標（0.8）
 */
export function buildSalesReport({ fiscalYear, startMonth, projects, invoices, bankTxs, payables, cardCharges, payablesMonthMode = "prev", targets, marginTarget }) {
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

  // 支払い先まとめ（税込 → 税抜）。支払月の前月（請求月）か支払月に数える
  const payablesOut = Array(12).fill(0);
  const payablesCount = Array(12).fill(0);
  for (const r of payables || []) {
    const k = payablesCostMonth(r.pay_month, payablesMonthMode);
    if (!idx.has(k)) continue;
    const total = n(r.amount_cv) + n(r.amount_cvdigital) + n(r.amount_coolagri);
    payablesOut[idx.get(k)] += total / 1.1;
    payablesCount[idx.get(k)]++;
  }
  // カード利用明細（税込 → 税抜）。利用月に数える
  const cardOut = Array(12).fill(0);
  const cardCount = Array(12).fill(0);
  for (const c of cardCharges || []) {
    const k = c.charge_month || monthKey(c.charged_at);
    if (!idx.has(k)) continue;
    cardOut[idx.get(k)] += n(c.amount) / 1.1;
    cardCount[idx.get(k)]++;
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

    const purchaseSource = T.actual_purchase[i] !== null ? "manual" : payablesCount[i] > 0 ? "payables" : "bank";
    const purchase = purchaseSource === "manual" ? T.actual_purchase[i] : purchaseSource === "payables" ? Math.round(payablesOut[i]) : Math.round(bankOut[i]);
    const otherSource = T.actual_other_cost[i] !== null ? "manual" : cardCount[i] > 0 ? "card" : "none";
    const other = otherSource === "manual" ? T.actual_other_cost[i] : otherSource === "card" ? Math.round(cardOut[i]) : 0;
    const actual = {
      sales: Math.round(actualSales[i]), count: actualSalesCount[i],
      purchase, other_cost: other,
      purchase_source: purchaseSource, purchase_from_bank: purchaseSource === "bank", bank_out: Math.round(bankOut[i]),
      payables_out: Math.round(payablesOut[i]), payables_count: payablesCount[i],
      other_source: otherSource, card_out: Math.round(cardOut[i]), card_count: cardCount[i],
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

  const annual = buildAnnual(rows, marginTarget);
  return { fiscalYear, startMonth, from, to, months, rows, annual, marginTarget };
}

/** 年計（各ブロックの数値を 12 か月ぶん足す。粗利率は合計から出し直す） */
export function buildAnnual(rows, marginTarget) {
  const sumKey = (block, key) => rows.reduce((s, r) => s + n(r[block][key]), 0);
  const annual = {};
  for (const block of ["target", "forecast", "actual", "total"]) {
    const b = {};
    for (const key of Object.keys(rows[0][block])) {
      if (typeof rows[0][block][key] === "number") b[key] = sumKey(block, key);
    }
    b.margin = b.sales > 0 ? b.gross / b.sales : null;
    annual[block] = b;
  }
  annual.total.margin_ok = annual.total.margin === null ? null : annual.total.margin >= marginTarget;
  annual.total.achieved = annual.target.gross > 0 ? annual.total.gross >= annual.target.gross : null;
  return annual;
}

/** シミュレーションで手入力できる着地見込の項目 */
export const SIM_KEYS = ["sales_a", "sales_a2", "cost_a", "cost_a2", "recurring"];

/**
 * 着地見込の一部を手入力の値に置き換えた表を作る（粗利・粗利率・必要額・計・年計は計算し直す）。
 * @param {object} report   buildSalesReport の結果
 * @param {object} sim      { sales_a:[12], ... } null/空の月は実データのまま
 */
export function applySimulation(report, sim, marginTarget) {
  const rows = report.rows.map((r, i) => {
    const forecast = { ...r.forecast, simulated: {} };
    for (const k of SIM_KEYS) {
      const v = sim?.[k]?.[i];
      if (v !== null && v !== undefined && v !== "") {
        forecast[k] = Math.round(Number(String(v).replace(/,/g, "")) || 0);
        forecast.simulated[k] = true;
      }
    }
    forecast.sales = forecast.sales_a + forecast.sales_a2;
    forecast.cost = forecast.cost_a + forecast.cost_a2;
    forecast.gross = forecast.sales - forecast.cost;
    forecast.margin = forecast.sales > 0 ? forecast.gross / forecast.sales : null;
    forecast.need_sales = forecast.sales - r.target.sales;
    forecast.need_gross_jump = forecast.gross - r.target.gross_jump;
    forecast.need_gross = forecast.gross - r.target.gross;
    forecast.need_gross_must = forecast.gross - r.target.gross_must;
    const total = {
      sales: r.actual.sales + forecast.sales,
      purchase: r.actual.purchase + r.actual.other_cost + forecast.cost,
      gross: r.actual.gross + forecast.gross,
    };
    total.margin = total.sales > 0 ? total.gross / total.sales : null;
    total.need_sales = total.sales - r.target.sales;
    total.need_gross_jump = total.gross - r.target.gross_jump;
    total.need_gross = total.gross - r.target.gross;
    total.need_gross_must = total.gross - r.target.gross_must;
    total.margin_ok = total.margin === null ? null : total.margin >= marginTarget;
    total.achieved = r.target.gross > 0 ? total.gross >= r.target.gross : null;
    return { ...r, forecast, total };
  });
  return { ...report, rows, annual: buildAnnual(rows, marginTarget) };
}
