import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, ClipboardList } from "lucide-react";
import { PARTNER_ORDER_STATUS_MAP } from "@/lib/documents";
import { useListColumns, columnLabel } from "@/lib/listColumns";
import { ListColumnsButton } from "@/components/table/ListColumnsEditor";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/** 発注書（CV → 連携先）の一覧。発行は見積の画面から */
export default function PartnerOrderList() {
  const cols = useListColumns("partner_orders"); // 列の並び・表示（全員共通）
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data: orders = [], isLoading } = useQuery({ queryKey: ["partnerOrders"], queryFn: () => db.entities.PartnerOrder.listAll("-order_date") });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => [o.po_number, o.partner_name, o.title].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [orders, search]);
  const total = filtered.reduce((s, o) => s + Number(o.total || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ClipboardList className="w-5 h-5" /> 発注書</h1>
          <p className="text-sm text-muted-foreground mt-0.5">CV から連携先へ出した発注書の一覧です。新しく作るときは、見積の画面の「連携先へ発注書を作る」から</p>
        </div>
        <ListColumnsButton list="partner_orders" />
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="番号・連携先・件名で検索" className="pl-9 h-9" />
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-14 text-sm text-muted-foreground">
              <p>発注書はまだありません。</p>
              <p className="text-xs mt-1"><Link to="/estimates" className="text-primary hover:underline">見積一覧</Link> から見積を開き、「連携先へ発注書を作る」を押してください。</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-800 hover:bg-slate-800">
                  {cols.map((k) => <TableHead key={k} className={`text-white text-xs ${k === "total" ? "text-right" : ""}`}>{columnLabel("partner_orders", k)}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => {
                  const st = PARTNER_ORDER_STATUS_MAP[o.status] || PARTNER_ORDER_STATUS_MAP.issued;
                  return (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(`/partner-orders/${o.id}`)}>
                      {cols.map((k) => {
                        switch (k) {
                          case "po_number": return <TableCell key={k} className="font-mono text-xs">{o.po_number}</TableCell>;
                          case "order_date": return <TableCell key={k} className="text-xs tabular-nums">{o.order_date}</TableCell>;
                          case "partner_name": return <TableCell key={k} className="text-sm">{o.partner_name} {o.partner_honorific}</TableCell>;
                          case "title": return <TableCell key={k} className="text-xs text-muted-foreground truncate max-w-[280px]">{o.title}</TableCell>;
                          case "due_date": return <TableCell key={k} className="text-xs tabular-nums">{o.due_date || "—"}</TableCell>;
                          case "total": return <TableCell key={k} className="text-right tabular-nums font-medium">{yen(o.total)}</TableCell>;
                          case "status": return <TableCell key={k}><Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge></TableCell>;
                          default: return <TableCell key={k} />;
                        }
                      })}
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/30 font-medium">
                  {cols.map((k, i) => (k === "total"
                    ? <TableCell key={k} className="text-right tabular-nums">{yen(total)}</TableCell>
                    : <TableCell key={k} className="text-xs whitespace-nowrap">{i === cols.findIndex((c) => c !== "total") ? `合計（${filtered.length} 件）` : ""}</TableCell>))}
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
