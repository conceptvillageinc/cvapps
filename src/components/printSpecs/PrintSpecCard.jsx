import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Printer, AlertTriangle, ArrowUp, ArrowDown, Trash2, Copy, Quote, Plus, X } from "lucide-react";
import SizeInput from "@/components/estimates/SizeInput";
import { SPEC_FIELDS, missingFields, markupForType, isPackageType, quantitiesOf } from "@/lib/printSpecList";

const LABEL = Object.fromEntries(SPEC_FIELDS.map((f) => [f.key, f.label]));

/** 1 行の短いまとめ（たたんだときに出す） */
function summaryOf(it) {
  const qs = quantitiesOf(it);
  return [it.size, it.paper, it.colors, it.finishing, qs.length ? qs.map((q) => `${q.toLocaleString()}${it.unit || ""}`).join("／") : "", it.due].filter(Boolean).join("・");
}

/** 印刷枚数（複数パターン可）。入れて「追加」で 1 つずつ足す。先頭が基本の枚数 */
function QuantityInput({ item: it, readOnly, missing, onChange, index }) {
  const [draft, setDraft] = useState("");
  const qs = quantitiesOf(it);
  const setQs = (next) => onChange({ quantities: next.length > 1 ? next : [], quantity: next[0] ?? "" });
  const add = () => {
    const n = Number(String(draft).replace(/[,，\s枚部個]/g, ""));
    if (!(n > 0)) return;
    if (!qs.includes(n)) setQs([...qs, n]);
    setDraft("");
  };
  const unit = it.unit || "枚";
  if (readOnly) return <p className="min-h-9 rounded-md bg-slate-50 px-3 py-2 text-sm">{qs.length ? qs.map((q) => `${q.toLocaleString()}${unit}`).join("／") : "—"}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }}
          onBlur={() => { if (draft && !qs.length) add(); }}
          inputMode="numeric" placeholder="枚数" className={`w-28 text-right tabular-nums ${missing ? "border-red-200 bg-red-50/40" : ""}`} aria-label={`${index + 1}件目の印刷枚数`} data-testid="qty-input" />
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1 hover:bg-blue-50 hover:text-blue-800" onClick={add} data-testid="qty-add"><Plus className="h-3.5 w-3.5" />追加</Button>
        <Input value={it.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} placeholder="単位" className="w-16" aria-label={`${index + 1}件目の単位`} />
      </div>
      {qs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {qs.map((q, i) => (
            <span key={q} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 ring-1 ring-blue-200" data-testid="qty-chip">
              {qs.length > 1 && <span className="text-[10px] font-normal text-blue-500">パターン{i + 1}</span>}
              {q.toLocaleString()}{unit}
              <button type="button" onClick={() => setQs(qs.filter((x) => x !== q))} className="text-blue-400 hover:text-blue-700" aria-label={`${q}${unit}を外す`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {qs.length > 1 && <p className="text-[11px] text-muted-foreground">枚数ごとに仕入を入れ、社内見積・見積書には枚数ごとの行で出します</p>}
    </div>
  );
}

/**
 * 印刷物 1 件分の仕様（見積の「印刷所に見積を依頼する」の印刷仕様と同じ形）。
 * 議事録で決まっていない必須の項目は、見出しに「未確認」を付けて薄い赤で知らせる。
 */
export default function PrintSpecCard({ item: it, index, count, printTypes, rules, readOnly, onChange, onMove, onDuplicate, onRemove, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const miss = new Set(missingFields(it));
  const set = (patch) => onChange(patch);
  const field = (key, label, node, { required = false, wide = false } = {}) => (
    <div className={`space-y-1.5 ${wide ? "md:col-span-2" : ""}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium">
        {label}{required && <span className="text-destructive">*</span>}
        {miss.has(key) && <span className="rounded bg-red-50 px-1.5 text-[10px] font-normal text-red-600 ring-1 ring-red-200">未確認</span>}
      </p>
      {node}
    </div>
  );
  const text = (key, placeholder, { numeric = false } = {}) => (readOnly
    ? <p className={`min-h-9 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm ${it[key] ? "" : "text-muted-foreground"}`}>{it[key] || "—"}</p>
    : <Input value={it[key] ?? ""} type={numeric ? "number" : "text"} placeholder={placeholder}
        onChange={(e) => set({ [key]: numeric ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })}
        className={`${numeric ? "text-right tabular-nums" : ""} ${miss.has(key) ? "border-red-200 bg-red-50/40" : ""}`} aria-label={`${index + 1}件目の${LABEL[key] || key}`} />);

  return (
    <div className="rounded-xl border bg-white shadow-sm" data-testid="print-spec-row">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          <Printer className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="shrink-0 text-sm font-bold">印刷物 {index + 1}</span>
          <span className="min-w-0 break-words text-sm font-semibold text-slate-800">{it.name || <span className="font-normal text-muted-foreground">（品目を入れてください）</span>}</span>
          {!open && <span className="hidden min-w-0 truncate text-xs text-muted-foreground lg:inline">{summaryOf(it)}</span>}
        </button>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${isPackageType(it.print_type) ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-700"}`}>× {markupForType(rules, it.print_type)}（{isPackageType(it.print_type) ? "パッケージ" : "パッケージ以外"}）</span>
        {miss.size > 0 && <span className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{[...miss].map((k) => LABEL[k]).join("・")}が未確認</span>}
        {!readOnly && (
          <span className="flex items-center">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label="上へ"><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="下へ"><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDuplicate} aria-label="複製" title="複製"><Copy className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="消す" title="消す"><Trash2 className="h-3.5 w-3.5" /></Button>
          </span>
        )}
      </div>

      {open && (
        <div className="grid gap-4 border-t px-4 pb-4 pt-4 md:grid-cols-2">
          {field("name", "品目", text("name", "例: 天然トラフグ贅沢セット 掛け紙"), { required: true })}
          {field("print_type", "印刷物種別", readOnly
            ? <p className="min-h-9 rounded-md bg-slate-50 px-3 py-2 text-sm">{it.print_type || "—"}</p>
            : (
              <select value={it.print_type || ""} onChange={(e) => set({ print_type: e.target.value })} className={`h-9 w-full rounded-md border bg-background px-3 text-sm ${it.print_type ? "" : "border-amber-300"}`} aria-label={`${index + 1}件目の印刷物種別`}>
                <option value="">選択してください</option>
                {printTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ), { required: true })}
          {field("size", <>サイズ <span className="font-normal text-muted-foreground">（数字だけ入れると 000mm×000mm の形になります）</span></>, readOnly
            ? <p className="min-h-9 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm">{it.size || "—"}</p>
            : <div className={miss.has("size") ? "rounded-md ring-1 ring-red-200" : ""}><SizeInput value={it.size || ""} onChange={(v) => set({ size: v })} /></div>, { required: true, wide: true })}
          {field("paper", "紙質・素材", text("paper", "例: コート紙135kg、PETフィルム"), { required: true })}
          {field("colors", "印刷色数", text("colors", "例: 4色(CMYK)、両面4色"), { required: true })}
          {field("quantity", <>印刷枚数 <span className="font-normal text-muted-foreground">（複数パターン可）</span></>, <QuantityInput item={it} readOnly={readOnly} missing={miss.has("quantity")} onChange={set} index={index} />, { required: true })}
          {field("due", "希望納期", text("due", "例: 11/30、10/13〜10/16"))}
          {field("finishing", "加工・オプション", text("finishing", "例: PP加工、折り加工（二つ折り）、角丸"))}
          {field("notes", "備考（印刷会社への伝達事項）", readOnly
            ? <p className="min-h-9 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm">{it.notes || "—"}</p>
            : <Textarea value={it.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="例: 入稿データは Illustrator。送料込みで見積ください" className="min-h-[60px]" />, { wide: false })}
          {it.basis && (
            <p className="flex items-start gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 md:col-span-2"><Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="whitespace-pre-wrap break-words"><b className="mr-1 font-medium text-slate-500">議事録の根拠</b>{it.basis}</span></p>
          )}
        </div>
      )}
    </div>
  );
}
