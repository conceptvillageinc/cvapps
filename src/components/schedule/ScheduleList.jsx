import { Fragment } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Trash2, ArrowUp, ArrowDown, Link2, Diamond, Plus } from "lucide-react";
import { PHASES, taskRange, diffDays, wouldCycle, categoryTints, md } from "@/lib/schedule";
import { PartyChips } from "./ScheduleTimeline";

/**
 * 工程表のリスト（カテゴリーごとにまとめた表）。その場で編集する。
 * 社内メモ・見込み時間・実績時間は社内だけ（共有リンク・スプレッドシートには出ない）。
 */
export default function ScheduleList({ tasks, parties, users = [], categories = [], onChange, onDelete, onMove, onAddInCategory, memberName }) {
  const tints = categoryTints(tasks);
  const groups = [];
  for (const t of tasks) {
    const c = t.category || "";
    if (!groups.length || groups[groups.length - 1].category !== c) groups.push({ category: c, items: [] });
    groups[groups.length - 1].items.push(t);
  }
  const commit = (t, key, value) => {
    const v = value === "" ? null : value;
    if ((t[key] ?? null) === v) return;
    onChange(t.id, { [key]: v });
  };

  return (
    <div className="overflow-x-auto rounded-md border" data-testid="schedule-list">
      <table className="w-full text-xs table-fixed min-w-[1500px]">
        <thead>
          <tr className="bg-[#1e3a5f] text-white">
            <th className="w-10 px-1 py-1.5 font-medium">完了</th>
            <th className="w-12"></th>
            <th className="text-left px-2 py-1.5 font-medium w-[120px]">カテゴリー</th>
            <th className="text-left px-2 py-1.5 font-medium w-[230px]">タスク名</th>
            <th className="text-left px-2 py-1.5 font-medium w-[96px]">工程</th>
            <th className="text-left px-2 py-1.5 font-medium w-[150px]">担当</th>
            <th className="text-left px-2 py-1.5 font-medium w-[132px]">開始日</th>
            <th className="text-left px-2 py-1.5 font-medium w-[132px]">終了日</th>
            <th className="px-1 py-1.5 font-medium w-10">日数</th>
            <th className="text-left px-2 py-1.5 font-medium w-[150px]">前の工程</th>
            <th className="px-1 py-1.5 font-medium w-14" title="見込み時間（社内のみ）">見込h</th>
            <th className="px-1 py-1.5 font-medium w-14" title="実績時間（社内のみ）">実績h</th>
            <th className="px-1 py-1.5 font-medium w-14 leading-tight" title="クライアント向けの工程表に出す">表に<br />出す</th>
            <th className="px-1 py-1.5 font-medium w-8" title="節目（◆。納品・校了など）">◆</th>
            <th className="text-left px-2 py-1.5 font-medium w-[180px]">社内メモ</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => (
            <Fragment key={`${g.category}-${gi}`}>
              <tr style={{ background: tints.get(g.category) }}>
                <td colSpan={16} className="px-2 py-1 font-semibold text-[11px]">
                  <span>{g.category || "（カテゴリーなし）"}</span>
                  <span className="ml-2 font-normal text-muted-foreground">{g.items.filter((t) => t.completed).length}/{g.items.length} 完了</span>
                  <button className="ml-3 inline-flex items-center gap-0.5 text-primary hover:underline font-normal" onClick={() => onAddInCategory(g.category, g.items[g.items.length - 1])}><Plus className="w-3 h-3" />このカテゴリーに追加</button>
                </td>
              </tr>
              {g.items.map((t) => {
                const i = tasks.indexOf(t);
                const r = taskRange(t);
                return (
                  <tr key={t.id} className={`border-t ${t.completed ? "bg-muted/30" : ""}`} data-testid="schedule-row">
                    <td className="text-center"><Checkbox checked={!!t.completed} onCheckedChange={(v) => onChange(t.id, { completed: !!v, completed_at: v ? new Date().toISOString() : null })} /></td>
                    <td className="px-1 whitespace-nowrap">
                      <button className="text-muted-foreground hover:text-foreground disabled:opacity-20" disabled={i === 0} onClick={() => onMove(i, -1)}><ArrowUp className="w-3 h-3" /></button>
                      <button className="text-muted-foreground hover:text-foreground disabled:opacity-20 ml-0.5" disabled={i === tasks.length - 1} onClick={() => onMove(i, 1)}><ArrowDown className="w-3 h-3" /></button>
                    </td>
                    <td className="px-1 py-1">
                      <Input key={`c${t.id}${t.category}`} list="schedule-categories" defaultValue={t.category || ""} onBlur={(e) => commit(t, "category", e.target.value.trim())} className="h-7 text-xs" />
                    </td>
                    <td className="px-1 py-1"><Input key={`n${t.id}${t.name}`} defaultValue={t.name} onBlur={(e) => e.target.value.trim() && commit(t, "name", e.target.value.trim())} className={`h-7 text-xs ${t.completed ? "line-through text-muted-foreground" : ""}`} /></td>
                    <td className="px-1 py-1"><Input key={`p${t.id}${t.phase}`} list="schedule-phases" defaultValue={t.phase || ""} onBlur={(e) => commit(t, "phase", e.target.value.trim())} className="h-7 text-xs" /></td>
                    <td className="px-1 py-1"><PartyPicker task={t} parties={parties} users={users} memberName={memberName} onChange={(patch) => onChange(t.id, patch)} /></td>
                    <td className="px-1 py-1"><Input key={`s${t.id}${t.start_date}`} type="date" defaultValue={t.start_date || ""} onBlur={(e) => commit(t, "start_date", e.target.value)} className="h-7 text-xs px-1.5" /></td>
                    <td className="px-1 py-1"><Input key={`e${t.id}${t.end_date}`} type="date" defaultValue={t.end_date || ""} disabled={t.is_milestone} onBlur={(e) => commit(t, "end_date", e.target.value)} className="h-7 text-xs px-1.5" /></td>
                    <td className="text-center tabular-nums text-muted-foreground">{r ? diffDays(r.start, r.end) + 1 : ""}</td>
                    <td className="px-1 py-1"><DependsPicker task={t} tasks={tasks} onChange={(ids) => onChange(t.id, { depends_on: ids })} /></td>
                    <td className="px-1 py-1"><Input key={`h${t.id}${t.estimated_hours}`} type="number" min="0" step="0.5" defaultValue={t.estimated_hours ?? ""} onBlur={(e) => commit(t, "estimated_hours", e.target.value === "" ? "" : Number(e.target.value))} className="h-7 text-xs px-1 text-right" /></td>
                    <td className="px-1 py-1"><Input key={`a${t.id}${t.actual_hours}`} type="number" min="0" step="0.5" defaultValue={t.actual_hours ?? ""} onBlur={(e) => commit(t, "actual_hours", e.target.value === "" ? "" : Number(e.target.value))} className="h-7 text-xs px-1 text-right" /></td>
                    <td className="text-center"><Checkbox checked={t.on_schedule !== false} onCheckedChange={(v) => onChange(t.id, { on_schedule: !!v })} /></td>
                    <td className="text-center">
                      <button title="節目（◆）にする" onClick={() => onChange(t.id, { is_milestone: !t.is_milestone, ...(t.is_milestone ? {} : { end_date: t.start_date || t.end_date || null }) })} className={t.is_milestone ? "text-fuchsia-600" : "text-muted-foreground/40 hover:text-muted-foreground"}><Diamond className="w-3.5 h-3.5" fill={t.is_milestone ? "currentColor" : "none"} /></button>
                    </td>
                    <td className="px-1 py-1"><Input key={`m${t.id}${t.notes}`} defaultValue={t.notes || ""} onBlur={(e) => commit(t, "notes", e.target.value)} className="h-7 text-xs" placeholder="クライアントには出ません" /></td>
                    <td className="px-1"><button onClick={() => onDelete(t)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      <datalist id="schedule-phases">{PHASES.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="schedule-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}

/** 担当の区分（複数可）と、CV のメンバー */
function PartyPicker({ task, parties, users, memberName, onChange }) {
  const keys = task.parties || [];
  const members = task.member_ids || [];
  const toggle = (k) => onChange({ parties: keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k] });
  const toggleMember = (id) => onChange({ member_ids: members.includes(id) ? members.filter((x) => x !== id) : [...members, id] });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="w-full min-h-7 rounded border px-1 py-0.5 text-left hover:bg-muted/40" data-testid="party-picker"><PartyChips task={task} parties={parties} memberName={memberName} /></button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2 text-xs" align="start">
        <p className="font-semibold">担当（複数選べます）</p>
        {parties.map((p) => (
          <label key={p.key} className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={keys.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
            <span className="w-3 h-3 rounded-full" style={{ background: p.color }} />{p.label}
          </label>
        ))}
        {keys.filter((k) => !parties.some((p) => p.key === k)).map((k) => (
          <label key={k} className="flex items-center gap-2 cursor-pointer text-muted-foreground"><Checkbox checked onCheckedChange={() => toggle(k)} />{k.replace(/^other:/, "")}（以前の値）</label>
        ))}
        <div className="border-t pt-2 space-y-1.5">
          <p className="font-semibold">CV の担当メンバー</p>
          <div className="max-h-36 overflow-y-auto space-y-1">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 cursor-pointer"><Checkbox checked={members.includes(u.id)} onCheckedChange={() => toggleMember(u.id)} />{u.full_name || u.email}</label>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1 border-t"><Checkbox checked={!!task.show_members} onCheckedChange={(v) => onChange({ show_members: !!v })} />クライアント向けにもメンバー名を出す</label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 前の工程（終わってから始める工程）。輪になる組み合わせは選べない */
function DependsPicker({ task, tasks, onChange }) {
  const ids = task.depends_on || [];
  const names = ids.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="w-full h-7 rounded border px-1.5 text-left truncate hover:bg-muted/40 inline-flex items-center gap-1" data-testid="depends-picker">
          {names.length ? <><Link2 className="w-3 h-3 shrink-0 text-muted-foreground" /><span className="truncate">{names.map((t) => t.name).join("・")}</span></> : <span className="text-muted-foreground">—</span>}
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
                <span className="truncate">{t.category ? `${t.category}／` : ""}{t.name}</span>
                {r && <span className="ml-auto text-muted-foreground shrink-0">{md(r.end)}まで</span>}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
