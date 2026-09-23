import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Receipt, ArrowRight, Plus, Download } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { INVOICE_STATUS_MAP } from "@/lib/documents";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, todayString } from "@/lib/fiscal";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const ALL = "all";

/** CSV（Excel で開ける BOM 付き UTF-8）。期間は請求日で絞る */
function invoicesToCsv(rows) {
  const header = ["請求書番号", "請求日", "入金期日", "請求先", "件名", "小計（税抜）", "消費税", "請求金額（税込）", "状態", "入金日", "入金額", "送付方法", "担当者", "備考"];
  const esc = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((inv) => [
    inv.invoice_number, inv.invoice_date, inv.due_date, inv.client_name, inv.title,
    Math.round(Number(inv.subtotal) || 0), Math.round(Number(inv.tax) || 0), Math.round(Number(inv.total) || 0),
    INVOICE_STATUS_MAP[inv.status]?.label || inv.status, inv.paid_at ? String(inv.paid_at).slice(0, 10) : "", inv.paid_amount ?? "",
    inv.delivery_method || "", inv.person_in_charge || "", (inv.notes || "").replace(/\r?\n/g, " "),
  ].map(esc).join(","));
  return "\ufeff" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** 期間を指定して CSV をダウンロードする */
function CsvDownload({ defaultFrom, defaultTo }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultFrom || "");
  const [to, setTo] = useState(defaultTo || "");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!from || !to) { toast.error("期間（開始日・終了日）を入れてください"); return; }
    setLoading(true);
    try {
      let rows = await db.entities.Invoice.between("invoice_date", from, to, "invoice_date");
      if (status === "unpaid") rows = rows.filter((i) => i.status === "sent" || i.status === "draft");
      if (status === "paid") rows = rows.filter((i) => i.status === "paid");
      if (rows.length === 0) { toast.info("その期間の請求書はありません"); return; }
      const blob = new Blob([invoicesToCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `請求書一覧_${from}_${to}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success(`${rows.length}件を書き出しました`);
      setOpen(false);
    } catch (err) {
      toast.error("書き出せませんでした: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2"><Download className="w-4 h-4" /> CSV</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <p className="text-xs font-medium">請求書一覧を CSV で書き出す</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label className="text-[10px]">請求日 から</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs" /></div>
          <div className="space-y-1"><Label className="text-[10px]">まで</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs" /></div>
        </div>
        <div className="flex gap-1">
          {[["all", "すべて"], ["unpaid", "未入金"], ["paid", "入金済"]].map(([k, l]) => (
            <Button key={k} size="sm" variant={status === k ? "default" : "outline"} className="text-xs h-7" onClick={() => setStatus(k)}>{l}</Button>
          ))}
        </div>
        <Button size="sm" className="w-full gap-1.5 text-xs" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} ダウンロード
        </Button>
        <p className="text-[10px] text-muted-foreground">Excel で開ける形式（UTF-8 BOM）。金額は税抜・税込の両方が入ります</p>
      </PopoverContent>
    </Popover>
  );
}

export default function InvoiceList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  // 一覧から状態を変える（下書き→送付済、送付済→入金済 など）
  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => {
      const patch = { status };
      if (status === "sent") patch.sent_at = new Date().toISOString();
      if (status === "paid") { patch.paid_at = todayString(); }
      if (status === "draft") { patch.sent_at = null; patch.paid_at = null; patch.paid_amount = null; }
      return db.entities.Invoice.update(id, patch);
    },
    onSuccess: (_, v) => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); toast.success(`状態を「${INVOICE_STATUS_MAP[v.status]?.label || v.status}」にしました`); },
    onError: (err) => toast.error("変更できませんでした: " + err.message),
  });

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
          <CsvDownload defaultFrom={range?.from} defaultTo={range?.to} />
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
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <select
                            value={inv.status}
                            onChange={(e) => statusMutation.mutate({ id: inv.id, status: e.target.value })}
                            title="一覧から状態を変えられます（入金額まで記録するときは請求書を開いて「入金を記録」）"
                            className={`h-7 rounded-md border px-1.5 text-[11px] font-medium cursor-pointer ${late ? "bg-red-100 text-red-700 border-red-200" : `${st.color} border-transparent`}`}
                          >
                            {Object.entries(INVOICE_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{k === inv.status && late ? "期日超過" : v.label}</option>)}
                          </select>
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
