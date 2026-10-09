import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, PackageCheck, ExternalLink, Search, Copy, ImageIcon } from "lucide-react";
import PrintOrderDialog from "@/components/printOrders/PrintOrderDialog";
import { fmtOrderDate, orderItems } from "@/lib/printOrders";
import PrintOrderItems from "@/components/printOrders/PrintOrderItems";

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

function Shot({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    db.storage.signedUrl(path).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [path]);
  if (!path) return null;
  return (
    <a href={url || "#"} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0" title="スクショを開く">
      {url && /\.(png|jpe?g|gif|webp)$/i.test(path) ? <img src={url} alt="スクショ" className="h-10 w-auto max-w-[72px] rounded border bg-white object-contain" /> : <span className="inline-flex items-center gap-0.5 text-[11px] text-primary"><ImageIcon className="w-3.5 h-3.5" /> スクショ</span>}
    </a>
  );
}

/**
 * 入稿履歴（新しい順）。見積書・案件詳細・クライアントカルテで使う。
 * @param {object} p
 * @param {{ estimate_id?: string, project_id?: string, client_name?: string, client_id?: string }} p.where  絞り込み
 * @param {boolean} [p.showEstimate]  元の見積番号を出す（見積書の画面では出さない）
 * @param {string} [p.emptyText]
 */
export default function PrintOrderHistory({ where, showEstimate = true, emptyText = "まだ入稿記録がありません。見積書の明細の「入稿した」から記録できます" }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const key = JSON.stringify(where);
  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["printOrders", key],
    queryFn: async () => {
      if (where.client_name && where.client_id) {
        // クライアントは id と名前のどちらで紐づいていても拾う
        const [a, b] = await Promise.all([db.entities.PrintOrder.filter({ client_id: where.client_id }, "-ordered_on"), db.entities.PrintOrder.filter({ client_name: where.client_name }, "-ordered_on")]);
        const seen = new Set();
        return [...a, ...b].filter((r) => (seen.has(r.id) ? false : seen.add(r.id))).sort((x, y) => String(y.ordered_on).localeCompare(String(x.ordered_on)));
      }
      return db.entities.PrintOrder.filter(where, "-ordered_on");
    },
    retry: false,
  });
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.name, r.vendor, r.memo, r.estimate_number, r.source_url, ...orderItems(r).map((it) => it.name)].filter(Boolean).join(" ").toLowerCase().includes(s));
  }, [rows, q]);

  const reorder = (o) => navigate(`/estimates/new?reorder=${o.id}${o.client_name ? `&client=${encodeURIComponent(o.client_name)}` : ""}${o.project_id ? `&project=${o.project_id}` : ""}`);

  return (
    <div className="space-y-2" data-testid="print-order-history">
      {rows.length > 3 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="品名・仕入先・メモで探す" className="h-8 pl-8 text-xs" />
        </div>
      )}
      {isLoading ? (
        <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">{q ? "該当する入稿記録がありません" : emptyText}</p>
      ) : (
        <div className="divide-y rounded-md border">
          {filtered.map((o) => (
            <div key={o.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5 hover:bg-muted/30 cursor-pointer" onClick={() => setOpen(o)} data-testid="print-order-row">
              <div className="w-[76px] shrink-0">
                <p className="text-xs font-semibold tabular-nums">{fmtOrderDate(o.ordered_on)}</p>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-teal-700"><PackageCheck className="w-3 h-3" /> 入稿</span>
              </div>
              <div className="min-w-0 flex-1 basis-[240px]">
                <p className="text-sm font-medium leading-snug">{o.name}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {orderItems(o).length > 0 ? (
                    <>{o.quantity != null ? `${Number(o.quantity).toLocaleString()}${o.unit || ""}　` : ""}合計 <b className="text-foreground">{yen(o.amount)}</b></>
                  ) : (
                    <>{o.quantity != null ? `${Number(o.quantity).toLocaleString()}${o.unit || ""}` : ""} × {yen(o.unit_price)} ＝ <b className="text-foreground">{yen(o.amount)}</b>
                      {o.cost_price != null && <>　原価単価 {yen(o.cost_price)}</>}</>
                  )}
                  {o.vendor && <>　仕入先 {o.vendor}</>}
                </p>
                <PrintOrderItems order={o} className="my-1" />
                {o.source_url && (
                  <a href={o.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline max-w-full truncate" title={o.source_url}>
                    <ExternalLink className="w-3 h-3 shrink-0" /> <span className="truncate">{o.source_url}</span>
                  </a>
                )}
                {o.memo && <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{o.memo}</p>}
                <p className="text-[10px] text-muted-foreground">
                  {showEstimate && o.estimate_id && <Link to={`/estimates/${o.estimate_id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline mr-2">見積 {o.estimate_number}</Link>}
                  {o.created_by_name && <>記録 {o.created_by_name}</>}
                </p>
              </div>
              <Shot path={o.screenshot_path} />
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1 shrink-0 border-teal-300 text-teal-800 hover:bg-teal-50" onClick={(e) => { e.stopPropagation(); reorder(o); }} data-testid="reorder">
                <Copy className="w-3.5 h-3.5" /> この内容で追加印刷の見積を作る
              </Button>
            </div>
          ))}
        </div>
      )}
      <PrintOrderDialog open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }} order={open} onSaved={() => refetch()} />
    </div>
  );
}
