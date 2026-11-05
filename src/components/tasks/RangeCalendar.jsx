import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 期日を選ぶカレンダー（開始日〜期限）。
 *   1 回目に押した日が開始日（期限も同じ日）、2 回目に押した日が期限。開始日より前を押すと、そこから選び直し。
 * @param {{ start: string|null, end: string|null, today: string, onChange: (patch: { start_date, end_date }) => void }} p
 */
export default function RangeCalendar({ start, end, today, onChange }) {
  const base = new Date(`${(start || end || today).slice(0, 7)}-01T00:00:00`);
  const [month, setMonth] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  const [picking, setPicking] = useState(false); // 開始日を選んだあと、期限を待っている
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = [];
  for (let i = 0; i < first.getDay(); i++) days.push(null);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= last; d++) days.push(new Date(month.getFullYear(), month.getMonth(), d));
  const s = start || end || null;
  const e = end || start || null;
  const pick = (ymd) => {
    if (!picking || !s || ymd < s) { onChange({ start_date: ymd, end_date: ymd }); setPicking(true); return; }
    onChange({ start_date: s, end_date: ymd }); setPicking(false);
  };
  const move = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div className="w-[15.5rem] select-none" data-testid="range-calendar">
      <div className="flex items-center justify-between pb-1">
        <button type="button" onClick={() => move(-1)} className="rounded p-1 hover:bg-muted" aria-label="前の月"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-semibold tabular-nums">{month.getFullYear()}年{month.getMonth() + 1}月</span>
        <button type="button" onClick={() => move(1)} className="rounded p-1 hover:bg-muted" aria-label="次の月"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
        {WEEK.map((w, i) => <span key={w} className={i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : ""}>{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {days.map((d, i) => {
          if (!d) return <span key={`b${i}`} />;
          const ymd = ymdOf(d);
          const edge = ymd === s || ymd === e;
          const inside = s && e && ymd > s && ymd < e;
          const dow = d.getDay();
          return (
            <button key={ymd} type="button" onClick={() => pick(ymd)} data-ymd={ymd}
              className={`h-8 tabular-nums ${edge ? "rounded-md bg-primary text-primary-foreground font-semibold" : inside ? "bg-primary/10 text-slate-800" : `rounded-md hover:bg-muted ${dow === 0 ? "text-rose-500" : dow === 6 ? "text-blue-500" : "text-slate-700"}`} ${ymd === today && !edge ? "ring-1 ring-primary/50" : ""}`}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <p className="pt-1 text-[10px] text-muted-foreground">{picking ? "期限の日を押してください（同じ日ならそのままで OK）" : "開始日を押し、続けて期限の日を押します"}</p>
    </div>
  );
}

/** カレンダーのボタン（押すとカレンダーが開く。日付の入力欄の横に置く） */
export function RangeCalendarButton({ start, end, today, onChange, className = "h-8 w-8", testId = "range-calendar-open" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`inline-flex shrink-0 items-center justify-center rounded border bg-white text-slate-600 hover:bg-muted ${className}`} title="カレンダーで選ぶ" aria-label="カレンダーで選ぶ" data-testid={testId}>
          <CalendarDays className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2 space-y-2">
        <RangeCalendar start={start} end={end} today={today} onChange={onChange} />
        <div className="flex justify-between border-t pt-2">
          <button type="button" onClick={() => onChange({ start_date: today, end_date: today })} className="rounded border px-2 py-0.5 text-[11px] hover:bg-muted">今日</button>
          <button type="button" onClick={() => setOpen(false)} className="rounded bg-primary px-3 py-0.5 text-[11px] font-semibold text-primary-foreground">決定</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
