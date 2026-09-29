import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Truck, ArrowRight, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DELIVERY_STATUS_MAP } from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

export default function DeliveryNoteList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | uninvoiced | draft
  const [picked, setPicked] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["deliveryNotes"],
    queryFn: () => db.entities.DeliveryNote.listAll("-delivery_date"),
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

  const togglePick = (id) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const deletePicked = async () => {
    setDeleting(true);
    let ok = 0;
    try {
      for (const id of picked) { await db.entities.DeliveryNote.delete(id); ok++; }
      toast.success(`${ok}件の納品書を削除しました`);
      setPicked(new Set());
    } catch (err) {
      toast.error(`${ok}件削除したところで失敗しました: ` + (err?.message || "不明なエラー"));
    } finally {
      setDeleting(false);
      queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">納品書</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length}件 / 全{notes.length}件　合計 {yen(total)}（税込）</p>
        </div>
        <div className="flex items-center gap-2">
          {picked.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive" disabled={deleting}>
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} 選択した{picked.size}件を削除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{picked.size}件の納品書を削除しますか？</AlertDialogTitle>
                  <AlertDialogDescription>請求書に載っている納品書は請求書側の明細は残り、納品書との紐づけだけが外れます。この操作は取り消せません。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction onClick={deletePicked} className="bg-destructive text-destructive-foreground">削除する</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button className="gap-2" onClick={() => navigate("/delivery-notes/new")}><Plus className="w-4 h-4" /> 納品書を作成</Button>
        </div>
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
                    <TableHead className="w-8 px-2">
                      <Checkbox
                        aria-label="すべて選択"
                        className="border-white/60 data-[state=checked]:bg-white data-[state=checked]:text-slate-800"
                        checked={filtered.length > 0 && filtered.every((n) => picked.has(n.id))}
                        onCheckedChange={(v) => setPicked(v ? new Set(filtered.map((n) => n.id)) : new Set())}
                      />
                    </TableHead>
                    {["番号", "納品日", "クライアント", "件名", "合計（税込）", "状態", "請求", ""].map((h, i) => (
                      <TableHead key={i} className={`text-xs text-white whitespace-nowrap ${h.includes("合計") ? "text-right" : ""}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((n) => {
                    const st = DELIVERY_STATUS_MAP[n.status] || DELIVERY_STATUS_MAP.draft;
                    return (
                      <TableRow key={n.id} className={`group cursor-pointer hover:bg-muted/40 ${picked.has(n.id) ? "bg-red-50/60" : ""}`} onClick={() => navigate(`/delivery-notes/${n.id}`)}>
                        <TableCell className="w-8 px-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox aria-label="選択" checked={picked.has(n.id)} onCheckedChange={() => togglePick(n.id)} />
                        </TableCell>
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
