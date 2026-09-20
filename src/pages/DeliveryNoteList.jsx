import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Truck, ArrowRight, Plus } from "lucide-react";
import { DELIVERY_STATUS_MAP } from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

export default function DeliveryNoteList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | uninvoiced | draft

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["deliveryNotes"],
    queryFn: () => db.entities.DeliveryNote.list("-delivery_date", 500),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (filter === "uninvoiced" && n.invoice_id) return false;
      if (filter === "draft" && n.status !== "draft") return false;
      if (!q) return true;
      return [n.delivery_number, n.client_name, n.title].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [notes, search, filter]);

  const total = filtered.reduce((s, n) => s + Number(n.total || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">納品書</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length}件 / 全{notes.length}件　合計 {yen(total)}（税込）</p>
        </div>
        <Button className="gap-2" onClick={() => navigate("/delivery-notes/new")}><Plus className="w-4 h-4" /> 納品書を作成</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="番号・クライアント名・件名で検索" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[["all", "すべて"], ["uninvoiced", "未請求"], ["draft", "下書き"]].map(([k, label]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} className="text-xs" onClick={() => setFilter(k)}>{label}</Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Truck className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">納品書がありません</p>
              <p className="text-xs text-muted-foreground mt-1">見積詳細の「納品書を作成」、または案件詳細から作成できます</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {["番号", "納品日", "クライアント", "件名", "合計（税込）", "状態", "請求", ""].map((h, i) => (
                      <TableHead key={i} className={`text-xs text-white whitespace-nowrap ${h.includes("合計") ? "text-right" : ""}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((n) => {
                    const st = DELIVERY_STATUS_MAP[n.status] || DELIVERY_STATUS_MAP.draft;
                    return (
                      <TableRow key={n.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/delivery-notes/${n.id}`)}>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">{n.delivery_number}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{n.delivery_date}</TableCell>
                        <TableCell className="text-sm font-medium max-w-[220px] truncate">{n.client_name}</TableCell>
                        <TableCell className="text-sm max-w-[300px] truncate">{n.title || "—"}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{yen(n.total)}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge></TableCell>
                        <TableCell>
                          {n.invoice_id
                            ? <Link to={`/invoices/${n.invoice_id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-primary hover:underline">請求済</Link>
                            : <span className="text-xs text-amber-700">未請求</span>}
                        </TableCell>
                        <TableCell><ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
