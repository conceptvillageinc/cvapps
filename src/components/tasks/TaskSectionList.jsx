import { useRef, useState } from "react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus, Lock, Users, Loader2, Trash2, PanelRightOpen } from "lucide-react";
import { MODES, groupIntoSections, orderAt } from "@/lib/taskSections";
import { subtasksOf, isPrivateTask, PRIORITY, REVIEW_STATUS } from "@/lib/tasks";
import { UserAvatar, TaskCheck, TaskPlaceChip, DueLabel } from "@/components/tasks/parts";
import { useTaskWrites } from "@/lib/useTaskData";
import PlacePicker, { moveTaskPlace } from "@/components/tasks/PlacePicker";

// 表の列（タスク名・予定時間・紐づけ先・公開範囲・優先度・確認・期日・担当）
const gridOf = ({ place, assignee }) => ({ gridTemplateColumns: ["minmax(18rem,1fr)", "4.5rem", place && "minmax(8rem,13rem)", "6rem", "4.5rem", "5rem", "6.5rem", assignee && "3rem"].filter(Boolean).join(" ") });

function Pill({ map, value }) {
  const v = map[value];
  return v ? <span className={`rounded-full px-2 text-[10px] leading-5 ring-1 whitespace-nowrap ${v.cls}`}>{v.label}</span> : <span className="text-[11px] text-slate-300">—</span>;
}

function Visibility({ task }) {
  return isPrivateTask(task)
    ? <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Lock className="w-3 h-3" />自分だけ</span>
    : <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Users className="w-3 h-3" />共有</span>;
}

/**
 * タスク名（押すとその場で直せる。Enter か外を押すと保存、Esc でやめる）
 *   行のほかの場所を押すと、これまでどおり詳細が開く
 */
function InlineTaskName({ task, onSave, onEditing }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(task.name || "");
  const start = (e) => { e.stopPropagation(); setV(task.name || ""); setEditing(true); onEditing?.(true); };
  const end = (save) => {
    setEditing(false); onEditing?.(false);
    const name = v.trim();
    if (save && name && name !== task.name) onSave(name);
  };
  if (editing) {
    return (
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()} onFocus={(e) => e.target.select()}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); end(true); } if (e.key === "Escape") end(false); }}
        onBlur={() => end(true)} className="h-7 min-w-0 flex-1 rounded border border-primary/50 bg-white px-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label="タスク名" data-testid="task-name-inline" />
    );
  }
  return (
    <span onClick={start} title="押すと名前を直せます" className={`min-w-0 truncate rounded px-0.5 -mx-0.5 text-sm cursor-text hover:ring-1 hover:ring-slate-300 hover:bg-white ${task.completed ? "line-through text-slate-400" : "text-slate-800"}`} data-testid="task-name-text">{task.name}</span>
  );
}

/** 予定時間（押すとその場で入れられる。空にすると消える） */
function InlineHours({ task, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const cur = Number(task.estimated_hours) > 0 ? Number(task.estimated_hours) : null;
  const end = (save) => {
    setEditing(false);
    if (!save) return;
    const s = String(v).trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[hH時間]/g, "");
    const n = s === "" ? null : Number(s);
    if (n !== null && (!Number.isFinite(n) || n < 0)) { toast.error("予定時間は数字で入れてください"); return; }
    const next = n === null || n === 0 ? null : Math.round(n * 100) / 100;
    if (next !== cur) onSave(next);
  };
  if (editing) {
    return (
      <span className="flex justify-end pr-1" onClick={(e) => e.stopPropagation()}>
        <input autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); end(true); } if (e.key === "Escape") end(false); }}
          onBlur={() => end(true)} className="h-7 w-14 rounded border border-primary/50 bg-white px-1.5 text-right text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label="予定時間（時間）" data-testid="task-hours-inline" />
      </span>
    );
  }
  return (
    <span className="flex justify-end pr-1">
      <button type="button" onClick={(e) => { e.stopPropagation(); setV(cur ?? ""); setEditing(true); }} title="押すと予定時間を入れられます（時間）"
        className={`h-7 min-w-[2.75rem] rounded px-1.5 text-right text-xs tabular-nums hover:bg-white hover:ring-1 hover:ring-slate-300 ${cur ? "text-slate-600" : "text-slate-300"}`} data-testid="task-hours">
        {cur ? `${cur}h` : "—"}
      </button>
    </span>
  );
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

/**
 * 「タスクを追加」。名前を入れて Enter（または「追加」・枠の外をクリック）で 1 件追加して閉じる。
 *   続けて入力の欄は出さない（足したタスクは一覧の中で少しのあいだ色が付く）。Esc・「やめる」で何も足さずに閉じる
 */
export function AddLine({ onAdd, board = false, testId }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const close = () => { setV(""); setOpen(false); };
  const submit = async () => {
    const name = v.trim();
    if (!name) { close(); return; }
    if (sending.current) return;
    sending.current = true; setBusy(true);
    try { await onAdd(name); close(); } catch (err) { toast.error("追加できませんでした: " + (err?.message || "")); } finally { sending.current = false; setBusy(false); }
  };
  if (!open) return (
    // ＋ は、上の行の ◯（完了のチェック）と同じ位置・同じ幅にそろえる（下に紐づくタスクに見えないように）
    <button type="button" onClick={() => setOpen(true)} className={`flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 ${board ? "w-full rounded-lg px-2.5 py-2 hover:bg-white/70" : "pl-7 py-2"}`} data-testid={testId}>
      <span className={`inline-flex shrink-0 items-center justify-center ${board ? "w-4" : "w-[17px]"}`}><Plus className="w-3.5 h-3.5" /></span>タスクを追加
    </button>
  );
  const keep = (e) => e.preventDefault(); // ボタンを押したときに入力欄の blur で先に保存しないように
  return (
    <div className={`flex items-center gap-1.5 ${board ? "flex-wrap rounded-lg bg-white px-2.5 py-2 shadow-sm ring-2 ring-primary/30" : "pl-7 pr-2 py-1.5 border-b border-slate-100 bg-blue-50/40"}`} data-testid={`${testId}-editor`}>
      {busy ? <span className={`inline-flex shrink-0 justify-center ${board ? "w-4" : "w-[17px]"}`}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></span> : <TaskCheck done={false} size={board ? 16 : 17} />}
      <input autoFocus value={v} disabled={busy} onChange={(e) => setV(e.target.value)} placeholder="タスク名" className="flex-1 min-w-[8rem] text-sm bg-transparent focus:outline-none" data-testid={`${testId}-input`}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); close(); }
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
        }} />
      <span className="hidden sm:inline text-[10px] text-slate-400">Enter で追加・Esc でやめる</span>
      <button type="button" onMouseDown={keep} onClick={submit} disabled={!v.trim() || busy} className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40" data-testid={`${testId}-save`}>追加</button>
      <button type="button" onMouseDown={keep} onClick={close} className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100">やめる</button>
    </div>
  );
}

/**
 * タスクのリスト（表）とボード。見出し（セクション）ごとに分け、名前・並び順は自由に変えられる。
 *   ドラッグで並べ替え・ほかの見出しへ移せる。
 * @param {"my"|"internal"} mode
 */
export default function TaskSectionList({ mode, tasks, sections, data, today, view = "list", onOpen, onAdd, onMove, ops, showAssignee = false }) {
  const showPlace = mode === "my"; // プロジェクトの中では、紐づけ先はいつも同じなので出さない
  const writes = useTaskWrites();
  const [drag, setDrag] = useState(null); // 動かしているタスクの id
  const [over, setOver] = useState(null); // { key, index }
  const [noneCollapsed, setNoneCollapsed] = useState(false);
  const [added, setAdded] = useState(null); // 足したばかりのタスク（少しのあいだ色を付ける）
  const addTo = async (g, name) => {
    const row = await onAdd(g.section?.id || null, name, orderAt(g.tasks, g.tasks.length, mode));
    if (row?.id) { setAdded(row.id); setTimeout(() => setAdded((x) => (x === row.id ? null : x)), 2500); }
    return row;
  };
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
  const [renaming, setRenaming] = useState(null); // 名前を直しているタスク（そのあいだは行をドラッグさせない）
  const rename = (t, name) => writes.update(t, { name }).catch((e) => toast.error("名前を変えられませんでした: " + (e?.message || "")));

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
                      className={`cursor-pointer rounded-lg p-2.5 shadow-sm ring-1 hover:ring-primary/40 hover:shadow transition-colors duration-700 ${added === t.id ? "bg-emerald-50 ring-emerald-300" : "bg-white ring-slate-200"} ${drag === t.id ? "opacity-40" : ""}`} data-testid="board-card">
                      <div className="group/card flex items-start gap-2">
                        <span className="pt-0.5"><TaskCheck done={t.completed} onToggle={(v) => toggleDone(t, v)} size={16} /></span>
                        <p className={`flex-1 text-sm leading-snug ${t.completed ? "line-through text-slate-400" : "text-slate-800"}`}>{t.name}</p>
                        <button type="button" onClick={(e) => { e.stopPropagation(); writes.removeWithUndo(t, data.tasks); }} className="shrink-0 rounded p-0.5 text-slate-300 opacity-0 group-hover/card:opacity-100 hover:bg-rose-50 hover:text-rose-600" title="このタスクを削除" aria-label="削除" data-testid="card-delete"><Trash2 className="w-3.5 h-3.5" /></button>
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
            <AddLine board onAdd={(name) => addTo(g, name)} testId="board-add" />
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
          <span className="py-2 pl-9">タスク名</span><span className="text-right pr-3">予定時間</span>{showPlace && <span>紐づけ先</span>}<span>公開範囲</span><span>優先度</span><span>確認</span><span>期日</span>{showAssignee && <span>担当</span>}
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
                        <div draggable={renaming !== t.id} onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onDragOver={(e) => rowDragOver(e, g, i)} onClick={() => renaming !== t.id && onOpen(t.id)}
                          style={grid} className={`group/row grid items-center border-b border-slate-100 px-2 hover:bg-slate-50 cursor-pointer transition-colors duration-700 ${added === t.id ? "bg-emerald-50" : ""} ${drag === t.id ? "opacity-40" : ""}`} data-testid="task-row">
                          <div className="flex items-center gap-1.5 min-w-0 py-2">
                            <GripVertical className="w-3.5 h-3.5 shrink-0 text-slate-300 opacity-0 group-hover/row:opacity-100 cursor-grab" />
                            <TaskCheck done={t.completed} onToggle={(v) => toggleDone(t, v)} size={17} />
                            <InlineTaskName task={t} onSave={(name) => rename(t, name)} onEditing={(on) => setRenaming(on ? t.id : null)} />
                            {subs.length > 0 && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500 tabular-nums" title="サブタスク">{subs.filter((s) => s.completed).length}/{subs.length}</span>}
                            {/* ボタン一つで削除（すぐ消して、少しのあいだ「元に戻す」を出す） */}
                            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }} className="ml-auto shrink-0 rounded p-1 text-slate-300 opacity-0 group-hover/row:opacity-100 hover:bg-slate-100 hover:text-slate-700 focus:opacity-100" title="詳細を開く" aria-label="詳細を開く" data-testid="task-open"><PanelRightOpen className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); writes.removeWithUndo(t, data.tasks); }} className="mr-1 shrink-0 rounded p-1 text-slate-300 opacity-0 group-hover/row:opacity-100 hover:bg-rose-50 hover:text-rose-600 focus:opacity-100" title="このタスクを削除" aria-label="削除" data-testid="task-delete"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                          <InlineHours task={t} onSave={(h) => writes.update(t, { estimated_hours: h }).catch((e) => toast.error("予定時間を保存できませんでした: " + (e?.message || "")))} />
                          {showPlace && (
                            // 一覧から紐づけ先を選べる（サブタスクは親と同じなので、親の紐づけ先を出すだけ）
                            <span className="min-w-0 pr-2 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                              {t.parent_task_id
                                ? <TaskPlaceChip task={data.byId.tasks.get(t.parent_task_id) || t} byId={data.byId} className="!max-w-full" />
                                : <PlacePicker compact task={t} projects={data.projects} internalProjects={data.internalProjects} byId={data.byId} onChange={(patch) => moveTaskPlace(writes, t, data.tasks, patch)} />}
                            </span>
                          )}
                          <Visibility task={t} />
                          <span><Pill map={PRIORITY} value={t.priority} /></span>
                          <span><Pill map={REVIEW_STATUS} value={t.review_status} /></span>
                          <DueLabel task={t} today={today} />
                          {showAssignee && <span><UserAvatar user={data.byId.users.get(t.assignee_id)} size={22} /></span>}
                        </div>
                      </div>
                    );
                  })}
                  {isOver(g, g.tasks.length) && <div className="mx-2 h-0.5 bg-primary" />}
                  <AddLine onAdd={(name) => addTo(g, name)} testId="list-add" />
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
