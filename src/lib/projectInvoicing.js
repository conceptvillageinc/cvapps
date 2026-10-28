// ============================================================================
// 請求書の金額を案件に割り当てる・定期売上の案件を月ごとの見込に広げる
//
// 1. 請求書の案件分け
//    同じクライアントの納品書をまとめた請求書は、案件が 1 つとは限らない。
//    明細の project_id（納品書から写したときに入る）で案件ごとに分け、
//    project_id の無い明細（手で足した行など）は請求書の project_id に入れる。
//    消費税込みの額（total）は、税抜の割合で按分する（端数は最後の案件に寄せる）。
//
// 2. 定期売上の案件（recurring_start_month がある案件）
//    定期売上は 1 つの案件に、毎月の納品書・請求書がぶら下がる。
//    見込は「月額（expected_revenue）× 月」で、月ごとに
//      その月の分として請求した額（明細の service_month → 取引日 = 納品日の月 → 請求日の月）
//    service_month は、月ごとの案件（旧）を 1 つにまとめたときに、元の案件の月を明細に残したもの（0039）
//    を差し引く。画面ではその月の分の案件として 1 行ずつ出す。
// ============================================================================

const n = (v) => Number(v) || 0;
const ymOf = (d) => String(d || "").slice(0, 7);
const lastDay = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
export const addMonthsYm = (ym, k) => { const [y, m] = ym.split("-").map(Number); const t = new Date(y, m - 1 + k, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
const monthLabel = (ym) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月分`;

/** 定期売上の案件（1 つの案件に毎月の納品書・請求書がぶら下がる形）か */
export const isRecurringParent = (p) => !!(p && p.recurring_start_month);

/**
 * 請求書 → 案件ごとの金額（税抜・税込）。明細の project_id → 請求書の project_id の順。
 * 月ごとにも分ける（明細の取引日の月、無ければ請求日の月）。
 * @returns {{ project_id: string, month: string, subtotal: number, total: number }[]}
 */
export function invoiceProjectShares(inv) {
  const lines = (inv?.line_items || []).filter((li) => li && li.row_type !== "text" && li.row_type !== "subtotal");
  const invMonth = ymOf(inv?.invoice_date);
  const bucket = new Map();
  for (const li of lines) {
    const pid = li.project_id || inv.project_id || null;
    if (!pid) continue;
    const month = li.service_month || ymOf(li.transaction_date) || invMonth;
    const key = `${pid}|${month}`;
    bucket.set(key, (bucket.get(key) || 0) + n(li.amount));
  }
  // 明細が無い（取込の請求書など）ときは、請求書の案件に全額
  if (bucket.size === 0) return inv?.project_id ? [{ project_id: inv.project_id, month: invMonth, subtotal: n(inv.subtotal), total: n(inv.total) }] : [];
  const sub = [...bucket.values()].reduce((s, v) => s + v, 0);
  const out = [...bucket.entries()].map(([key, subtotal]) => {
    const [project_id, month] = key.split("|");
    return { project_id, month, subtotal, total: sub ? Math.round(n(inv.total) * (subtotal / sub)) : 0 };
  });
  // 税込の按分の端数を最後に寄せて、合計を請求書の total に合わせる
  if (out.length && sub) out[out.length - 1].total += n(inv.total) - out.reduce((s, x) => s + x.total, 0);
  return out;
}

/** 案件ごとの請求済み額（取消を除く）。byMonth は「案件|YYYY-MM」 */
export function invoicedIndex(invoices) {
  const byProject = new Map();
  const byMonth = new Map();
  for (const inv of invoices || []) {
    if (inv.status === "cancelled") continue;
    for (const s of invoiceProjectShares(inv)) {
      const p = byProject.get(s.project_id) || { subtotal: 0, total: 0 };
      p.subtotal += s.subtotal; p.total += s.total;
      byProject.set(s.project_id, p);
      const k = `${s.project_id}|${s.month}`;
      const m = byMonth.get(k) || { subtotal: 0, total: 0 };
      m.subtotal += s.subtotal; m.total += s.total;
      byMonth.set(k, m);
    }
  }
  return { byProject, byMonth };
}

/** この案件のうち、ある請求書がこの案件の分として請求した額（税抜・税込） */
export function invoiceShareFor(inv, projectId) {
  return invoiceProjectShares(inv).filter((s) => s.project_id === projectId)
    .reduce((a, s) => ({ subtotal: a.subtotal + s.subtotal, total: a.total + s.total }), { subtotal: 0, total: 0 });
}

/** 定期売上の案件が動いている月（YYYY-MM）。from〜to（YYYY-MM）の範囲だけ */
export function recurringMonths(p, fromYm, toYm) {
  if (!isRecurringParent(p)) return [];
  const start = ymOf(p.recurring_start_month);
  const end = p.recurring_end_month ? ymOf(p.recurring_end_month) : null;
  const out = [];
  let m = start > fromYm ? start : fromYm;
  for (let i = 0; i < 240 && m <= toYm && (!end || m <= end); i++, m = addMonthsYm(m, 1)) out.push(m);
  return out;
}

/**
 * 見込に使う案件の一覧。定期売上の案件は from〜to の月ごとに 1 件ずつに広げる。
 * それぞれに _invoiced（{ subtotal, total }。その案件・その月の分として請求した額）を付ける。
 * 広げた行は、その月の 1 日〜末日の案件として扱えるよう、登録日・完了予定・入金予定を月に合わせる。
 */
export function forecastProjects(projects, invoices, { fromYm, toYm }) {
  const { byProject, byMonth } = invoicedIndex(invoices);
  const out = [];
  for (const p of projects || []) {
    if (!isRecurringParent(p)) { out.push({ ...p, _invoiced: byProject.get(p.id) || { subtotal: 0, total: 0 } }); continue; }
    for (const m of recurringMonths(p, fromYm, toYm)) {
      out.push({
        ...p,
        name: `${p.name}（${monthLabel(m)}）`,
        registered_at: `${m}-01`,
        due_date: lastDay(m),
        payment_due_date: lastDay(addMonthsYm(m, 1)),
        vendor_payment_date: p.vendor_payment_date ? lastDay(addMonthsYm(m, 1)) : null,
        _recurring_month: m,
        _invoiced: byMonth.get(`${p.id}|${m}`) || { subtotal: 0, total: 0 },
      });
    }
  }
  return out;
}
