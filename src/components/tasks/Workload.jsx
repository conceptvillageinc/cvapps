import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronRight as Caret } from "lucide-react";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { addDays, weekStart, daysBetween, dayInfo, md } from "@/lib/schedule";
import { workload, dailyHoursOf, userLabel } from "@/lib/tasks";
import { UserAvatar } from "@/components/tasks/parts";

const fmtH = (h) => (h ? (Math.round(h * 10) / 10).toString() : "");
const DAY_W = 44;

/**
 * ワークロード: メンバーごと・日ごとの作業時間の合計。1 日の稼働時間を超えた日は薄い赤。
 *   自分だけ（非公開）のタスクは数えない。メンバーを開くと、案件・社内プロジェクトごとのタスクのバー
 */
export default function Workload({ data, today, onOpenTask }) {
  const { tasks, users, byId } = data;
  const { companyHolidays } = useSystemSettings();
  const [from, setFrom] = useState(() => weekStart(today));
  const [open, setOpen] = useState(() => new Set());
  const to = addDays(from, 20);
  const days = daysBetween(from, to);
  const load = useMemo(() => workload(tasks, { from, to, holidays: companyHolidays }), [tasks, from, to, companyHolidays]);
  const members = users.filter((u) => u.role !== "guest" || load.has(u.id));
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const placeOf = (t) => (t.project_id ? `p:${t.project_id}` : `i:${t.internal_project_id}`);
  const placeLabel = (key) => {
    if (key.startsWith("p:")) { const p = byId.projects.get(key.slice(2)); return p ? `${p.client_name ? `${p.client_name}／` : ""}${p.name}` : "案件"; }
    return byId.internal.get(key.slice(2))?.name || "社内プロジェクト";
  };

  return (
    <div className="space-y-2" data-testid="workload">
      <div className="flex items-center gap-2 text-xs">
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft className="w-3.5 h-3.5" /></Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFrom(weekStart(today))}>今週</Button>
        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setFrom(addDays(from, 7))}><ChevronRight className="w-3.5 h-3.5" /></Button>
        <span className="text-muted-foreground">{md(from)}〜{md(to)}　数字は 1 日の作業時間の合計（期間の営業日に均等に割り振り）。1 日の稼働時間を超えた日は<span className="mx-1 rounded bg-rose-100 px-1 text-rose-700">薄い赤</span>。自分だけのタスクは数えません</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded bg-sky-50 ring-1 ring-sky-100" />作業あり</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded bg-amber-50 ring-1 ring-amber-100" />稼働時間の 75% 以上</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded bg-rose-100 ring-1 ring-rose-200" />稼働時間を超えた</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="text-xs border-collapse" style={{ minWidth: 220 + days.length * DAY_W }}>
          <thead>
            <tr className="bg-muted/40">
              <th className="sticky left-0 z-10 bg-slate-50 w-64 min-w-64 px-3 py-1.5 text-left font-medium">メンバー（この期間の稼働率）</th>
              {days.map((d) => { const i = dayInfo(d, companyHolidays); return (
                <th key={d} style={{ width: DAY_W, minWidth: DAY_W }} className={`py-1 font-normal border-l ${i.off ? "bg-slate-100 text-slate-400" : ""} ${d === today ? "text-primary font-bold" : ""}`}>
                  {(i.day === 1 || d === from) && <div className="text-[9px] text-muted-foreground">{i.month}月</div>}{i.day}<div className="text-[9px]">{i.weekday}</div>
                </th>); })}
            </tr>
          </thead>
          <tbody>
            {members.map((u) => {
              const row = load.get(u.id);
              const cap = dailyHoursOf(u);
              const isOpen = open.has(u.id);
              const groups = new Map();
              for (const it of row?.tasks || []) { const k = placeOf(it.task); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
              return (
                <Fragment key={u.id}>
                  <tr className="border-t" data-testid="workload-member">
                    <td className="sticky left-0 z-10 bg-white px-2 py-2 w-64 min-w-64">
                      <button type="button" className="flex items-center gap-1.5 w-full text-left" onClick={() => toggle(u.id)}>
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <Caret className="w-3.5 h-3.5 text-muted-foreground" />}
                        <UserAvatar user={u} size={26} />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1"><span className="font-semibold truncate">{userLabel(u)}</span><span className="ml-auto text-[10px] text-muted-foreground">1日 {cap}h</span></span>
                          {/* 表示している期間の合計と、稼働できる時間（営業日 × 1 日の稼働時間）に対する割合 */}
                          {(() => { const total = Object.values(row?.total || {}).reduce((a, b) => a + b, 0); const capTotal = cap * days.filter((d) => !dayInfo(d, companyHolidays).off).length; const ratio = capTotal ? total / capTotal : 0; return (
                            <span className="mt-0.5 flex items-center gap-1.5" title={`この期間 ${fmtH(total) || 0}h／稼働できる時間 ${capTotal}h`}>
                              <span className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${ratio > 1 ? "bg-rose-500" : ratio > 0.75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></span>
                              <span className="text-[10px] tabular-nums text-slate-500">{Math.round(ratio * 100)}%</span>
                            </span>); })()}
                        </span>
                      </button>
                    </td>
                    {days.map((d) => {
                      const h = row?.total[d] || 0; const over = h > cap + 1e-9; const off = dayInfo(d, companyHolidays).off;
                      const busy = !over && h > 0 && h >= cap * 0.75;
                      return <td key={d} className={`border-l text-center tabular-nums ${over ? "bg-rose-100 text-rose-700 font-semibold" : busy ? "bg-amber-50 text-amber-800" : h > 0 ? "bg-sky-50/60 text-slate-700" : off ? "bg-slate-50" : ""}`} data-over={over ? "1" : undefined}>{fmtH(h)}</td>;
                    })}
                  </tr>
                  {isOpen && [...groups.entries()].map(([k, items]) => (
                    <Fragment key={k}>
                      <tr><td className="sticky left-0 z-10 bg-white pl-9 pr-2 pt-1.5 text-[10px] font-semibold text-muted-foreground truncate" colSpan={1}>{placeLabel(k)}</td><td colSpan={days.length} /></tr>
                      {items.map(({ task: t, hours }) => {
                        const s = t.start_date || t.end_date; const e = t.end_date || t.start_date;
                        const si = Math.max(0, days.indexOf(s < from ? from : s)); const ei = days.indexOf(e > to ? to : e);
                        const total = Object.values(hours).reduce((a, b) => a + b, 0);
                        return (
                          <tr key={t.id}>
                            <td className="sticky left-0 z-10 bg-white pl-9 pr-2 py-0.5 text-[11px] truncate max-w-56" title={t.name}>{t.name}</td>
                            <td colSpan={days.length} className="relative h-7 p-0">
                              <button type="button" onClick={() => onOpenTask(t.id)} title={`${t.name}（${fmtH(Number(t.estimated_hours) || 0)} 時間）`}
                                className={`absolute top-1 bottom-1 rounded px-1.5 text-left text-[10px] truncate text-white ${t.completed ? "bg-slate-400" : t.priority === "high" ? "bg-rose-500" : "bg-amber-500"}`}
                                style={{ left: si * DAY_W + 2, width: Math.max(1, (ei < 0 ? days.length - 1 : ei) - si + 1) * DAY_W - 4 }}>
                                <b className="mr-1">{fmtH(total) || "-"}</b>{t.name}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                  {isOpen && groups.size === 0 && <tr><td className="sticky left-0 bg-white pl-9 py-1 text-[11px] text-muted-foreground">この期間に作業時間の入ったタスクはありません</td><td colSpan={days.length} /></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
