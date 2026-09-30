import { useMemo } from "react";
import { vendorRequestStatus } from "@/lib/vendorRequest";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Printer, Check, ArrowRight, ChevronRight, History } from "lucide-react";

/**
 * 見積書ステップの上に置く「印刷所に見積を依頼する」の帯。
 * 右の列だった案内カードを 1 行にまとめ、プレビューと編集欄に横幅を全部使わせる。
 * 進み具合（仕様 → 送信 → 返答）のチップと「依頼ツールを開く」ボタン、メール履歴のポップアップ。
 */
export default function VendorRequestBar({ estimate, emailLogs, onOpen }) {
  const status = useMemo(() => vendorRequestStatus(estimate, emailLogs), [estimate, emailLogs]);
  const steps = [
    { n: 1, label: "印刷仕様", note: status.specs > 0 ? `${status.specs}件` : "未入力", done: status.specs > 0 },
    { n: 2, label: "メールを送る", note: status.sent > 0 ? `${status.sent}社に送信` : "未送信", done: status.sent > 0 },
    {
      n: 3, label: "返答を明細に",
      note: status.imported > 0 ? `${status.imported}社 取込済` : status.replied > 0 ? `${status.replied}社 返答あり` : status.sent > 0 ? "返答待ち" : "—",
      done: status.imported > 0,
      highlight: status.replied > status.imported,
    },
  ];
  const current = status.step > 3 ? 3 : status.step;
  const sentLogs = [...(emailLogs || [])].filter((l) => l.status === "sent").sort((x, y) => String(y.sent_at || "").localeCompare(String(x.sent_at || "")));

  return (
    <div className={`rounded-xl border bg-card px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${status.step >= 4 ? "border-emerald-300 bg-emerald-50/30" : "border-primary/40 bg-primary/[0.03]"}`}>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center"><Printer className="w-3.5 h-3.5 text-primary" /></div>
        <p className="text-xs font-bold whitespace-nowrap">印刷所に見積を依頼する</p>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/50" />}
            <button
              type="button"
              onClick={() => onOpen(s.n)}
              title={`${s.n}. ${s.label}（クリックで依頼ツールのこの手順を開く）`}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] transition-colors ${
                s.done ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  : s.n === current ? "bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] font-bold ${s.done ? "bg-emerald-600 text-white" : s.n === current ? "bg-primary text-white" : "bg-background border"}`}>
                {s.done ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : s.n}
              </span>
              <span className={s.n === current && !s.done ? "font-semibold" : ""}>{s.n}. {s.label}</span>
              <span className={`font-semibold ${s.highlight ? "text-amber-700" : ""}`}>{s.note}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="flex-1" />

      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <History className="w-3 h-3" /> 履歴（{sentLogs.length}）
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <p className="text-xs font-bold mb-1.5">メール送信の履歴</p>
          {sentLogs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">まだメールの送信はありません</p>
          ) : (
            <ul className="text-[11px] text-muted-foreground space-y-1 max-h-60 overflow-y-auto">
              {sentLogs.slice(0, 20).map((l) => (
                <li key={l.id}>
                  <span className="tabular-nums">{new Date(l.sent_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}</span>
                  　{l.recipient_company} へ{l.document_type ? "書類を送付" : "見積依頼"}
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <Button size="sm" className="gap-1.5 text-xs h-8 shrink-0" onClick={() => onOpen(current)}>
        依頼ツールを開く <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
