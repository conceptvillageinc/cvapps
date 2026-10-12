import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { nextMonthEnd } from "@/lib/fiscal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, CalendarCheck } from "lucide-react";

export const CUTOVER_KEY = "payments_cutover_date";
const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const fmt = (d) => String(d || "").replace(/-/g, "/");

/** 入金予定日（入金期日。未設定なら請求日の翌月末） */
export const dueOf = (inv) => inv.due_date || nextMonthEnd(inv.invoice_date);

/**
 * CV アプリで入金を管理し始める前の分を、まとめて「入金確認済み」にする。
 *   ・入金予定日がその日までの請求書（送付済）→ 入金済（入金日は入金予定日、入金額は請求額）
 *   ・その日までの銀行明細のうち未照合の入金 → 対象外
 *   下書き・取消の請求書は変えない（下書きは数だけ知らせる）。区切りの日はシステム設定に残す。
 */
export default function CutoverDialog({ open, onOpenChange, invoices, txs }) {
  const queryClient = useQueryClient();
  const { settings } = useSystemSettings();
  const row = settings.find((x) => x.setting_key === CUTOVER_KEY) || null;
  const [date, setDate] = useState("2026-09-30");
  const [ignoreTxs, setIgnoreTxs] = useState(true);
  const [running, setRunning] = useState(null); // { done, total }

  useEffect(() => { if (open && row?.setting_value) setDate(row.setting_value); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const targets = useMemo(() => invoices.filter((i) => i.status === "sent" && dueOf(i) && dueOf(i) <= date), [invoices, date]);
  const drafts = useMemo(() => invoices.filter((i) => i.status === "draft" && dueOf(i) && dueOf(i) <= date), [invoices, date]);
  const txTargets = useMemo(() => txs.filter((t) => t.match_status === "unmatched" && Number(t.amount_in) > 0 && String(t.transaction_date) <= date), [txs, date]);
  const total = targets.reduce((s, i) => s + (Number(i.total) || 0), 0);

  const run = async () => {
    const jobs = [
      ...targets.map((i) => () => db.entities.Invoice.update(i.id, { status: "paid", paid_at: dueOf(i), paid_amount: Number(i.total) || 0 })),
      ...(ignoreTxs ? txTargets.map((t) => () => db.entities.BankTransaction.update(t.id, { match_status: "ignored", matched_by: null })) : []),
    ];
    setRunning({ done: 0, total: jobs.length });
    try {
      for (let k = 0; k < jobs.length; k += 10) {
        await Promise.all(jobs.slice(k, k + 10).map((f) => f()));
        setRunning({ done: Math.min(k + 10, jobs.length), total: jobs.length });
      }
      const data = { setting_key: CUTOVER_KEY, setting_value: date, description: "この日までの入金予定分は、CV アプリ導入前のため入金確認済みとした（入金確認の区切り）" };
      if (row) await db.entities.SystemSettings.update(row.id, data); else await db.entities.SystemSettings.create(data);
      toast.success(`${fmt(date)} までの請求書 ${targets.length} 件を入金済にしました${ignoreTxs && txTargets.length ? `（銀行明細 ${txTargets.length} 件を対象外に）` : ""}`);
      onOpenChange(false);
    } catch (e) {
      toast.error("途中で止まりました: " + e.message + "（もう一度押すと、残りだけ続けます）");
    } finally {
      setRunning(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bankTransactions"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) onOpenChange(v); }}>
      <DialogContent className="max-w-lg" data-testid="cutover-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarCheck className="w-5 h-5" /> 過去分をまとめて入金確認済みにする</DialogTitle>
          <DialogDescription className="text-xs">CV アプリで入金を管理し始める前の分を、まとめて片付けます。区切りの日より後の入金予定から、CV アプリで確認します。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">この日までの入金予定分を完了にする</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" aria-label="区切りの日" />
            </div>
            {row?.setting_value && <p className="text-[11px] text-muted-foreground pb-2">前回の区切り: {fmt(row.setting_value)}</p>}
          </div>
          <div className="rounded-md border divide-y text-xs" data-testid="cutover-preview">
            <div className="px-3 py-2">
              <p className="font-semibold">請求書（送付済）→ 入金済にする: {targets.length} 件 {yen(total)}</p>
              <p className="text-muted-foreground mt-0.5">入金予定日（入金期日。未設定は請求日の翌月末）が {fmt(date)} までのもの。入金日は入金予定日、入金額は請求額で記録します。</p>
            </div>
            <label className="px-3 py-2 flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={ignoreTxs} onChange={(e) => setIgnoreTxs(e.target.checked)} />
              <span><span className="font-semibold">銀行明細の未照合の入金 → 対象外にする: {txTargets.length} 件</span><span className="block text-muted-foreground">日付が {fmt(date)} までのもの。「対象外」タブに移り、あとから戻せます。</span></span>
            </label>
            {drafts.length > 0 && (
              <div className="px-3 py-2 text-amber-800 bg-amber-50">下書きのままの請求書が {drafts.length} 件あります（入金予定日が {fmt(date)} まで）。発行していない請求書なので変えません。不要なら請求書の画面で取消にしてください。</div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">会計データ出力で「入金」も出すときは、{fmt(date)} より前の期間を出すと、ここで記録した入金も含まれます。</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!running}>キャンセル</Button>
          <Button onClick={run} disabled={!!running || (targets.length === 0 && (!ignoreTxs || txTargets.length === 0))} data-testid="cutover-run" className="gap-1.5">
            {running ? <><Loader2 className="w-4 h-4 animate-spin" /> {running.done}/{running.total}</> : `${fmt(date)} までを入金確認済みにする`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
