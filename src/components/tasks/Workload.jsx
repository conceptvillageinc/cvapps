import { Fragment, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, ChevronDown, CalendarOff, ZoomIn, ZoomOut, Check, FolderKanban, Layers } from "lucide-react";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { addDays, weekStart, daysBetween, dayInfo, diffDays, md } from "@/lib/schedule";
import { workload, dailyHoursOf, userLabel, assigneesOf, isPrivateTask } from "@/lib/tasks";
import { useTaskWrites } from "@/lib/useTaskData";
import { UserAvatar } from "@/components/tasks/parts";

const fmtH = (h) => (h ? (Math.round(h * 10) / 10).toString() : "");
const LEFT_W = 264;
const MEMBER_H = 64;
const LANE_H = 46;
const PALETTE = ["#f87171", "#fb923c", "#fbbf24", "#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#94a3b8"];
const hashColor = (id) => PALETTE[[...String(id || "")].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];

/** 日ごとの負荷の曲線（なめらかな面）。ratio は 1 日の稼働時間に対する割合 */
function LoadCurve({ values, dayW, height, over }) {
  const n = values.length;
  if (!n) return null;
  const base = height - 4; const top = 10;
  const y = (r) => base - Math.min(1.25, r) * (base - top) / 1.25;
  const pts = values.map((r, i) => [i * dayW + dayW / 2, r > 0 ? y(r) : base]);
  let d = `M 0 ${base} L ${pts[0][0] - dayW / 2} ${base}`;
  pts.forEach(([x, py], i) => {
    if (i === 0) { d += ` L ${x} ${py}`; return; }
    const [px, ppy] = pts[i - 1]; const cx = (px + x) / 2;
    d += ` C ${cx} ${ppy}, ${cx} ${py}, ${x} ${py}`;
  });
  d += ` L ${n * dayW} ${base} Z`;
  const capY = y(1);
  return (
    <svg className="pointer-events-none absolute inset-0" width={n * dayW} height={height} aria-hidden="true">
      <defs>
        <linearGradient id="wl-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35" /><stop offset="100%" stopColor="#a78bfa" stopOpacity="0.05" /></linearGradient>
      </defs>
      <path d={d} fill="url(#wl-fill)" stroke="#a78bfa" strokeOpacity="0.6" strokeWidth="1.2" />
      {/* 1 日の稼働時間の線（これを超えた日は薄い赤） */}
      <line x1="0" x2={n * dayW} y1={capY} y2={capY} stroke="#fb7185" strokeOpacity="0.35" strokeDasharray="3 4" />
      {values.map((r, i) => (over[i] ? <rect key={i} x={i * dayW + 2} y={0} width={dayW - 4} height={height} rx="6" fill="#fecdd3" fillOpacity="0.45" /> : null))}
    </svg>
  );
}

/** タスクを重ならないように段に分ける（1 日だけのタスクはカードの幅のぶん場所を取る） */
function lanesOf(items, minSpan) {
  const lanes = [];
  return items.map((it) => {
    const end = Math.max(it.e, it.s + minSpan - 1);
    let lane = lanes.findIndex((last) => last < it.s);
    if (lane < 0) { lane = lanes.length; lanes.push(end); } else lanes[lane] = end;
    return { ...it, lane };
  });
}

/**
 * ワークロード（Asana のワークロードに近い形）
 *   メンバーの行: 日ごとの作業時間の合計と、負荷の曲線。1 日の稼働時間を超えた日は薄い赤
 *   メンバーを開く: 案件・社内プロジェクトごとに、タスクを日付の位置にカードで並べる（ドラッグで日付を動かせる）
 *   自分だけ（非公開）のタスクは数えない
 */
export default function Workload({ data, today, onOpenTask }) {
  const { tasks, users, byId } = data;
  const { companyHolidays } = useSystemSettings();
  const writes = useTaskWrites();
  const [from, setFrom] = useState(() => addDays(weekStart(today), -7));
  const [zoom, setZoom] = useState("small"); // small | large
  const dayW = zoom === "large" ? 64 : 46;
  const [open, setOpen] = useState(() => new Set());
  const [dragging, setDragging] = useState(null); // { id, dx }
  const dragRef = useRef(null);
  const to = addDays(from, 34);
  const days = daysBetween(from, to);
  const info = useMemo(() => days.map((d) => dayInfo(d, companyHolidays)), [days, companyHolidays]);
  const load = useMemo(() => workload(tasks, { from, to, holidays: companyHolidays }), [tasks, from, to, companyHolidays]);
  const members = users.filter((u) => u.role !== "guest" || load.has(u.id));
  const undated = tasks.filter((t) => !t.completed && !isPrivateTask(t) && !t.start_date && !t.end_date && assigneesOf(t).length && !t.parent_task_id);
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todayIdx = days.indexOf(today);
  const placeKey = (t) => (t.project_id ? `p:${t.project_id}` : `i:${t.internal_project_id}`);
  const place = (key) => {
    if (key.startsWith("p:")) { const p = byId.projects.get(key.slice(2)); return { label: p ? `${p.client_name ? `${p.client_name}／` : ""}${p.name}` : "案件", color: hashColor(key), Icon: FolderKanban }; }
    const ip = byId.internal.get(key.slice(2)); return { label: ip?.name || "社内プロジェクト", color: ip?.color || "#8b5cf6", Icon: Layers };
  };
  const months = [];
  days.forEach((d, i) => { if (i === 0 || info[i].day === 1) months.push({ i, label: `${info[i].month}月` }); });

  // ドラッグで日付を動かす（横に動かした日数だけ、開始日・期限をずらす）
  const startDrag = (e, t) => {
    if (e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX; let moved = false;
    dragRef.current = { id: t.id, dx: 0 };
    const move = (ev) => { const dx = ev.clientX - x0; if (Math.abs(dx) > 4) moved = true; dragRef.current = { id: t.id, dx }; setDragging({ id: t.id, dx }); };
    const up = async () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const delta = Math.round((dragRef.current?.dx || 0) / dayW);
      setDragging(null); dragRef.current = null;
      if (!moved) { onOpenTask(t.id); return; }
      if (!delta) return;
      const patch = { ...(t.start_date ? { start_date: addDays(t.start_date, delta) } : {}), ...(t.end_date ? { end_date: addDays(t.end_date, delta) } : {}) };
      try { await writes.update(t, patch); toast.success(`「${t.name}」を ${delta > 0 ? `${delta} 日後` : `${-delta} 日前`}に動かしました`); } catch (err) { toast.error("動かせませんでした: " + (err?.message || "")); }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const gridW = days.length * dayW;
  const DayBackdrop = ({ height }) => (
    <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: gridW, height }}>
      {info.map((d, i) => (d.off ? <div key={i} className="absolute inset-y-0 bg-slate-100/80" style={{ left: i * dayW, width: dayW }} /> : null))}
      {todayIdx >= 0 && <div className="absolute inset-y-0 w-px bg-blue-500/70" style={{ left: todayIdx * dayW + dayW / 2 }} />}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="workload">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setFrom(addDays(from, -7))} aria-label="前の週"><ChevronLeft className="w-4 h-4" /></Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setFrom(addDays(weekStart(today), -7))}>今日</Button>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setFrom(addDays(from, 7))} aria-label="次の週"><ChevronRight className="w-4 h-4" /></Button>
        <span className="text-slate-500 ml-1">{md(from)}〜{md(to)}</span>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded bg-violet-300/60" />負荷（1 日の稼働時間に対して）</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded bg-rose-200" />稼働時間を超えた日</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-px bg-blue-500" />今日</span>
        </span>
        <Popover>
          <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-8 gap-1 text-xs" data-testid="workload-undated"><CalendarOff className="w-3.5 h-3.5" />日付なし{undated.length > 0 && <span className="rounded-full bg-slate-200 px-1.5 text-[10px]">{undated.length}</span>}</Button></PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <p className="px-1 pb-1 text-[11px] text-slate-500">期日の入っていない共有のタスク（ワークロードに数えられません）</p>
            {undated.length === 0 ? <p className="px-1 py-3 text-xs text-slate-400">ありません</p> : undated.slice(0, 40).map((t) => (
              <button key={t.id} type="button" onClick={() => onOpenTask(t.id)} className="w-full flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-slate-50">
                <UserAvatar user={byId.users.get(assigneesOf(t)[0])} size={18} /><span className="flex-1 truncate">{t.name}</span>{Number(t.estimated_hours) > 0 && <span className="text-slate-400">{Number(t.estimated_hours)}h</span>}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setZoom(zoom === "small" ? "large" : "small")} data-testid="workload-zoom">
          {zoom === "small" ? <ZoomIn className="w-3.5 h-3.5" /> : <ZoomOut className="w-3.5 h-3.5" />}日（{zoom === "small" ? "小" : "大"}）
        </Button>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm max-h-[calc(100vh-15rem)]">
        <div style={{ width: LEFT_W + gridW }} className="relative">
          {/* 見出し（月・日） */}
          <div className="sticky top-0 z-30 flex bg-white border-b border-slate-200">
            <div className="sticky left-0 z-10 shrink-0 bg-white border-r border-slate-200" style={{ width: LEFT_W }} />
            <div className="relative" style={{ width: gridW, height: 52 }}>
              {months.map((m) => <span key={m.i} className="absolute top-1 text-[11px] text-slate-500 pl-1 border-l border-slate-200" style={{ left: m.i * dayW }}>{m.label}</span>)}
              {info.map((d, i) => (
                <div key={i} className={`absolute bottom-0 flex h-8 flex-col items-center justify-center text-[12px] ${d.off ? "bg-slate-100/80 text-slate-400" : "text-slate-700"} ${i === todayIdx ? "font-bold text-blue-600" : ""}`} style={{ left: i * dayW, width: dayW }}>
                  {d.day}
                  {i === todayIdx && <span className="absolute -bottom-1 h-2 w-2 rounded-full bg-blue-600" />}
                </div>
              ))}
            </div>
          </div>

          {members.map((u) => {
            const row = load.get(u.id);
            const cap = dailyHoursOf(u);
            const totals = days.map((d) => row?.total[d] || 0);
            const ratios = totals.map((h) => (cap ? h / cap : 0));
            const over = totals.map((h) => h > cap + 1e-9);
            const isOpen = open.has(u.id);
            const groups = new Map();
            for (const it of row?.tasks || []) { const k = placeKey(it.task); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
            const sum = totals.reduce((a, b) => a + b, 0);
            const capSum = cap * info.filter((d) => !d.off).length;
            return (
              <Fragment key={u.id}>
                <div className="flex border-b border-slate-200" data-testid="workload-member">
                  <button type="button" onClick={() => toggle(u.id)} className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-3 text-left hover:bg-slate-50" style={{ width: LEFT_W, height: MEMBER_H }}>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                    <UserAvatar user={u} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{u.full_name || userLabel(u)}</span>
                      <span className="block text-[10px] text-slate-500 tabular-nums">1 日 {cap}h ・ この期間 {fmtH(sum) || 0}h / {capSum}h（{capSum ? Math.round((sum / capSum) * 100) : 0}%）</span>
                    </span>
                  </button>
                  <div className="relative bg-slate-50/40" style={{ width: gridW, height: MEMBER_H }}>
                    <DayBackdrop height={MEMBER_H} />
                    <LoadCurve values={ratios} dayW={dayW} height={MEMBER_H} over={over} />
                    {totals.map((h, i) => h > 0 && (
                      <span key={i} className={`absolute top-1/2 -translate-y-1/2 text-center text-[12px] tabular-nums ${over[i] ? "font-bold text-rose-600" : "text-slate-700"}`} style={{ left: i * dayW, width: dayW }} data-over={over[i] ? "1" : undefined}>{fmtH(h)}</span>
                    ))}
                  </div>
                </div>
                {isOpen && [...groups.entries()].map(([k, items]) => {
                  const pl = place(k);
                  const laid = lanesOf(items.map(({ task: t, hours }) => {
                    const s = t.start_date || t.end_date; const e = t.end_date || t.start_date;
                    return { t, hours, s: Math.max(0, diffDays(from, s)), e: Math.min(days.length - 1, diffDays(from, e)), single: s === e, clipL: s < from, clipR: e > to };
                  }).sort((a, b) => a.s - b.s || b.e - a.e), Math.ceil(150 / dayW));
                  const laneCount = Math.max(1, ...laid.map((x) => x.lane + 1));
                  const h = laneCount * LANE_H + 10;
                  return (
                    <div key={k} className="flex border-b border-slate-100">
                      <div className="sticky left-0 z-20 flex shrink-0 items-start gap-2 border-r border-slate-200 bg-white px-3 pt-3 pl-12" style={{ width: LEFT_W, height: h }}>
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ background: `${pl.color}22`, color: pl.color }}><pl.Icon className="w-3 h-3" /></span>
                        <span className="text-[13px] font-medium text-slate-700 leading-tight line-clamp-2">{pl.label}</span>
                      </div>
                      <div className="relative" style={{ width: gridW, height: h }}>
                        <DayBackdrop height={h} />
                        {laid.map(({ t, hours, s, e, single, lane }) => {
                          const total = Object.values(hours).reduce((a, b) => a + b, 0) || Number(t.estimated_hours) || 0;
                          const color = t.priority === "high" ? "#f87171" : pl.color;
                          const dx = dragging?.id === t.id ? dragging.dx : 0;
                          const top = 6 + lane * LANE_H;
                          const done = t.completed;
                          const late = !done && (t.end_date || t.start_date) < today;
                          if (single) {
                            // 1 日だけのタスク: 期限の日にカード（色の帯・時間・名前・期限）
                            return (
                              <div key={t.id} onPointerDown={(ev) => startDrag(ev, t)} title={`${t.name}（${fmtH(total) || "—"} 時間）ドラッグで日付を動かせます`}
                                className={`absolute flex cursor-grab items-center gap-1.5 rounded-md bg-white pr-2 shadow-sm ring-1 ring-slate-200 hover:ring-slate-300 active:cursor-grabbing ${done ? "opacity-50" : ""}`}
                                style={{ left: s * dayW + 4 + dx, top, height: LANE_H - 8, maxWidth: 220, transition: dx ? "none" : "left .15s" }} data-testid="workload-card">
                                <span className="h-full w-1.5 rounded-l-md" style={{ background: color }} />
                                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] font-bold text-white" style={{ background: color }}>{fmtH(total) || "-"}</span>
                                <span className="min-w-0">
                                  <span className={`flex items-center gap-1 truncate text-[12px] ${done ? "line-through text-slate-400" : "text-slate-800"}`}>{done && <Check className="w-3 h-3 text-emerald-600" />}{t.name}</span>
                                  <span className={`block text-[10px] ${late ? "text-rose-600" : "text-slate-400"}`}>{md(t.end_date || t.start_date)} 期限</span>
                                </span>
                              </div>
                            );
                          }
                          return (
                            <div key={t.id} onPointerDown={(ev) => startDrag(ev, t)} title={`${t.name}（${fmtH(total) || "—"} 時間）ドラッグで日付を動かせます`}
                              className={`absolute flex cursor-grab items-center gap-1.5 overflow-hidden rounded-md px-2 text-[12px] font-medium shadow-sm active:cursor-grabbing ${done ? "opacity-50" : ""}`}
                              style={{ left: s * dayW + 3 + dx, width: (e - s + 1) * dayW - 6, top, height: LANE_H - 8, background: done ? "#e2e8f0" : color, color: done ? "#64748b" : "#fff", transition: dx ? "none" : "left .15s" }} data-testid="workload-bar">
                              <span className="rounded bg-white/25 px-1 font-bold tabular-nums">{fmtH(total) || "-"}</span>
                              {done && <Check className="w-3 h-3" />}
                              <span className="truncate">{t.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {isOpen && groups.size === 0 && (
                  <div className="flex border-b border-slate-100"><div className="sticky left-0 shrink-0 bg-white border-r border-slate-200 pl-12 py-3 text-[11px] text-slate-400" style={{ width: LEFT_W }}>この期間に期日の入ったタスクはありません</div><div style={{ width: gridW }} /></div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-slate-400">数字は 1 日の作業時間の合計（作業時間数を期間の営業日に均等に割り振り）。カード・バーは押すとタスクを開き、横にドラッグすると日付を動かせます。自分だけのタスクは数えません</p>
    </div>
  );
}
