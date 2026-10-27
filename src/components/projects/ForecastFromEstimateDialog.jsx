import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { forecastLines, sumLines, defaultEstimate } from "@/lib/projectForecast";
import { submissionOf, SUBMISSION_STATUS } from "@/lib/submission";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;

/**
 * 案件の受注見込・発注見込を、見積の明細から入れる（今の見込みを置きかえる）。
 *   initial: { estimateId, lineIds } 前に入れたときのチェック（入れ直すとき）
 */
export default function ForecastFromEstimateDialog({ open, onOpenChange, project, estimates, initial = null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const candidates = useMemo(() => (estimates || []).filter((e) => (e.line_items || []).length), [estimates]);
  const [estimateId, setEstimateId] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const est = candidates.find((e) => e.id === estimateId) || null;
  const lines = useMemo(() => forecastLines(est), [est]);

  useEffect(() => {
    if (!open) return;
    const first = (initial?.estimateId && candidates.find((e) => e.id === initial.estimateId)) || defaultEstimate(candidates);
    setEstimateId(first?.id || null);
  }, [open]);
  useEffect(() => {
    if (!est) { setChecked(new Set()); return; }
    const all = forecastLines(est).map((l) => l.id);
    setChecked(new Set(initial?.estimateId === est.id && initial?.lineIds ? all.filter((id) => initial.lineIds.includes(id)) : all));
  }, [estimateId]);

  const sums = sumLines(lines, [...checked]);
  const gross = sums.revenue - sums.cost - (Number(project.other_cost) || 0);
  const noCost = lines.filter((l) => checked.has(l.id) && !l.hasCost && !l.isDiscount).length;
  const toggle = (id) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = lines.length > 0 && lines.every((l) => checked.has(l.id));

  const apply = useMutation({
    mutationFn: () => db.entities.Project.update(project.id, {
      expected_revenue: sums.revenue,
      expected_cost: sums.cost,
      forecast_source: {
        estimate_id: est.id, estimate_number: est.estimate_number || "", line_ids: [...checked],
        unchecked_ids: lines.filter((l) => !checked.has(l.id)).map((l) => l.id),
        revenue: sums.revenue, cost: sums.cost, applied_at: new Date().toISOString(), applied_by: user?.full_name || user?.email || "",
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`受注見込 ${yen(sums.revenue)}・発注見込 ${yen(sums.cost)} を入れました`);
      onOpenChange(false);
    },
    onError: (err) => toast.error("入れられませんでした: " + (err?.message || "不明なエラー")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="forecast-dialog">
        <DialogHeader>
          <DialogTitle>見積から受注見込・発注見込を入れる</DialogTitle>
          <DialogDescription>入れたい明細にチェックを付けてください。今の見込みは置きかわります（税抜）。</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">この案件には明細のある見積がまだありません。</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">見積</span>
              <select value={estimateId || ""} onChange={(e) => setEstimateId(e.target.value)} className="h-8 max-w-full rounded-md border bg-background px-2 text-xs" aria-label="見積を選ぶ">
                {candidates.map((e) => {
                  const st = SUBMISSION_STATUS[submissionOf(e)]?.label;
                  return <option key={e.id} value={e.id}>{e.estimate_number}　{e.estimate_title || ""}{e.revision_label && e.revision_label !== "初回" ? `（${e.revision_label}）` : ""}{st ? `［${st}］` : ""}</option>;
                })}
              </select>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="w-9 px-2 py-1.5"><Checkbox checked={allOn} onCheckedChange={(v) => setChecked(new Set(v ? lines.map((l) => l.id) : []))} aria-label="すべて" /></th>
                    <th className="px-2 py-1.5 text-left font-normal">明細</th>
                    <th className="px-2 py-1.5 text-right font-normal">数量</th>
                    <th className="px-2 py-1.5 text-right font-normal">金額（受注見込）</th>
                    <th className="px-2 py-1.5 text-right font-normal">原価 × 数量（発注見込）</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className={`border-t cursor-pointer hover:bg-blue-50/50 ${checked.has(l.id) ? "" : "text-muted-foreground"}`} onClick={() => toggle(l.id)} data-testid="forecast-line">
                      <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}><Checkbox checked={checked.has(l.id)} onCheckedChange={() => toggle(l.id)} /></td>
                      <td className="px-2 py-1.5"><span className="break-words">{l.name}</span>{l.category && <span className="ml-1.5 text-[10px] text-muted-foreground">{l.category}</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{l.qty.toLocaleString("ja-JP")}{l.unit}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${l.isDiscount ? "text-red-600" : ""}`}>{yen(l.revenue)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.hasCost ? yen(l.cost) : l.isDiscount ? <span className="text-muted-foreground">—</span> : <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700 ring-1 ring-amber-200">原価なし</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span>受注見込 <b className="text-base tabular-nums">{yen(sums.revenue)}</b></span>
              <span>発注見込 <b className="text-base tabular-nums">{yen(sums.cost)}</b></span>
              <span className="text-muted-foreground">粗利見込 <b className={`tabular-nums ${gross < 0 ? "text-destructive" : "text-emerald-700"}`}>{yen(gross)}</b>{sums.revenue > 0 && `（${Math.round((gross / sums.revenue) * 100)}%）`}{Number(project.other_cost) > 0 && "　※その他費用を引いた額"}</span>
            </div>
            {noCost > 0 && <p className="flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />原価の入っていない明細が {noCost} 件あります。発注見込が少なく出ている場合があります（見積の明細で原価を入れると反映できます）</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={() => apply.mutate()} disabled={!est || checked.size === 0 || apply.isPending} data-testid="forecast-apply">
            {apply.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}見込みに反映する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
