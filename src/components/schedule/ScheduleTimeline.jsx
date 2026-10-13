import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Check } from "lucide-react";
import { addDays, dayInfo, daysBetween, diffDays, taskRange, partyOf, partyText, categoryColors, scheduleBounds, weekStart, md, jpDate, parseYmd, WEEKDAYS } from "@/lib/schedule";

const mdw = (s) => `${md(s)}（${WEEKDAYS[parseYmd(s).getDay()]}）`;

const ROW_H = 40;
const SEC_H = 36;
const HEAD_H = 56;

/** #rrggbb を白と混ぜる／黒と混ぜる */
export function tint(hex, k) {
  const n = parseInt(String(hex || "#94a3b8").replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** 担当のメンバー（名前と写真）。社内の画面ではいつも、クライアント向けは「メンバー名を出す」のときだけ */
export function membersOf(task, memberName = () => "", memberAvatar = () => "", always = false) {
  if (!always && !task.show_members) return [];
  return (task.member_ids || []).map((id, i) => ({ name: memberName(id), avatar: task.member_avatars?.[i] || memberAvatar(id) || "" })).filter((m) => m.name);
}

/** 担当のまるいアイコン（写真があれば写真。無ければ CV・クライアント名の頭文字・メンバーの名字） */
export function PartyAvatars({ task, parties, memberName = () => "", memberAvatar = () => "", alwaysMembers = false, size = 20, max = 3 }) {
  const keys = task.parties?.length ? task.parties : [];
  const members = membersOf(task, memberName, memberAvatar, alwaysMembers);
  const items = [];
  for (const k of keys) {
    const p = partyOf(parties, k);
    if (k === "cv" && members.length) {
      for (const m of members) items.push({ key: `m${m.name}`, text: m.name.slice(0, 2), avatar: m.avatar, color: p.color, title: `CV（${m.name}）` });
    } else {
      items.push({ key: k, text: k === "cv" ? "CV" : p.label.replace(/様$/, "").slice(0, 1), color: p.color, title: p.label });
    }
  }
  if (!items.length) return null;
  const shown = items.slice(0, max);
  return (
    <span className="inline-flex -space-x-1.5 shrink-0">
      {shown.map((it) => it.avatar
        ? <img key={it.key} src={it.avatar} alt={it.title} title={it.title} className="rounded-full object-cover ring-2 ring-white" style={{ width: size, height: size, boxShadow: `0 0 0 ${size > 18 ? 3 : 2}px ${it.color}` }} />
        : <span key={it.key} title={it.title} className="inline-flex items-center justify-center rounded-full font-bold text-white ring-2 ring-white" style={{ width: size, height: size, background: it.color, fontSize: size * 0.42 }}>{it.text}</span>)}
      {items.length > max && <span className="inline-flex items-center justify-center rounded-full bg-slate-200 font-bold text-slate-600 ring-2 ring-white" style={{ width: size, height: size, fontSize: size * 0.4 }}>+{items.length - max}</span>}
    </span>
  );
}

/**
 * 工程表のタイムライン（ガント）。社内の画面と、クライアント向けの共有リンクの両方で使う。
 *   カテゴリーごとのセクション（たためる）。日単位・週単位を切り替えられる。
 *   土日・祝日・会社の休業日はうすい灰色、大事な日（納品期限など）は赤い線、今日は青い線。
 *   editable なら棒をドラッグして日付を動かせる（端をつかむと開始日・終了日だけ）。前の工程は矢印で結ぶ。
 * @param {object} p
 * @param {object[]} p.tasks
 * @param {object[]} p.parties     担当の区分 [{ key, label, color }]
 * @param {object[]} p.keyDates    大事な日 [{ label, date }]
 * @param {Set<string>} [p.holidays] 会社の休業日
 * @param {"day"|"week"} p.scale
 * @param {"mini"|"standard"|"full"} [p.columns]  左の列（mini: タスク名だけ（スマホ） / standard: タスク名・担当 / full: ＋工程・期間）
 * @param {(id, patch) => void} [p.onChange]
 * @param {(id) => string} [p.memberName]
 * @param {"soft"|"solid"|"progress"|"status"|"line"|"cells"} [p.barStyle]  棒の見せ方
 */
export default function ScheduleTimeline({ tasks, parties, keyDates = [], holidays = null, scale = "day", columns = "standard", editable = false, onChange, memberName = () => "", memberAvatar = () => "", alwaysMembers = false, today, fitHeight = false, barStyle = "line" }) {
  const colW = scale === "week" ? 16 : 34;
  const bounds = useMemo(() => {
    const b = scheduleBounds(tasks, keyDates, { today, padDays: scale === "week" ? 7 : 3 });
    return scale === "week" ? { from: weekStart(b.from), to: addDays(weekStart(b.to), 6) } : b;
  }, [tasks, keyDates, scale, today]);
  const days = useMemo(() => daysBetween(bounds.from, bounds.to).map((d) => dayInfo(d, holidays)), [bounds, holidays]);
  const keyMap = useMemo(() => new Map(keyDates.map((k) => [k.date, k.label])), [keyDates]);
  const secColors = useMemo(() => categoryColors(tasks), [tasks]);
  const gridW = days.length * colW;
  const idx = (d) => diffDays(bounds.from, d);

  // セクション（カテゴリー）と、たたんだもの
  const [collapsed, setCollapsed] = useState(() => new Set());
  const rows = useMemo(() => {
    const out = [];
    let y = 0;
    tasks.forEach((t, i) => {
      const c = t.category || "";
      if (i === 0 || (tasks[i - 1].category || "") !== c) {
        const items = [];
        for (let j = i; j < tasks.length && (tasks[j].category || "") === c; j++) items.push(tasks[j]);
        out.push({ type: "section", key: `s${i}`, category: c, items, y, h: SEC_H });
        y += SEC_H;
      }
      if (!collapsed.has(c)) { out.push({ type: "task", key: t.id, t, y, h: ROW_H }); y += ROW_H; }
    });
    return { list: out, height: y };
  }, [tasks, collapsed]);
  const rowOf = useMemo(() => new Map(rows.list.filter((r) => r.type === "task").map((r) => [r.t.id, r])), [rows]);

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

  // 月の見出し／週の見出し
  const months = [];
  for (const d of days) {
    const key = `${d.year}-${d.month}`;
    if (!months.length || months[months.length - 1].key !== key) months.push({ key, label: `${d.year}年${d.month}月`, short: `${d.month}月`, n: 0 });
    months[months.length - 1].n++;
  }
  const weeks = [];
  if (scale === "week") for (let i = 0; i < days.length; i += 7) weeks.push(days[i]);

  const leftCols = columns === "full"
    ? [{ key: "name", label: "タスク名", w: 230 }, { key: "phase", label: "工程", w: 88 }, { key: "party", label: "担当", w: 64 }, { key: "range", label: "期間", w: 112 }]
    : columns === "mini"
      ? [{ key: "name", label: "タスク名", w: 132 }]
      : [{ key: "name", label: "タスク名", w: 230 }, { key: "party", label: "担当", w: 64 }];
  const leftW = leftCols.reduce((s, c) => s + c.w, 0);
  const todayIn = today && today >= bounds.from && today <= bounds.to;
  const todayX = todayIn ? idx(today) * colW + colW / 2 : null;

  // 開いたとき・日／週を切り替えたときは、今日の少し前から見せる
  const boxRef = useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !todayIn) return;
    el.scrollLeft = Math.max(0, (idx(today) - (scale === "week" ? 7 : 2)) * colW);
  }, [scale]);

  const toggle = (c) => setCollapsed((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  return (
    <div ref={boxRef} className={`overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm ${fitHeight ? "" : "max-h-[72vh]"}`} data-testid="schedule-timeline">
      <div className="relative" style={{ width: leftW + gridW }}>
        {/* 見出し */}
        <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-white" style={{ height: HEAD_H }}>
          <div className="sticky left-0 z-30 flex items-end border-r border-slate-200 bg-white pb-2 text-[11px] font-medium text-slate-500" style={{ width: leftW }}>
            {leftCols.map((c) => <div key={c.key} className={`px-3 ${c.key === "name" ? "" : "text-center"}`} style={{ width: c.w }}>{c.label}</div>)}
          </div>
          <div className="relative" style={{ width: gridW }}>
            <div className="flex h-[24px] text-[11px] font-semibold text-slate-700">
              {months.map((m) => (
                <div key={m.key} className="border-l border-slate-200 first:border-l-0" style={{ width: m.n * colW }}>
                  <span className="sticky inline-block px-2 pt-1 whitespace-nowrap" style={{ left: leftW }}>{m.n * colW > 80 ? m.label : m.short}</span>
                </div>
              ))}
            </div>
            {scale === "day" ? (
              <div className="flex h-[32px]">
                {days.map((d) => {
                  const isToday = d.date === today;
                  const key = keyMap.get(d.date);
                  return (
                    <div key={d.date} title={key ? `${key}（${jpDate(d.date)}）` : jpDate(d.date)} className={`flex flex-col items-center justify-center leading-none ${d.day === 1 ? "border-l border-slate-200" : ""}`} style={{ width: colW }}>
                      <span className={`text-[9px] ${d.off ? "text-slate-300" : "text-slate-400"}`}>{d.holiday ? "祝" : d.weekday}</span>
                      <span className={`mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] ${isToday ? "bg-blue-600 font-bold text-white" : key ? "bg-red-500 font-bold text-white" : d.off ? "text-slate-300" : "text-slate-600"}`}>{d.day}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-[32px] text-[10px] text-slate-500">
                {weeks.map((w) => <div key={w.date} className="flex items-center border-l border-slate-100 pl-1.5" style={{ width: 7 * colW }}>{md(w.date)}〜</div>)}
              </div>
            )}
          </div>
        </div>

        {/* 行 */}
        <div className="flex">
          <div className="sticky left-0 z-10 border-r border-slate-200 bg-white" style={{ width: leftW }}>
            {rows.list.map((row) => row.type === "section" ? (
              <button key={row.key} onClick={() => toggle(row.category)} className="relative flex w-full items-center gap-1.5 border-b border-slate-100 pl-3 pr-2 text-left hover:bg-slate-50" style={{ height: SEC_H }} data-testid="timeline-section">
                <span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: secColors.get(row.category) }} />
                {collapsed.has(row.category) ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: secColors.get(row.category) }} />
                <span className="truncate text-[13px] font-bold text-slate-800">{row.category || "（カテゴリーなし）"}</span>
                <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{row.items.filter((t) => t.completed).length}/{row.items.length}</span>
              </button>
            ) : (
              <div key={row.key} className="group relative flex items-center border-b border-slate-100 text-[12px] hover:bg-slate-50" style={{ height: ROW_H }} data-testid="timeline-row">
                <span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: secColors.get(row.t.category || "") }} />
                <span className="absolute inset-y-0 left-[14px] w-[3px]" style={{ background: tint(secColors.get(row.t.category || ""), 0.45) }} />
                {leftCols.map((c) => {
                  const t = row.t;
                  const r = taskRange(t);
                  let v = null;
                  if (c.key === "name") {
                    v = (
                      <span className="flex min-w-0 items-center gap-2 pl-6">
                        {t.is_milestone
                          ? <span className={`h-3 w-3 shrink-0 rotate-45 rounded-[2px] ${t.completed ? "bg-emerald-500" : "bg-fuchsia-500"}`} />
                          : <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${t.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent"}`}><Check className="h-3 w-3" strokeWidth={3} /></span>}
                        <span className={`truncate ${t.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.name}</span>
                      </span>
                    );
                  }
                  if (c.key === "phase") v = t.phase ? <span className="truncate rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600" title={t.phase}>{t.phase}</span> : "";
                  if (c.key === "party") v = <PartyAvatars task={t} parties={parties} memberName={memberName} memberAvatar={memberAvatar} alwaysMembers={alwaysMembers} />;
                  if (c.key === "range") v = r ? <span className="text-[11px] text-slate-500 whitespace-nowrap">{r.start === r.end ? mdw(r.start) : `${md(r.start)} – ${md(r.end)}`}</span> : "";
                  return <div key={c.key} className={`flex min-w-0 items-center px-3 ${c.key === "name" ? "" : "justify-center"}`} style={{ width: c.w }}>{v}</div>;
                })}
              </div>
            ))}
          </div>

          <div className="relative" style={{ width: gridW, height: rows.height }}>
            {/* 休みの日の網掛け・月の区切り */}
            {days.map((d, i) => d.off && <div key={d.date} className="absolute top-0 bottom-0 bg-slate-50" style={{ left: i * colW, width: colW }} />)}
            {scale === "day" && days.map((d, i) => d.day === 1 && i > 0 && <div key={`m${d.date}`} className="absolute top-0 bottom-0 border-l border-slate-200" style={{ left: i * colW }} />)}
            {scale === "week" && weeks.map((w, i) => <div key={`w${w.date}`} className="absolute top-0 bottom-0 border-l border-slate-100" style={{ left: i * 7 * colW }} />)}
            {/* セクションの帯・行の線 */}
            {rows.list.map((row) => row.type === "section"
              ? <div key={`b${row.key}`} className="absolute left-0 right-0 border-b border-slate-100 bg-slate-50/60" style={{ top: row.y, height: SEC_H }} />
              : <div key={`b${row.key}`} className="absolute left-0 right-0 border-b border-slate-100" style={{ top: row.y, height: ROW_H }} />)}
            {/* 大事な日（赤い点線）と今日（青い線） */}
            {keyDates.map((k) => k.date >= bounds.from && k.date <= bounds.to && (
              <div key={`k${k.date}${k.label}`} className="absolute top-0 bottom-0 z-[5] border-l-2 border-dashed border-red-400" style={{ left: idx(k.date) * colW + colW / 2 - 1 }}>
                <span className="absolute -top-0 left-1 whitespace-nowrap rounded-full bg-red-500 px-1.5 py-[1px] text-[9px] font-bold text-white shadow-sm">{k.label}</span>
              </div>
            ))}
            {todayX !== null && <div className="absolute top-0 bottom-0 z-[5] w-[2px] bg-blue-500" style={{ left: todayX - 1 }} title="今日"><span className="absolute -left-[3px] -top-[1px] h-2 w-2 rounded-full bg-blue-500" /></div>}

            {/* 前の工程の矢印（なめらかな線） */}
            <svg className="pointer-events-none absolute inset-0 z-[6]" width={gridW} height={rows.height}>
              <defs><marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#94a3b8" /></marker></defs>
              {tasks.flatMap((t) => (t.depends_on || []).map((pid) => {
                const pRow = rowOf.get(pid); const tRow = rowOf.get(t.id);
                if (!pRow || !tRow) return null;
                const pr = rangeOf(pRow.t); const tr = rangeOf(t);
                if (!pr || !tr) return null;
                const x1 = (idx(pr.end) + 1) * colW - (pRow.t.is_milestone ? colW / 2 - 6 : 2); const y1 = pRow.y + ROW_H / 2;
                const x2 = idx(tr.start) * colW + (t.is_milestone ? colW / 2 - 8 : 1); const y2 = tRow.y + ROW_H / 2;
                const bend = Math.max(14, Math.min(40, Math.abs(x2 - x1) / 2));
                const d = x2 >= x1 + 12
                  ? `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2 - 3},${y2}`
                  : `M${x1},${y1} h8 v${(y2 - y1) / 2} H${x2 - 10} V${y2} H${x2 - 3}`;
                return <path key={`${pid}-${t.id}`} d={d} fill="none" stroke="#94a3b8" strokeWidth="1.4" markerEnd="url(#arr)" />;
              }))}
            </svg>

            {/* 棒 */}
            {rows.list.filter((row) => row.type === "task").map((row) => {
              const t = row.t;
              const r = rangeOf(t);
              if (!r) return null;
              const keys = t.parties?.length ? t.parties : [];
              const colors = keys.map((k) => partyOf(parties, k).color);
              const c0 = colors[0] || "#94a3b8";
              const left = idx(r.start) * colW;
              const width = (diffDays(r.start, r.end) + 1) * colW;
              const label = partyText(t, parties, memberName);
              const tip = `${t.name}　${label}　${r.start === r.end ? jpDate(r.start) : `${jpDate(r.start)}〜${jpDate(r.end)}`}`;
              if (t.is_milestone) {
                return (
                  <div key={t.id} onPointerDown={(e) => startDrag(e, t, "move")} className={`absolute z-[8] flex items-center ${editable ? "cursor-grab" : ""}`} style={{ left: left + colW / 2 - 8, top: row.y + ROW_H / 2 - 8 }} title={tip} data-testid="timeline-milestone">
                    <div className={`h-4 w-4 rotate-45 rounded-[3px] shadow ${t.completed ? "bg-emerald-500" : "bg-fuchsia-500"}`} />
                    <span className="ml-2 whitespace-nowrap rounded bg-white/90 px-1 text-[11px] font-semibold text-slate-700">{t.name}<span className="ml-1 font-normal text-slate-400">{md(r.start)}</span></span>
                  </div>
                );
              }
              const textInside = scale === "day" && width >= Math.min(220, t.name.length * 12 + 44);
              const outside = !textInside && scale === "day" && <span className="relative z-[9] ml-1 whitespace-nowrap rounded bg-white/90 px-1 text-[11px] text-slate-600">{t.name}</span>;
              const handles = editable && <>
                <span onPointerDown={(e) => startDrag(e, t, "start")} className="absolute left-0 top-0 bottom-0 z-[2] w-2 cursor-ew-resize" />
                <span onPointerDown={(e) => startDrag(e, t, "end")} className="absolute right-0 top-0 bottom-0 z-[2] w-2 cursor-ew-resize" />
              </>;
              const grab = editable ? "cursor-grab active:cursor-grabbing" : "";
              const wrap = (h, children) => <div key={t.id} className="absolute z-[8] flex items-center" style={{ left: left + 2, top: row.y + (ROW_H - h) / 2, height: h }}>{children}</div>;
              const status = t.completed ? "done" : r.end < today ? "late" : r.start <= today ? "doing" : "todo";
              const STATUS_COLOR = { done: "#10b981", late: "#ef4444", doing: "#3b82f6", todo: "#94a3b8" };

              // 細い線（ミニマル）
              if (barStyle === "line") {
                const lineBg = colors.length > 1 ? `linear-gradient(90deg, ${colors.join(", ")})` : c0;
                return (
                  <div key={t.id} className="absolute z-[8] flex items-center" style={{ left: left + 2, top: row.y, height: ROW_H }}>
                    <div onPointerDown={(e) => startDrag(e, t, "move")} className={`relative flex h-full items-center select-none ${grab} ${t.completed ? "opacity-50" : ""}`} style={{ width: Math.max(width - 4, 26) }} title={tip} data-testid="timeline-bar">
                      <span className="absolute left-3 right-1.5 h-[5px] rounded-full" style={{ background: lineBg }} />
                      <span className="absolute right-0.5 h-2.5 w-2.5 rounded-full border-2 bg-white" style={{ borderColor: colors[colors.length - 1] || c0 }} />
                      <span className="relative z-[1] -ml-1"><PartyAvatars task={t} parties={parties} memberName={memberName} memberAvatar={memberAvatar} alwaysMembers={alwaysMembers} size={22} max={2} /></span>
                      {handles}
                    </div>
                    {scale === "day" && <span className="relative z-[9] ml-1 whitespace-nowrap rounded bg-white/90 px-0.5 text-[11px] text-slate-600">{t.completed ? "✓ " : ""}{t.name}</span>}
                  </div>
                );
              }
              // 日ごとのマス（営業日だけ塗る。土日・祝日はすき間）
              if (barStyle === "cells") {
                const ds = daysBetween(r.start, r.end);
                return wrap(ROW_H - 16, <>
                  <div onPointerDown={(e) => startDrag(e, t, "move")} className={`relative flex h-full select-none ${grab} ${t.completed ? "opacity-45" : ""}`} style={{ width: width - 4 }} title={tip} data-testid="timeline-bar">
                    {ds.map((d, i) => {
                      const off = days[idx(d)]?.off;
                      const c = colors[i % Math.max(1, colors.length)] || c0;
                      return <span key={d} className="h-full rounded-[3px]" style={{ width: colW - 3, marginRight: 3, background: off ? "transparent" : c, border: off ? `1px dashed ${tint(c, 0.4)}` : "none" }} />;
                    })}
                    {handles}
                  </div>
                  <span className="ml-1 flex items-center gap-1"><PartyAvatars task={t} parties={parties} memberName={memberName} memberAvatar={memberAvatar} alwaysMembers={alwaysMembers} size={16} />{scale === "day" && <span className="whitespace-nowrap rounded bg-white/90 px-0.5 text-[11px] text-slate-600">{t.name}</span>}</span>
                </>);
              }
              // 色の決め方: 担当の色（soft / solid / progress）か、状況の色（status）
              const base = barStyle === "status" ? [STATUS_COLOR[status]] : colors.length ? colors : [c0];
              const k0 = base[0];
              const solid = barStyle === "solid";
              const fill = (k) => (solid ? k : tint(k, 0.72));
              const bg = base.length > 1
                ? `linear-gradient(90deg, ${base.map((c, i) => `${fill(c)} ${(i / base.length) * 100}% ${((i + 1) / base.length) * 100}%`).join(", ")})`
                : fill(k0);
              // 進み具合（今日までに過ぎた日の割合。完了なら全部）
              const elapsed = t.completed ? 1 : today < r.start ? 0 : today > r.end ? 1 : (diffDays(r.start, today) + 1) / (diffDays(r.start, r.end) + 1);
              return wrap(ROW_H - 14, <>
                <div onPointerDown={(e) => startDrag(e, t, "move")}
                  className={`relative flex h-full items-center gap-1.5 overflow-hidden border pl-1 pr-2 text-[11px] font-medium whitespace-nowrap select-none transition-shadow hover:shadow-md ${solid ? "rounded-md" : "rounded-full"} ${grab} ${t.completed && barStyle !== "status" && barStyle !== "progress" ? "opacity-50" : ""} ${barStyle === "progress" && status === "late" ? "ring-2 ring-red-400" : ""}`}
                  style={{ width: width - 4, background: bg, borderColor: solid ? "transparent" : tint(k0, 0.35), color: solid ? "#ffffff" : tint(k0, -0.45) }}
                  title={barStyle === "status" ? `${tip}　${{ done: "完了", late: "遅れ", doing: "進行中", todo: "これから" }[status]}` : tip} data-testid="timeline-bar">
                  {barStyle === "progress" && elapsed > 0 && <span className="absolute inset-y-0 left-0" style={{ width: `${elapsed * 100}%`, background: t.completed ? tint("#10b981", 0.35) : tint(k0, 0.3) }} />}
                  {handles}
                  <span className="relative flex items-center gap-1.5">
                    {width >= 40 && <PartyAvatars task={t} parties={parties} memberName={memberName} memberAvatar={memberAvatar} alwaysMembers={alwaysMembers} size={18} />}
                    {t.completed && <Check className="h-3 w-3 shrink-0" strokeWidth={3} />}
                    {textInside && <span className="truncate">{t.name}</span>}
                    {barStyle === "progress" && textInside && !t.completed && elapsed > 0 && elapsed < 1 && <span className="opacity-70">{Math.round(elapsed * 100)}%</span>}
                  </span>
                </div>
                {outside}
              </>);
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 担当の区分の印（色付きの文字。リストで使う） */
export function PartyChips({ task, parties, memberName = () => "", alwaysMembers = false }) {
  const keys = task.parties?.length ? task.parties : [];
  if (!keys.length) return <span className="text-muted-foreground">—</span>;
  const members = alwaysMembers || task.show_members ? (task.member_ids || []).map(memberName).filter(Boolean) : [];
  return (
    <span className="flex flex-wrap gap-0.5">
      {keys.map((k) => {
        const p = partyOf(parties, k);
        return <span key={k} className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10px] font-medium whitespace-nowrap" style={{ background: tint(p.color, 0.85), color: tint(p.color, -0.4) }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />{p.label}{k === "cv" && members.length ? `（${members.join("・")}）` : ""}</span>;
      })}
    </span>
  );
}
