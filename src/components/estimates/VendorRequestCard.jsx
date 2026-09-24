import { useMemo } from "react";
import { vendorRequestStatus } from "@/lib/vendorRequest";
import { Button } from "@/components/ui/button";
import { Printer, Check, ArrowRight } from "lucide-react";

/**
 * 見積書ステップの右側に置く「印刷所に見積を依頼する」カード。
 * 閉じていても進み具合（仕様・送信・返答）が分かる。
 */
export default function VendorRequestCard({ estimate, emailLogs, onOpen }) {
  const status = useMemo(() => vendorRequestStatus(estimate, emailLogs), [estimate, emailLogs]);
  const rows = [
    { n: 1, label: "印刷仕様を入力", note: status.specs > 0 ? `${status.specs}件` : "未入力", done: status.specs > 0 },
    { n: 2, label: "送信先を選んでメールを送る", note: status.sent > 0 ? `${status.sent}社に送信` : "未送信", done: status.sent > 0 },
    {
      n: 3, label: "返答を明細に取り込む",
      note: status.imported > 0 ? `${status.imported}社 取り込み済み` : status.replied > 0 ? `${status.replied}社 返答あり` : status.sent > 0 ? "返答待ち" : "—",
      done: status.imported > 0,
      highlight: status.replied > status.imported,
    },
  ];
  const current = status.step > 3 ? 3 : status.step;
  return (
    <div className={`rounded-xl border-2 bg-card p-4 space-y-3 ${status.step >= 4 ? "border-emerald-300" : "border-primary"}`}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Printer className="w-4 h-4 text-primary" /></div>
        <p className="text-sm font-bold">印刷所に見積を依頼する</p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">仕様を書いて、印刷所にメールで見積を依頼し、届いた見積書を明細に取り込むまでの道具です。</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <button key={r.n} type="button" onClick={() => onOpen(r.n)} className="w-full flex items-center gap-2 text-[11px] text-left hover:bg-muted/40 rounded px-1 py-0.5">
            <span className={`w-[18px] h-[18px] rounded-full inline-flex items-center justify-center shrink-0 text-[10px] font-bold ${r.done ? "bg-emerald-600 text-white" : r.n === current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {r.done ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : r.n}
            </span>
            <span className={`flex-1 ${r.n === current && !r.done ? "font-semibold" : ""}`}>{r.n}. {r.label}</span>
            <span className={`${r.highlight ? "text-amber-700 font-semibold" : "text-muted-foreground"}`}>{r.note}</span>
          </button>
        ))}
      </div>
      <Button className="w-full gap-1.5 text-xs" onClick={() => onOpen(current)}>
        依頼ツールを開く <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
