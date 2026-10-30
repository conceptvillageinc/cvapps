import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Repeat, Loader2, Truck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/api/db";
import { supabase } from "@/lib/supabase";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { forecastLines, defaultEstimate } from "@/lib/projectForecast";
import { submissionOf, SUBMISSION_STATUS } from "@/lib/submission";
import { lineAmount } from "@/lib/constants";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;
const nextMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthLabel = (ym) => (ym ? `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月分` : "");
import { MONTH_TOKEN, recurringPayloadFromEstimate, recurringNoteLines, recurringSums, templateAddsMonth } from "@/lib/recurringSetup";
import MonthSelect, { PeriodEndSelect } from "@/components/ui/month-select";

/**
 * 案件（または見積）を定期売上にする・定期売上の設定を直す。
 *   見積の明細のうち、毎月請求するもの（チェックしたもの）が月額になり、毎月の納品書の明細になる。
 *   初期費用など 1 回だけのものはチェックを外す（ふつうの納品書・請求書で出す）。
 * @param {object}   p.project    定期売上にする案件（見積が案件に紐づいていないときは null → 案件を作る）
 * @param {object[]} p.estimates  候補の見積（案件の見積。見積から開いたときはその見積を最初に選ぶ）
 * @param {string}   [p.initialEstimateId]
 * @param {object}   [p.template] すでに定期売上のときのひな形（直すとき）
 * @param {(projectId: string) => void} [p.onDone]
 */
export default function RecurringSetupDialog({ open, onOpenChange, project, estimates = [], initialEstimateId = null, template = null, onDone }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { phaseOptions = [] } = useSystemSettings();
  const candidates = useMemo(() => estimates.filter((e) => (e.line_items || []).length), [estimates]);
  const [estimateId, setEstimateId] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [startMonth, setStartMonth] = useState(nextMonth());
  const [endMonth, setEndMonth] = useState("");
  const [autoNote, setAutoNote] = useState(true);
  const [addMonth, setAddMonth] = useState(true);
  const est = candidates.find((e) => e.id === estimateId) || null;
  const lines = useMemo(() => forecastLines(est), [est]);

  useEffect(() => {
    if (!open) return;
    const first = candidates.find((e) => e.id === (initialEstimateId || template?.source_estimate_id)) || defaultEstimate(candidates);
    setEstimateId(first?.id || null);
    setStartMonth(template?.start_month ? template.start_month.slice(0, 7) : nextMonth());
    setEndMonth(template?.end_month ? template.end_month.slice(0, 7) : "");
    setAutoNote(template ? !!template.auto_delivery_note : true);
    setAddMonth(template ? templateAddsMonth(template) : true);
  }, [open]);
  useEffect(() => {
    if (!est) { setChecked(new Set()); return; }
    const all = forecastLines(est).map((l) => l.id);
    const saved = template?.source_estimate_id === est.id ? template.source_line_ids || [] : null;
    setChecked(new Set(saved?.length ? all.filter((id) => saved.includes(id)) : all));
  }, [estimateId]);

  const picked = lines.filter((l) => checked.has(l.id));
  const { monthly, monthlyCost, oneTime, oneTimeCost } = recurringSums(est, [...checked]);
  const toggle = (id) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = lines.length > 0 && lines.every((l) => checked.has(l.id));
  const clientName = project?.client_name || est?.client_name || "";
  const name = project?.name || est?.estimate_title || "";

  // 毎月の納品書の明細（見積の明細を税抜で写す。品名の後ろに「（{年月}）」を付ける）
  const noteLines = useMemo(() => recurringNoteLines(est, [...checked], addMonth), [est, checked, addMonth]);
  const sampleTotal = noteLines.reduce((s, l) => s + lineAmount(l.quantity, l.unit_price), 0);

  const save = useMutation({
    mutationFn: async () => {
      const prob = /定期/.test(project?.deal_probability || "") ? project.deal_probability : "A（定期売上）";
      const payload = {
        client_id: project?.client_id || est?.client_id || null,
        client_name: clientName,
        name,
        deal_probability: prob,
        // 定期売上にした案件は受注が決まっているので、フェーズは「受注済」にする（設定に無いときは今のまま）
        phase: phaseOptions.includes("受注済") ? "受注済" : (project?.phase || "受注済"),
        ...recurringPayloadFromEstimate(est, [...checked], addMonth),
        other_cost: Number(project?.other_cost) || 0,
        start_month: `${startMonth}-01`,
        end_month: endMonth ? `${endMonth}-01` : null,
        is_active: true,
        auto_delivery_note: autoNote,
        project_id: project?.id || null,
      };
      const tpl = template
        ? await db.entities.RecurringProjectTemplate.update(template.id, payload)
        : await db.entities.RecurringProjectTemplate.create({ ...payload, created_by: user?.id || null });
      // 案件に反映する（月額・受注確度・定期売上の印・期間）。ひな形を保存したときにも DB 側で動くが、確実に、ここでもう一度呼ぶ
      const { data: syncedId, error: syncError } = await supabase.rpc("sync_recurring_project", { p_template_id: tpl.id });
      if (syncError) throw new Error(`案件に反映できませんでした（${syncError.message}）`);
      const projectId = project?.id || syncedId || null;
      if (!projectId) throw new Error("定期売上の案件が見つかりませんでした");
      // 受注確度・フェーズを合わせる（案件の画面からもすぐ分かるように）
      const patch = { deal_probability: prob, ...(phaseOptions.includes("受注済") ? { phase: "受注済" } : {}), is_recurring: true };
      await db.entities.Project.update(projectId, patch);
      // 見積が案件に紐づいていなかったときは、できた定期売上の案件に紐づける
      if (!project && est) await db.entities.Estimate.update(est.id, { project_id: projectId });
      return projectId;
    },
    onSuccess: (projectId) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["recurringTemplates"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success(template ? "定期売上の設定を直しました" : `定期売上にしました（${monthLabel(startMonth).replace("分", "")}から 月額 ${yen(monthly)}）`);
      onOpenChange(false);
      onDone?.(projectId);
    },
    onError: (err) => toast.error("定期売上にできませんでした: " + (err?.message || "不明なエラー")),
  });

  const canSave = !!est && picked.length > 0 && !!startMonth && !save.isPending && (!endMonth || endMonth >= startMonth);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="recurring-setup">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Repeat className="w-4 h-4 text-rose-600" /> {template ? "定期売上を編集" : "定期売上にする"}</DialogTitle>
          <DialogDescription className="text-xs">
            {clientName}　{name}　―　見積の明細のうち<strong>毎月請求するもの</strong>にチェックすると、その合計が月額になり、毎月の納品書の明細になります。初期費用など 1 回だけのものはチェックを外すと「初回だけの費用」として開始月の見込みに入ります（納品書はふつうに作ってください）。
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> この案件には明細のある見積がありません。先に見積を作ってください</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">元にする見積</Label>
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((e) => {
                  const st = SUBMISSION_STATUS[submissionOf(e)];
                  return (
                    <button key={e.id} type="button" onClick={() => setEstimateId(e.id)}
                      className={`rounded-md border px-2.5 py-1.5 text-left text-xs ${e.id === estimateId ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-background hover:bg-muted/50"}`}>
                      <span className="font-mono text-muted-foreground mr-1.5">{e.estimate_number}</span>{e.estimate_title || "（件名なし）"}
                      <span className={`ml-1.5 rounded border px-1 text-[10px] ${st.cls}`}>{st.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-white">
                  <tr>
                    <th className="w-9 px-2 py-1.5"><Checkbox checked={allOn} onCheckedChange={(v) => setChecked(new Set(v ? lines.map((l) => l.id) : []))} className="border-white/70 data-[state=checked]:bg-white data-[state=checked]:text-slate-800" aria-label="すべて" /></th>
                    <th className="text-left font-medium px-2 py-1.5">明細（毎月請求するものにチェック）</th>
                    <th className="text-right font-medium px-2 py-1.5 w-20">数量</th>
                    <th className="text-right font-medium px-2 py-1.5 w-28">金額（税抜）</th>
                    <th className="text-right font-medium px-2 py-1.5 w-24">原価</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.id} className={checked.has(l.id) ? "" : "text-muted-foreground bg-muted/30"}>
                      <td className="px-2 py-1.5 text-center"><Checkbox checked={checked.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`${l.name}を毎月の分に入れる`} /></td>
                      <td className="px-2 py-1.5">{l.name}{!checked.has(l.id) && <span className="ml-1.5 text-[10px]">（初回だけの費用）</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.qty}{l.unit}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{yen(l.revenue)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.hasCost ? yen(l.cost) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-rose-50/60">
                  <tr>
                    <td colSpan={3} className="px-2 py-1.5 text-right font-semibold">月額（チェックした明細の合計）</td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums text-rose-800" data-testid="recurring-monthly">{yen(monthly)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{yen(monthlyCost)}</td>
                  </tr>
                  {oneTime !== 0 && (
                    <tr className="bg-white">
                      <td colSpan={3} className="px-2 py-1.5 text-right text-muted-foreground">初回だけの費用（チェックしなかった明細。開始月の見込みに足します）</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums" data-testid="recurring-onetime">{yen(oneTime)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{yen(oneTimeCost)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">開始月 <span className="text-destructive">*</span></Label>
                <MonthSelect value={startMonth} onChange={(v) => { setStartMonth(v); if (endMonth && endMonth < v) setEndMonth(""); }} ariaLabel="開始月" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">終了月</Label>
                <PeriodEndSelect start={startMonth} value={endMonth} onChange={setEndMonth} ariaLabel="終了月" />
                <p className="text-[10px] text-muted-foreground">開始月から何か月分続けるかを選べます（「無期限」なら終わりを決めない）</p>
              </div>
            </div>

            <div className={`rounded-lg border p-3 space-y-2 ${autoNote ? "border-rose-200 bg-rose-50/30" : ""}`}>
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <Checkbox className="mt-0.5" checked={autoNote} onCheckedChange={(v) => setAutoNote(!!v)} data-testid="recurring-auto-note" />
                <span>
                  <span className="font-semibold inline-flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> 毎月の納品書（下書き）を自動で作る</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">毎月1日に、チェックした明細でその月の納品書の下書きを案件の中に作ります（納品日はその月の末日）</span>
                </span>
              </label>
              {autoNote && (
                <>
                  <label className="flex items-center gap-2 text-xs cursor-pointer pl-6">
                    <Checkbox checked={addMonth} onCheckedChange={(v) => setAddMonth(!!v)} />
                    品名の後ろに「（{monthLabel(startMonth) || "2026年11月分"}）」のように月を付ける
                  </label>
                  {noteLines.length > 0 && (
                    <div className="ml-6 rounded-md border bg-white px-3 py-2 text-[11px]" data-testid="recurring-note-preview">
                      <p className="font-semibold text-muted-foreground mb-1">{monthLabel(startMonth)}の納品書（下書き）の例</p>
                      {noteLines.map((l, i) => (
                        <p key={i} className="flex justify-between gap-3"><span className="truncate">{String(l.name).replace(MONTH_TOKEN, monthLabel(startMonth))}</span><span className="tabular-nums shrink-0">{yen(lineAmount(l.quantity, l.unit_price))}</span></p>
                      ))}
                      <p className="flex justify-between gap-3 border-t mt-1 pt-1 font-semibold"><span>合計（税抜）</span><span className="tabular-nums">{yen(sampleTotal)}</span></p>
                    </div>
                  )}
                </>
              )}
            </div>
            {!project && <p className="text-[11px] text-muted-foreground">この見積は案件に紐づいていないので、定期売上の案件を新しく作って、この見積を紐づけます</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={() => save.mutate()} disabled={!canSave} className="gap-1.5 bg-rose-600 hover:bg-rose-700" data-testid="recurring-save">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />} {template ? "設定を保存" : "定期売上にする"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
