import { Fragment, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Trash2, GripVertical, Link2, Diamond, Plus, ChevronDown, ChevronRight, Check } from "lucide-react";
import { useRowReorder } from "./useRowReorder";
import { PHASES, taskRange, diffDays, wouldCycle, categoryColors, md } from "@/lib/schedule";
import { tint } from "./ScheduleTimeline";
import EditableCell from "./EditableCell";
import PartyPicker from "./PartyPicker";

/**
 * 工程表のリスト（カテゴリーごとにまとめた表）。その場で編集する。
 * 社内メモ・見込み時間・実績時間は社内だけ（共有リンク・スプレッドシートには出ない）。
 * 行の左の ⋮⋮ をつかんで上下にドラッグすると並びが変わる（別のカテゴリーに入れるとカテゴリーも移る）。
 */
export default function ScheduleList({ tasks, parties, users = [], categories = [], onChange, onDelete, onReorder, onAddInCategory, memberName }) {
  const secColors = categoryColors(tasks);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (c) => setCollapsed((x) => { const n = new Set(x); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const groups = [];
  for (const t of tasks) {
    const c = t.category || "";
    if (!groups.length || groups[groups.length - 1].category !== c) groups.push({ category: c, items: [] });
    groups[groups.length - 1].items.push(t);
  }
  const boxRef = useRef(null);
  const reorder = useRowReorder((id, to, cat) => onReorder?.(id, to, cat));
  const commit = (t, key, value) => {
    const v = value === "" ? null : value;
    if ((t[key] ?? null) === v) return;
    onChange(t.id, { [key]: v });
  };

  return (
    <div ref={boxRef} className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="schedule-list">
      <table className="w-full text-xs table-fixed min-w-[1520px]">
        <thead>
          <tr className="border-b border-slate-200 bg-white text-[11px] text-slate-500">
            <th className="w-[52px] px-1 py-2 font-normal"></th>
            <th className="w-12"></th>
            <th className="text-left px-2 py-2 font-normal w-[140px]">カテゴリー</th>
            <th className="text-left px-2 py-2 font-normal w-[230px]">タスク名</th>
            <th className="text-left px-2 py-2 font-normal w-[96px]">工程</th>
            <th className="text-left px-2 py-2 font-normal w-[150px]">担当</th>
            <th className="text-left px-2 py-2 font-normal w-[132px]">開始日</th>
            <th className="text-left px-2 py-2 font-normal w-[132px]">終了日</th>
            <th className="px-1 py-2 font-normal w-10">日数</th>
            <th className="text-left px-2 py-2 font-normal w-[150px]">前の工程</th>
            <th className="px-1 py-2 font-normal w-14" title="見込み時間（社内のみ）">見込h</th>
            <th className="px-1 py-2 font-normal w-14" title="実績時間（社内のみ）">実績h</th>
            <th className="px-1 py-2 font-normal w-14 leading-tight" title="クライアント向けの工程表に出す">表に<br />出す</th>
            <th className="px-1 py-2 font-normal w-8" title="節目（◆。納品・校了など）">◆</th>
            <th className="text-left px-2 py-2 font-normal w-[180px]">社内メモ</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => (
            <Fragment key={`${g.category}-${gi}`}>
              <tr className="group/sec" data-drop-index={collapsed.has(g.category) ? tasks.indexOf(g.items[g.items.length - 1]) + 1 : tasks.indexOf(g.items[0])} data-drop-category={g.category}>
                <td colSpan={16} className="relative pl-3 pr-2 pt-4 pb-1.5 border-b border-slate-200">
                  <span className="absolute left-0 bottom-0 h-7 w-[4px]" style={{ background: secColors.get(g.category) }} />
                  <button className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-800" onClick={() => toggle(g.category)} data-testid="list-section">
                    {collapsed.has(g.category) ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: secColors.get(g.category) }} />
                    {g.category || "（カテゴリーなし）"}
                  </button>
                  <span className="ml-2 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{g.items.filter((t) => t.completed).length}/{g.items.length}</span>
                  <button className="ml-3 inline-flex items-center gap-0.5 text-[11px] text-slate-400 opacity-0 group-hover/sec:opacity-100 hover:text-primary" onClick={() => onAddInCategory(g.category, g.items[g.items.length - 1])}><Plus className="w-3 h-3" />工程を追加</button>
                </td>
              </tr>
              {!collapsed.has(g.category) && g.items.map((t) => {
                const i = tasks.indexOf(t);
                const r = taskRange(t);
                return (
                  <tr key={t.id} className={`group border-b border-slate-100 hover:bg-slate-50/80 ${reorder.draggingId === t.id ? "bg-blue-50/70 opacity-50" : ""}`} data-drop-index={i + 1} data-drop-category={t.category || ""} data-testid="schedule-row">
                    <td className="relative text-center">
                      <span className="absolute inset-y-[3px] left-[14px] w-[3px] rounded-full" style={{ background: tint(secColors.get(t.category || ""), 0.35) }} />
                      <button role="checkbox" aria-checked={!!t.completed} title={t.completed ? "未完了に戻す" : "完了にする"} onClick={() => onChange(t.id, { completed: !t.completed, completed_at: t.completed ? null : new Date().toISOString() })}
                        className={`ml-[24px] flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors ${t.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500"}`}><Check className="h-3 w-3" strokeWidth={3} /></button>
                    </td>
                    <td className="px-1 whitespace-nowrap">
                      <span onPointerDown={(e) => reorder.start(e, t.id, boxRef.current)} title="つかんで上下に動かすと並びが変わります" className="inline-flex h-7 w-6 cursor-grab touch-none items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600 group-hover:text-slate-400 active:cursor-grabbing" data-testid="row-grip"><GripVertical className="h-4 w-4" /></span>
                    </td>
                    <td className="px-1 py-1">
                      <EditableCell value={t.category || ""} list="schedule-categories" onCommit={(v) => commit(t, "category", v)} />
                    </td>
                    <td className="px-1 py-1"><EditableCell value={t.name} required onCommit={(v) => commit(t, "name", v)} textClassName={t.completed ? "line-through text-muted-foreground" : ""} /></td>
                    <td className="px-1 py-1"><EditableCell value={t.phase || ""} list="schedule-phases" onCommit={(v) => commit(t, "phase", v)} /></td>
                    <td className="px-1 py-1"><PartyPicker task={t} parties={parties} users={users} memberName={memberName} onChange={(patch) => onChange(t.id, patch)} /></td>
                    <td className="px-1 py-1"><Input key={`s${t.id}${t.start_date}`} type="date" defaultValue={t.start_date || ""} onBlur={(e) => commit(t, "start_date", e.target.value)} className="h-7 text-xs border-transparent bg-transparent shadow-none hover:border-slate-200 focus:border-slate-300 focus:bg-white px-1.5" /></td>
                    <td className="px-1 py-1"><Input key={`e${t.id}${t.end_date}`} type="date" defaultValue={t.end_date || ""} disabled={t.is_milestone} onBlur={(e) => commit(t, "end_date", e.target.value)} className="h-7 text-xs border-transparent bg-transparent shadow-none hover:border-slate-200 focus:border-slate-300 focus:bg-white px-1.5" /></td>
                    <td className="text-center tabular-nums text-muted-foreground">{r ? diffDays(r.start, r.end) + 1 : ""}</td>
                    <td className="px-1 py-1"><DependsPicker task={t} tasks={tasks} onChange={(ids) => onChange(t.id, { depends_on: ids })} /></td>
                    <td className="px-1 py-1"><Input key={`h${t.id}${t.estimated_hours}`} type="number" min="0" step="0.5" defaultValue={t.estimated_hours ?? ""} onBlur={(e) => commit(t, "estimated_hours", e.target.value === "" ? "" : Number(e.target.value))} className="h-7 text-xs border-transparent bg-transparent shadow-none hover:border-slate-200 focus:border-slate-300 focus:bg-white px-1 text-right" /></td>
                    <td className="px-1 py-1"><Input key={`a${t.id}${t.actual_hours}`} type="number" min="0" step="0.5" defaultValue={t.actual_hours ?? ""} onBlur={(e) => commit(t, "actual_hours", e.target.value === "" ? "" : Number(e.target.value))} className="h-7 text-xs border-transparent bg-transparent shadow-none hover:border-slate-200 focus:border-slate-300 focus:bg-white px-1 text-right" /></td>
                    <td className="text-center"><Checkbox checked={t.on_schedule !== false} onCheckedChange={(v) => onChange(t.id, { on_schedule: !!v })} /></td>
                    <td className="text-center">
                      <button title="節目（◆）にする" onClick={() => onChange(t.id, { is_milestone: !t.is_milestone, ...(t.is_milestone ? {} : { end_date: t.start_date || t.end_date || null }) })} className={t.is_milestone ? "text-fuchsia-600" : "text-muted-foreground/40 hover:text-muted-foreground"}><Diamond className="w-3.5 h-3.5" fill={t.is_milestone ? "currentColor" : "none"} /></button>
                    </td>
                    <td className="px-1 py-1"><EditableCell value={t.notes || ""} placeholder="クライアントには出ません" onCommit={(v) => commit(t, "notes", v)} /></td>
                    <td className="px-1"><button onClick={() => onDelete(t)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {reorder.line}
      <datalist id="schedule-phases">{PHASES.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="schedule-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}

/** 前の工程（終わってから始める工程）。輪になる組み合わせは選べない */
function DependsPicker({ task, tasks, onChange }) {
  const ids = task.depends_on || [];
  const names = ids.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="w-full min-h-7 rounded border border-transparent px-1.5 py-1 hover:border-slate-200 text-left hover:bg-muted/40 inline-flex items-center gap-1" data-testid="depends-picker">
          {names.length ? <><Link2 className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="break-words leading-snug">{names.map((t) => t.name).join("・")}</span></> : <span className="text-muted-foreground">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 text-xs" align="start">
        <p className="font-semibold mb-1">前の工程（これが終わってから始める）</p>
        <p className="text-muted-foreground mb-2 text-[11px]">前の工程が延びると、この工程も同じ日数のまま後ろへずれます。</p>
        <div className="max-h-60 overflow-y-auto space-y-1">
          {tasks.filter((t) => t.id !== task.id).map((t) => {
            const on = ids.includes(t.id);
            const cyc = !on && wouldCycle(tasks, task.id, t.id);
            const r = taskRange(t);
            return (
              <label key={t.id} className={`flex items-center gap-2 ${cyc ? "opacity-40" : "cursor-pointer"}`} title={cyc ? "この工程のあとに続く工程なので選べません" : ""}>
                <Checkbox checked={on} disabled={cyc} onCheckedChange={() => onChange(on ? ids.filter((x) => x !== t.id) : [...ids, t.id])} />
                <span className="break-words leading-snug">{t.category ? `${t.category}／` : ""}{t.name}</span>
                {r && <span className="ml-auto text-muted-foreground shrink-0">{md(r.end)}まで</span>}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
