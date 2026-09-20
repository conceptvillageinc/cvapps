import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Receipt, ArrowRight, Plus } from "lucide-react";
import { INVOICE_STATUS_MAP } from "@/lib/documents";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, todayString } from "@/lib/fiscal";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const ALL = "all";

export default function InvoiceList() {
  const navigate = useNavigate();
  const { fiscalYearStartMonth } = useSystemSettings();
  const currentFy = fiscalYearOf(todayString(), fiscalYearStartMonth);
  const [fiscalYear, setFiscalYear] = useState(String(currentFy));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("unpaid"); // all | unpaid | overdue | paid
  const today = todayString();

  const range = fiscalYear === ALL ? null : fiscalYearRange(Number(fiscalYear), fiscalYearStartMonth);
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices", fiscalYear, fiscalYearStartMonth],
    queryFn: () => range
      ? db.entities.Invoice.between("invoice_date", range.from, range.to, "-invoice_date")
      : db.entities.Invoice.list("-invoice_date"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (filter === "unpaid" && !(inv.status === "draft" || inv.status === "sent")) return false;
      if (filter === "overdue" && !(inv.status === "sent" && inv.due_date && inv.due_date < today)) return false;
      if (filter === "paid" && inv.status !== "paid") return false;
      if (!q) return true;
      return [inv.invoice_number, inv.client_name, inv.title].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [invoices, search, filter, today]);

  const sum = (rows) => rows.reduce((s, i) => s + Number(i.total || 0), 0);
  const unpaid = invoices.filter((i) => i.status === "sent" || i.status === "draft");
  const overdue = unpaid.filter((i) => i.status === "sent" && i.due_date && i.due_date < today);
  const years = [];
  for (let y = currentFy + 1; y >= currentFy - 3; y--) years.push(y);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">請求書</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            未入金 {unpaid.length}件 {yen(sum(unpaid))}
            {overdue.length > 0 && <span className="text-red-700">　期日超過 {overdue.length}件 {yen(sum(overdue))}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={fiscalYear} onValueChange={setFiscalYear}>
            <SelectTrigger className="h-9 w-[230px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)} className="text-xs">{fiscalYearLabel(y, fiscalYearStartMonth)}{y === currentFy ? "　今期" : ""}</SelectItem>)}
              <SelectItem value={ALL} className="text-xs">すべての期</SelectItem>
            </SelectContent>
          </Select>
          <Button className="gap-2" onClick={() => navigate("/invoices/new")}><Plus className="w-4 h-4" /> 請求書を作成</Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="番号・請求先・件名で検索" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[["unpaid", "未入金"], ["overdue", "期日超過"], ["paid", "入金済"], ["all", "すべて"]].map(([k, label]) => (
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
              <Receipt className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">該当する請求書がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {["番号", "請求日", "入金期日", "請求先", "件名", "請求金額", "状態", ""].map((h, i) => (
                      <TableHead key={i} className={`text-xs text-white whitespace-nowrap ${h === "請求金額" ? "text-right" : ""}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => {
                    const st = INVOICE_STATUS_MAP[inv.status] || INVOICE_STATUS_MAP.draft;
                    const late = inv.status === "sent" && inv.due_date && inv.due_date < today;
                    return (
                      <TableRow key={inv.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">{inv.invoice_number}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{inv.invoice_date}</TableCell>
                        <TableCell className={`text-xs whitespace-nowrap ${late ? "text-red-700 font-medium" : ""}`}>{inv.due_date || "—"}</TableCell>
                        <TableCell className="text-sm font-medium max-w-[220px] truncate">{inv.client_name}</TableCell>
                        <TableCell className="text-sm max-w-[300px] truncate">{inv.title || "—"}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{yen(inv.total)}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${late ? "bg-red-100 text-red-700 hover:bg-red-100" : st.color}`}>{late ? "期日超過" : st.label}</Badge>
                        </TableCell>
                        <TableCell><ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary" /></TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30 hover:bg-muted/30 font-medium">
                    <TableCell colSpan={5} className="text-xs text-muted-foreground">表示中の合計（{filtered.length}件）</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{yen(sum(filtered))}</TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
