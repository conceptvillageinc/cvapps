import { useState } from "react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus, Lock, Users, Loader2 } from "lucide-react";
import { MODES, groupIntoSections, orderAt } from "@/lib/taskSections";
import { subtasksOf, isPrivateTask, PRIORITY, REVIEW_STATUS } from "@/lib/tasks";
import { UserAvatar, TaskCheck, TaskPlaceChip, DueLabel } from "@/components/tasks/parts";
import { useTaskWrites } from "@/lib/useTaskData";

// 表の列（タスク名・優先度・確認・期日・紐づけ先・公開範囲・予定時間・担当）
const gridOf = ({ place, assignee }) => ({ gridTemplateColumns: ["minmax(18rem,1fr)", "4.5rem", "5rem", "6.5rem", place && "minmax(8rem,13rem)", "6rem", "4.5rem", assignee && "3rem"].filter(Boolean).join(" ") });

function Pill({ map, value }) {
  const v = map[value];
  return v ? <span className={`rounded-full px-2 text-[10px] leading-5 ring-1 whitespace-nowrap ${v.cls}`}>{v.label}</span> : <span className="text-[11px] text-slate-300">—</span>;
}

function Visibility({ task }) {
  return isPrivateTask(task)
    ? <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Lock className="w-3 h-3" />自分だけ</span>
    : <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Users className="w-3 h-3" />共有</span>;
}

/** 見出し（名前はその場で直す・メニューで並べ替え・消す） */
function SectionHeader({ group, count, hours, mode, collapsed, onToggle, ops, isFirst, isLast, dragProps, board = false }) {
  const [editing, setEditing] = useState(!!group.section?._edit); // 足したばかりの見出しは、すぐ名前を入れられるように
  const [name, setName] = useState(group.section?.name || "");
  const label = group.section ? group.section.name : MODES[mode].noneLabel;
  const commit = () => { setEditing(false); ops.doneEditing?.(group.section); const v = name.trim(); if (v && v !== group.section.name) ops.rename(group.section, v); else setName(group.section.name); };
  return (
    <div className={`group/sec flex items-center gap-1.5 ${board ? "px-1 pb-2" : "px-2 pt-4 pb-1.5"}`} {...dragProps} data-testid="task-section">
      {!board && <button type="button" onClick={onToggle} className="rounded p-0.5 text-slate-500 hover:bg-slate-100" aria-label={collapsed ? "開く" : "閉じる"}>{collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>}
      {editing ? (
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) commit(); if (e.key === "Escape") { setName(group.section.name); setEditing(false); } }}
          className="h-7 min-w-[14rem] rounded border border-primary/40 px-2 text-sm font-bold" data-testid="section-rename" />
      ) : (
        <button type="button" onClick={() => group.section && (setName(group.section.name), setEditing(true))} className={`text-sm font-bold text-slate-800 ${group.section ? "hover:underline underline-offset-4 decoration-slate-300" : "cursor-default"}`} title={group.section ? "押すと名前を直せます" : undefined}>{label}</button>
      )}
      <span className="text-[11px] text-slate-400 tabular-nums">{count}{hours > 0 && ` ・ ${Math.round(hours * 10) / 10}h`}</span>
      {group.section && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" className="ml-0.5 rounded p-0.5 text-slate-400 opacity-0 group-hover/sec:opacity-100 hover:bg-slate-100 focus:opacity-100" aria-label="見出しのメニュー" data-testid="section-menu"><MoreHorizontal className="w-4 h-4" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem className="text-xs" onClick={() => { setName(group.section.name); setEditing(true); }}>名前を変える</DropdownMenuItem>
            <DropdownMenuItem className="text-xs" disabled={isFirst} onClick={() => ops.move(group.section, -1)}>{board ? "左へ" : "上へ"}</DropdownMenuItem>
            <DropdownMenuItem className="text-xs" disabled={isLast} onClick={() => ops.move(group.section, 1)}>{board ? "右へ" : "下へ"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs text-destructive" onClick={() => ops.remove(group.section)}>見出しを消す（タスクは「{MODES[mode].noneLabel}」へ）</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function AddLine({ onAdd, board = false, testId }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className={`flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 ${board ? "w-full rounded-lg px-2 py-2 hover:bg-white/70" : "pl-9 py-2"}`} data-testid={testId}>
      <Plus className="w-3.5 h-3.5" />タスクを追加
    </button>
  );
  return (
    <div className={`flex items-center gap-2 ${board ? "rounded-lg bg-white px-2 py-2 shadow-sm ring-1 ring-slate-200" : "pl-9 pr-2 py-1.5 border-b border-slate-100"}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <TaskCheck done={false} size={16} />}
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="タスク名を入れて Enter（Esc でやめる）" className="flex-1 text-sm bg-transparent focus:outline-none" data-testid={`${testId}-input`}
        onBlur={() => !v.trim() && setOpen(false)}
        onKeyDown={async (e) => {
          if (e.key === "Escape") { setV(""); setOpen(false); }
          if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) { setBusy(true); try { await onAdd(v.trim()); setV(""); } catch (err) { toast.error("追加できませんでした: " + (err?.message || "")); } finally { setBusy(false); } }
        }} />
    </div>
  );
}

/**
 * タスクのリスト（表）とボード。見出し（セクション）ごとに分け、名前・並び順は自由に変えられる。
 *   ドラッグで並べ替え・ほかの見出しへ移せる。
 * @param {"my"|"internal"} mode
 */
export default function TaskSectionList({ mode, tasks, sections, data, today, view = "list", onOpen, onAdd, onMove, ops, showAssignee = false }) {
  const showPlace = mode === "my"; // 社内プロジェクトの中では、紐づけ先はいつも同じなので出さない
  const writes = useTaskWrites();
  const [drag, setDrag] = useState(null); // 動かしているタスクの id
  const [over, setOver] = useState(null); // { key, index }
  const [noneCollapsed, setNoneCollapsed] = useState(false);
  const groups = groupIntoSections(tasks, sections, mode);
  const keyOf = (g) => g.section?.id || "none";
  const hoursOf = (list) => list.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  const drop = (g) => {
    const t = data.byId.tasks.get(drag);
    if (t && over) onMove(t, g.section?.id || null, orderAt(g.tasks, over.index, mode, t.id));
    setDrag(null); setOver(null);
  };
  const rowDragOver = (e, g, i) => {
    if (!drag) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const index = e.clientY > r.top + r.height / 2 ? i + 1 : i;
    if (over?.key !== keyOf(g) || over?.index !== index) setOver({ key: keyOf(g), index });
  };
  const isOver = (g, i) => drag && over && over.key === keyOf(g) && over.index === i;
  const toggleDone = (t, v) => writes.update(t, { completed: v, completed_at: v ? new Date().toISOString() : null });

  if (view === "board") {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4 items-start" data-testid="task-board">
        {groups.map((g, gi) => (
          <div key={keyOf(g)} className={`w-72 shrink-0 rounded-xl bg-slate-100/80 p-2 ${drag && over?.key === keyOf(g) ? "ring-2 ring-primary/30" : ""}`}
            onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (over?.key !== keyOf(g)) setOver({ key: keyOf(g), index: g.tasks.length }); }} onDrop={(e) => { e.preventDefault(); drop(g); }} data-testid="board-column">
            <SectionHeader board group={g} count={g.tasks.length} hours={hoursOf(g.tasks)} mode={mode} ops={ops} isFirst={gi <= 1} isLast={gi === groups.length - 1} />
            <div className="space-y-2 min-h-8">
              {g.tasks.map((t, i) => {
                const subs = subtasksOf(data.tasks, t.id);
                return (
                  <div key={t.id}>
                    {isOver(g, i) && <div className="h-1 rounded-full bg-primary mb-2" />}
                    <div draggable onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onDragOver={(e) => rowDragOver(e, g, i)} onClick={() => onOpen(t.id)}
                      className={`cursor-pointer rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-slate-200 hover:ring-primary/40 hover:shadow transition ${drag === t.id ? "opacity-40" : ""}`} data-testid="board-card">
                      <div className="flex items-start gap-2">
                        <span className="pt-0.5"><TaskCheck done={t.completed} onToggle={(v) => toggleDone(t, v)} size={16} /></span>
                        <p className={`flex-1 text-sm leading-snug ${t.completed ? "line-through text-slate-400" : "text-slate-800"}`}>{t.name}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
                        <Pill map={PRIORITY} value={t.priority} />
                        {t.review_status && <Pill map={REVIEW_STATUS} value={t.review_status} />}
                        {showPlace && <TaskPlaceChip task={t} byId={data.byId} />}
                      </div>
                      <div className="mt-2 flex items-center gap-2 pl-6 text-[11px] text-slate-400">
                        <DueLabel task={t} today={today} />
                        {Number(t.estimated_hours) > 0 && <span className="tabular-nums">{Number(t.estimated_hours)}h</span>}
                        {subs.length > 0 && <span className="tabular-nums">☑ {subs.filter((s) => s.completed).length}/{subs.length}</span>}
                        <span className="ml-auto"><UserAvatar user={data.byId.users.get(t.assignee_id)} size={20} /></span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {isOver(g, g.tasks.length) && <div className="h-1 rounded-full bg-primary" />}
            </div>
            <AddLine board onAdd={(name) => onAdd(g.section?.id || null, name, orderAt(g.tasks, g.tasks.length, mode))} testId="board-add" />
          </div>
        ))}
        <button type="button" onClick={() => ops.add()} className="w-60 shrink-0 rounded-xl border-2 border-dashed border-slate-200 py-6 text-sm text-slate-400 hover:border-slate-300 hover:text-slate-600" data-testid="section-add">
          <Plus className="inline w-4 h-4 mr-1" />見出しを追加
        </button>
      </div>
    );
  }

  const grid = gridOf({ place: showPlace, assignee: showAssignee });
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto" data-testid="task-list">
      <div className="min-w-[900px]">
        <div style={grid} className="sticky top-0 z-10 grid items-center border-b border-slate-200 bg-slate-50/90 backdrop-blur px-2 text-[11px] font-medium text-slate-500">
          <span className="py-2 pl-9">タスク名</span><span>優先度</span><span>確認</span><span>期日</span>{showPlace && <span>紐づけ先</span>}<span>公開範囲</span><span className="text-right pr-2">予定時間</span>{showAssignee && <span>担当</span>}
        </div>
        {groups.map((g, gi) => {
          const collapsed = g.section ? !!g.section.collapsed : noneCollapsed;
          if (!g.section && g.tasks.length === 0 && groups.length > 1) return null; // 見出しなしが空なら出さない
          return (
            <section key={keyOf(g)} onDragOver={(e) => { if (drag && g.tasks.length === 0) { e.preventDefault(); setOver({ key: keyOf(g), index: 0 }); } }} onDrop={(e) => { e.preventDefault(); drop(g); }}>
              <SectionHeader group={g} count={g.tasks.length} hours={hoursOf(g.tasks)} mode={mode} collapsed={collapsed} ops={ops} isFirst={gi <= 1} isLast={gi === groups.length - 1}
                onToggle={() => (g.section ? ops.toggle(g.section) : setNoneCollapsed((v) => !v))}
                dragProps={{ onDragOver: (e) => { if (!drag) return; e.preventDefault(); setOver({ key: keyOf(g), index: 0 }); } }} />
              {!collapsed && (
                <div className="border-t border-slate-100">
                  {g.tasks.map((t, i) => {
                    const subs = subtasksOf(data.tasks, t.id);
                    return (
                      <div key={t.id} className="relative">
                        {isOver(g, i) && <div className="absolute inset-x-2 -top-px h-0.5 bg-primary z-10" />}
                        <div draggable onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onDragOver={(e) => rowDragOver(e, g, i)} onClick={() => onOpen(t.id)}
                          style={grid} className={`group/row grid items-center border-b border-slate-100 px-2 hover:bg-slate-50 cursor-pointer ${drag === t.id ? "opacity-40" : ""}`} data-testid="task-row">
                          <div className="flex items-center gap-1.5 min-w-0 py-2">
                            <GripVertical className="w-3.5 h-3.5 shrink-0 text-slate-300 opacity-0 group-hover/row:opacity-100 cursor-grab" />
                            <TaskCheck done={t.completed} onToggle={(v) => toggleDone(t, v)} size={17} />
                            <span className={`truncate text-sm ${t.completed ? "line-through text-slate-400" : "text-slate-800"}`}>{t.name}</span>
                            {subs.length > 0 && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500 tabular-nums" title="サブタスク">{subs.filter((s) => s.completed).length}/{subs.length}</span>}
                          </div>
                          <span><Pill map={PRIORITY} value={t.priority} /></span>
                          <span><Pill map={REVIEW_STATUS} value={t.review_status} /></span>
                          <DueLabel task={t} today={today} />
                          {showPlace && <span className="min-w-0 pr-2 overflow-hidden">{isPrivateTask(t) && !t.parent_task_id ? <span className="text-[11px] text-slate-300">—</span> : <TaskPlaceChip task={t.parent_task_id ? data.byId.tasks.get(t.parent_task_id) || t : t} byId={data.byId} className="!max-w-full" />}</span>}
                          <Visibility task={t} />
                          <span className="text-right pr-2 text-xs tabular-nums text-slate-600">{Number(t.estimated_hours) > 0 ? `${Number(t.estimated_hours)}h` : ""}</span>
                          {showAssignee && <span><UserAvatar user={data.byId.users.get(t.assignee_id)} size={22} /></span>}
                        </div>
                      </div>
                    );
                  })}
                  {isOver(g, g.tasks.length) && <div className="mx-2 h-0.5 bg-primary" />}
                  <AddLine onAdd={(name) => onAdd(g.section?.id || null, name, orderAt(g.tasks, g.tasks.length, mode))} testId="list-add" />
                </div>
              )}
            </section>
          );
        })}
        <button type="button" onClick={() => ops.add()} className="flex items-center gap-1.5 px-4 py-3 text-sm text-slate-500 hover:text-slate-800" data-testid="section-add"><Plus className="w-4 h-4" />見出しを追加</button>
      </div>
    </div>
  );
}
