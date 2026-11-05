import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Loader2, Truck, ArrowRight, Plus, Trash2, SquareCheck, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DELIVERY_STATUS_MAP } from "@/lib/documents";
import { isNoteInvoiced } from "@/lib/deliveryStatus";
import { useListColumns, columnLabel } from "@/lib/listColumns";
import { ListColumnsButton } from "@/components/table/ListColumnsEditor";
import RecurringMark, { useRecurringProjectIds, noteIsRecurring } from "@/components/projects/RecurringMark";
import CsvExportButton from "@/components/table/CsvExportButton";
import PeriodFilter, { emptyPeriod, inPeriod } from "@/components/table/PeriodFilter";

// 期間で絞り込める日付
const PERIOD_FIELDS = [{ value: "delivery_date", label: "納品日" }, { value: "created_date", label: "作成日" }];
import { exportDeliveryNotesCsv } from "@/lib/listCsv";
import { useSessionState } from "@/hooks/use-session-state";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

export default function DeliveryNoteList() {
  const cols = useListColumns("delivery_notes"); // 列の並び・表示（全員共通）
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // 検索・絞り込みは、詳細を開いて戻ってきても残す（このタブのあいだ）
  const [search, setSearch] = useSessionState("deliveryNotes.search", "");
  const [filter, setFilter] = useSessionState("deliveryNotes.filter", "all"); // all | uninvoiced | draft
  const [showRecurring, setShowRecurring] = useSessionState("deliveryNotes.showRecurring", false); // 定期売上の納品書（案件の「月ごとの納品・請求」で見る）は、ふだんは出さない
  const [period, setPeriod] = useSessionState("deliveryNotes.period", () => emptyPeriod("delivery_date")); // 期間（納品日・作成日）
  const [picked, setPicked] = useState(() => new Set());
  const recurringIds = useRecurringProjectIds();
  const [deleting, setDeleting] = useState(false);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["deliveryNotes"],
    queryFn: () => db.entities.DeliveryNote.listAll("-delivery_date"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (!showRecurring && noteIsRecurring(n, recurringIds)) return false;
      if (!inPeriod(n[period.field], period)) return false;
      if (filter === "uninvoiced" && isNoteInvoiced(n)) return false;
      if (filter === "draft" && n.status !== "draft") return false;
      if (!q) return true;
      return [n.delivery_number, n.client_name, n.title].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [notes, search, filter, period, showRecurring, recurringIds]);
  const recurringCount = useMemo(() => notes.filter((n) => noteIsRecurring(n, recurringIds)).length, [notes, recurringIds]);

  // 一覧の金額は税別（小計）で出す
  const total = filtered.reduce((s, n) => s + Number(n.subtotal || 0), 0);

  // 請求書作成の 未処理／処理済 を一覧から変える（請求書とつながっていない納品書だけ）
  const setInvoicedManual = async (n, done) => {
    queryClient.setQueryData(["deliveryNotes"], (old) => (old || []).map((x) => (x.id === n.id ? { ...x, invoiced_manual: done } : x)));
    try {
      await db.entities.DeliveryNote.update(n.id, { invoiced_manual: done });
      toast.success(`請求書作成を「${done ? "処理済" : "未処理"}」にしました`);
    } catch (e) {
      toast.error("変えられませんでした: " + (e?.message || ""));
    } finally {
      queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] });
    }
  };

  // 選んだ納品書から請求書を作る（同じクライアントの未請求分だけ。1 枚の請求書にまとめる）
  const pickedNotes = notes.filter((n) => picked.has(n.id));
  const pickedClients = [...new Set(pickedNotes.map((n) => (n.client_name || "").trim()))];
  const pickedInvoiced = pickedNotes.filter(isNoteInvoiced);
  const invoiceBlock = pickedInvoiced.length > 0
    ? `請求書作成が「処理済」の納品書が ${pickedInvoiced.length} 件入っています（外すと作れます）`
    : pickedClients.length > 1 ? `クライアントが違う納品書が入っています（${pickedClients.slice(0, 3).join("・")}${pickedClients.length > 3 ? " ほか" : ""}）` : "";
  const sameClientRest = !invoiceBlock && pickedClients.length === 1
    ? notes.filter((n) => !isNoteInvoiced(n) && (showRecurring || !noteIsRecurring(n, recurringIds)) && (n.client_name || "").trim() === pickedClients[0] && !picked.has(n.id))
    : [];
  // 同じクライアントの未請求の納品書（選んだものも含む）。選んだ 1 件から、ほかの分をその場で足せるように並べる
  const sameClientAll = !invoiceBlock && pickedClients.length === 1
    ? notes.filter((n) => !isNoteInvoiced(n) && (showRecurring || !noteIsRecurring(n, recurringIds) || picked.has(n.id)) && (n.client_name || "").trim() === pickedClients[0])
    : [];
  const pickedTotal = pickedNotes.reduce((s, n) => s + Number(n.subtotal || 0), 0);
  const invoicePicked = () => {
    const ids = [...pickedNotes].sort((a, b) => String(a.delivery_date || "").localeCompare(String(b.delivery_date || ""))).map((n) => n.id);
    navigate(`/invoices/new?delivery=${ids.join(",")}`);
  };

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
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length}件 / 全{notes.length}件　合計 {yen(total)}（税別）</p>
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
          <CsvExportButton count={filtered.length} onExport={() => exportDeliveryNotesCsv(filtered)} />
          <ListColumnsButton list="delivery_notes" />
          <Button className="gap-2" onClick={() => navigate("/delivery-notes/new")}><Plus className="w-4 h-4" /> 納品書を作成</Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="番号・クライアント名・件名で検索" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[["all", "すべて"], ["uninvoiced", "請求書作成：未処理"], ["draft", "下書き"]].map(([k, label]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} className="text-xs" onClick={() => setFilter(k)}>{label}</Button>
          ))}
          {recurringCount > 0 && (
            <Button size="sm" variant={showRecurring ? "default" : "outline"} className="text-xs gap-1" onClick={() => setShowRecurring((v) => !v)}
              title="定期売上の納品書は、案件の画面の「月ごとの納品・請求」で見られます。ここでは、ふだんは出しません" data-testid="show-recurring-notes">
              {showRecurring ? "定期売上の分も表示中" : `定期売上の分も表示（${recurringCount}件）`}
            </Button>
          )}
        </div>
      </div>
      <PeriodFilter value={period} onChange={setPeriod} fields={PERIOD_FIELDS} className="-mt-1" />

      {/* 選んでいないときも出して、選ぶと請求書にまとめられることが分かるようにする */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950" data-testid="picked-bar">
        {picked.size === 0 ? (
          <>
            <span className="inline-flex items-center gap-1.5"><SquareCheck className="w-3.5 h-3.5 text-sky-700 shrink-0" /><span>左のチェックで納品書を選ぶと、<strong>同じクライアントの未請求の納品書を 1 枚の請求書にまとめて</strong>作れます</span></span>
            <span className="flex-1" />
            {filter !== "uninvoiced" && <Button size="sm" variant="outline" className="h-8 text-xs bg-white" onClick={() => setFilter("uninvoiced")}>未処理だけ表示</Button>}
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled title="先に左のチェックで納品書を選んでください">
              <SquareCheck className="w-3.5 h-3.5" /> 選択した納品書で請求書を作る
            </Button>
          </>
        ) : (
          <>
            <span>選択中 <strong>{picked.size} 件</strong>　合計 {yen(pickedTotal)}（税別）{pickedClients.length === 1 && <>　<span className="font-medium">{pickedClients[0]}</span></>}</span>
            {invoiceBlock && <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle className="w-3.5 h-3.5" /> {invoiceBlock}</span>}
            <span className="flex-1" />
            {sameClientRest.length > 0 && (
              <Button size="sm" variant="outline" className="h-8 text-xs bg-white" onClick={() => setPicked((prev) => new Set([...prev, ...sameClientRest.map((n) => n.id)]))}>
                同じクライアントの未請求 {sameClientRest.length} 件も選ぶ
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPicked(new Set())}>選択を外す</Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!!invoiceBlock} onClick={invoicePicked} title={invoiceBlock || "選んだ納品書を 1 枚の請求書にまとめます（納品日の順に並びます）"}>
              <SquareCheck className="w-3.5 h-3.5" /> 選択した {picked.size} 件で請求書を作る
            </Button>
            {/* 同じクライアントの未請求の納品書を、その場でチェックして足せるように並べる */}
            {sameClientAll.length > 1 && (
              <div className="basis-full rounded-md border border-sky-200 bg-white" data-testid="same-client-rest">
                <p className="px-3 py-1.5 text-[11px] font-semibold text-sky-900 border-b border-sky-100">同じクライアント（{pickedClients[0]}）の未請求の納品書 {sameClientAll.length} 件　<span className="font-normal text-muted-foreground">チェックした分を 1 枚の請求書にまとめます</span></p>
                <div className="max-h-48 overflow-y-auto divide-y">
                  {[...sameClientAll].sort((a, b) => String(a.delivery_date || "").localeCompare(String(b.delivery_date || ""))).map((n) => (
                    <label key={n.id} className="flex items-center gap-3 px-3 py-1.5 text-xs cursor-pointer hover:bg-sky-50/60">
                      <Checkbox checked={picked.has(n.id)} onCheckedChange={() => togglePick(n.id)} aria-label={`${n.delivery_number}を選ぶ`} />
                      <span className="font-mono text-muted-foreground w-24 shrink-0">{n.delivery_number}</span>
                      <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{n.delivery_date}</span>
                      <span className="flex-1 min-w-0 truncate">
                        {noteIsRecurring(n, recurringIds) && <RecurringMark className="mr-1.5 align-middle" />}
                        {n.status === "draft" && <Badge variant="outline" className="mr-1.5 text-[9px] font-normal text-muted-foreground">下書き</Badge>}
                        {n.title || "（件名なし）"}
                      </span>
                      <span className="tabular-nums w-24 text-right">{yen(n.subtotal)}</span>
                      <a href={`/delivery-notes/${n.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-primary hover:underline shrink-0">開く</a>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
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
                    {cols.map((k) => (
                      <TableHead key={k} className={`text-xs text-white whitespace-nowrap ${k === "total" ? "text-right" : ""}`}>{columnLabel("delivery_notes", k)}</TableHead>
                    ))}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((n) => {
                    const st = DELIVERY_STATUS_MAP[n.status] || DELIVERY_STATUS_MAP.draft;
                    return (
                      <TableRow key={n.id} className={`group cursor-pointer hover:bg-muted/40 ${picked.has(n.id) ? "bg-sky-50/70" : ""}`} onClick={() => window.open(`/delivery-notes/${n.id}`, "_blank", "noopener")} title="新しいタブで開きます">
                        <TableCell className="w-8 px-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox aria-label="選択" checked={picked.has(n.id)} onCheckedChange={() => togglePick(n.id)} />
                        </TableCell>
                        {cols.map((k) => {
                          switch (k) {
                            case "delivery_number": return <TableCell key={k} className="text-xs font-mono text-muted-foreground whitespace-nowrap">{n.delivery_number}</TableCell>;
                            case "delivery_date": return <TableCell key={k} className="text-xs whitespace-nowrap">{n.delivery_date}</TableCell>;
                            case "client_name": return <TableCell key={k} className="text-sm font-medium max-w-[220px] truncate">{n.client_name}</TableCell>;
                            case "title": return (
                              <TableCell key={k} className="text-sm max-w-[300px] truncate">
                                {noteIsRecurring(n, recurringIds) && <RecurringMark className="mr-1.5 align-middle" title={n.recurring_template_id ? "定期売上から毎月作られた納品書" : "定期売上の案件の納品書"} />}
                                {n.title || "—"}
                              </TableCell>
                            );
                            case "total": return <TableCell key={k} className="text-right text-sm tabular-nums" title={`税込 ${yen(n.total)}`}>{yen(n.subtotal)}</TableCell>;
                            case "status": return <TableCell key={k}><Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge></TableCell>;
                            case "invoice": return (
                              <TableCell key={k}>
                                {n.invoice_id
                                  ? <Link to={`/invoices/${n.invoice_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-primary hover:underline" title="この納品書から作った請求書を開く（請求書とつながっているので、ここでは変えられません）">処理済</Link>
                                  : (
                                    // 請求書とつながっていない納品書は、一覧から 未処理／処理済 を切り替えられる
                                    <select value={n.invoiced_manual ? "done" : "todo"} onClick={(e) => e.stopPropagation()} onChange={(e) => setInvoicedManual(n, e.target.value === "done")}
                                      title="請求書作成の処理を一覧から変えられます（freee販売で請求した分など）"
                                      className={`h-7 rounded-md border px-1.5 text-[11px] font-medium cursor-pointer border-transparent ${n.invoiced_manual ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-800"}`} data-testid="note-invoiced-select">
                                      <option value="todo">未処理</option>
                                      <option value="done">処理済</option>
                                    </select>
                                  )}
                              </TableCell>
                            );
                            default: return <TableCell key={k} />;
                          }
                        })}
                        <TableCell><ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary" /></TableCell>
                      </TableRow>
                    );
                  })}
                  {/* 表示中（検索・期間・絞り込みのあと）の合計 */}
                  <TableRow className="bg-muted/30 hover:bg-muted/30 font-medium" data-testid="list-total">
                    <TableCell />
                    {cols.map((k, i) => (k === "total"
                      ? <TableCell key={k} className="text-right text-sm tabular-nums whitespace-nowrap">{yen(total)}</TableCell>
                      : <TableCell key={k} className="text-xs text-muted-foreground whitespace-nowrap">{i === cols.findIndex((c) => c !== "total") ? `表示中の合計（${filtered.length}件）` : ""}</TableCell>))}
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
