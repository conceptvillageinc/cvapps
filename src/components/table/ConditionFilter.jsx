import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, Plus, X, ChevronDown, Search, Check } from "lucide-react";
import { periodPresets, inPeriod } from "@/components/table/PeriodFilter";

// ============================================================================
// 条件で絞り込む欄（freee の「フィルタ ＋条件追加」のような形）
//   fields: [{ key, label, type: "text" | "date" | "amount" | "select", get(row), options?: [{ value, label }] }]
//   value:  [{ key, value }]（項目ごとに 1 つ）
//     text   … 文字（含む）
//     date   … { from, to }（"YYYY-MM-DD"）
//     amount … { min, max }（数字の文字）
//     select … 選んだ値の配列（どれかに当たれば通す）
// ============================================================================

const emptyValue = (type) => (type === "date" ? { from: "", to: "" } : type === "amount" ? { min: "", max: "" } : type === "select" ? [] : "");
const num = (s) => { const n = Number(String(s ?? "").replace(/[,，¥円\s]/g, "")); return Number.isFinite(n) ? n : null; };
const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")}円`;

/** 条件が入っているか（空の条件は絞り込みに使わない） */
export function conditionActive(c, field) {
  if (!field) return false;
  const v = c.value;
  if (field.type === "date") return !!(v?.from || v?.to);
  if (field.type === "amount") return [v?.min, v?.max].some((x) => String(x ?? "").trim() !== "" && num(x) != null);
  if (field.type === "select") return Array.isArray(v) && v.length > 0;
  return String(v || "").trim() !== "";
}

/** 行がすべての条件に当たるか */
export function matchConditions(row, conditions, fields) {
  return conditions.every((c) => {
    const f = fields.find((x) => x.key === c.key);
    if (!conditionActive(c, f)) return true;
    const raw = f.get ? f.get(row) : row[f.key];
    if (f.type === "date") return inPeriod(raw, c.value);
    if (f.type === "amount") {
      const n = num(raw); if (n == null) return false;
      const min = String(c.value.min ?? "").trim() === "" ? null : num(c.value.min);
      const max = String(c.value.max ?? "").trim() === "" ? null : num(c.value.max);
      return (min == null || n >= min) && (max == null || n <= max);
    }
    if (f.type === "select") { const vals = Array.isArray(raw) ? raw : [raw]; return vals.some((x) => c.value.includes(x ?? "")); }
    const words = String(c.value).trim().toLowerCase().split(/[\s　]+/).filter(Boolean);
    const hay = (Array.isArray(raw) ? raw.join(" ") : String(raw ?? "")).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** 札に出す文字（例: 請求日: 2026-09-01〜2026-09-30） */
function summaryOf(c, f) {
  if (!conditionActive(c, f)) return "未設定";
  const v = c.value;
  if (f.type === "date") return `${v.from || ""}〜${v.to || ""}`;
  if (f.type === "amount") { const a = String(v.min ?? "").trim() !== "" ? yen(num(v.min)) : ""; const b = String(v.max ?? "").trim() !== "" ? yen(num(v.max)) : ""; return a && b ? `${a}〜${b}` : a ? `${a}以上` : `${b}以下`; }
  if (f.type === "select") { const labels = v.map((x) => f.options?.find((o) => o.value === x)?.label ?? x); return labels.length > 2 ? `${labels.slice(0, 2).join("・")} ほか${labels.length - 2}` : labels.join("・"); }
  return `「${v}」を含む`;
}

function Editor({ field, value, onChange }) {
  if (field.type === "date") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <input type="date" autoFocus value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} className="h-8 rounded-md border px-2 text-xs" aria-label="いつから" data-testid="cond-date-from" />
          <span className="text-xs text-muted-foreground">〜</span>
          <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} className="h-8 rounded-md border px-2 text-xs" aria-label="いつまで" data-testid="cond-date-to" />
        </div>
        <div className="flex flex-wrap gap-1">
          {periodPresets().map((p) => (
            <button key={p.label} type="button" onClick={() => onChange({ from: p.from, to: p.to })} className={`h-6 rounded-full border px-2.5 text-[11px] ${value.from === p.from && value.to === p.to ? "bg-slate-800 text-white border-slate-800" : "hover:bg-muted/50"}`}>{p.label}</button>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === "amount") {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <input inputMode="numeric" autoFocus value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} placeholder="下限" className="h-8 w-28 rounded-md border px-2 text-right tabular-nums" data-testid="cond-amount-min" />
        <span className="text-muted-foreground">円 〜</span>
        <input inputMode="numeric" value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} placeholder="上限" className="h-8 w-28 rounded-md border px-2 text-right tabular-nums" data-testid="cond-amount-max" />
        <span className="text-muted-foreground">円</span>
      </div>
    );
  }
  if (field.type === "select") {
    const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    return (
      <div className="max-h-64 overflow-y-auto -mx-1">
        {(field.options || []).map((o) => (
          <label key={o.value} className="flex items-center gap-2 rounded px-1 py-1.5 text-xs cursor-pointer hover:bg-muted/50" data-testid="cond-option">
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="h-3.5 w-3.5 accent-primary" />{o.label}
          </label>
        ))}
        {!(field.options || []).length && <p className="px-1 py-2 text-xs text-muted-foreground">選べる値がありません</p>}
      </div>
    );
  }
  return <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder="含む文字（スペースで区切ると、すべてを含むもの）" className="h-8 w-72 rounded-md border px-2 text-xs" data-testid="cond-text" />;
}

/** 条件 1 つの札（押すと編集、× で外す） */
function Chip({ cond, field, open, onOpenChange, onChange, onRemove }) {
  const active = conditionActive(cond, field);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className={`inline-flex h-8 items-center rounded-md border text-xs ${active ? "border-primary/40 bg-primary/5" : "border-dashed bg-white"}`} data-testid="cond-chip">
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-full items-center gap-1 pl-2.5 pr-1.5">
            <span className="font-semibold">{field.label}:</span>
            <span className={active ? "text-foreground" : "text-muted-foreground"}>{summaryOf(cond, field)}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <button type="button" onClick={onRemove} className="h-full px-1.5 text-muted-foreground hover:text-rose-600 border-l" title="この条件を外す" aria-label={`${field.label}の条件を外す`}><X className="w-3 h-3" /></button>
      </div>
      <PopoverContent align="start" className="w-auto min-w-[16rem] p-3 space-y-2" data-testid="cond-editor">
        <p className="text-[11px] font-semibold text-muted-foreground">{field.label}</p>
        <Editor field={field} value={cond.value} onChange={onChange} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => onChange(emptyValue(field.type))} className="text-[11px] text-muted-foreground hover:underline">空にする</button>
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground" data-testid="cond-done"><Check className="w-3 h-3" />決定</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * @param {{ fields, value: {key, value}[], onChange, className? }} p
 */
export default function ConditionFilter({ fields, value, onChange, className = "" }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const used = new Set(value.map((c) => c.key));
  const choices = useMemo(() => fields.filter((f) => !used.has(f.key) && (!q.trim() || f.label.includes(q.trim()))), [fields, value, q]);
  const add = (f) => { onChange([...value, { key: f.key, value: emptyValue(f.type) }]); setAdding(false); setQ(""); setTimeout(() => setEditing(f.key), 0); };
  const update = (key, v) => onChange(value.map((c) => (c.key === key ? { ...c, value: v } : c)));
  const remove = (key) => { onChange(value.filter((c) => c.key !== key)); if (editing === key) setEditing(null); };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} data-testid="condition-filter">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mr-0.5"><Filter className="w-3.5 h-3.5" />条件</span>
      {value.map((c) => {
        const f = fields.find((x) => x.key === c.key);
        if (!f) return null;
        return <Chip key={c.key} cond={c} field={f} open={editing === c.key} onOpenChange={(o) => setEditing(o ? c.key : null)} onChange={(v) => update(c.key, v)} onRemove={() => remove(c.key)} />;
      })}
      <Popover open={adding} onOpenChange={(o) => { setAdding(o); if (!o) setQ(""); }}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary/5" data-testid="cond-add"><Plus className="w-3.5 h-3.5" />条件追加</button>
        </PopoverTrigger>
        {/* 閉じたときに「条件追加」へフォーカスを戻さない（戻すと、開いたばかりの条件の編集が閉じてしまう） */}
        <PopoverContent align="start" className="w-60 p-2" data-testid="cond-fields" onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="relative mb-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="項目を探す" className="h-8 w-full rounded-md border pl-7 pr-2 text-xs" />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {choices.map((f) => (
              <button key={f.key} type="button" onClick={() => add(f)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60" data-testid="cond-field">{f.label}</button>
            ))}
            {choices.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">追加できる項目はありません</p>}
          </div>
        </PopoverContent>
      </Popover>
      {value.length > 0 && <button type="button" onClick={() => { onChange([]); setEditing(null); }} className="h-8 px-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline" data-testid="cond-clear">クリア</button>}
    </div>
  );
}
