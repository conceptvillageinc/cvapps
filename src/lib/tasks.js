// ============================================================================
// タスク管理（Asana の置きかえ）の共通の決まり
//
//   タスク = 工程表の工程（project_tasks）。案件の工程表に入れた工程が、そのまま担当者のタスクになる。
//   見える範囲（RLS は 0052）:
//     案件に紐づく・社内プロジェクトに紐づく … CV のメンバー全員
//     どこにも紐づかない（マイタスク）       … 作った人と担当者だけ。ワークロードにも数えない
//   作業時間（estimated_hours）は、期間の営業日に均等に割り振る（土日・祝日・会社の休業日を除く）
//   サブタスクは parent_task_id。校正のピンから作ったサブタスクは pin = { attachment_id, page, x, y, no }
// ============================================================================
import { addDays, parseYmd, toYmd, weekStart, daysBetween } from "@/lib/schedule";
import { isOffDay } from "@/lib/jpHolidays";

export const PRIORITY = {
  high: { label: "高", cls: "bg-rose-100 text-rose-700 ring-rose-200" },
  mid: { label: "中", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
  low: { label: "低", cls: "bg-sky-100 text-sky-700 ring-sky-200" },
};
/**
 * 優先度の選択肢のボタン
 *   選んでいないもの: 背景なし・文字の色だけ（マウスを乗せると薄く背景）
 *   選んでいるもの: 背景の色・太字・✓
 */
export const choiceCls = (v, selected) => {
  const text = v.cls.split(" ").filter((c) => c.startsWith("text-") || c.startsWith("ring-")).join(" ");
  return `rounded px-2 text-xs leading-6 ring-1 transition ${selected ? `${v.cls} font-bold shadow-sm` : `${text} bg-transparent hover:bg-slate-50`}`;
};

export const REVIEW_STATUS = {
  todo: { label: "要対応", cls: "bg-rose-100 text-rose-700 ring-rose-200" },
  reviewing: { label: "確認中", cls: "bg-amber-100 text-amber-800 ring-amber-200" }, // 優先度「中」と同じ色
  ok: { label: "OK", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
};

/** どこにも紐づかない（作った人と担当者だけが見る）タスクか */
export const isPrivateTask = (t) => !t?.project_id && !t?.internal_project_id;
/** 期限（終わりの日。無ければ始まりの日） */
export const dueOf = (t) => t?.end_date || t?.start_date || null;
/** 担当者（担当者が無い工程表の工程は、担当の CV メンバー） */
export function assigneesOf(t) {
  if (t?.assignee_id) return [t.assignee_id];
  return Array.isArray(t?.member_ids) ? t.member_ids.filter(Boolean) : [];
}

/**
 * 作業時間を日ごとに割り振る。{ "YYYY-MM-DD": 時間 }
 *   期間の営業日に均等（営業日が無い期間は、期間の最初の日にまとめる）
 */
export function hoursByDay(t, holidays = null) {
  const h = Number(t?.estimated_hours) || 0;
  const start = t?.start_date || t?.end_date;
  const end = t?.end_date || t?.start_date;
  if (!h || !start || !end || end < start) return {};
  const days = daysBetween(start, end).filter((d) => !isOffDay(parseYmd(d), holidays));
  if (!days.length) return { [start]: h };
  const per = h / days.length;
  return Object.fromEntries(days.map((d) => [d, per]));
}

/**
 * ワークロード: メンバーごと・日ごとの作業時間の合計（非公開のタスクは数えない）
 * @returns {Map<userId, { total: {day: h}, tasks: [{ task, hours: {day: h} }] }>}
 */
export function workload(tasks, { from, to, holidays = null } = {}) {
  const out = new Map();
  for (const t of tasks || []) {
    if (isPrivateTask(t)) continue;
    const who = assigneesOf(t);
    if (!who.length) continue;
    const byDay = hoursByDay(t, holidays);
    const share = 1 / who.length;
    const inRange = Object.entries(byDay).filter(([d]) => (!from || d >= from) && (!to || d <= to));
    const start = t.start_date || t.end_date; const end = t.end_date || t.start_date;
    const overlaps = start && end && (!to || start <= to) && (!from || end >= from);
    if (!inRange.length && !overlaps) continue;
    for (const uid of who) {
      const row = out.get(uid) || { total: {}, tasks: [] };
      const hours = {};
      for (const [d, h] of inRange) { hours[d] = h * share; row.total[d] = (row.total[d] || 0) + h * share; }
      row.tasks.push({ task: t, hours });
      out.set(uid, row);
    }
  }
  return out;
}

/** 1 日の稼働時間（既定 8 時間） */
export const dailyHoursOf = (u) => (u?.daily_hours === null || u?.daily_hours === undefined || u?.daily_hours === "" ? 8 : Number(u.daily_hours));

/** マイタスクの見出し（期限で分ける） */
export const MY_GROUPS = [
  { key: "overdue", label: "期限切れ" },
  { key: "today", label: "今日" },
  { key: "week", label: "今週" },
  { key: "later", label: "来週以降" },
  { key: "none", label: "期限なし" },
];
export function myGroupOf(t, today) {
  const due = dueOf(t);
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  const sunday = addDays(weekStart(today), 6);
  return due <= sunday ? "week" : "later";
}

/** 自分のタスク（担当が自分。完了を出すかは showDone） */
export function myTasks(tasks, uid, { showDone = false } = {}) {
  // 担当者が入っていない工程表の工程は、担当の CV メンバー（member_ids）のタスクとして出す
  return (tasks || [])
    .filter((t) => assigneesOf(t).includes(uid) && (showDone || !t.completed))
    .sort((a, b) => String(dueOf(a) || "9999").localeCompare(String(dueOf(b) || "9999")) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

/** サブタスク（並び順） */
export const subtasksOf = (tasks, parentId) => (tasks || []).filter((t) => t.parent_task_id === parentId)
  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at || "").localeCompare(String(b.created_at || "")));

/** 次のピンの番号 */
export const nextPinNo = (subtasks) => (subtasks || []).reduce((m, t) => Math.max(m, Number(t.pin?.no) || 0), 0) + 1;

/** 本文の @名前 から、メンションした利用者を拾う（名前・短い名前の長いものから当てる） */
export function mentionsIn(body, users) {
  const text = String(body || "");
  const ids = new Set();
  const names = (users || []).flatMap((u) => [u.full_name, u.short_name].filter(Boolean).map((n) => ({ id: u.id, n: String(n) })))
    .sort((a, b) => b.n.length - a.n.length);
  for (const { id, n } of names) if (text.includes(`@${n}`) || text.includes(`＠${n}`)) ids.add(id);
  return [...ids];
}

/** 表示用の名前（短い名前 > 名前 > メール） */
export const userLabel = (u) => u?.short_name || u?.full_name || u?.email || "（不明）";

/** 今日（YYYY-MM-DD） */
export const todayYmd = () => toYmd(new Date());
