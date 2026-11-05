import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Receipt, ArrowRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { INVOICE_STATUS_MAP, INVOICE_SEND_LABEL, INVOICE_SEND_KEYS } from "@/lib/documents";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, todayString } from "@/lib/fiscal";
import { useListColumns, columnLabel } from "@/lib/listColumns";
import { ListColumnsButton } from "@/components/table/ListColumnsEditor";
import { refreshProjectActuals, projectIdsOfInvoice } from "@/lib/projectActuals";
import RecurringMark, { useRecurringProjectIds, invoiceHasRecurring } from "@/components/projects/RecurringMark";
import CsvExportButton from "@/components/table/CsvExportButton";
import { exportInvoicesCsv } from "@/lib/listCsv";
import ConditionFilter, { matchConditions, conditionActive } from "@/components/table/ConditionFilter";
import { INVOICE_DELIVERY_METHODS } from "@/lib/constants";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const ALL = "all";

export default function InvoiceList() {
  const cols = useListColumns("invoices"); // 列の並び・表示（全員共通）
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recurringIds = useRecurringProjectIds();
  const { fiscalYearStartMonth } = useSystemSettings();
  const currentFy = fiscalYearOf(todayString(), fiscalYearStartMonth);
  const [fiscalYear, setFiscalYear] = useState(String(currentFy));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("unpaid"); // all | unpaid | overdue | paid
  const [conditions, setConditions] = useState([]);
  const today = todayString();

  // 条件で絞る項目（freee の「条件追加」のように、いくつでも重ねられる）
  const condFields = useMemo(() => [
    { key: "invoice_number", label: "請求No.", type: "text" },
    { key: "client_name", label: "請求先", type: "text" },
    { key: "title", label: "請求書名（件名）", type: "text" },
    { key: "items", label: "明細の品目", type: "text", get: (i) => (i.line_items || []).map((li) => li.name || li.text || "") },
    { key: "invoice_date", label: "請求日", type: "date" },
    { key: "due_date", label: "入金期日", type: "date" },
    { key: "sent_at", label: "送付日", type: "date" },
    { key: "paid_at", label: "入金日", type: "date" },
    { key: "subtotal", label: "請求金額（税抜）", type: "amount" },
    { key: "total", label: "請求金額（税込）", type: "amount" },
    { key: "status", label: "送付", type: "select", get: (i) => (i.status === "sent" && i.due_date && i.due_date < today ? ["sent", "overdue"] : [i.status || "draft"]),
      options: [...INVOICE_SEND_KEYS.map((value) => ({ value, label: INVOICE_SEND_LABEL[value] })), { value: "overdue", label: "期日超過" }, { value: "cancelled", label: INVOICE_SEND_LABEL.cancelled }] },
    { key: "delivery_method", label: "送付方法", type: "select", get: (i) => i.delivery_method || "",
      options: [...Object.entries(INVOICE_DELIVERY_METHODS).map(([value, label]) => ({ value, label })), { value: "", label: "未設定" }] },
    { key: "person_in_charge", label: "担当者", type: "select", get: (i) => i.person_in_charge || "", options: [] },
    { key: "recurring", label: "定期売上", type: "select", get: (i) => (invoiceHasRecurring(i, recurringIds) ? "yes" : "no"), options: [{ value: "yes", label: "定期売上の請求" }, { value: "no", label: "定期売上以外" }] },
  ], [today, recurringIds]);
  // 請求日で絞るときは、期（年度）にかかわらず探す
  const byInvoiceDate = conditions.some((c) => c.key === "invoice_date" && conditionActive(c, condFields.find((f) => f.key === "invoice_date")));

  const range = fiscalYear === ALL || byInvoiceDate ? null : fiscalYearRange(Number(fiscalYear), fiscalYearStartMonth);
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices", byInvoiceDate ? ALL : fiscalYear, fiscalYearStartMonth],
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
  // 担当者の選択肢は、読み込んだ請求書から
  const fieldsWithPeople = useMemo(() => condFields.map((f) => (f.key !== "person_in_charge" ? f : {
    ...f, options: [...new Set(invoices.map((i) => i.person_in_charge || ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ja"))).map((v) => ({ value: v, label: v || "未設定" })),
  })), [condFields, invoices]);
  const shown = useMemo(() => filtered.filter((inv) => matchConditions(inv, conditions, fieldsWithPeople)), [filtered, conditions, fieldsWithPeople]);

  // 一覧から状態を変える（下書き→送付済、送付済→入金済 など）
  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => {
      const patch = { status };
      if (status === "sent") patch.sent_at = new Date().toISOString();
      if (status === "paid") { patch.paid_at = todayString(); }
      if (status === "draft") { patch.sent_at = null; patch.paid_at = null; patch.paid_amount = null; }
      return db.entities.Invoice.update(id, patch);
    },
    onSuccess: (row, v) => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); refreshProjectActuals(projectIdsOfInvoice(row)).then(() => queryClient.invalidateQueries({ queryKey: ["projects"] })); toast.success(`送付を「${INVOICE_SEND_LABEL[v.status] || v.status}」にしました`); },
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
          <CsvExportButton count={shown.length} onExport={() => exportInvoicesCsv(shown)} />
          <ListColumnsButton list="invoices" />
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
      <ConditionFilter fields={fieldsWithPeople} value={conditions} className="-mt-2"
        onChange={(next) => {
          // 「状態」の条件を足したら、上の「未入金」などのボタンは「すべて」にする（両方で絞って 0 件にならないように）
          if (next.some((c) => c.key === "status") && !conditions.some((c) => c.key === "status")) setFilter("all");
          setConditions(next);
        }} />
      {byInvoiceDate && <p className="-mt-2 text-[11px] text-muted-foreground">請求日の条件で探しているので、期（{fiscalYear === ALL ? "すべての期" : fiscalYearLabel(Number(fiscalYear), fiscalYearStartMonth)}）にかかわらず表示しています</p>}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : shown.length === 0 ? (
            <div className="text-center py-16">
              <Receipt className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">該当する請求書がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {cols.map((k) => (
                      <TableHead key={k} className={`text-xs text-white whitespace-nowrap ${k === "total" ? "text-right" : ""}`}>{columnLabel("invoices", k)}</TableHead>
                    ))}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((inv) => {
                    const st = INVOICE_STATUS_MAP[inv.status] || INVOICE_STATUS_MAP.draft;
                    const late = inv.status === "sent" && inv.due_date && inv.due_date < today;
                    return (
                      <TableRow key={inv.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => window.open(`/invoices/${inv.id}`, "_blank", "noopener")} title="新しいタブで開きます">
                        {cols.map((k) => {
                          switch (k) {
                            case "invoice_number": return <TableCell key={k} className="text-xs font-mono text-muted-foreground whitespace-nowrap">{inv.invoice_number}</TableCell>;
                            case "invoice_date": return <TableCell key={k} className="text-xs whitespace-nowrap">{inv.invoice_date}</TableCell>;
                            case "due_date": return <TableCell key={k} className={`text-xs whitespace-nowrap ${late ? "text-red-700 font-medium" : ""}`}>{inv.due_date || "—"}</TableCell>;
                            case "client_name": return <TableCell key={k} className="text-sm font-medium max-w-[220px] truncate">{inv.client_name}</TableCell>;
                            case "title": return <TableCell key={k} className="text-sm max-w-[300px] truncate">{invoiceHasRecurring(inv, recurringIds) && <RecurringMark className="mr-1.5 align-middle" title="定期売上の分が入っている請求書" />}{inv.title || "—"}</TableCell>;
                            case "total": return <TableCell key={k} className="text-right text-sm tabular-nums">{yen(inv.total)}</TableCell>;
                            case "status": return (
                        <TableCell key={k} onClick={(e) => e.stopPropagation()}>
                          <select
                            value={inv.status}
                            onChange={(e) => statusMutation.mutate({ id: inv.id, status: e.target.value })}
                            title="一覧から送付を変えられます（未＝まだ送っていない・済＝送った。入金額まで記録するときは請求書を開いて「入金を記録」）"
                            className={`h-7 rounded-md border px-1.5 text-[11px] font-medium cursor-pointer ${st.color} border-transparent`}
                          >
                            {[...INVOICE_SEND_KEYS, ...(inv.status === "cancelled" ? ["cancelled"] : [])].map((sk) => <option key={sk} value={sk}>{INVOICE_SEND_LABEL[sk]}</option>)}
                          </select>
                        </TableCell>
                            );
                            default: return <TableCell key={k} />;
                          }
                        })}
                        <TableCell><ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary" /></TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30 hover:bg-muted/30 font-medium">
                    {cols.map((k, i) => (k === "total"
                      ? <TableCell key={k} className="text-right text-sm tabular-nums">{yen(sum(shown))}</TableCell>
                      : <TableCell key={k} className="text-xs text-muted-foreground whitespace-nowrap">{i === cols.findIndex((c) => c !== "total") ? `表示中の合計（${shown.length}件）` : ""}</TableCell>))}
                    <TableCell />
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
