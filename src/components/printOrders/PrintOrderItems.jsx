import { Check } from "lucide-react";
import { orderItems } from "@/lib/printOrders";

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const qtyText = (it) => (it.quantity != null && it.quantity !== "" ? `${Number(it.quantity).toLocaleString()}${it.unit || ""}` : "");

/**
 * 入稿記録の内訳（M 4枚 / XL 1枚 / 送料 …）。送料・袋入れなど数量に足さない行は薄く出す。
 * @param {object} p
 * @param {Set<number>} [p.selected]  選べるとき: 選んでいる内訳の番号（追加印刷の見積に入れる行）
 * @param {(i: number) => void} [p.onToggle]
 */
export default function PrintOrderItems({ order, className = "", selected = null, onToggle = null }) {
  const items = orderItems(order);
  if (items.length === 0) return null;
  const selectable = !!(selected && onToggle);
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} data-testid="print-order-items">
      <span className="text-[10px] text-muted-foreground mr-0.5">{selectable ? "内訳（見積に使う行を選ぶ）" : "内訳"}</span>
      {items.map((it, i) => {
        const on = selectable && selected.has(i);
        const body = (
          <>
            {selectable && <span className={`inline-flex h-3 w-3 items-center justify-center rounded-sm border self-center ${on ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-slate-300"}`}>{on && <Check className="w-2.5 h-2.5" strokeWidth={3} />}</span>}
            <span className={it.extra ? "" : "font-medium"}>{it.name}</span>
            {qtyText(it) && <span>{qtyText(it)}</span>}
            <span className="text-muted-foreground">{yen(it.amount)}</span>
          </>
        );
        const cls = `inline-flex items-baseline gap-1 rounded px-1.5 py-px text-[11px] tabular-nums ${it.extra ? "border border-dashed text-muted-foreground" : "bg-muted text-foreground"}`;
        return selectable ? (
          <button key={it.row ?? i} type="button" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onToggle(i); }} className={`${cls} ${on ? "ring-1 ring-teal-400" : "opacity-50 line-through decoration-slate-400"} hover:ring-teal-500`} title={on ? "見積に入れる（押すと外す）" : "見積に入れない（押すと入れる）"} data-testid="print-order-item-toggle">
            {body}
          </button>
        ) : (
          <span key={it.row ?? i} className={cls} title={it.extra ? "数量に足さない行（送料・袋入れなど）" : undefined}>{body}</span>
        );
      })}
    </div>
  );
}
