// ============================================================================
// 定期売上の終了・更新の管理
//
//   終了月がある定期売上 … 終了月の 2 か月前から「まもなく終了」、過ぎたら「終了月を過ぎた」（どちらも要対応）
//                          「更新する」で終了月を延ばす（同じ案件のまま）／「更新しない（終了）」で確定（要対応から外す）
//   無期限の定期売上     … 年に 1 回（開始月から 12 か月ごと）、その 2 か月前から「見直しの時期」（要対応）
//                          「見直し済み（このまま継続）」で次の年まで外す。「終了月を決める」で終了月を入れる
//   要対応の件数は、サイドバーの「定期売上一覧」の数字とダッシュボードの一覧に出す
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { todayString } from "@/lib/fiscal";

export const NOTICE_MONTHS = 2; // 何か月前から知らせるか

const ym = (d) => (d ? String(d).slice(0, 7) : "");
/** "YYYY-MM" どうしの月の差（b − a） */
export const monthDiff = (a, b) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};
/** "YYYY-MM" に n か月足す */
export const addMonths = (a, n) => {
  const [y, m] = a.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const ymLabel = (a) => (a ? `${Number(a.slice(0, 4))}年${Number(a.slice(5, 7))}月` : "");

export const RECURRING_STATUS = {
  active: { label: "継続中", cls: "bg-emerald-100 text-emerald-700", action: false },
  ending_soon: { label: "まもなく終了", cls: "bg-amber-100 text-amber-800", action: true },
  expired: { label: "終了月を過ぎた", cls: "bg-red-100 text-red-700", action: true },
  review: { label: "見直しの時期", cls: "bg-sky-100 text-sky-800", action: true },
  ending: { label: "終了予定", cls: "bg-slate-100 text-slate-600", action: false },
  ended: { label: "終了", cls: "bg-slate-100 text-slate-500", action: false },
  stopped: { label: "停止中", cls: "bg-slate-100 text-slate-500", action: false },
};

/**
 * 定期売上の状態。{ key, monthsLeft, endYm, reviewYm, note }
 *   monthsLeft: 終了月まであと何か月（終了月が今月なら 0、過ぎていればマイナス）
 *   reviewYm:   無期限のとき、次の見直しの月
 */
export function recurringStatus(t, today = todayString()) {
  const now = ym(today);
  const endYm = ym(t?.end_month);
  if (t?.ended_confirmed_at) {
    const key = endYm && endYm >= now ? "ending" : "ended";
    return { key, endYm, note: key === "ending" ? `${ymLabel(endYm)}分で終了（更新しない）` : "更新しないで終了" };
  }
  if (!t?.is_active) return { key: "stopped", endYm };
  if (endYm) {
    const monthsLeft = monthDiff(now, endYm);
    if (monthsLeft < 0) return { key: "expired", endYm, monthsLeft, note: `${ymLabel(endYm)}分で終わっています` };
    if (monthsLeft <= NOTICE_MONTHS) return { key: "ending_soon", endYm, monthsLeft, note: monthsLeft === 0 ? `今月（${ymLabel(endYm)}分）で終了` : `${ymLabel(endYm)}分で終了（あと ${monthsLeft} か月）` };
    return { key: "active", endYm, monthsLeft, note: `${ymLabel(endYm)}分まで（あと ${monthsLeft} か月）` };
  }
  // 無期限: 開始月（見直し済みならその月）から 12 か月ごとに見直す
  const base = ym(t?.last_reviewed_month) || ym(t?.start_month) || now;
  let reviewYm = addMonths(base, 12);
  while (monthDiff(reviewYm, now) > 12) reviewYm = addMonths(reviewYm, 12); // 何年も見直していないときは、直近の見直し月に寄せる
  if (monthDiff(now, reviewYm) <= NOTICE_MONTHS) return { key: "review", reviewYm, note: `無期限（${ymLabel(reviewYm)}に 1 年の見直し）` };
  return { key: "active", reviewYm, note: `無期限（次の見直し ${ymLabel(reviewYm)}）` };
}

export const needsAction = (t, today) => RECURRING_STATUS[recurringStatus(t, today).key]?.action;

/** 要対応の定期売上（サイドバーの数字・ダッシュボード・定期売上一覧で共通。1 分ごとに読み直す） */
export function useRecurringAlerts() {
  const { data: templates = [] } = useQuery({
    queryKey: ["recurringTemplates"],
    queryFn: () => db.entities.RecurringProjectTemplate.list("-created_date"),
    staleTime: 60_000,
  });
  const alerts = templates
    .map((t) => ({ template: t, status: recurringStatus(t) }))
    .filter((a) => RECURRING_STATUS[a.status.key]?.action)
    .sort((a, b) => (a.status.endYm || a.status.reviewYm || "").localeCompare(b.status.endYm || b.status.reviewYm || ""));
  return { templates, alerts, count: alerts.length };
}
