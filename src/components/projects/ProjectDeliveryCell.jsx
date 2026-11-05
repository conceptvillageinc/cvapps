import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check, FileText } from "lucide-react";
import { db } from "@/api/db";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DELIVERY_STATE, MANUAL_DELIVERY_STATES } from "@/lib/deliveryStatus";

const ymd = (s) => String(s || "").slice(5, 10).replace("-", "/");
const HINT = {
  none: "まだ納品していない",
  uninvoiced: "納品したが、まだ請求していない",
  invoiced: "請求まで終わった（freee販売で請求した案件など）",
  na: "納品書・請求書の要らない案件（月末チェックに出さない）",
};

/**
 * 案件一覧の「納品・請求」。札を押すと、その場で状態を変えられる。
 *   「自動」… 納品書・請求書から決める（これまでどおり）／ほかを選ぶと、その状態に固定する（札に「手動」と出る）
 */
export default function ProjectDeliveryCell({ project, info }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (value) => db.entities.Project.update(project.id, { delivery_state_manual: value }),
    onSuccess: (_r, value) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success(value ? `納品・請求を「${DELIVERY_STATE[value].label}」にしました` : "納品・請求を自動（納品書・請求書から）に戻しました");
      setOpen(false);
    },
    onError: (e) => toast.error("変えられませんでした: " + (e?.message || "不明なエラー")),
  });
  if (!info) return <span className="text-muted-foreground text-xs">—</span>;
  const st = DELIVERY_STATE[info.state];
  const stop = (e) => e.stopPropagation();
  const current = info.manual ? info.state : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={stop} className="inline-flex items-center rounded hover:ring-2 hover:ring-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" title="納品・請求の状態を変更（クリック）" data-testid="inline-delivery">
          {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : (
            <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${st.cls}`} data-testid="delivery-badge" data-state={info.state}>
              {st.label}{info.manual && <span className="ml-1 text-[9px] opacity-70">手動</span>}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1" onClick={stop}>
        <p className="px-2 py-1 text-[10px] text-muted-foreground">納品・請求の状態を変更</p>
        <button type="button" onClick={() => save.mutate(null)} className="w-full flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted" data-testid="delivery-auto">
          <span className="w-3.5 pt-0.5">{!current && <Check className="w-3.5 h-3.5 text-primary" />}</span>
          <span className="flex-1">
            <span className="text-xs font-medium">自動（納品書・請求書から）</span>
            <span className="block text-[10px] text-muted-foreground">いまの納品書・請求書だと「{DELIVERY_STATE[info.auto || "none"].label}」</span>
          </span>
        </button>
        <div className="my-1 border-t" />
        {MANUAL_DELIVERY_STATES.map((k) => (
          <button key={k} type="button" onClick={() => save.mutate(k)} className="w-full flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted" data-testid={`delivery-${k}`}>
            <span className="w-3.5 pt-0.5">{current === k && <Check className="w-3.5 h-3.5 text-primary" />}</span>
            <span className="flex-1">
              <span className={`inline-flex rounded border px-1.5 text-[10.5px] font-medium ${DELIVERY_STATE[k].cls}`}>{DELIVERY_STATE[k].label}</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">{HINT[k]}</span>
            </span>
          </button>
        ))}
        {info.notes.length > 0 && (
          <>
            <div className="my-1 border-t" />
            <p className="px-2 py-1 text-[10px] text-muted-foreground">この案件の納品書</p>
            {info.notes.map((n) => (
              <div key={n.id} className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-muted/50">
                <Link to={`/delivery-notes/${n.id}`} className="font-mono text-primary hover:underline">{n.delivery_number}</Link>
                <span className="text-muted-foreground">{ymd(n.delivery_date)}</span>
                <span className="ml-auto">{n.invoice_id ? <Link to={`/invoices/${n.invoice_id}`} className="text-sky-700 hover:underline">請求済</Link> : n.status === "issued" ? <span className="text-amber-700">未請求</span> : <span className="text-muted-foreground">下書き</span>}</span>
              </div>
            ))}
          </>
        )}
        {info.state === "none" && !info.manual && (
          <Link to={`/delivery-notes/new?project=${project.id}`} className="mt-1 flex items-center gap-1 rounded px-2 py-1.5 text-xs text-primary hover:bg-muted"><FileText className="w-3.5 h-3.5" />この案件の納品書を作る</Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
