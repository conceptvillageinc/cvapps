import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { forecastLines, forecastSources, defaultForecastEstimateIds, isOldRevision } from "@/lib/projectForecast";
import { submissionOf, SUBMISSION_STATUS } from "@/lib/submission";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;
const keyOf = (estimateId, lineId) => `${estimateId}:${lineId}`;

/**
 * 案件の受注見込・発注見込を、見積の明細から入れる（今の見込みを置きかえる）。
 *   案件に紐づく見積の明細をまとめて並べ、見積をまたいでチェックした明細の合計を入れる。
 *   最初は、失注の見積と改訂前の古い版を除いた見積の明細を全部チェックする（失注の見積は薄く出す）。
 *   initial: forecast_source（前に入れたときのチェック。入れ直すとき）
 */
export default function ForecastFromEstimateDialog({ open, onOpenChange, project, estimates, initial = null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // 明細のある見積。失注していないものを先に、新しい順
  const candidates = useMemo(() => {
    const list = (estimates || []).filter((e) => (e.line_items || []).length);
    const lost = (e) => (submissionOf(e) === "lost" ? 1 : 0);
    return [...list].sort((a, b) => lost(a) - lost(b) || String(b.created_date || "").localeCompare(String(a.created_date || "")));
  }, [estimates]);
  const linesOf = useMemo(() => Object.fromEntries(candidates.map((e) => [e.id, forecastLines(e)])), [candidates]);
  const [checked, setChecked] = useState(new Set());

  useEffect(() => {
    if (!open) return;
    const prev = forecastSources(initial);
    if (prev.length) {
      setChecked(new Set(prev.flatMap((s) => (s.line_ids || []).map((id) => keyOf(s.estimate_id, id)))));
    } else {
      const ids = new Set(defaultForecastEstimateIds(candidates));
      setChecked(new Set(candidates.filter((e) => ids.has(e.id)).flatMap((e) => linesOf[e.id].map((l) => keyOf(e.id, l.id)))));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const picked = candidates.flatMap((e) => linesOf[e.id].filter((l) => checked.has(keyOf(e.id, l.id))));
  const sums = picked.reduce((s, l) => ({ revenue: s.revenue + l.revenue, cost: s.cost + l.cost }), { revenue: 0, cost: 0 });
  const gross = sums.revenue - sums.cost - (Number(project.other_cost) || 0);
  const noCost = picked.filter((l) => !l.hasCost && !l.isDiscount).length;
  const usedEstimates = candidates.filter((e) => linesOf[e.id].some((l) => checked.has(keyOf(e.id, l.id))));
  const toggle = (k) => setChecked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const setEstimate = (e, on) => setChecked((s) => { const n = new Set(s); for (const l of linesOf[e.id]) { const k = keyOf(e.id, l.id); if (on) n.add(k); else n.delete(k); } return n; });

  const apply = useMutation({
    mutationFn: () => db.entities.Project.update(project.id, {
      expected_revenue: sums.revenue,
      expected_cost: sums.cost,
      forecast_source: {
        sources: usedEstimates.map((e) => ({
          estimate_id: e.id, estimate_number: e.estimate_number || "",
          line_ids: linesOf[e.id].filter((l) => checked.has(keyOf(e.id, l.id))).map((l) => l.id),
          unchecked_ids: linesOf[e.id].filter((l) => !checked.has(keyOf(e.id, l.id))).map((l) => l.id),
        })),
        revenue: sums.revenue, cost: sums.cost, applied_at: new Date().toISOString(), applied_by: user?.full_name || user?.email || "",
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`受注見込 ${yen(sums.revenue)}・発注見込 ${yen(sums.cost)} を入れました（見積 ${usedEstimates.length}件の明細 ${picked.length}件）`);
      onOpenChange(false);
    },
    onError: (err) => toast.error("入れられませんでした: " + (err?.message || "不明なエラー")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="forecast-dialog">
        <DialogHeader>
          <DialogTitle>見積から受注見込・発注見込を入れる</DialogTitle>
          <DialogDescription>
            入れたい明細にチェックを付けてください。見積をまたいでチェックした明細の合計が入ります。今の見込みは置きかわります（税抜）。
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">この案件には明細のある見積がまだありません。</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="w-9 px-2 py-1.5"></th>
                    <th className="px-2 py-1.5 text-left font-normal">明細</th>
                    <th className="px-2 py-1.5 text-right font-normal">数量</th>
                    <th className="px-2 py-1.5 text-right font-normal">金額（受注見込）</th>
                    <th className="px-2 py-1.5 text-right font-normal">原価 × 数量（発注見込）</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((e) => {
                    const lines = linesOf[e.id];
                    const on = lines.filter((l) => checked.has(keyOf(e.id, l.id))).length;
                    const lost = submissionOf(e) === "lost";
                    const old = isOldRevision(e, candidates);
                    const st = SUBMISSION_STATUS[submissionOf(e)]?.label;
                    return (
                      <Fragment key={e.id}>
                        <tr className={`border-t bg-slate-100/80 ${lost ? "opacity-60" : ""}`} data-testid="forecast-estimate">
                          <td className="px-2 py-1.5 text-center">
                            <Checkbox checked={on === lines.length ? true : on > 0 ? "indeterminate" : false} onCheckedChange={(v) => setEstimate(e, !!v)} aria-label={`${e.estimate_number}の明細をすべて`} />
                          </td>
                          <td colSpan={4} className="px-2 py-1.5">
                            <span className="font-mono text-[11px] text-muted-foreground mr-2">{e.estimate_number}</span>
                            <span className="font-semibold">{e.estimate_title || e.print_type || "（件名なし）"}</span>
                            {e.revision_label && e.revision_label !== "初回" && <span className="ml-1.5 text-[10px] text-muted-foreground">{e.revision_label}</span>}
                            {st && <span className={`ml-1.5 rounded px-1 text-[10px] ${lost ? "bg-red-50 text-red-700" : submissionOf(e) === "submitted" ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{st}</span>}
                            {old && <span className="ml-1.5 rounded bg-slate-200 px-1 text-[10px] text-slate-600" title="同じ見積の新しい版があります">古い版</span>}
                            <span className="ml-2 text-[10px] text-muted-foreground">{on}/{lines.length} 行</span>
                          </td>
                        </tr>
                        {lines.map((l) => {
                          const k = keyOf(e.id, l.id);
                          return (
                            <tr key={k} className={`border-t cursor-pointer hover:bg-blue-50/50 ${checked.has(k) ? "" : "text-muted-foreground"} ${lost ? "opacity-60" : ""}`} onClick={() => toggle(k)} data-testid="forecast-line">
                              <td className="px-2 py-1.5 text-center" onClick={(ev) => ev.stopPropagation()}><Checkbox checked={checked.has(k)} onCheckedChange={() => toggle(k)} /></td>
                              <td className="px-2 py-1.5 pl-4"><span className="break-words">{l.name}</span>{l.category && <span className="ml-1.5 text-[10px] text-muted-foreground">{l.category}</span>}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{l.qty.toLocaleString("ja-JP")}{l.unit}</td>
                              <td className={`px-2 py-1.5 text-right tabular-nums ${l.isDiscount ? "text-red-600" : ""}`}>{yen(l.revenue)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{l.hasCost ? yen(l.cost) : l.isDiscount ? <span className="text-muted-foreground">—</span> : <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700 ring-1 ring-amber-200">原価なし</span>}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="text-muted-foreground mr-auto">見積 {usedEstimates.length}件・明細 {picked.length}件</span>
              <span>受注見込 <b className="text-base tabular-nums">{yen(sums.revenue)}</b></span>
              <span>発注見込 <b className="text-base tabular-nums">{yen(sums.cost)}</b></span>
              <span className="text-muted-foreground">粗利見込 <b className={`tabular-nums ${gross < 0 ? "text-destructive" : "text-emerald-700"}`}>{yen(gross)}</b>{sums.revenue > 0 && `（${Math.round((gross / sums.revenue) * 100)}%）`}{Number(project.other_cost) > 0 && "　※その他費用を引いた額"}</span>
            </div>
            {candidates.length > 1 && <p className="text-[11px] text-muted-foreground">最初は、失注の見積と、改訂前の古い版を外してチェックしています（失注の見積は薄く出しています）</p>}
            {noCost > 0 && <p className="flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />原価の入っていない明細が {noCost} 件あります。発注見込が少なく出ている場合があります（見積の明細で原価を入れると反映できます）</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={() => apply.mutate()} disabled={picked.length === 0 || apply.isPending} data-testid="forecast-apply">
            {apply.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}見込みに反映する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
