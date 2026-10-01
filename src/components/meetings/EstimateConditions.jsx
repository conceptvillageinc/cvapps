import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Printer, Palette, FileText, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import {
  WORK_KINDS, WORK_OWNERS, PRINT_FIELDS, WORK_FIELDS,
  newPrintCondition, newWorkCondition, newDesignItem, workBuildCost, missingFields, isDesignByMaster,
} from "@/lib/meetingConditions";
import { useDesignFeeMaster } from "@/lib/designFees";
import { designItemsTotal } from "@/lib/designCatalog";

const yen = (v) => {
  const n = Number(String(v ?? "").replace(/[,¥￥円\s]/g, ""));
  return Number.isFinite(n) && n !== 0 ? `¥${Math.round(n).toLocaleString()}` : "";
};

/** 内容に合わせて高さが伸びる 1 行入力（長い文章は折り返して全文が見える。Enter で改行はしない） */
function GrowInput({ value, onChange, className = "", ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      rows={1}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, " "))}
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      className={`min-h-0 resize-none overflow-hidden px-2.5 py-1.5 text-xs leading-snug ${className}`}
      {...props}
    />
  );
}

/** 1 項目分の入力欄。空欄は黄色（未確認）、下に根拠の発言（全文を折り返して表示） */
function Field({ label, value, onChange, evidence, type = "text", placeholder = "未確認", className = "", readOnly = false, optional = false, children }) {
  // 任意の項目（予算・実費）は空でも「未確認」にしない
  const empty = !optional && (value === "" || value === null || value === undefined);
  const tone = readOnly ? "bg-muted/60" : empty ? "bg-amber-50 border-amber-300 placeholder:text-amber-700/70" : "";
  return (
    <div className={`space-y-0.5 min-w-0 ${className}`}>
      <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
      {children || (type === "text"
        ? <GrowInput value={value} onChange={onChange} placeholder={placeholder} readOnly={readOnly} className={tone} />
        : <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} className={`h-8 text-xs ${tone}`} />
      )}
      <p className={`text-xs leading-snug break-words ${empty && !readOnly ? "text-amber-700" : "text-muted-foreground"}`}>
        {evidence ? `「${evidence}」` : empty && !readOnly ? "発言なし" : " "}
      </p>
    </div>
  );
}

function PrintCard({ item, index, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...item, [k]: v });
  const missing = missingFields(item, "print");
  const ev = item.evidence || {};
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Printer className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-bold">印刷物 {index + 1}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${missing.length === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {missing.length === 0 ? "すべて入力済み" : `未確認 ${missing.length} 項目`}
        </span>
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="この印刷物を削除"><Trash2 className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label={PRINT_FIELDS[0][1]} value={item.print_type} onChange={(v) => set("print_type", v)} evidence={ev.print_type} placeholder="例: チラシ・フライヤー" />
        <Field label={PRINT_FIELDS[1][1]} value={item.quantities} onChange={(v) => set("quantities", v)} evidence={ev.quantities} placeholder="例: 2000 / 3000" />
        <Field label={PRINT_FIELDS[2][1]} value={item.size} onChange={(v) => set("size", v)} evidence={ev.size} placeholder="例: A4、100mm×80mm" />
        <Field label={PRINT_FIELDS[3][1]} value={item.paper_type} onChange={(v) => set("paper_type", v)} evidence={ev.paper_type} placeholder="例: コート紙 110kg" />
        <Field label={PRINT_FIELDS[4][1]} value={item.color_count} onChange={(v) => set("color_count", v)} evidence={ev.color_count} placeholder="例: 両面4C" />
        <Field label={PRINT_FIELDS[5][1]} value={item.finishing} onChange={(v) => set("finishing", v)} evidence={ev.finishing} placeholder="例: PP、折り" />
        <Field label={PRINT_FIELDS[6][1]} value={item.due_date} onChange={(v) => set("due_date", v)} evidence={ev.due_date} type="date" />
        <Field label={PRINT_FIELDS[7][1]} value={item.budget} onChange={(v) => set("budget", v)} evidence={ev.budget} placeholder="任意" optional />
      </div>
    </div>
  );
}

/** デザイン費マスタから選んだ項目の一覧と、追加の選択 */
function DesignItemsField({ item, groups, onChange }) {
  const items = item.design_items || [];
  const setItems = (design_items) => onChange({ ...item, design_items });
  const addByKey = (key) => {
    if (!key) return;
    const [ci, ii] = key.split(":").map(Number);
    const g = groups[ci]; const m = g?.items?.[ii];
    if (!m) return;
    setItems([...items, newDesignItem({ master_id: m.id || null, category: g.category, name: m.name, selling_price: Number(m.selling_price ?? m.amount) || 0, quantity: 1 })]);
  };
  const total = designItemsTotal(items);
  const none = items.length === 0;
  return (
    <div className="col-span-2 md:col-span-4 space-y-1 min-w-0">
      <p className="text-[10px] font-semibold text-muted-foreground">デザイン費マスタの項目</p>
      {none ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">デザイン費マスタに当てはまる項目が見つかりませんでした</p>
          {item.design_note && <p className="break-words">{item.design_note}</p>}
          <p className="text-[11px] text-amber-700">下から項目を選ぶか、「人日で見積る」に切り替えてください。どちらもしない場合は、金額 0 の明細として見積に入ります。</p>
        </div>
      ) : (
        <div className="rounded-md border bg-background divide-y">
          {items.map((d) => (
            <div key={d.id} className="flex items-start gap-2 px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-snug break-words">{d.name}</p>
                <p className="text-[10px] text-muted-foreground break-words">{d.category}{d.reason ? `　「${d.reason}」` : ""}</p>
              </div>
              <Input value={d.quantity ?? 1} onChange={(e) => setItems(items.map((x) => (x.id === d.id ? { ...x, quantity: e.target.value } : x)))} className="h-7 w-14 text-xs text-right" aria-label="数量" />
              <span className="text-xs tabular-nums w-24 text-right pt-1.5">{yen(Number(String(d.selling_price).replace(/,/g, "")) * (Number(d.quantity) || 1)) || "¥0"}</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setItems(items.filter((x) => x.id !== d.id))} aria-label="この項目を外す"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-end gap-2 px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">デザイン費（税別）</span><span className="font-semibold tabular-nums">{yen(total) || "¥0"}</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value="" onChange={(e) => addByKey(e.target.value)} className="h-8 max-w-full rounded-md border bg-background px-2 text-xs" aria-label="マスタから項目を追加">
          <option value="">＋ マスタから項目を追加…</option>
          {groups.map((g, ci) => (
            <optgroup key={g.category} label={g.category}>
              {(g.items || []).map((m, ii) => <option key={`${ci}:${ii}`} value={`${ci}:${ii}`}>{m.name}　{yen(m.selling_price ?? m.amount)}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => onChange({ ...item, pricing: "days" })}>人日で見積る</button>
      </div>
    </div>
  );
}

function WorkCard({ item, index, onChange, onRemove, groups }) {
  const set = (k, v) => onChange({ ...item, [k]: v });
  const missing = missingFields(item, "work");
  const ev = item.evidence || {};
  const build = workBuildCost(item);
  const byMaster = isDesignByMaster(item);
  const kindLabel = WORK_KINDS.find((k) => k.key === item.kind)?.label || "";
  return (
    <div className="rounded-lg border border-emerald-200 bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Palette className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-bold">制作・開発 {index + 1}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${missing.length === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {missing.length === 0 ? "すべて入力済み" : `未確認 ${missing.length} 項目`}
        </span>
        <span className="text-[10px] text-muted-foreground">{byMaster ? "デザイン費マスタの項目で見積るもの" : item.kind === "design" ? "デザイン（人日で見積る）" : "人日で見積るもの（システム構築・web構築）"}</span>
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="この制作・開発を削除"><Trash2 className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label={WORK_FIELDS[0][1]} value={item.kind} evidence={ev.kind}>
          <Select value={item.kind} onValueChange={(v) => set("kind", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{WORK_KINDS.map((k) => <SelectItem key={k.key} value={k.key} className="text-xs">{k.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field className="md:col-span-3" label={WORK_FIELDS[1][1]} value={item.description} onChange={(v) => set("description", v)} evidence={ev.description} placeholder={item.kind === "design" ? "例: A4 チラシ 表裏のデザイン" : "例: 予約フォーム（受付・自動返信メール・管理画面）"} />
        {byMaster ? (
          <DesignItemsField item={item} groups={groups} onChange={onChange} />
        ) : (
          <>
            <Field label={WORK_FIELDS[2][1]} value={item.days} onChange={(v) => set("days", v)} evidence={ev.days} placeholder="例: 5" />
            <Field label={WORK_FIELDS[3][1]} value={item.day_rate} onChange={(v) => set("day_rate", v)} evidence={ev.day_rate} placeholder="例: 60000" />
          </>
        )}
        <Field label={WORK_FIELDS[4][1]} value={item.owner} evidence={ev.owner}>
          <Select value={item.owner} onValueChange={(v) => set("owner", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{WORK_OWNERS.map((o) => <SelectItem key={o.key} value={o.key} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={WORK_FIELDS[5][1]} value={item.due_date} onChange={(v) => set("due_date", v)} evidence={ev.due_date} type="date" />
        {byMaster ? (
          <Field label={`${kindLabel}費（税別・自動）`} value={build ? String(build) : ""} readOnly evidence={build ? `マスタの項目 ${item.design_items.length} 件の合計` : ""} placeholder="項目の合計" />
        ) : (
          <Field label="構築費（税別・自動）" value={build ? String(build) : ""} readOnly evidence={build ? `${item.days} 人日 × ¥${Number(String(item.day_rate).replace(/,/g, "")).toLocaleString()}` : ""} placeholder="人日 × 単価" />
        )}
        <Field label={WORK_FIELDS[6][1]} value={item.other_cost} onChange={(v) => set("other_cost", v)} evidence={ev.other_cost} placeholder="任意" optional />
        <Field label={WORK_FIELDS[7][1]} value={item.budget} onChange={(v) => set("budget", v)} evidence={ev.budget} placeholder="任意" optional />
      </div>
      {item.kind === "design" && !byMaster && (
        <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => onChange({ ...item, pricing: "master" })}>デザイン費マスタの項目から選ぶ</button>
      )}
    </div>
  );
}

/**
 * 議事録の「見積条件」。印刷物と制作・開発を持ち、「この条件で見積を作る」で新しい見積に流し込む。
 */
export default function EstimateConditions({ value, onChange, meeting, onCreateEstimate, creating }) {
  const c = value;
  const setPrints = (prints) => onChange({ ...c, prints });
  const setWorks = (works) => onChange({ ...c, works });
  const totalMissing = useMemo(
    () => c.prints.reduce((n, p) => n + missingFields(p, "print").length, 0) + c.works.reduce((n, w) => n + missingFields(w, "work").length, 0),
    [c],
  );
  const buildTotal = c.works.reduce((s, w) => s + workBuildCost(w), 0);
  const empty = c.prints.length === 0 && c.works.length === 0;
  const { groups: designGroups } = useDesignFeeMaster();

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">見積条件</p>
        <p className="text-[11px] text-muted-foreground">打ち合わせから読み取った条件。直してから見積に流し込みます</p>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setWorks([...c.works, newWorkCondition()])}><Plus className="w-3 h-3" /> 制作・開発を追加</Button>
        <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setPrints([...c.prints, newPrintCondition()])}><Plus className="w-3 h-3" /> 印刷物を追加</Button>
      </div>

      {empty && <p className="text-[11px] text-muted-foreground">まだ条件がありません。議事録の作成時に自動で入るほか、上のボタンで手で足せます。</p>}
      {c.prints.map((p, i) => (
        <PrintCard key={p.id} item={p} index={i} onChange={(next) => setPrints(c.prints.map((x) => (x.id === p.id ? next : x)))} onRemove={() => setPrints(c.prints.filter((x) => x.id !== p.id))} />
      ))}
      {c.works.map((w, i) => (
        <WorkCard key={w.id} item={w} index={i} groups={designGroups} onChange={(next) => setWorks(c.works.map((x) => (x.id === w.id ? next : x)))} onRemove={() => setWorks(c.works.filter((x) => x.id !== w.id))} />
      ))}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">全体の予算（税別）</p>
          <Input value={c.budget ?? ""} onChange={(e) => onChange({ ...c, budget: e.target.value })} placeholder="例: 150000" className="h-8 w-32 text-xs" />
          {c.budget_evidence && <span className="text-[10px] text-muted-foreground truncate max-w-[260px]" title={c.budget_evidence}>「{c.budget_evidence}」</span>}
        </div>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          {buildTotal > 0 && <>制作・開発の費用 {yen(buildTotal)}　</>}
          {totalMissing > 0 ? <span className="text-amber-700">未確認 {totalMissing} 項目（空のまま見積に入ります）</span> : !empty && <span className="text-emerald-700">すべて入力済み</span>}
        </span>
        {meeting?.estimate_id ? (
          <Link to={`/estimates/${meeting.estimate_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <FileText className="w-3.5 h-3.5" /> 作成した見積を開く <ExternalLink className="w-3 h-3" />
          </Link>
        ) : null}
        <Button type="button" size="sm" className="h-8 text-xs gap-1.5" onClick={onCreateEstimate} disabled={creating || empty}>
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} この条件で見積を作る（新しいタブ）
        </Button>
      </div>
    </div>
  );
}
