import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { docItemsFromEstimate } from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/** ほかの納品書に入った見積の明細（見積の明細 id → 納品書番号） */
export function deliveredElsewhereMap(siblings, noteId) {
  const m = new Map();
  for (const n of siblings || []) {
    if (n.id === noteId) continue;
    for (const li of n.line_items || []) if (li.source_line_id && !m.has(li.source_line_id)) m.set(li.source_line_id, n.delivery_number || "別の納品書");
  }
  return m;
}

/**
 * 納品書: 見積の明細から、今回納品する行を選ぶ（分納）。
 *   チェックした行が納品書の明細になる（直した数量・単価はそのまま残す）。見積に無い行（手で足した行）は下に残る。
 *   ほかの納品書に入れた行には「D-2610-001 で納品済」を出し、最初は外しておく。
 * @param {object} p
 * @param {object} p.estimate
 * @param {object[]} p.siblings  同じ見積から作った納品書
 * @param {string|null} p.noteId  この納品書の id（新規は null）
 * @param {object[]} p.items     納品書の明細
 * @param {(items: object[]) => void} p.onChange
 */
export default function DeliveryLinePicker({ estimate, siblings, noteId, items, onChange, disabled = false }) {
  const estItems = useMemo(() => docItemsFromEstimate(estimate), [estimate]);
  const elsewhere = useMemo(() => deliveredElsewhereMap(siblings, noteId), [siblings, noteId]);
  const inNote = new Map(items.filter((li) => li.source_line_id).map((li) => [li.source_line_id, li]));

  // 選び直した結果: 見積の順で選んだ行 → 見積に無い行
  const rebuild = (picked) => {
    const ownIds = new Set(estItems.map((li) => li.source_line_id));
    const rows = estItems.filter((li) => picked.has(li.source_line_id)).map((li) => inNote.get(li.source_line_id) || li);
    const others = items.filter((li) => !li.source_line_id || !ownIds.has(li.source_line_id));
    onChange([...rows, ...others]);
  };
  const toggle = (sid) => {
    const picked = new Set(inNote.keys());
    if (picked.has(sid)) picked.delete(sid); else picked.add(sid);
    rebuild(picked);
  };

  const sum = (rows) => rows.reduce((s, li) => s + (Number(li.amount) || 0), 0);
  const total = sum(estItems);
  const here = sum(estItems.filter((li) => inNote.has(li.source_line_id)).map((li) => inNote.get(li.source_line_id)));
  const other = sum(estItems.filter((li) => !inNote.has(li.source_line_id) && elsewhere.has(li.source_line_id)));
  const rest = Math.max(0, total - here - other);
  if (estItems.length === 0) return null;

  return (
    <Card data-testid="delivery-line-picker">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">見積 {estimate.estimate_number} の明細から、今回納品する行を選ぶ</CardTitle>
          <div className="ml-auto flex gap-1.5">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={disabled} onClick={() => rebuild(new Set(estItems.filter((li) => !elsewhere.has(li.source_line_id) || inNote.has(li.source_line_id)).map((li) => li.source_line_id)))}>まだ納品していない行を全部選ぶ</Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={disabled} onClick={() => rebuild(new Set())}>全部外す</Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          見積 {yen(total)}（税抜）のうち{"　"}この納品書 <b className="text-foreground">{yen(here)}</b>
          {other > 0 && <>{"　"}ほかの納品書で納品済 {yen(other)}</>}
          {"　"}まだ納品していない <b className={rest > 0 ? "text-amber-700" : "text-foreground"}>{yen(rest)}</b>
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-md border divide-y max-h-72 overflow-y-auto">
          {estItems.map((src) => {
            const on = inNote.has(src.source_line_id);
            const done = elsewhere.get(src.source_line_id);
            return (
              <label key={src.source_line_id} className={`flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/40 ${on ? "" : "text-muted-foreground"}`} data-testid="delivery-line-option">
                <Checkbox checked={on} disabled={disabled} onCheckedChange={() => toggle(src.source_line_id)} aria-label={`${src.name} を納品する`} />
                <span className="flex-1 min-w-0 truncate">{src.name}</span>
                {done && <span className="shrink-0 rounded bg-sky-50 border border-sky-200 px-1.5 text-[10px] text-sky-800">{done} で納品済</span>}
                <span className="shrink-0 tabular-nums w-24 text-right">{Number(src.quantity).toLocaleString()}{src.unit}</span>
                <span className="shrink-0 tabular-nums w-24 text-right">{yen(src.amount)}</span>
              </label>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
