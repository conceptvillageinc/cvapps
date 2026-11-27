import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus, Lock, Users, Loader2, Trash2, PanelRightOpen, X, FolderInput } from "lucide-react";
import { MODES, groupIntoSections, orderAt, ordersAt } from "@/lib/taskSections";
import { subtasksOf, isPrivateTask, PRIORITY, choiceCls } from "@/lib/tasks";
import { UserAvatar, TaskCheck, TaskPlaceChip, DueLabel } from "@/components/tasks/parts";
import { useTaskWrites } from "@/lib/useTaskData";
import RangeCalendar from "@/components/tasks/RangeCalendar";
import PlacePicker, { moveTaskPlace } from "@/components/tasks/PlacePicker";

// 表の列（タスク名・予定時間・紐づけ先・公開範囲・優先度・期日・担当）
// 期日は「11/20〜11/26」が入る幅だけにして、そのぶん紐づけ先（案件名）を広く見せる
const gridOf = ({ place, assignee }) => ({ gridTemplateColumns: ["minmax(18rem,1fr)", "4.5rem", place && "minmax(8rem,14.5rem)", "6rem", "4.5rem", "5rem", assignee && "3rem"].filter(Boolean).join(" ") });

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
 *   Enter で保存すると名前に青い枠が付き、もう一度 Enter ですぐ下に新しいタスクの行ができる（↑↓ で枠を上下のタスクへ動かせる）
 *   直している途中に ↓／↑ を押すと、保存して下／上のタスクを直す状態になる
 *   Shift＋↓／↑ で、保存して複数選ぶ（枠の状態からでも同じ）
 *   行のほかの場所を押すと、これまでどおり詳細が開く
 */
/** 名前のどの文字をクリックしたか（文字の位置）。わからなければ最後 */
function clickedOffset(e, text) {
  try {
    const el = e.currentTarget;
    let node = null; let offset = 0;
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); node = p?.offsetNode; offset = p?.offset ?? 0; }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); node = r?.startContainer; offset = r?.startOffset ?? 0; }
    if (node && el.contains(node) && node.nodeType === 3) return Math.min(offset, text.length);
  } catch { /* 古いブラウザ */ }
  return text.length;
}

function InlineTaskName({ task, editing, focused, onStart, onEnd, onFocusEnter, onFocusMove, onFocusLeave, onFocusEscape }) {
  const [v, setV] = useState(task.name || "");
  const ended = useRef(false);
  const textRef = useRef(null);
  const caretAt = useRef(null); // クリックした文字の位置（そこから直せるように）。キーで始めたときは全部選ぶ
  useEffect(() => { if (editing) { setV(task.name || ""); ended.current = false; } }, [editing]);
  useEffect(() => { if (focused && !editing) textRef.current?.focus(); }, [focused, editing]);
  const end = (save, how = null) => {
    if (ended.current) return; // Enter のあとの「外れた」で二重に保存しない
    ended.current = true;
    const name = v.trim();
    onEnd(save && name && name !== task.name ? name : null, how);
  };
  const isTypingEnter = isTypingEnterKey;
  if (editing) {
    return (
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()} onFocus={(e) => {
          const at = caretAt.current; caretAt.current = null;
          if (at === null) { e.target.select(); return; }
          e.target.setSelectionRange(at, at);
        }}
        onKeyDown={(e) => {
          const typing = !e.nativeEvent.isComposing && e.keyCode !== 229; // 変換候補を ↓ で選んでいるときは動かない
          if (isTypingEnter(e)) { e.preventDefault(); end(true, "enter"); }
          else if (typing && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); end(true, (e.shiftKey ? "select-" : "") + (e.key === "ArrowDown" ? "down" : "up")); }
          if (e.key === "Escape") end(false);
        }}
        onBlur={() => end(true)} className="h-7 min-w-0 flex-1 rounded border border-primary/50 bg-white px-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label="タスク名" data-testid="task-name-inline" />
    );
  }
  return (
    <span ref={textRef} tabIndex={-1} onClick={(e) => { e.stopPropagation(); caretAt.current = clickedOffset(e, task.name || ""); onStart(); }} onBlur={onFocusLeave}
      onKeyDown={(e) => {
        if (isTypingEnter(e)) { e.preventDefault(); e.stopPropagation(); onFocusEnter(); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); onFocusMove(e.key === "ArrowDown" ? 1 : -1, e.shiftKey); }
        else if (e.key === "Escape") { onFocusEscape?.(); e.currentTarget.blur(); }
      }}
      title={focused ? "Enter ですぐ下に新しいタスクを足せます（↑↓ で上下のタスクへ・押すと名前を直せます）" : "押すと名前を直せます"}
      className={`min-w-0 whitespace-normal [overflow-wrap:anywhere] rounded px-0.5 -mx-0.5 text-sm leading-snug cursor-text outline-none hover:ring-1 hover:ring-slate-300 hover:bg-white ${focused ? "ring-2 ring-primary/50 bg-primary/5" : ""} ${task.completed ? "line-through text-slate-400" : "text-slate-800"}`} data-testid="task-name-text">{task.name}</span>
  );
}

// 日本語の変換を確定する Enter は数えない（Safari は isComposing が付かないので keyCode も見る）
const isTypingEnterKey = (e) => e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;

/**
 * タスクのすぐ下に足す新しいタスクの行（名前を打って Enter で保存。空のまま Enter で消えて下のタスクを直す状態に、Esc で消える）
 */
function InsertTaskRow({ grid, onSubmit, onCancel }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const finish = async (byEnter) => {
    if (done.current) return;
    const name = v.trim();
    if (!name) { done.current = true; onCancel(byEnter ? "enter" : null); return; }
    done.current = true; setBusy(true);
    try { await onSubmit(name, byEnter); } catch (err) { done.current = false; setBusy(false); toast.error("追加できませんでした: " + (err?.message || "")); }
  };
  return (
    <div style={grid} className="grid items-center border-b border-slate-100 bg-primary/5 px-2" data-testid="task-insert-row">
      <div className="flex items-center gap-1.5 min-w-0 py-2">
        <span className="w-3.5 shrink-0" />
        <span className="inline-block h-[17px] w-[17px] shrink-0 rounded-full border-2 border-slate-300" />
        <input autoFocus value={v} disabled={busy} onChange={(e) => setV(e.target.value)} placeholder="新しいタスクの名前（Enter で保存・Esc でやめる）"
          onKeyDown={(e) => { if (isTypingEnterKey(e)) { e.preventDefault(); finish(true); } if (e.key === "Escape") { done.current = true; onCancel("esc"); } }}
          onBlur={() => finish(false)} className="h-7 min-w-0 flex-1 rounded border border-primary/50 bg-white px-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label="新しいタスクの名前" data-testid="task-insert-input" />
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      </div>
    </div>
  );
}

/** 優先度・確認の札（押すと選べる。同じものをもう一度押すと外す） */
function PillPicker({ map, value, label, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const pick = (k) => { setOpen(false); onChange(value === k ? null : k); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-full px-0.5 hover:ring-1 hover:ring-slate-300" title={`${label}を変える`} data-testid={testId}><Pill map={map} value={value} /></button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-28 p-1.5">
        <p className="px-1 pb-1 text-[10px] font-semibold text-muted-foreground">{label}</p>
        {/* 選択肢は縦に並べる */}
        <div className="flex flex-col gap-1">
          {Object.entries(map).map(([k, v]) => (
            <button key={k} type="button" onClick={() => pick(k)} aria-pressed={value === k} className={`${choiceCls(v, value === k)} text-left !leading-7`}>{value === k && "✓ "}{v.label}</button>
          ))}
          {value && <button type="button" onClick={() => pick(value)} className="rounded px-2 text-left text-xs leading-7 text-muted-foreground hover:bg-muted">外す</button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 期日（押すと 開始日〜期限 を選べる） */
function DuePicker({ task, today, onChange }) {
  const [open, setOpen] = useState(false);
  const setStart = (v) => onChange({ start_date: v || null, ...(task.end_date && v && v > task.end_date ? { end_date: v } : {}) });
  const setEnd = (v) => onChange({ end_date: v || null, ...(task.start_date && v && v < task.start_date ? { start_date: v } : {}) });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded px-0.5 -mx-0.5 text-left hover:bg-white hover:ring-1 hover:ring-slate-300" title="期日を変える" data-testid="task-due"><DueLabel task={task} today={today} /></button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground">期日（開始日〜期限）</p>
        <RangeCalendar start={task.start_date} end={task.end_date} today={today} onChange={onChange} />
        <div className="flex items-center gap-1.5 border-t pt-2">
          <input type="date" value={task.start_date || ""} onChange={(e) => setStart(e.target.value)} className="h-7 w-[7.2rem] rounded border px-1.5 text-xs" aria-label="開始日" data-testid="task-due-start" />
          <span className="text-muted-foreground">〜</span>
          <input type="date" value={task.end_date || ""} onChange={(e) => setEnd(e.target.value)} className="h-7 w-[7.2rem] rounded border px-1.5 text-xs" aria-label="期限" data-testid="task-due-end" />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onChange({ start_date: today, end_date: today })} className="rounded border px-2 py-0.5 text-[11px] hover:bg-muted">今日</button>
          {(task.start_date || task.end_date) && <button type="button" onClick={() => { onChange({ start_date: null, end_date: null }); setOpen(false); }} className="ml-auto text-[11px] text-muted-foreground hover:underline">期日を外す</button>}
        </div>
      </PopoverContent>
    </Popover>
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
function SectionHeader({ group, count, hours, mode, collapsed, onToggle, ops, isFirst, isLast, dragProps, board = false, grip = null }) {
  const [editing, setEditing] = useState(!!group.section?._edit); // 足したばかりの見出しは、すぐ名前を入れられるように
  const [name, setName] = useState(group.section?.name || "");
  const label = group.section ? group.section.name : MODES[mode].noneLabel;
  const commit = () => { setEditing(false); ops.doneEditing?.(group.section); const v = name.trim(); if (v && v !== group.section.name) ops.rename(group.section, v); else setName(group.section.name); };
  return (
    <div className={`group/sec flex items-center gap-1.5 ${board ? "px-1 pb-2" : "px-2 pt-4 pb-1.5"}`} {...dragProps} data-testid="task-section">
      {grip}
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
  // 一覧に見えている順のタスク（たたんだ見出しの中は飛ばす）
  const visibleIds = () => groups.flatMap((g) => ((g.section ? g.section.collapsed : noneCollapsed) ? [] : g.tasks.map((t) => t.id)));
  const addTo = async (g, name) => {
    const row = await onAdd(g.section?.id || null, name, orderAt(g.tasks, g.tasks.length, mode));
    if (row?.id) { setAdded(row.id); setTimeout(() => setAdded((x) => (x === row.id ? null : x)), 2500); }
    return row;
  };
  const groups = groupIntoSections(tasks, sections, mode);
  const keyOf = (g) => g.section?.id || "none";
  const hoursOf = (list) => list.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  // 選んでいるタスク（ドラッグ・Shift＋↑↓・Shift／⌘＋クリックで複数）。つまみをドラッグすると、まとめて動く
  const [selected, setSelected] = useState(() => new Set());
  const [selAnchor, setSelAnchor] = useState(null);
  const clearSel = () => { setSelected(new Set()); setSelAnchor(null); };
  // 動かすタスク（選んだ中のタスクをつかんだら、選んだ全部を一覧の順で）
  const movingOf = (id) => (selected.has(id) && selected.size > 1 ? visibleIds().filter((x) => selected.has(x)) : [id]);
  const moveMany = (ids, g, index) => {
    const list = ids.map((id) => data.byId.tasks.get(id)).filter(Boolean);
    const orders = ordersAt(g.tasks, index, mode, ids, list.length);
    list.forEach((t, k) => onMove(t, g.section?.id || null, orders[k]));
  };
  // 見出しのドラッグ（つまみを持って動かす。中のタスクは見出しについて一緒に動く）
  const [secDrag, setSecDrag] = useState(null); // 動かしている見出しの id
  const [secOver, setSecOver] = useState(null); // 見出しの並び（見出しなしを除く）での入れる位置
  const secList = sections.filter(Boolean).slice().sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const secDragOver = (e, g) => {
    if (!secDrag) return false;
    e.preventDefault();
    let index = 0;
    if (g.section) {
      const k = secList.findIndex((x) => x.id === g.section.id);
      const r = e.currentTarget.getBoundingClientRect();
      index = e.clientY > r.top + r.height / 2 ? k + 1 : k;
    }
    if (secOver !== index) setSecOver(index);
    return true;
  };
  const secDrop = () => {
    const s = secList.find((x) => x.id === secDrag);
    const from = secList.findIndex((x) => x.id === secDrag);
    if (s && secOver !== null && secOver !== from && secOver !== from + 1) {
      const rest = secList.filter((x) => x.id !== secDrag);
      const at = secOver > from ? secOver - 1 : secOver;
      const p = rest[at - 1] ? Number(rest[at - 1].sort_order) : null; const n = rest[at] ? Number(rest[at].sort_order) : null;
      const order = p !== null && n !== null ? (p + n) / 2 : p !== null ? p + 1 : n !== null ? n - 1 : 1;
      ops.reorder?.(s, order);
    }
    setSecDrag(null); setSecOver(null);
  };
  const secGrip = (g) => (!g.section || !ops.reorder ? <span className="invisible -ml-1 shrink-0 p-0.5" aria-hidden><GripVertical className="w-3.5 h-3.5" /></span> : (
    <span draggable onDragStart={(e) => { setSecDrag(g.section.id); clearSel(); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", g.section.name || ""); } catch { /* 古いブラウザ */ } const el = e.currentTarget.closest("section"); if (el) e.dataTransfer.setDragImage(el, 20, 20); }}
      onDragEnd={() => { setSecDrag(null); setSecOver(null); }}
      title="ドラッグで見出しを動かす（中のタスクも一緒に動きます）" className="-ml-1 shrink-0 rounded p-0.5 text-slate-300 opacity-0 group-hover/sec:opacity-100 cursor-grab active:cursor-grabbing hover:bg-slate-200/70 hover:text-slate-500" data-testid="section-grip">
      <GripVertical className="w-3.5 h-3.5" />
    </span>
  ));
  // 離したところ：最後に線を出した位置（over）へ入れる（行の上でなく、すき間や「タスクを追加」の上で離しても動く）
  const drop = () => {
    if (secDrag) { secDrop(); return; }
    const g = over && groups.find((x) => keyOf(x) === over.key);
    if (drag && g) moveMany(movingOf(drag), g, over.index);
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
  const [nameFocus, setNameFocus] = useState(null); // Enter で保存したタスク（青い枠。もう一度 Enter ですぐ下に新しい行）
  const [inserting, setInserting] = useState(null); // すぐ下に新しい行を出しているタスクの id
  const rename = (t, name) => writes.update(t, { name }).catch((e) => toast.error("名前を変えられませんでした: " + (e?.message || "")));
  const save = (t, patch) => writes.update(t, patch).catch((e) => toast.error("保存できませんでした: " + (e?.message || "")));

  const neighborOf = (id, dir) => { const ids = visibleIds(); const i = ids.indexOf(id); return i < 0 ? null : ids[i + dir] ?? null; };
  const rangeOf = (a, b) => { const ids = visibleIds(); let i = ids.indexOf(a); let j = ids.indexOf(b); if (i < 0) i = j; if (i > j) [i, j] = [j, i]; return new Set(ids.slice(i, j + 1)); };
  // Shift＋↑↓：起点（はじめに選んだタスク）から、枠のタスクまでを選ぶ
  const extendSel = (from, dir) => {
    const anchor = selAnchor && selected.has(from) ? selAnchor : from;
    const n = neighborOf(from, dir) || from;
    setSelAnchor(anchor); setSelected(rangeOf(anchor, n)); setNameFocus(n);
  };
  const nameProps = (t) => ({
    editing: renaming === t.id,
    focused: nameFocus === t.id,
    onStart: () => { setNameFocus(null); setRenaming(t.id); },
    onEnd: (name, how) => {
      if (name) rename(t, name);
      if (how === "select-down" || how === "select-up") { setRenaming(null); extendSel(t.id, how === "select-down" ? 1 : -1); return; }
      if (how === "down" || how === "up") {
        const n = neighborOf(t.id, how === "down" ? 1 : -1);
        setRenaming(n); setNameFocus(n ? null : t.id); // いちばん端なら、枠を付けて止まる
        return;
      }
      setRenaming(null);
      setNameFocus(how === "enter" ? t.id : null);
    },
    onFocusEnter: () => { setNameFocus(null); setInserting(t.id); },
    onFocusMove: (dir, shift) => {
      if (shift) { extendSel(t.id, dir); return; }
      clearSel(); const n = neighborOf(t.id, dir); if (n) setNameFocus(n);
    },
    onFocusEscape: clearSel,
    onFocusLeave: () => setNameFocus((x) => (x === t.id ? null : x)),
  });

  // すぐ下に足す（見出しと並び順は、上のタスクと次のタスクのあいだ）
  const insertBelow = async (g, i, name, byEnter) => {
    const row = await onAdd(g.section?.id || null, name, orderAt(g.tasks, i + 1, mode));
    setInserting(null);
    if (row?.id) {
      setAdded(row.id); setTimeout(() => setAdded((x) => (x === row.id ? null : x)), 2500);
      if (byEnter) setNameFocus(row.id); // 続けて Enter で、さらに下に新しい行
    }
  };

  // マウスで行を押したまま上下になぞると、そのあいだを選ぶ（つまみ・ボタン・入力欄から始めたときは選ばない）
  const sweep = useRef(null); // { anchor, moved }
  const swept = useRef(false); // なぞって選んだ直後のクリックは、詳細を開かない
  useEffect(() => {
    const up = () => {
      const s = sweep.current; sweep.current = null;
      if (!s) return;
      document.body.classList.remove("select-none");
      if (s.moved) { swept.current = true; setTimeout(() => { swept.current = false; }, 0); } // 離した直後のクリックだけ止める
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  // 選んでいるときは Esc で外す
  useEffect(() => {
    if (!selected.size) return undefined;
    const key = (e) => { if (e.key === "Escape") clearSel(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected]);
  const rowMouseDown = (e, t) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (e.target.closest("button, input, a, [role=combobox], [data-grip]")) return;
    sweep.current = { anchor: t.id, moved: false };
  };
  const rowMouseEnter = (t) => {
    const s = sweep.current;
    if (!s || (!s.moved && t.id === s.anchor)) return;
    if (!s.moved) { s.moved = true; document.body.classList.add("select-none"); window.getSelection?.().removeAllRanges(); }
    setSelAnchor(s.anchor); setSelected(rangeOf(s.anchor, t.id));
  };
  // Shift＋クリックで範囲、⌘／Ctrl＋クリックで 1 件ずつ足す・外す。ふつうのクリックは選びを外して、これまでどおり
  const rowClickCapture = (e, t) => {
    if (swept.current) { swept.current = false; e.stopPropagation(); e.preventDefault(); return; }
    if (e.target.closest("button, input, [role=combobox], [data-grip]")) return;
    if (e.shiftKey) {
      e.stopPropagation(); e.preventDefault(); window.getSelection?.().removeAllRanges();
      const anchor = selAnchor || nameFocus || t.id;
      setSelAnchor(anchor); setSelected(rangeOf(anchor, t.id));
    } else if (e.metaKey || e.ctrlKey) {
      e.stopPropagation(); e.preventDefault();
      setSelected((old) => { const n = new Set(old); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; });
      setSelAnchor(t.id);
    } else if (selected.size) clearSel();
  };
  const gripDragStart = (e, t) => {
    if (!selected.has(t.id)) clearSel();
    setDrag(t.id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", t.name || ""); } catch { /* 古いブラウザ */ }
    const row = e.currentTarget.closest("[data-testid=task-row]");
    if (row) e.dataTransfer.setDragImage(row, 20, row.offsetHeight / 2);
  };
  const selCount = [...selected].filter((id) => data.byId.tasks.has(id)).length;
  const moveSelTo = (g) => {
    const ids = visibleIds().filter((x) => selected.has(x));
    moveMany(ids, g, g.tasks.length);
    toast.success(`${ids.length} 件を「${g.section?.name || MODES[mode].noneLabel}」へ移しました`);
    clearSel();
  };

  if (view === "board") {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4 items-start" data-testid="task-board">
        {groups.map((g, gi) => (
          <div key={keyOf(g)} className={`w-72 shrink-0 rounded-xl bg-slate-100/80 p-2 ${drag && over?.key === keyOf(g) ? "ring-2 ring-primary/30" : ""}`}
            onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (over?.key !== keyOf(g)) setOver({ key: keyOf(g), index: g.tasks.length }); }} onDrop={(e) => { e.preventDefault(); drop(); }} data-testid="board-column">
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
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto" data-testid="task-list"
      onDragOver={(e) => { if (drag || secDrag) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); drop(); }}>
      <div className="min-w-[900px]">
        {selCount > 0 && (
          // 画面の下に浮かべる（一覧の上に出すと行がずれて、なぞって選ぶ範囲が変わるため）
          <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-xl border border-primary/30 bg-white px-4 py-2.5 text-xs shadow-lg ring-4 ring-primary/10" data-testid="selection-bar">
            <span className="font-semibold text-primary">{selCount} 件を選んでいます</span>
            <span className="hidden md:inline text-slate-500">つまみ（<GripVertical className="inline w-3 h-3 -mt-0.5" />）をドラッグすると、まとめて動かせます</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" data-testid="selection-move"><FolderInput className="w-3.5 h-3.5" />見出しへ移す</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {groups.map((g) => <DropdownMenuItem key={keyOf(g)} className="text-xs" onClick={() => moveSelTo(g)}>{g.section?.name || MODES[mode].noneLabel}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" onClick={clearSel} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" data-testid="selection-clear"><X className="w-3.5 h-3.5" />選択を外す（Esc）</button>
          </div>
        )}
        <div style={grid} className="sticky top-0 z-10 grid items-center border-b border-slate-200 bg-slate-50/90 backdrop-blur px-2 text-[11px] font-medium text-slate-500">
          <span className="py-2 pl-9">タスク名</span><span className="text-right pr-3">予定時間</span>{showPlace && <span>紐づけ先</span>}<span>公開範囲</span><span>優先度</span><span>期日</span>{showAssignee && <span>担当</span>}
        </div>
        {groups.map((g, gi) => {
          const collapsed = g.section ? !!g.section.collapsed : noneCollapsed;
          if (!g.section && g.tasks.length === 0 && groups.length > 1) return null; // 見出しなしが空なら出さない
          return (
            <section key={keyOf(g)} onDragOverCapture={(e) => { if (secDragOver(e, g)) e.stopPropagation(); }} onDragOver={(e) => {
                // 行・見出しの上でないところ（「タスクを追加」・すき間）では、この見出しの一番下に入れる
                if (!drag || e.defaultPrevented) return;
                e.preventDefault();
                const index = collapsed ? 0 : g.tasks.length;
                if (over?.key !== keyOf(g) || over?.index !== index) setOver({ key: keyOf(g), index });
              }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop(); }}
              className={`relative ${secDrag && secDrag === g.section?.id ? "opacity-40" : ""}`}>
              {/* 見出しを入れる位置の線 */}
              {secDrag && g.section && secOver === secList.findIndex((x) => x.id === g.section.id) && <div className="pointer-events-none absolute inset-x-2 top-0 z-10 h-1 rounded-full bg-primary" data-testid="section-drop-line" />}
              {secDrag && g.section && secOver === secList.length && secList[secList.length - 1]?.id === g.section.id && <div className="pointer-events-none absolute inset-x-2 bottom-0 z-10 h-1 rounded-full bg-primary" data-testid="section-drop-line" />}
              <SectionHeader group={g} count={g.tasks.length} hours={hoursOf(g.tasks)} mode={mode} collapsed={collapsed} ops={ops} isFirst={gi <= 1} isLast={gi === groups.length - 1} grip={secGrip(g)}
                onToggle={() => (g.section ? ops.toggle(g.section) : setNoneCollapsed((v) => !v))}
                dragProps={{ onDragOver: (e) => { if (!drag) return; e.preventDefault(); setOver({ key: keyOf(g), index: 0 }); } }} />
              {!collapsed && (
                <div className="border-t border-slate-100">
                  {g.tasks.map((t, i) => {
                    const subs = subtasksOf(data.tasks, t.id);
                    return (
                      <div key={t.id} className="relative">
                        {isOver(g, i) && <div className="pointer-events-none absolute inset-x-2 -top-px h-0.5 bg-primary z-10" />}
                        <div onDragOver={(e) => rowDragOver(e, g, i)} onClick={() => renaming !== t.id && onOpen(t.id)}
                          onMouseDown={(e) => rowMouseDown(e, t)} onMouseEnter={() => rowMouseEnter(t)} onClickCapture={(e) => rowClickCapture(e, t)}
                          style={grid} className={`group/row grid items-center border-b border-slate-100 px-2 cursor-pointer transition-colors duration-700 ${selected.has(t.id) ? "bg-primary/10 hover:bg-primary/15" : added === t.id ? "bg-emerald-50" : "hover:bg-slate-50"} ${drag && movingOf(drag).includes(t.id) ? "opacity-40" : ""}`} data-testid="task-row" data-selected={selected.has(t.id) || undefined}>
                          <div className="relative flex items-start gap-1.5 min-w-0 py-2">{/* 名前が折り返すときは、◯などを 1 行目にそろえる */}
                            {/* つまみ：ここをドラッグすると動かす（選んでいる行なら、選んだ全部） */}
                            <span data-grip draggable={renaming !== t.id} onDragStart={(e) => gripDragStart(e, t)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={(e) => e.stopPropagation()}
                              title={selected.has(t.id) && selCount > 1 ? `ドラッグで選んだ ${selCount} 件をまとめて動かす` : "ドラッグで動かす"}
                              className={`-ml-1 shrink-0 rounded p-0.5 cursor-grab active:cursor-grabbing hover:bg-slate-200/70 ${selected.has(t.id) ? "text-primary/70 opacity-100" : "text-slate-300 opacity-0 group-hover/row:opacity-100"}`} data-testid="task-grip">
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                            <span className="flex shrink-0 pt-px"><TaskCheck done={t.completed} onToggle={(v) => toggleDone(t, v)} size={17} /></span>
                            <InlineTaskName task={t} {...nameProps(t)} />
                            {subs.length > 0 && <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500 tabular-nums" title="サブタスク">{subs.filter((s) => s.completed).length}/{subs.length}</span>}
                            {/* 詳細・削除のボタンは、マウスを乗せたときだけ名前の右上に重ねて出す（名前をボタンの分まで広く使う） */}
                            {renaming !== t.id && (
                              <span className="absolute right-1 top-1.5 z-[1] flex items-center gap-0.5 rounded-md bg-white/95 p-0.5 shadow-sm ring-1 ring-slate-200 opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
                                <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="詳細を開く" aria-label="詳細を開く" data-testid="task-open"><PanelRightOpen className="w-3.5 h-3.5" /></button>
                                {/* ボタン一つで削除（すぐ消して、少しのあいだ「元に戻す」を出す） */}
                                <button type="button" onClick={(e) => { e.stopPropagation(); writes.removeWithUndo(t, data.tasks); }} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="このタスクを削除" aria-label="削除" data-testid="task-delete"><Trash2 className="w-3.5 h-3.5" /></button>
                              </span>
                            )}
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
                          {/* 優先度・確認・期日は、一覧から押して変えられる */}
                          <span onClick={(e) => e.stopPropagation()}><PillPicker map={PRIORITY} value={t.priority} label="優先度" onChange={(v) => save(t, { priority: v })} testId="task-priority" /></span>
                          <span onClick={(e) => e.stopPropagation()}><DuePicker task={t} today={today} onChange={(patch) => save(t, patch)} /></span>
                          {showAssignee && <span><UserAvatar user={data.byId.users.get(t.assignee_id)} size={22} /></span>}
                        </div>
                        {inserting === t.id && (
                          <InsertTaskRow grid={grid} onSubmit={(name, byEnter) => insertBelow(g, i, name, byEnter)}
                            onCancel={(how) => {
                              setInserting(null);
                              // 空のまま Enter：すぐ下のタスクを直す状態に（下が無ければ枠を付けて止まる）。Esc：枠を付けて止まる
                              const n = how === "enter" ? neighborOf(t.id, 1) : null;
                              if (n) { setNameFocus(null); setRenaming(n); } else setNameFocus(how ? t.id : null);
                            }} />
                        )}
                      </div>
                    );
                  })}
                  {isOver(g, g.tasks.length) && <div className="pointer-events-none mx-2 h-0.5 bg-primary" />}
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
