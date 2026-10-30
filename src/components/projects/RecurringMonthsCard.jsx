import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Repeat, FileText, Receipt } from "lucide-react";
import { todayString } from "@/lib/fiscal";
import { addMonthsYm, invoiceProjectShares, recurringMonths } from "@/lib/projectInvoicing";
import { stateOfNotes, DELIVERY_STATE } from "@/lib/deliveryStatus";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const label = (ym) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;

/**
 * 定期売上の案件: 月ごとの納品書・請求書の状況。
 *   納品書はその月の分（定期売上の自動作成なら recurring_month、手で作ったものは納品日の月）、
 *   請求額はこの案件・その月の分として請求した税抜額（まとめた請求書も明細で分ける）。
 */
export default function RecurringMonthsCard({ project, deliveryNotes, invoices }) {
  const [showAll, setShowAll] = useState(false);
  const thisMonth = todayString().slice(0, 7);
  const rows = useMemo(() => {
    const months = recurringMonths(project, String(project.recurring_start_month).slice(0, 7), addMonthsYm(thisMonth, 1)).reverse();
    return months.map((m) => {
      const notes = deliveryNotes.filter((n) => String(n.recurring_month || n.delivery_date || "").slice(0, 7) === m);
      const invs = [];
      let billed = 0;
      for (const inv of invoices) {
        if (inv.status === "cancelled") continue;
        const s = invoiceProjectShares(inv).filter((x) => x.project_id === project.id && x.month === m).reduce((a, x) => a + x.subtotal, 0);
        if (s) { billed += s; invs.push(inv); }
      }
      const state = billed > 0 && notes.every((n) => n.invoice_id) ? "invoiced" : stateOfNotes(notes);
      return { m, notes, invs, billed, state };
    });
  }, [project, deliveryNotes, invoices, thisMonth]);
  const shown = showAll ? rows : rows.slice(0, 6);

  return (
    <Card data-testid="recurring-months">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Repeat className="w-4 h-4 text-teal-600" /> 月ごとの納品・請求（定期売上 月額 {yen(project.expected_revenue)}）</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {shown.map(({ m, notes, invs, billed, state }) => (
            <div key={m} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm ${m === thisMonth ? "bg-teal-50/40" : ""}`}>
              <span className="w-32 shrink-0 font-medium tabular-nums whitespace-nowrap">{label(m)}{m === thisMonth && <span className="ml-1 text-[10px] text-teal-700">今月</span>}{m === String(project.recurring_start_month || "").slice(0, 7) && Number(project.recurring_one_time_revenue) > 0 && <span className="block text-[10px] font-normal text-muted-foreground">＋初回 {yen(project.recurring_one_time_revenue)}</span>}</span>
              <span className={`w-28 shrink-0 rounded border px-1.5 py-0.5 text-center text-[11px] ${DELIVERY_STATE[state].cls}`}>{DELIVERY_STATE[state].label}</span>
              <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                {notes.map((n) => <Link key={n.id} to={`/delivery-notes/${n.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><FileText className="w-3 h-3" />{n.delivery_number}{n.status === "draft" ? "（下書き）" : ""}</Link>)}
                {invs.map((inv) => <Link key={inv.id} to={`/invoices/${inv.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Receipt className="w-3 h-3" />{inv.invoice_number}</Link>)}
                {notes.length === 0 && invs.length === 0 && <span className="text-muted-foreground">まだありません</span>}
              </span>
              <span className="w-28 text-right tabular-nums text-xs">{billed ? <>請求 {yen(billed)}</> : <span className="text-muted-foreground">—</span>}</span>
              <span className="w-28 shrink-0 text-right">
                {notes.length === 0 && <Link to={`/delivery-notes/new?project=${project.id}`} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50"><FileText className="w-3 h-3" /> 納品書を作る</Link>}
                {notes.some((n) => !n.invoice_id) && <Link to={`/invoices/new?delivery=${notes.filter((n) => !n.invoice_id).map((n) => n.id).join(",")}`} className="inline-flex items-center gap-1 rounded border border-amber-400 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-50"><Receipt className="w-3 h-3" /> 請求書を作る</Link>}
              </span>
            </div>
          ))}
        </div>
        {rows.length > 6 && (
          <div className="px-4 py-2 border-t">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>{showAll ? "最近の 6 か月だけ表示" : `すべての月を表示（${rows.length} か月）`}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
