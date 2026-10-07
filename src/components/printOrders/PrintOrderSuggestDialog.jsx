import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, PackageCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { todayString } from "@/lib/fiscal";

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

/**
 * 納品書を作ったときに出す「この行を入稿記録にしますか？」。
 * @param {object} p
 * @param {object[]} p.candidates  orderFromLine で作った入稿記録の候補
 * @param {() => void} p.onDone    閉じたとき（記録した・しないに関わらず）
 */
export default function PrintOrderSuggestDialog({ open, candidates, onDone }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState(() => new Set());
  const [date, setDate] = useState(todayString());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPicked(new Set(candidates.map((c) => c.estimate_line_id))); setDate(todayString()); } }, [open, candidates]);
  const toggle = (k) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const record = async () => {
    const rows = candidates.filter((c) => picked.has(c.estimate_line_id));
    if (rows.length === 0) { onDone(); return; }
    setBusy(true);
    try {
      await db.entities.PrintOrder.createMany(rows.map((r) => ({ ...r, ordered_on: date })));
      queryClient.invalidateQueries({ queryKey: ["printOrders"] });
      toast.success(`${rows.length} 行を入稿記録にしました`);
      onDone();
    } catch (e) {
      toast.error("入稿記録を残せませんでした: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onDone(); }}>
      <DialogContent className="max-w-lg" data-testid="print-order-suggest">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageCheck className="w-5 h-5 text-teal-700" /> この行を入稿記録にしますか？</DialogTitle>
          <DialogDescription className="text-xs">納品書に入った印刷の明細です。入稿した行にチェックを入れて記録すると、追加印刷のときに入稿履歴から同じ内容で見積を作れます。スクショやメモは、あとから見積書の入稿履歴で足せます</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border divide-y max-h-[50vh] overflow-y-auto">
          {candidates.map((c) => (
            <label key={c.estimate_line_id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30">
              <Checkbox checked={picked.has(c.estimate_line_id)} onCheckedChange={() => toggle(c.estimate_line_id)} className="mt-0.5" aria-label={`${c.name} を入稿記録にする`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{c.name}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {c.quantity != null ? `${Number(c.quantity).toLocaleString()}${c.unit || ""}` : ""} × {yen(c.unit_price)} ＝ {yen(c.amount)}{c.vendor ? `　仕入先 ${c.vendor}` : ""}
                </p>
                {c.source_url ? (
                  <a href={c.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline max-w-full truncate"><ExternalLink className="w-3 h-3 shrink-0" /><span className="truncate">{c.source_url}</span></a>
                ) : <p className="text-[11px] text-muted-foreground">入稿先 URL なし（あとから足せます）</p>}
              </div>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">入稿日</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" aria-label="入稿日" />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={busy}>記録しない</Button>
          <Button type="button" size="sm" className="gap-1 bg-teal-700 hover:bg-teal-800" onClick={record} disabled={busy || picked.size === 0}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />} {picked.size} 行を入稿記録にする
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
