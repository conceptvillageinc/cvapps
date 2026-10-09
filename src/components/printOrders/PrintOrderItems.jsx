import { orderItems } from "@/lib/printOrders";

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const qtyText = (it) => (it.quantity != null && it.quantity !== "" ? `${Number(it.quantity).toLocaleString()}${it.unit || ""}` : "");

/** 入稿記録の内訳（M 4枚 / XL 1枚 / 送料 …）。送料・袋入れなど数量に足さない行は薄く出す */
export default function PrintOrderItems({ order, className = "" }) {
  const items = orderItems(order);
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} data-testid="print-order-items">
      <span className="text-[10px] text-muted-foreground mr-0.5">内訳</span>
      {items.map((it) => (
        <span key={it.row ?? it.name} className={`inline-flex items-baseline gap-1 rounded px-1.5 py-px text-[11px] tabular-nums ${it.extra ? "border border-dashed text-muted-foreground" : "bg-muted text-foreground"}`} title={it.extra ? "数量に足さない行（送料・袋入れなど）" : undefined}>
          <span className={it.extra ? "" : "font-medium"}>{it.name}</span>
          {qtyText(it) && <span>{qtyText(it)}</span>}
          <span className="text-muted-foreground">{yen(it.amount)}</span>
        </span>
      ))}
    </div>
  );
}
