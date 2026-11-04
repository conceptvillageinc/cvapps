import { CalendarRange, X } from "lucide-react";
import { todayString } from "@/lib/fiscal";

const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(y, m, 0).getDate();
/** 今月・先月・来月・今年など、よく使う期間 */
function presets(today = todayString()) {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const month = (yy, mm) => { const d = new Date(yy, mm - 1, 1); const Y = d.getFullYear(); const M = d.getMonth() + 1; return { from: `${Y}-${pad(M)}-01`, to: `${Y}-${pad(M)}-${pad(lastDay(Y, M))}` }; };
  return [
    { label: "先月", ...month(y, m - 1) },
    { label: "今月", ...month(y, m) },
    { label: "来月", ...month(y, m + 1) },
    { label: "今年", from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

/** 期間の絞り込みの値 { field, from, to }（from・to は "YYYY-MM-DD" か ""） */
export const emptyPeriod = (field) => ({ field, from: "", to: "" });
export const periodActive = (p) => !!(p?.from || p?.to);
/** 行の日付が期間に入るか（期間が空なら全部通す。日付の無い行は、期間を入れたら外す） */
export function inPeriod(value, p) {
  if (!periodActive(p)) return true;
  // 日時（作成日など）は、日本の日付に直してから比べる
  const raw = String(value || "");
  const dt = raw.includes("T") ? new Date(raw) : null;
  const d = dt && !Number.isNaN(dt.getTime()) ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` : raw.slice(0, 10);
  if (!d) return false;
  return (!p.from || d >= p.from) && (!p.to || d <= p.to);
}
/** 条件の札に出す文字（例: 完了予定 2026-10-01〜2026-10-31） */
export function periodLabel(p, fields) {
  const name = fields.find((f) => f.value === p.field)?.label || "";
  return `${name} ${p.from || ""}〜${p.to || ""}`;
}

/**
 * 期間で絞り込む欄（どの日付で絞るか・いつから・いつまで・よく使う期間）
 * @param {{ value, onChange, fields: { value, label }[] }} p
 */
export default function PeriodFilter({ value, onChange, fields, className = "" }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const ps = presets();
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${className}`} data-testid="period-filter">
      <CalendarRange className="w-4 h-4 text-muted-foreground" />
      <span className="text-muted-foreground">期間</span>
      {fields.length > 1 ? (
        <select value={value.field} onChange={(e) => set({ field: e.target.value })} className="h-8 rounded-md border bg-white px-2" aria-label="どの日付で絞るか" data-testid="period-field">
          {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      ) : <span className="font-medium">{fields[0]?.label}</span>}
      <input type="date" value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} className="h-8 rounded-md border bg-white px-2" aria-label="いつから" data-testid="period-from" />
      <span className="text-muted-foreground">〜</span>
      <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} className="h-8 rounded-md border bg-white px-2" aria-label="いつまで" data-testid="period-to" />
      {ps.map((p) => (
        <button key={p.label} type="button" onClick={() => set({ from: p.from, to: p.to })}
          className={`h-7 rounded-full border px-2.5 ${value.from === p.from && value.to === p.to ? "bg-slate-800 text-white border-slate-800" : "bg-white hover:bg-muted/50"}`}>{p.label}</button>
      ))}
      {periodActive(value) && (
        <button type="button" onClick={() => set({ from: "", to: "" })} className="inline-flex items-center gap-0.5 text-primary hover:underline" data-testid="period-clear"><X className="w-3 h-3" />期間を外す</button>
      )}
    </div>
  );
}
