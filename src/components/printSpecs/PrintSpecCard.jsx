import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Printer, AlertTriangle, ArrowUp, ArrowDown, Trash2, Copy, Quote, Plus, X } from "lucide-react";
import SizeInput from "@/components/estimates/SizeInput";
import ColorCountInput from "@/components/estimates/ColorCountInput";
import ConfirmPopover from "@/components/ConfirmPopover";
import { SPEC_FIELDS, missingFields, markupForType, isPackageType, quantitiesOf } from "@/lib/printSpecList";
import { markupKindOf, MARKUP_KIND_LABELS } from "@/lib/markupKinds";

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
  if (readOnly) return <p className="min-h-8 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">{qs.length ? qs.map((q) => `${q.toLocaleString()}${unit}`).join("／") : "—"}</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }}
          onBlur={() => { if (draft && !qs.length) add(); }}
          inputMode="numeric" placeholder="枚数" className={`h-8 w-20 text-right tabular-nums ${missing ? "border-red-200 bg-red-50/40" : ""}`} aria-label={`${index + 1}件目の印刷枚数`} data-testid="qty-input" />
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2.5 hover:bg-blue-50 hover:text-blue-800" onClick={add} title="入れた枚数をパターンに足す（Enter でも足せます）" data-testid="qty-add"><Plus className="h-3.5 w-3.5" />追加</Button>
        <Input value={it.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value })} placeholder="単位" className="h-8 w-12 px-2" aria-label={`${index + 1}件目の単位`} />
      {qs.length > 0 && (
        <>
          {qs.map((q, i) => (
            <span key={q} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-200" data-testid="qty-chip">
              {qs.length > 1 && <span className="text-[10px] font-normal text-blue-500">パターン{i + 1}</span>}
              {q.toLocaleString()}{unit}
              <button type="button" onClick={() => setQs(qs.filter((x) => x !== q))} className="text-blue-400 hover:text-blue-700" aria-label={`${q}${unit}を外す`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </>
      )}
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
  const field = (key, label, node, { required = false, span = "" } = {}) => (
    <div className={`min-w-0 space-y-1 ${span}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
        {label}{required && <span className="text-destructive">*</span>}
        {miss.has(key) && <span className="rounded bg-red-50 px-1.5 text-[10px] font-normal text-red-600 ring-1 ring-red-200">未確認</span>}
      </p>
      {node}
    </div>
  );
  const text = (key, placeholder, { numeric = false } = {}) => (readOnly
    ? <p className={`min-h-8 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-2.5 py-1.5 text-sm ${it[key] ? "" : "text-muted-foreground"}`}>{it[key] || "—"}</p>
    : <Input value={it[key] ?? ""} type={numeric ? "number" : "text"} placeholder={placeholder}
        onChange={(e) => set({ [key]: numeric ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })}
        className={`h-8 ${numeric ? "text-right tabular-nums" : ""} ${miss.has(key) ? "border-red-200 bg-red-50/40" : ""}`} aria-label={`${index + 1}件目の${LABEL[key] || key}`} />);

  return (
    <div className="rounded-xl border bg-white shadow-sm" data-testid="print-spec-row">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          <Printer className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="shrink-0 text-sm font-bold">印刷物 {index + 1}</span>
          <span className="min-w-0 break-words text-sm font-semibold text-slate-800">{it.name || <span className="font-normal text-muted-foreground">（品目を入れてください）</span>}</span>
          {!open && <span className="hidden min-w-0 truncate text-xs text-muted-foreground lg:inline">{summaryOf(it)}</span>}
        </button>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${isPackageType(it.print_type) ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-700"}`}>× {markupForType(rules, it.print_type)}（{MARKUP_KIND_LABELS[markupKindOf(rules, it.print_type).kind]}）</span>
        {miss.size > 0 && <span className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{[...miss].map((k) => LABEL[k]).join("・")}が未確認</span>}
        {!readOnly && (
          <span className="flex items-center">
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-blue-50 hover:text-blue-800" disabled={index === 0} onClick={() => onMove(-1)} aria-label="上へ"><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-blue-50 hover:text-blue-800" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="下へ"><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-blue-50 hover:text-blue-800" onClick={onDuplicate} aria-label="複製" title="複製"><Copy className="h-3.5 w-3.5" /></Button>
            <ConfirmPopover message={<>「<b>{it.name || `印刷物 ${index + 1}`}</b>」を消しますか？</>} onConfirm={onRemove}>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-red-50 hover:text-destructive data-[state=open]:bg-red-50 data-[state=open]:text-destructive" aria-label="消す" title="消す"><Trash2 className="h-3.5 w-3.5" /></Button>
            </ConfirmPopover>
          </span>
        )}
      </div>

      {open && (
        <div className="grid gap-x-3 gap-y-2.5 border-t px-3 py-3 sm:grid-cols-2 lg:grid-cols-12">
          {field("name", "品目", text("name", "例: 天然トラフグ贅沢セット 掛け紙"), { required: true, span: "lg:col-span-5" })}
          {field("print_type", "印刷物種別", readOnly
            ? <p className="min-h-8 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">{it.print_type || "—"}</p>
            : (
              <select value={it.print_type || ""} onChange={(e) => set({ print_type: e.target.value })} className={`h-8 w-full rounded-md border bg-background px-2 text-sm ${it.print_type ? "" : "border-amber-300"}`} aria-label={`${index + 1}件目の印刷物種別`}>
                <option value="">選択してください</option>
                {printTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ), { required: true, span: "lg:col-span-4" })}
          {field("due", "希望納期", text("due", "例: 11/30、10/13〜10/16"), { span: "sm:col-span-2 lg:col-span-3" })}
          {field("size", "サイズ", readOnly
            ? <p className="min-h-8 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">{it.size || "—"}</p>
            : <div className={miss.has("size") ? "rounded-md ring-1 ring-red-200" : ""}><SizeInput compact value={it.size || ""} onChange={(v) => set({ size: v })} /></div>, { required: true, span: "sm:col-span-2 lg:col-span-12" })}
          {field("colors", "印刷色数", readOnly ? text("colors") : <ColorCountInput compact value={it.colors || ""} onChange={(v) => set({ colors: v })} invalid={miss.has("colors")} ariaLabel={`${index + 1}件目の印刷色数`} />, { required: true, span: "sm:col-span-2 lg:col-span-12" })}
          {field("paper", "紙質・素材", text("paper", "例: コート紙135kg、PETフィルム"), { required: true, span: "lg:col-span-6" })}
          {field("finishing", "加工・オプション", text("finishing", "例: PP加工、折り加工（二つ折り）、角丸"), { span: "lg:col-span-6" })}
          {field("quantity", <>印刷枚数 <span className="font-normal text-muted-foreground">（複数パターン可・枚数ごとに見積）</span></>, <QuantityInput item={it} readOnly={readOnly} missing={miss.has("quantity")} onChange={set} index={index} />, { required: true, span: "sm:col-span-2 lg:col-span-6" })}
          {field("notes", "備考（印刷会社への伝達事項）", readOnly
            ? <p className="min-h-8 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">{it.notes || "—"}</p>
            : <Textarea value={it.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} rows={1} placeholder="例: 入稿データは Illustrator。送料込みで見積ください" className="min-h-8 max-h-40 resize-y py-1.5 [field-sizing:content]" />, { span: "sm:col-span-2 lg:col-span-6" })}
          {it.basis && (
            <p className="flex items-start gap-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 sm:col-span-2 lg:col-span-12"><Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="whitespace-pre-wrap break-words"><b className="mr-1 font-medium text-slate-500">議事録の根拠</b>{it.basis}</span></p>
          )}
        </div>
      )}
    </div>
  );
}
