import { Plus, Trash2, X } from "lucide-react";
import { useRowDrag, RowHandle } from "@/components/documents/RowDrag";
import { QUESTION_TYPE_LABEL } from "@/lib/proofForms";

// ============================================================================
// 校了フォームの中身を直す欄（新規の「内容を確かめる」と、作ったあとの「編集」で使う）
//   value: { title, description, items: [{ id, name, quantity, unit }], questions: [...], confirm_message }
// ============================================================================

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hasOptions = (t) => t === "checkbox" || t === "radio";
const input = "h-8 w-full rounded-md border px-2 text-sm";

/** 質問 1 つ */
function QuestionEditor({ q, onChange, onRemove, index, rowProps, handleProps }) {
  const set = (patch) => onChange({ ...q, ...patch });
  const options = q.options || [];
  const setOption = (k, v) => set({ options: options.map((o, j) => (j === k ? v : o)) });
  const isFinal = q.id === "final";
  return (
    <li {...rowProps} className={`group rounded-lg border bg-white p-3 space-y-2 ${rowProps.className}`} data-testid="proof-q-editor">
      <div className="flex items-start gap-2">
        <span className="mt-1"><RowHandle {...handleProps} /></span>
        <span className="mt-1.5 shrink-0 text-[11px] text-slate-400">質問{index + 1}</span>
        <input value={q.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder="質問の文" className={`${input} font-medium`} data-testid="proof-q-label" />
        <select value={q.type} onChange={(e) => { const t = e.target.value; set({ type: t, options: hasOptions(t) ? (options.length ? options : ["選択肢 1"]) : undefined }); }} className="h-8 shrink-0 rounded-md border bg-white px-1.5 text-xs" aria-label="答え方" data-testid="proof-q-type">
          {Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="mt-1.5 flex shrink-0 items-center gap-1 text-[11px] text-slate-600 cursor-pointer"><input type="checkbox" checked={!!q.required} onChange={(e) => set({ required: e.target.checked })} className="h-3.5 w-3.5 accent-rose-600" />必須</label>
        <button type="button" onClick={onRemove} className="mt-1 shrink-0 text-slate-400 hover:text-rose-600" title="この質問を消す" aria-label="この質問を消す"><Trash2 className="h-4 w-4" /></button>
      </div>
      <input value={q.help || ""} onChange={(e) => set({ help: e.target.value || undefined })} placeholder="補足（質問の下に小さく出る文。なくてもよい）" className="h-7 w-full rounded-md border px-2 text-xs text-slate-600" />
      {hasOptions(q.type) && (
        <div className="space-y-1 pl-1">
          {options.map((o, k) => (
            <div key={k} className="flex items-center gap-2">
              <span className={`h-3.5 w-3.5 shrink-0 border border-slate-400 ${q.type === "radio" ? "rounded-full" : "rounded-sm"}`} />
              <input value={o} onChange={(e) => setOption(k, e.target.value)} className="h-7 w-full rounded-md border px-2 text-xs" data-testid="proof-q-option" />
              {isFinal && k === 0 && <span className="shrink-0 rounded bg-emerald-50 px-1.5 text-[10px] text-emerald-700" title="この選択肢を選んだ回答を「校了」、ほかを「修正希望」として扱います">＝校了</span>}
              <button type="button" onClick={() => set({ options: options.filter((_, j) => j !== k) })} disabled={options.length <= 1} className="shrink-0 text-slate-400 hover:text-rose-600 disabled:opacity-20" aria-label="この選択肢を消す"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => set({ options: [...options, `選択肢 ${options.length + 1}`] })} className="ml-5 text-[11px] text-primary hover:underline">＋ 選択肢を追加</button>
        </div>
      )}
    </li>
  );
}

export default function ProofFormFields({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const items = value.items || [];
  const questions = value.questions || [];
  const setItem = (i, patch) => set({ items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  // つまんで上下に動かす（▲▼でも 1 つずつ）
  const itemDrag = useRowDrag(items, (next) => set({ items: next }), { keyOf: (it) => it._k || it.id });
  const qDrag = useRowDrag(questions, (next) => set({ questions: next }), { keyOf: (q) => q.id });
  return (
    <div className="space-y-4" data-testid="proof-fields">
      <label className="block space-y-1"><span className="block text-xs text-slate-500">フォームタイトル</span>
        <input value={value.title || ""} onChange={(e) => set({ title: e.target.value })} className="h-9 w-full rounded-lg border px-3 text-sm font-semibold" data-testid="proof-title" /></label>
      <label className="block space-y-1"><span className="block text-xs text-slate-500">フォームの説明</span>
        <textarea value={value.description || ""} onChange={(e) => set({ description: e.target.value })} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed" data-testid="proof-description" /></label>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-500">校了の対象（{items.length} 項目）</p>
        <ul className="rounded-lg border divide-y bg-slate-50/50">
          {items.map((it, i) => (
            <li key={it._k || it.id || i} {...itemDrag.rowProps(it)} className={`group flex items-center gap-2 bg-white px-2 py-1.5 ${itemDrag.rowProps(it).className}`} data-testid="proof-item-editor">
              <RowHandle {...itemDrag.handleProps(it, i)} />
              <input value={it.name || ""} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="項目名" className={input} data-testid="proof-item-name" />
              <input value={it.quantity ?? ""} onChange={(e) => setItem(i, { quantity: e.target.value === "" ? null : e.target.value })} inputMode="decimal" placeholder="数量" className="h-8 w-20 shrink-0 rounded-md border px-2 text-right text-sm tabular-nums" aria-label="数量" />
              <input value={it.unit || ""} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="単位" className="h-8 w-14 shrink-0 rounded-md border px-2 text-sm" aria-label="単位" />
              <button type="button" onClick={() => set({ items: items.filter((_, j) => j !== i) })} className="shrink-0 text-slate-400 hover:text-rose-600" title="この項目を外す" aria-label="この項目を外す"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-3 text-center text-xs text-slate-400">項目がありません（なくても作れます）</li>}
        </ul>
        <button type="button" onClick={() => set({ items: [...items, { _k: uid("it"), id: null, name: "", quantity: null, unit: "" }] })} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid="proof-item-add"><Plus className="h-3.5 w-3.5" />項目を追加</button>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-500">質問（{questions.length}）</p>
        <ol className="space-y-2">
          {questions.map((q, i) => (
            <QuestionEditor key={q.id} q={q} index={i} rowProps={qDrag.rowProps(q)} handleProps={qDrag.handleProps(q, i)}
              onChange={(nq) => set({ questions: questions.map((x, j) => (j === i ? nq : x)) })}
              onRemove={() => set({ questions: questions.filter((_, j) => j !== i) })} />
          ))}
        </ol>
        <button type="button" onClick={() => set({ questions: [...questions, { id: uid("q"), type: "text", label: "", required: false }] })} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid="proof-q-add"><Plus className="h-3.5 w-3.5" />質問を追加</button>
      </div>

      <label className="block space-y-1"><span className="block text-xs text-slate-500">送信後の確認メッセージ</span>
        <textarea value={value.confirm_message || ""} onChange={(e) => set({ confirm_message: e.target.value })} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed" data-testid="proof-confirm" /></label>
    </div>
  );
}

/** 保存の前に整える（空の項目・空の選択肢を外し、数量を数に）。問題があれば error を返す */
export function cleanProofFields(v) {
  const items = (v.items || []).filter((it) => String(it.name || "").trim())
    .map((it) => ({ id: it.id || null, name: String(it.name).trim(), quantity: it.quantity === "" || it.quantity == null || !Number.isFinite(Number(it.quantity)) ? null : Number(it.quantity), unit: it.unit || "" }));
  const questions = (v.questions || []).map((q) => {
    const out = { id: q.id, type: q.type, label: String(q.label || "").trim(), required: !!q.required };
    if (q.help && String(q.help).trim()) out.help = String(q.help).trim();
    if (hasOptions(q.type)) out.options = [...new Set((q.options || []).map((o) => String(o).trim()).filter(Boolean))];
    return out;
  });
  const bad = questions.find((q) => !q.label) ? "文が空の質問があります" : questions.find((q) => hasOptions(q.type) && !q.options.length) ? "選択肢が空の質問があります" : null;
  return { error: !String(v.title || "").trim() ? "フォームタイトルを入れてください" : bad, data: { title: String(v.title || "").trim(), description: v.description || "", items, questions, confirm_message: v.confirm_message || "" } };
}
