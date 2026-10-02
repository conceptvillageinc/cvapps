// ============================================================================
// 資金繰り表（CV の口座）
//
// 起点: 入金確認で取り込んだ銀行明細の「残高」（口座ごとに最後の明細）。
// そこから先の入金・支払を日ごとに積み上げて、残高の推移を 2 本作る。
//   確定   … 請求済の請求書（期日内）、支払い先まとめの CV 分（未払）、カード引落（CV 分）、
//            登録した定期支払・一時的な予定
//   見込込み… 確定 ＋ 未請求の案件（A／要注意（A）／A（定期売上）で着手中）の入金・発注見込、
//            期日を過ぎた未入金（いつ入るか分からないので今日に置く）
// 安全度は「確定」の線で判定する（見込で安心しないため）。
// ============================================================================

import { nextMonthEnd } from "@/lib/fiscal";
import { BANK_LABELS } from "@/lib/bankImport";

const n = (v) => Number(v) || 0;
const pad = (x) => String(x).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, k) => { const d = parse(s); d.setDate(d.getDate() + k); return ymd(d); };
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(daysInMonth(y, m))}`; };
const dayInMonth = (ym, day) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(Math.min(Math.max(1, day || 31), daysInMonth(y, m)))}`; };
const addMonths = (ym, k) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

export const CATEGORIES = [
  { key: "人件費", direction: "out" }, { key: "経費", direction: "out" }, { key: "借入返済", direction: "out" }, { key: "税金", direction: "out" }, { key: "その他支出", direction: "out" },
  { key: "借入入金", direction: "in" }, { key: "その他収入", direction: "in" },
];
export const directionOf = (category) => CATEGORIES.find((c) => c.key === category)?.direction || "out";

/** 未請求の見込として数える案件（受注確度 A／要注意（A）／A（定期売上）で、フェーズが着手中） */
export const countsAsForecast = (p) => p.status === "open" && p.phase === "着手中" && ["A", "A（定期売上）", "要注意（A）"].includes(p.deal_probability || "");

/** 口座ごとの最後の残高（最後の日付の明細のうち、最後に取り込んだもの） */
export function latestBalances(bankTxs) {
  const best = new Map();
  for (const tx of bankTxs || []) {
    if (tx.balance === null || tx.balance === undefined || tx.balance === "") continue;
    const cur = best.get(tx.bank);
    const newer = !cur || tx.transaction_date > cur.transaction_date || (tx.transaction_date === cur.transaction_date && String(tx.created_at || "") >= String(cur.created_at || ""));
    if (newer) best.set(tx.bank, tx);
  }
  return [...best.values()].map((tx) => ({ bank: tx.bank, label: BANK_LABELS[tx.bank] || tx.account_label || tx.bank, balance: n(tx.balance), date: tx.transaction_date })).sort((a, b) => a.bank.localeCompare(b.bank));
}

/**
 * 日ごとの資金繰りを作る。
 * @returns { anchor: { total, date, accounts, missing }, days: [...], events: [...], min, minAll, status, safety, overdue, runway }
 */
export function buildCashPlan({ today, horizonDays = 90, bankTxs, invoices, projects, payables, cardCharges, items, safetyLine = null, cardPayDay = 27 }) {
  const accounts = latestBalances(bankTxs);
  const anchorDate = accounts.length ? accounts.map((a) => a.date).sort().slice(-1)[0] : null;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const end = addDays(today, horizonDays);
  const events = [];
  // 確定の予定: 残高の日付以前なら残高に含まれているとみなして飛ばす。今日より前で未処理なら今日に置く
  const settle = (date) => (anchorDate && date <= anchorDate ? null : date < today ? today : date);
  const push = (e) => { if (e.date && e.date <= end && e.amount) events.push(e); };

  // 請求書（未入金）
  const invoicedByProject = new Map();
  const overdue = [];
  for (const inv of invoices || []) {
    if (inv.status === "cancelled") continue;
    if (inv.project_id) invoicedByProject.set(inv.project_id, (invoicedByProject.get(inv.project_id) || 0) + n(inv.total));
    if (inv.status === "paid") continue;
    const due = inv.due_date || nextMonthEnd(inv.invoice_date);
    const label = `${inv.client_name || ""} ${inv.title || ""}`.trim();
    if (!due || due < today) { overdue.push({ ...inv, due }); push({ date: today, amount: n(inv.total), sure: false, group: "期日超過の未入金", label: `${label}（期日 ${due || "—"}）`, link: `/invoices/${inv.id}` }); }
    else push({ date: due, amount: n(inv.total), sure: true, group: "入金予定（請求済）", label, link: `/invoices/${inv.id}` });
  }
  // 未請求の案件（見込）
  for (const p of projects || []) {
    if (!countsAsForecast(p)) continue;
    const remaining = Math.max(0, Math.round(n(p.expected_revenue) * 1.1) - (invoicedByProject.get(p.id) || 0));
    const inDate = p.payment_due_date || nextMonthEnd(p.due_date || p.registered_at);
    if (remaining > 0 && inDate) push({ date: inDate < today ? today : inDate, amount: remaining, sure: false, group: "入金見込（未請求の案件）", label: `${p.client_name || ""} ${p.name || ""}`.trim(), link: `/projects/${p.id}` });
    const cost = Math.round((n(p.expected_cost) + n(p.other_cost)) * 1.1);
    const outDate = p.vendor_payment_date || nextMonthEnd(p.due_date || p.registered_at);
    if (cost > 0 && outDate) push({ date: outDate < today ? today : outDate, amount: -cost, sure: false, group: "発注見込（案件）", label: `${p.client_name || ""} ${p.name || ""}`.trim(), link: `/projects/${p.id}` });
  }
  // 支払い先まとめ（CV 分・未払）: 支払月の月末。「済」が付くまでは残高の日付に関わらず未払として扱う
  for (const r of payables || []) {
    if (r.paid || n(r.amount_cv) <= 0 || !/^\d{4}-\d{2}$/.test(r.pay_month || "")) continue;
    const due = monthEnd(r.pay_month);
    push({ date: due < today ? today : due, amount: -n(r.amount_cv), sure: true, group: "支払い先まとめ（仕入）", label: `${r.payee_name}（${r.pay_month} 月末払）`, link: "/payables" });
  }
  // カード引落（CV 分）: 利用月の翌月 ○ 日
  const byMonth = new Map();
  for (const c of cardCharges || []) {
    if ((c.entity || "cv") !== "cv") continue;
    const m = c.charge_month || String(c.charged_at || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    byMonth.set(m, (byMonth.get(m) || 0) + n(c.amount));
  }
  for (const [m, amt] of byMonth) {
    const date = settle(dayInMonth(addMonths(m, 1), cardPayDay));
    if (date && amt > 0) push({ date, amount: -amt, sure: true, group: "カード引落", label: `${m} 利用分`, link: "/payables" });
  }
  // 登録した定期支払・一時的な予定
  for (const it of items || []) {
    if (it.is_active === false) continue;
    const sign = it.direction === "in" ? 1 : -1;
    if (it.kind === "oneoff") {
      const date = it.on_date ? settle(it.on_date) : null;
      if (date) push({ date, amount: sign * n(it.amount), sure: true, group: it.category, label: it.name, itemId: it.id });
    } else {
      let m = (anchorDate || today).slice(0, 7);
      for (let i = 0; i < 14; i++, m = addMonths(m, 1)) {
        if (it.start_month && m < it.start_month) continue;
        if (it.end_month && m > it.end_month) break;
        const date = settle(dayInMonth(m, it.day_of_month || 31));
        if (date) push({ date, amount: sign * n(it.amount), sure: true, group: it.category, label: `${it.name}（${m}）`, itemId: it.id });
      }
    }
  }

  // 日ごとに積み上げ
  events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const days = [];
  let balSure = total; let balAll = total;
  let minSure = { balance: total, date: today }; let minAll = { balance: total, date: today };
  let firstBelow = null; let firstNegative = null;
  const line = safetyLine;
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const todays = events.filter((e) => e.date === date);
    const inSure = todays.filter((e) => e.sure && e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const outSure = -todays.filter((e) => e.sure && e.amount < 0).reduce((s, e) => s + e.amount, 0);
    const inFc = todays.filter((e) => !e.sure && e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const outFc = -todays.filter((e) => !e.sure && e.amount < 0).reduce((s, e) => s + e.amount, 0);
    balSure += inSure - outSure;
    balAll += inSure - outSure + inFc - outFc;
    if (balSure < minSure.balance) minSure = { balance: balSure, date };
    if (balAll < minAll.balance) minAll = { balance: balAll, date };
    if (line !== null && firstBelow === null && balSure < line) firstBelow = date;
    if (firstNegative === null && balSure < 0) firstNegative = date;
    days.push({ date, in_sure: inSure, out_sure: outSure, in_fc: inFc, out_fc: outFc, balance_sure: Math.round(balSure), balance_all: Math.round(balAll), events: todays });
  }
  const status = accounts.length === 0 ? "unknown" : firstNegative ? "danger" : (line !== null && firstBelow) ? "warn" : "ok";
  return {
    anchor: { total, date: anchorDate, accounts, missing: accounts.length === 0 },
    days, events, overdue,
    min: { ...minSure, balance: Math.round(minSure.balance) }, minAll: { ...minAll, balance: Math.round(minAll.balance) },
    firstBelow, firstNegative, status, safetyLine: line,
    stale: anchorDate ? diffDays(anchorDate, today) : null,
  };
}

/** 安全ラインの自動計算: （毎月の定期支払 ＋ 直近 3 か月の仕入（CV 分）の平均）× 2 */
export function autoSafetyLine({ items, payables, today }) {
  const monthly = (items || []).filter((it) => it.is_active !== false && it.kind === "recurring" && it.direction === "out").reduce((s, it) => s + n(it.amount), 0);
  const thisMonth = today.slice(0, 7);
  const months = [addMonths(thisMonth, -1), addMonths(thisMonth, -2), addMonths(thisMonth, -3)];
  const sums = months.map((m) => (payables || []).filter((r) => r.pay_month === m).reduce((s, r) => s + n(r.amount_cv), 0));
  const used = sums.filter((v) => v > 0);
  const avg = used.length ? used.reduce((s, v) => s + v, 0) / used.length : 0;
  return Math.round((monthly + avg) * 2);
}

/** 月ごとのまとめ（資金繰り表の月次用: 入金・支払・月末残高） */
export function monthlySummary(plan) {
  const out = new Map();
  for (const d of plan.days) {
    const m = d.date.slice(0, 7);
    let r = out.get(m);
    if (!r) { r = { month: m, in_sure: 0, out_sure: 0, in_fc: 0, out_fc: 0, balance_sure: 0, balance_all: 0 }; out.set(m, r); }
    r.in_sure += d.in_sure; r.out_sure += d.out_sure; r.in_fc += d.in_fc; r.out_fc += d.out_fc;
    r.balance_sure = d.balance_sure; r.balance_all = d.balance_all;
  }
  return [...out.values()];
}
