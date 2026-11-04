import { Check, Lock, FolderKanban, Layers } from "lucide-react";
import { PRIORITY, REVIEW_STATUS, isPrivateTask, dueOf, userLabel } from "@/lib/tasks";
import { md } from "@/lib/schedule";

/** 利用者の丸いアイコン（顔写真が無ければ頭文字） */
export function UserAvatar({ user, size = 22, className = "" }) {
  const label = userLabel(user);
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.42) };
  if (user?.avatar_url) return <img src={user.avatar_url} alt={label} title={label} style={style} className={`rounded-full object-cover shrink-0 ${className}`} />;
  return (
    <span title={user ? label : "担当者なし"} style={style} className={`inline-flex items-center justify-center rounded-full shrink-0 font-semibold ${user ? "bg-slate-200 text-slate-700" : "border border-dashed border-slate-300 text-slate-400"} ${className}`}>
      {user ? label.slice(0, 1) : "?"}
    </span>
  );
}

/** 完了の丸いチェック */
export function TaskCheck({ done, onToggle, size = 18, testId }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle?.(!done); }} aria-label={done ? "未完了に戻す" : "完了にする"} data-testid={testId}
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center rounded-full border shrink-0 transition-colors ${done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-400 text-transparent hover:border-emerald-500 hover:text-emerald-500"}`}>
      <Check style={{ width: size * 0.65, height: size * 0.65 }} strokeWidth={3} />
    </button>
  );
}

/** タスクの紐づけ先（案件・プロジェクト・自分だけ） */
export function TaskPlaceChip({ task, byId, className = "" }) {
  if (isPrivateTask(task)) return <span className={`inline-flex items-center gap-0.5 rounded px-1.5 text-[10px] leading-5 bg-slate-100 text-slate-500 ${className}`} title="どこにも紐づけていないタスク（作った人と担当者だけが見られます）"><Lock className="w-2.5 h-2.5" />自分だけ</span>;
  if (task.project_id) {
    const p = byId.projects.get(task.project_id);
    return <span className={`inline-flex items-center gap-0.5 rounded px-1.5 text-[10px] leading-5 bg-blue-50 text-blue-700 max-w-[14rem] ${className}`} title={p ? `${p.project_number} ${p.client_name} ${p.name}` : "案件"}><FolderKanban className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{p ? `${p.client_name ? `${p.client_name}／` : ""}${p.name}` : "案件"}</span></span>;
  }
  const ip = byId.internal.get(task.internal_project_id);
  return <span className={`inline-flex items-center gap-0.5 rounded px-1.5 text-[10px] leading-5 max-w-[14rem] ${className}`} style={{ background: `${ip?.color || "#8b5cf6"}1a`, color: ip?.color || "#6d28d9" }} title="プロジェクト"><Layers className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{ip?.name || "プロジェクト"}</span></span>;
}

export function PriorityChip({ value }) {
  const p = PRIORITY[value];
  return p ? <span className={`rounded px-1.5 text-[10px] leading-5 ring-1 ${p.cls}`}>優先度 {p.label}</span> : null;
}
export function ReviewChip({ value }) {
  const r = REVIEW_STATUS[value];
  return r ? <span className={`rounded px-1.5 text-[10px] leading-5 ring-1 ${r.cls}`}>{r.label}</span> : null;
}

/** 期限（期間なら 〜）。期限切れは赤 */
export function DueLabel({ task, today, className = "" }) {
  const due = dueOf(task);
  if (!due) return <span className={`text-[11px] text-muted-foreground ${className}`}>—</span>;
  const range = task.start_date && task.end_date && task.start_date !== task.end_date ? `${md(task.start_date)}〜${md(task.end_date)}` : md(due);
  const late = !task.completed && due < today;
  const soon = !task.completed && due === today;
  return <span className={`text-[11px] tabular-nums whitespace-nowrap ${late ? "text-rose-600 font-semibold" : soon ? "text-emerald-700 font-semibold" : "text-muted-foreground"} ${className}`}>{soon ? "今日" : range}</span>;
}

/** 校正のピンの番号（黄色の丸） */
export function PinBadge({ no, done = false, size = 18, className = "" }) {
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.55 }} className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ring-1 ${done ? "bg-emerald-500 text-white ring-emerald-600" : "bg-yellow-300 text-yellow-900 ring-yellow-500"} ${className}`}>{no}</span>
  );
}
