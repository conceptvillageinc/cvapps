import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * 印刷色数の入力。「片面／両面」と「4色フルカラー／2色／1色」を押して選ぶ。
 * 保存される値は文字列（例: 「両面4色フルカラー」「片面1色」「4色フルカラー」）。
 * 特色や「表4色・裏1色」のように選べないものは「その他」で自由に書ける。
 */
export const SIDES = ["片面", "両面"];
export const COLOR_COUNTS = ["4色フルカラー", "2色", "1色"];

/** 文字列を { side, count, text } に分解する。選べる形でなければ text だけ */
export function parseColors(value) {
  const v = String(value || "").trim();
  if (!v) return { side: "", count: "", text: "" };
  const side = /両面/.test(v) ? "両面" : /片面/.test(v) ? "片面" : "";
  const rest = v.replace(/片面|両面/g, "").replace(/[\s()（）]/g, "");
  const count = rest && /^(4色)?(フルカラー)?(CMYK)?$/i.test(rest) ? "4色フルカラー"
    : rest === "2色" ? "2色"
    : /^(1色|モノクロ|スミ1色)$/.test(rest) ? "1色"
    : "";
  if (!count) return { side: "", count: "", text: v };
  return { side, count, text: "" };
}

export const formatColors = ({ side, count }) => (count ? `${side}${count}` : "");

export default function ColorCountInput({ value, onChange, compact = false, invalid = false, ariaLabel = "印刷色数" }) {
  const init = (v) => { const f = parseColors(v); return { ...f, other: !!f.text }; };
  const [f, setF] = useState(() => init(value));
  const [emitted, setEmitted] = useState(value || "");
  useEffect(() => {
    if ((value || "") !== emitted) { setF(init(value)); setEmitted(value || ""); }
  }, [value]);

  const emit = (next) => {
    setF(next);
    const str = next.other ? next.text : formatColors(next);
    setEmitted(str);
    onChange(str);
  };
  const h = compact ? "h-8" : "h-9";
  const pill = (active) => `${compact ? "h-7" : "h-8"} px-2.5 rounded-md text-xs whitespace-nowrap ${active ? "bg-background shadow-sm font-medium text-slate-900" : "text-muted-foreground hover:text-foreground"}`;
  const group = (items, key) => (
    <div className={`inline-flex gap-0.5 p-0.5 rounded-lg bg-muted ${invalid && !f[key] && !f.other ? "ring-1 ring-red-200" : ""}`} role="group">
      {items.map((x) => (
        <button key={x} type="button" aria-pressed={!f.other && f[key] === x}
          onClick={() => emit({ ...f, other: false, [key]: f[key] === x && key === "side" ? "" : x })}
          className={pill(!f.other && f[key] === x)}>{x}</button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={ariaLabel}>
      {group(SIDES, "side")}
      {group(COLOR_COUNTS, "count")}
      <button type="button" aria-pressed={f.other}
        onClick={() => emit({ ...f, other: !f.other, text: f.other ? "" : (f.text || formatColors(f)) })}
        className={`${compact ? "h-7" : "h-8"} px-2.5 rounded-md border text-xs ${f.other ? "border-blue-300 bg-blue-50 text-blue-800 font-medium" : "bg-background text-muted-foreground hover:bg-blue-50 hover:text-blue-800"}`}>その他</button>
      {f.other && (
        <Input value={f.text} onChange={(e) => emit({ ...f, text: e.target.value })} placeholder="例: 表4色・裏1色、特色1色＋スミ" className={`${h} min-w-[10rem] flex-1`} aria-label={`${ariaLabel}（その他）`} autoFocus={!f.text} />
      )}
    </div>
  );
}
