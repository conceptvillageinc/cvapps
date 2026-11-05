import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db } from "@/api/db";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DELIVERY_STATE, indexNotes } from "@/lib/deliveryStatus";
import { useMemo } from "react";

/** 納品書を見積・案件ごとに引く（一覧で使う。キャッシュは納品書一覧と共有） */
export function useDeliveryIndex(enabled = true) {
  const { data: notes = [] } = useQuery({ queryKey: ["deliveryNotes", "all"], queryFn: () => db.entities.DeliveryNote.list("-delivery_date"), enabled });
  return useMemo(() => indexNotes(notes), [notes]);
}

/** 納品書 1 枚の請求の印（未請求／請求書作成済） */
export function NoteInvoiceLabel({ note }) {
  if (!note.invoice_id) return note.invoiced_manual ? <span className="text-sky-700" title="納品書一覧で手で「処理済」にした納品書">処理済（手動）</span> : <span className="text-amber-700">未請求</span>;
  return <Link to={`/invoices/${note.invoice_id}`} className="text-sky-700 hover:underline">請求書作成済</Link>;
}

const ymd = (s) => String(s || "").slice(5, 10).replace("-", "/");

/**
 * 納品・請求の印。押すと納品書・請求書へ（1 件ならそのまま、複数なら一覧）。
 * @param {{ info: { state, notes, partial } | null }} p
 */
export default function DeliveryBadge({ info }) {
  if (!info) return <span className="text-muted-foreground text-xs">—</span>;
  const st = DELIVERY_STATE[info.state];
  const label = info.partial != null && info.state !== "none" ? `一部納品 ${Math.round(info.partial * 100)}%・${st.label.replace("納品済・", "")}` : st.label;
  const cls = `inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${st.cls}`;
  const chip = <span className={cls} data-testid="delivery-badge" data-state={info.state} title={info.manual ? "手で決めた状態です（納品書からの自動ではありません）" : undefined}>{label}{info.manual && <span className="ml-1 text-[9px] opacity-70">手動</span>}</span>;
  if (info.notes.length === 0) return chip;
  if (info.notes.length === 1) {
    const n = info.notes[0];
    return <Link to={n.invoice_id ? `/invoices/${n.invoice_id}` : `/delivery-notes/${n.id}`} onClick={(e) => e.stopPropagation()} title={`${n.delivery_number}（${ymd(n.delivery_date)}）を開く`}>{chip}</Link>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild><button type="button" onClick={(e) => e.stopPropagation()}>{chip}</button></PopoverTrigger>
      <PopoverContent className="w-72 p-1.5 text-xs" align="start" onClick={(e) => e.stopPropagation()}>
        {info.notes.map((n) => (
          <div key={n.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/50">
            <Link to={`/delivery-notes/${n.id}`} className="font-mono text-primary hover:underline">{n.delivery_number}</Link>
            <span className="text-muted-foreground">{ymd(n.delivery_date)}</span>
            <span className="ml-auto"><NoteInvoiceLabel note={n} /></span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
