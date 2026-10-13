import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, dayInfo, daysBetween, diffDays, taskRange, partyOf, partyText, categoryTints, scheduleBounds, weekStart, md, jpDate, parseYmd, WEEKDAYS } from "@/lib/schedule";

const mdw = (s) => `${md(s)}（${WEEKDAYS[parseYmd(s).getDay()]}）`;

const ROW_H = 36;
const HEAD_H = 54;

/**
 * 工程表のタイムライン（ガント）。社内の画面と、クライアント向けの共有リンクの両方で使う。
 *   日単位・週単位を切り替えられる。土日・祝日・会社の休業日は灰色、大事な日（納品期限など）は赤。
 *   editable なら棒をドラッグして日付を動かせる（端をつかむと開始日・終了日だけ）。
 *   前の工程は矢印で結ぶ。
 * @param {object} p
 * @param {object[]} p.tasks
 * @param {object[]} p.parties     担当の区分 [{ key, label, color }]
 * @param {object[]} p.keyDates    大事な日 [{ label, date }]
 * @param {Set<string>} [p.holidays] 会社の休業日
 * @param {"day"|"week"} p.scale
 * @param {"mini"|"compact"|"standard"|"full"} [p.columns]  左の列（mini: タスク名だけ（スマホ） / compact: タスク名・担当 / standard: ＋カテゴリー / full: カテゴリー・タスク名・工程・担当・開始日・終了日）
 * @param {(id, patch) => void} [p.onChange]
 * @param {(id) => string} [p.memberName]
 * @param {(id) => void} [p.onSelect]
 */
export default function ScheduleTimeline({ tasks, parties, keyDates = [], holidays = null, scale = "day", columns = "compact", editable = false, onChange, memberName = () => "", onSelect, today }) {
  const colW = scale === "week" ? 14 : 30;
  const bounds = useMemo(() => {
    const b = scheduleBounds(tasks, keyDates, { today, padDays: scale === "week" ? 7 : 2 });
    return scale === "week" ? { from: weekStart(b.from), to: addDays(weekStart(b.to), 6) } : b;
  }, [tasks, keyDates, scale, today]);
  const days = useMemo(() => daysBetween(bounds.from, bounds.to).map((d) => dayInfo(d, holidays)), [bounds, holidays]);
  const keyMap = useMemo(() => new Map(keyDates.map((k) => [k.date, k.label])), [keyDates]);
  const tints = useMemo(() => categoryTints(tasks), [tasks]);
  const gridW = days.length * colW;
  const idx = (d) => diffDays(bounds.from, d);

  // ドラッグ中の見た目（保存は離したとき）
  const [drag, setDrag] = useState(null); // { id, mode: move|start|end, x0, delta }
  const dragRef = useRef(null);
  const startDrag = (e, t, mode) => {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    const d = { id: t.id, mode, x0: e.clientX, delta: 0 };
    dragRef.current = d; setDrag(d);
    const move = (ev) => { const nd = { ...dragRef.current, delta: Math.round((ev.clientX - dragRef.current.x0) / colW) }; dragRef.current = nd; setDrag(nd); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const fin = dragRef.current; dragRef.current = null; setDrag(null);
      if (!fin || fin.delta === 0) return;
      const r = taskRange(t);
      if (!r) return;
      let s = r.start; let en = r.end;
      if (fin.mode === "move") { s = addDays(s, fin.delta); en = addDays(en, fin.delta); }
      else if (fin.mode === "start") { s = addDays(s, fin.delta); if (s > en) s = en; }
      else { en = addDays(en, fin.delta); if (en < s) en = s; }
      onChange?.(t.id, { start_date: s, end_date: t.is_milestone ? s : en });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const rangeOf = (t) => {
    const r = taskRange(t);
    if (!r) return null;
    if (!drag || drag.id !== t.id) return r;
    if (drag.mode === "move") return { start: addDays(r.start, drag.delta), end: addDays(r.end, drag.delta) };
    if (drag.mode === "start") { const s = addDays(r.start, drag.delta); return { start: s > r.end ? r.end : s, end: r.end }; }
    const e = addDays(r.end, drag.delta); return { start: r.start, end: e < r.start ? r.start : e };
  };

  // 月の見出し（日単位）／週の見出し（週単位）
  const months = [];
  for (const d of days) {
    const key = `${d.year}-${d.month}`;
    if (!months.length || months[months.length - 1].key !== key) months.push({ key, label: `${d.year}年${d.month}月`, n: 0 });
    months[months.length - 1].n++;
  }
  const weeks = [];
  if (scale === "week") for (let i = 0; i < days.length; i += 7) weeks.push(days[i]);

  const leftCols = columns === "full"
    ? [{ key: "category", label: "カテゴリー", w: 96 }, { key: "name", label: "タスク名", w: 180 }, { key: "phase", label: "工程", w: 64 }, { key: "party", label: "担当", w: 120 }, { key: "start", label: "開始日", w: 78 }, { key: "end", label: "終了日", w: 78 }]
    : columns === "standard"
      ? [{ key: "category", label: "カテゴリー", w: 92 }, { key: "name", label: "タスク名", w: 190 }, { key: "party", label: "担当", w: 120 }]
      : columns === "mini"
        ? [{ key: "name", label: "タスク名", w: 128 }]
        : [{ key: "name", label: "タスク名", w: 150 }, { key: "party", label: "担当", w: 86 }];
  const leftW = leftCols.reduce((s, c) => s + c.w, 0);
  const todayX = today && today >= bounds.from && today <= bounds.to ? idx(today) * colW + colW / 2 : null;
  const rowIndex = new Map(tasks.map((t, i) => [t.id, i]));
  // 開いたとき・日／週を切り替えたときは、今日の少し前から見せる
  const boxRef = useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !today || today < bounds.from || today > bounds.to) return;
    el.scrollLeft = Math.max(0, (diffDays(bounds.from, today) - (scale === "week" ? 7 : 2)) * colW);
  }, [scale]);
  const rowFirst = (t) => { const i = rowIndex.get(t.id); return i === 0 || (tasks[i - 1].category || "") !== (t.category || ""); };

  return (
    <div ref={boxRef} className="overflow-auto rounded-md border bg-white max-h-[70vh]" data-testid="schedule-timeline">
      <div className="relative" style={{ width: leftW + gridW }}>
        {/* 見出し */}
        <div className="sticky top-0 z-20 flex" style={{ height: HEAD_H }}>
          <div className="sticky left-0 z-30 flex bg-[#1e3a5f] text-white text-[11px] font-semibold" style={{ width: leftW }}>
            {leftCols.map((c) => <div key={c.key} className="flex items-center justify-center border-r border-white/20" style={{ width: c.w }}>{c.label}</div>)}
          </div>
          <div className="relative bg-[#24205e] text-white" style={{ width: gridW }}>
            <div className="flex h-[22px] text-[11px] font-semibold">
              {months.map((m) => <div key={m.key} className="flex items-center justify-start pl-2 border-r border-white/30 overflow-hidden whitespace-nowrap" style={{ width: m.n * colW }}>{m.n * colW > 70 ? m.label : m.label.slice(5)}</div>)}
            </div>
            {scale === "day" ? (
              <div className="flex h-[32px] text-[10px]">
                {days.map((d) => {
                  const key = keyMap.get(d.date);
                  return (
                    <div key={d.date} title={key ? `${key}（${jpDate(d.date)}）` : jpDate(d.date)} className={`flex flex-col items-center justify-center border-r border-white/20 leading-tight ${key ? "bg-red-600" : d.off ? "bg-white/10" : ""}`} style={{ width: colW }}>
                      <span className="font-semibold">{d.day}</span><span className="opacity-80">{d.holiday ? "祝" : d.weekday}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-[32px] text-[10px]">
                {weeks.map((w) => <div key={w.date} className="flex items-center justify-center border-r border-white/20" style={{ width: 7 * colW }}>{md(w.date)}〜</div>)}
              </div>
            )}
          </div>
        </div>

        {/* 行 */}
        <div className="flex">
          <div className="sticky left-0 z-10 bg-white" style={{ width: leftW }}>
            {tasks.map((t) => {
              const r = taskRange(t);
              return (
                <div key={t.id} className={`flex border-b text-[11px] ${onSelect ? "cursor-pointer hover:brightness-95" : ""}`} style={{ height: ROW_H, background: tints.get(t.category || "") }} onClick={() => onSelect?.(t.id)} data-testid="timeline-row">
                  {leftCols.map((c) => {
                    let v = null;
                    if (c.key === "category") v = rowFirst(t) ? <span className="font-semibold">{t.category || ""}</span> : "";
                    if (c.key === "name") v = <span className={`truncate ${t.completed ? "line-through text-muted-foreground" : ""}`}>{t.completed ? "✓ " : ""}{t.is_milestone ? "◆ " : ""}{t.name}</span>;
                    if (c.key === "phase") v = t.phase || "";
                    if (c.key === "party") v = <PartyChips task={t} parties={parties} memberName={memberName} />;
                    if (c.key === "start") v = r ? mdw(r.start) : "";
                    if (c.key === "end") v = r ? mdw(r.end) : "";
                    return <div key={c.key} className={`flex items-center border-r px-1.5 min-w-0 ${c.key === "name" ? "" : "justify-center text-center"}`} style={{ width: c.w }}>{v}</div>;
                  })}
                </div>
              );
            })}
          </div>

          <div className="relative" style={{ width: gridW, height: tasks.length * ROW_H }}>
            {/* 休みの日の網掛け・大事な日の線 */}
            {days.map((d, i) => (d.off || keyMap.has(d.date)) && (
              <div key={d.date} className={`absolute top-0 bottom-0 ${keyMap.has(d.date) ? "bg-red-50 border-x border-red-300" : "bg-slate-100"}`} style={{ left: i * colW, width: colW }} />
            ))}
            {scale === "day" && days.map((d, i) => <div key={`l${d.date}`} className="absolute top-0 bottom-0 border-r border-slate-100" style={{ left: i * colW, width: colW }} />)}
            {scale === "week" && weeks.map((w, i) => <div key={`w${w.date}`} className="absolute top-0 bottom-0 border-r border-slate-200" style={{ left: i * 7 * colW, width: 7 * colW }} />)}
            {tasks.map((t, i) => <div key={`r${t.id}`} className="absolute left-0 right-0 border-b border-slate-100" style={{ top: (i + 1) * ROW_H - 1 }} />)}
            {todayX !== null && <div className="absolute top-0 bottom-0 w-px bg-blue-500 z-[5]" style={{ left: todayX }} title="今日" />}

            {/* 前の工程の矢印 */}
            <svg className="absolute inset-0 pointer-events-none z-[6]" width={gridW} height={tasks.length * ROW_H}>
              <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#64748b" /></marker></defs>
              {tasks.flatMap((t) => (t.depends_on || []).map((pid) => {
                const p = tasks[rowIndex.get(pid)];
                const pr = p && rangeOf(p); const tr = rangeOf(t);
                if (!pr || !tr) return null;
                const x1 = (idx(pr.end) + 1) * colW; const y1 = rowIndex.get(pid) * ROW_H + ROW_H / 2;
                const x2 = idx(tr.start) * colW; const y2 = rowIndex.get(t.id) * ROW_H + ROW_H / 2;
                const mid = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));
                return <path key={`${pid}-${t.id}`} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 2}`} fill="none" stroke="#64748b" strokeWidth="1.2" markerEnd="url(#arr)" />;
              }))}
            </svg>

            {/* 棒 */}
            {tasks.map((t, i) => {
              const r = rangeOf(t);
              if (!r) return null;
              const keys = t.parties?.length ? t.parties : [];
              const colors = keys.map((k) => partyOf(parties, k).color);
              const bg = colors.length > 1 ? `repeating-linear-gradient(135deg, ${colors[0]} 0 8px, ${colors[1]} 8px 16px)` : colors[0] || "#94a3b8";
              const left = idx(r.start) * colW;
              const width = (diffDays(r.start, r.end) + 1) * colW;
              const top = i * ROW_H + 6;
              const label = partyText(t, parties, memberName);
              if (t.is_milestone) {
                return (
                  <div key={t.id} onPointerDown={(e) => startDrag(e, t, "move")} className={`absolute z-[8] flex items-center ${editable ? "cursor-grab" : ""}`} style={{ left: left + colW / 2 - 9, top: top + 3 }} title={`${t.name}（${jpDate(r.start)}）`} data-testid="timeline-milestone">
                    <div className="w-[18px] h-[18px] rotate-45 border-2 border-white shadow" style={{ background: t.completed ? "#a3a3a3" : "#d946ef" }} />
                    {scale === "day" && <span className="ml-2 text-[10px] font-semibold text-fuchsia-700 whitespace-nowrap">{t.name}</span>}
                  </div>
                );
              }
              return (
                <div key={t.id} onPointerDown={(e) => startDrag(e, t, "move")}
                  className={`absolute z-[8] rounded-sm shadow-sm text-white text-[10px] leading-[24px] px-1.5 overflow-hidden whitespace-nowrap select-none ${editable ? "cursor-grab active:cursor-grabbing" : ""} ${t.completed ? "opacity-45" : ""}`}
                  style={{ left: left + 1, width: width - 2, top, height: ROW_H - 12, background: bg }}
                  title={`${t.name}　${label}　${jpDate(r.start)}〜${jpDate(r.end)}`} data-testid="timeline-bar">
                  {editable && <span onPointerDown={(e) => startDrag(e, t, "start")} className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize" />}
                  {width > 60 && (scale === "day" ? `${t.completed ? "✓ " : ""}${t.name}` : "")}
                  {editable && <span onPointerDown={(e) => startDrag(e, t, "end")} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize" />}
                </div>
              );
            })}
            {/* 大事な日のラベル */}
            {keyDates.map((k) => k.date >= bounds.from && k.date <= bounds.to && (
              <div key={k.date + k.label} className="absolute z-[7] -translate-x-1/2 rounded bg-red-600 px-1 text-[9px] font-semibold text-white whitespace-nowrap" style={{ left: idx(k.date) * colW + colW / 2, top: 2 }}>{k.label}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 担当の区分の印（色付き） */
export function PartyChips({ task, parties, memberName = () => "" }) {
  const keys = task.parties?.length ? task.parties : [];
  if (!keys.length) return <span className="text-muted-foreground">—</span>;
  const members = task.show_members ? (task.member_ids || []).map(memberName).filter(Boolean) : [];
  return (
    <span className="flex flex-wrap gap-0.5 justify-center">
      {keys.map((k) => {
        const p = partyOf(parties, k);
        return <span key={k} className="rounded-full px-1.5 text-[10px] font-medium whitespace-nowrap" style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}55` }}>{p.label}{k === "cv" && members.length ? `（${members.join("・")}）` : ""}</span>;
      })}
    </span>
  );
}
