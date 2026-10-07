import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, ReceiptText } from "lucide-react";
import { RECEIPT_STATUS_MAP, paymentMethodLabel } from "@/lib/documents";
import { useListColumns, columnLabel } from "@/lib/listColumns";
import { ListColumnsButton } from "@/components/table/ListColumnsEditor";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/** 領収書の一覧。発行は納品書・請求書の画面から */
export default function ReceiptList() {
  const cols = useListColumns("receipts"); // 列の並び・表示（全員共通）
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data: receipts = [], isLoading } = useQuery({ queryKey: ["receipts"], queryFn: () => db.entities.Receipt.listAll("-issue_date") });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter((r) => [r.receipt_number, r.client_name, r.title, r.proviso].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [receipts, search]);
  const total = filtered.reduce((s, r) => s + Number(r.total || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ReceiptText className="w-5 h-5" /> 領収書</h1>
          <p className="text-sm text-muted-foreground mt-0.5">発行した領収書の一覧です。新しく発行するときは、納品書か請求書の画面の「領収書を発行」から</p>
        </div>
        <ListColumnsButton list="receipts" />
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="番号・宛名・但し書きで検索" className="pl-9 h-9" />
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-14 text-sm text-muted-foreground">
              <p>領収書はまだありません。</p>
              <p className="text-xs mt-1"><Link to="/delivery-notes" className="text-primary hover:underline">納品書</Link> か <Link to="/invoices" className="text-primary hover:underline">請求書</Link> の画面から発行してください。</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-800 hover:bg-slate-800">
                  {cols.map((k) => <TableHead key={k} className={`text-white text-xs ${k === "total" ? "text-right" : ""}`}>{columnLabel("receipts", k)}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const st = RECEIPT_STATUS_MAP[r.status] || RECEIPT_STATUS_MAP.issued;
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/receipts/${r.id}`)}>
                      {cols.map((k) => {
                        switch (k) {
                          case "receipt_number": return <TableCell key={k} className="font-mono text-xs">{r.receipt_number}</TableCell>;
                          case "issue_date": return <TableCell key={k} className="text-xs tabular-nums">{r.issue_date}</TableCell>;
                          case "client_name": return <TableCell key={k} className="text-sm">{r.client_name} {r.client_honorific}</TableCell>;
                          case "proviso": return <TableCell key={k} className="text-xs text-muted-foreground truncate max-w-[280px]">{r.proviso}</TableCell>;
                          case "total": return <TableCell key={k} className="text-right tabular-nums font-medium">{yen(r.total)}</TableCell>;
                          case "payment_method": return <TableCell key={k} className="text-xs">{paymentMethodLabel(r.payment_method)}</TableCell>;
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
