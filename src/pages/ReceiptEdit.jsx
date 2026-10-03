import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { receiptFilename } from "@/lib/docFilename";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Save, FileDown, Printer, Trash2, Loader2, CheckCircle2, Mail, Stamp, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import DocumentEmailDialog from "@/components/documents/DocumentEmailDialog";
import { PERSON_IN_CHARGE_OPTIONS, EMAIL_TO_PERSON_MAP } from "@/lib/constants";
import { todayString } from "@/lib/fiscal";
import { useSystemSettings } from "@/lib/useSystemSettings";
import {
  computeDocTotals, generateDocumentNumber, companyInfoFromSettings, RECEIPT_STATUS_MAP, PAYMENT_METHODS, defaultProviso,
  openBlob, openPreviewTab, showBlobInTab,
} from "@/lib/documents";
import { stampDutyLabel } from "@/lib/stampDuty";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/**
 * 領収書の作成・編集。
 *   /receipts/new?delivery=ID   納品書の明細から作る
 *   /receipts/new?invoice=ID    請求書の明細から作る
 *   /receipts/:id               編集
 * 元の明細から含める行を選び（初期値は全部）、税率ごとに計算した合計が領収金額になる。
 */
export default function ReceiptEdit() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);

  const [form, setForm] = useState(null);
  const [selected, setSelected] = useState(null); // 元の明細のうち含める行の id
  const [withStamp, setWithStamp] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);

  const { data: existing, isLoading } = useQuery({ queryKey: ["receipt", id], queryFn: () => db.entities.Receipt.get(id), enabled: !isNew });
  const deliveryId = searchParams.get("delivery") || existing?.delivery_note_id || null;
  const invoiceId = searchParams.get("invoice") || existing?.invoice_id || null;
  const { data: deliveryNote } = useQuery({ queryKey: ["deliveryNote", deliveryId], queryFn: () => db.entities.DeliveryNote.get(deliveryId), enabled: !!deliveryId });
  const { data: invoice } = useQuery({ queryKey: ["invoice", invoiceId], queryFn: () => db.entities.Invoice.get(invoiceId), enabled: !!invoiceId && !deliveryId });
  const source = deliveryNote || invoice || null;
  const sourceType = deliveryNote ? "delivery" : invoice ? "invoice" : null;
  // 同じ元から出した他の領収書（含めた行に印を付ける）
  const { data: siblings = [] } = useQuery({
    queryKey: ["receipts", "bySource", sourceType, source?.id],
    queryFn: () => db.entities.Receipt.filter(sourceType === "delivery" ? { delivery_note_id: source.id } : { invoice_id: source.id }, "-issue_date"),
    enabled: !!source,
  });
  const { data: emailLogs = [] } = useQuery({
    queryKey: ["emailLogs", "receipt", id],
    queryFn: () => db.entities.EmailLog.filter({ document_type: "receipt", document_id: id }, "-created_date"),
    enabled: !isNew,
  });

  const sourceItems = useMemo(() => (source?.line_items || []).filter((li) => li && (li.name || li.amount)), [source]);
  const receiptedElsewhere = useMemo(() => {
    const m = new Map();
    for (const r of siblings) {
      if (r.id === id) continue;
      for (const li of r.line_items || []) if (li.source_item_id) m.set(li.source_item_id, r.receipt_number);
    }
    return m;
  }, [siblings, id]);

  // 初期化
  useEffect(() => {
    if (form) return;
    if (!isNew) {
      if (!existing) return;
      setForm({ ...existing, line_items: existing.line_items || [] });
      setSelected(new Set((existing.line_items || []).map((li) => li.source_item_id).filter(Boolean)));
      return;
    }
    if ((deliveryId || invoiceId) && !source) return;
    const base = {
      delivery_note_id: deliveryNote?.id || null,
      invoice_id: invoice?.id || deliveryNote?.invoice_id || null,
      project_id: source?.project_id || null,
      client_id: source?.client_id || null,
      client_name: source?.client_name || "",
      client_honorific: source?.client_honorific || "御中",
      client_postal_code: source?.client_postal_code || "",
      client_address: source?.client_address || "",
      title: source?.title || "",
      proviso: defaultProviso(source?.title),
      issue_date: todayString(),
      payment_method: "cash",
      line_items: [],
      notes: "",
      status: "issued",
      person_in_charge: source?.person_in_charge || EMAIL_TO_PERSON_MAP[user?.email] || "",
    };
    setForm(base);
    // 初期値は全行。すでに他の領収書に含めた行は外しておく
    setSelected(new Set(sourceItems.filter((li) => !receiptedElsewhere.has(li.id)).map((li) => li.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, existing, source, deliveryId, invoiceId]);

  // 選んだ行から明細を作る（編集中はいつでも元の明細から組み直す）
  const items = useMemo(() => {
    if (!form) return [];
    if (!source || !selected) return form.line_items || [];
    return sourceItems.filter((li) => selected.has(li.id)).map((li) => ({
      id: `ri_${li.id}`, source_item_id: li.id, name: li.name, quantity: li.quantity, unit: li.unit, unit_price: li.unit_price, amount: li.amount, tax_rate: li.tax_rate ?? 10,
    }));
  }, [form, source, selected, sourceItems]);
  const totals = useMemo(() => computeDocTotals(items), [items]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (itemId) => setSelected((s) => { const n = new Set(s); if (n.has(itemId)) n.delete(itemId); else n.add(itemId); return n; });
  const allSelected = sourceItems.length > 0 && sourceItems.every((li) => selected?.has(li.id));

  const save = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("領収書に含める明細を 1 行以上選んでください");
      const payload = { ...form, client_name: (form.client_name || "").trim(), line_items: items, ...totals, created_by: form.created_by || user?.id || null };
      if (isNew) {
        payload.receipt_number = await generateDocumentNumber("receipt", form.issue_date);
        return db.entities.Receipt.create(payload);
      }
      return db.entities.Receipt.update(id, payload);
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["receipt", row.id] });
      toast.success(isNew ? `領収書 ${row.receipt_number} を発行しました` : "保存しました");
      setForm((f) => ({ ...f, ...row, line_items: row.line_items || f.line_items || [] }));
      if (isNew) navigate(`/receipts/${row.id}`, { replace: true });
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });
  const remove = useMutation({
    mutationFn: () => db.entities.Receipt.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["receipts"] }); toast.success("領収書を削除しました"); navigate("/receipts"); },
    onError: (err) => toast.error("削除できませんでした: " + (err?.message || "不明なエラー")),
  });

  // A5 単体（データ用）を保存
  const downloadA5 = async () => {
    setPdfLoading(true);
    try { openBlob(await db.documents.pdf("receipt", id, { stamp: withStamp, layout: "a5" }), receiptFilename(form)); }
    catch (err) { toast.error(err.message); }
    finally { setPdfLoading(false); }
  };
  // A4 印刷用（領収書＋控え）を新しいタブで開く
  const printA4 = async () => {
    const tab = openPreviewTab();
    setPdfLoading(true);
    try { showBlobInTab(tab, await db.documents.pdf("receipt", id, { stamp: withStamp, layout: "a4" }), receiptFilename(form)); }
    catch (err) { if (tab && !tab.closed) tab.close(); toast.error(err.message); }
    finally { setPdfLoading(false); }
  };

  if (!form || (!isNew && isLoading)) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isNew && !source) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-2">
        <ReceiptText className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="font-medium">領収書は納品書か請求書から発行します</p>
        <p className="text-sm text-muted-foreground">納品書または請求書の画面を開き、「領収書を発行」を押してください。</p>
      </div>
    );
  }

  const st = RECEIPT_STATUS_MAP[form.status] || RECEIPT_STATUS_MAP.issued;
  const canSave = (form.client_name || "").trim() && form.issue_date && items.length > 0 && !save.isPending;
  const sourceLabel = deliveryNote ? `納品書 ${deliveryNote.delivery_number}` : invoice ? `請求書 ${invoice.invoice_number}` : "";
  const sourceLink = deliveryNote ? `/delivery-notes/${deliveryNote.id}` : invoice ? `/invoices/${invoice.id}` : null;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(sourceLink || "/receipts")}><ArrowLeft className="w-4 h-4" /></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight">{isNew ? "領収書を発行" : `領収書 ${form.receipt_number}`}</h1>
              {!isNew && <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {sourceLink && <Link to={sourceLink} className="text-primary hover:underline">{sourceLabel} から</Link>}
              {form.project_id && <Link to={`/projects/${form.project_id}`} className="text-primary hover:underline">案件を開く</Link>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {!isNew && (
            <>
              <label className="flex items-center gap-1 text-[11px] cursor-pointer mr-1" title="持参して実印を押す場合は外す">
                <input type="checkbox" checked={withStamp} onChange={(e) => setWithStamp(e.target.checked)} /> <Stamp className="w-3.5 h-3.5" /> 社印を押す
              </label>
              <Button size="sm" className="gap-1.5 text-xs" onClick={printA4} disabled={pdfLoading}>
                {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />} 印刷用（A4に領収書＋控え）
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadA5} disabled={pdfLoading}>
                <FileDown className="w-3.5 h-3.5" /> PDF保存（A5）
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setMailOpen(true)}>
                <Mail className="w-3.5 h-3.5" /> メール送付（A5）
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /> 削除</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>領収書を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>この操作は取り消せません。番号 {form.receipt_number} は欠番になります。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground">削除</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => save.mutate()} disabled={!canSave}>
            {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {isNew ? "発行" : "保存"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">宛名・但し書き</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">宛名 <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Input value={form.client_name} onChange={(e) => set("client_name", e.target.value)} className="h-9" aria-label="宛名" />
                <Select value={form.client_honorific} onValueChange={(v) => set("client_honorific", v)}>
                  <SelectTrigger className="h-9 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="御中" className="text-xs">御中</SelectItem>
                    <SelectItem value="様" className="text-xs">様</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">但し書き</Label>
              <Input value={form.proviso || ""} onChange={(e) => set("proviso", e.target.value)} placeholder="例: チラシ印刷代として" className="h-9" aria-label="但し書き" />
              <p className="text-[10px] text-muted-foreground">PDF には「但し　{form.proviso || "お品代として"}」と出ます</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">件名（控え用。PDF の但し書きには使いません）</Label>
              <Input value={form.title || ""} onChange={(e) => set("title", e.target.value)} className="h-9" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">発行情報</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">発行日 <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.issue_date || ""} onChange={(e) => set("issue_date", e.target.value)} className="h-9" />
              {isNew && <p className="text-[10px] text-muted-foreground">番号は発行日の年月で採番されます（R-YYMM-連番）</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">受領方法</Label>
              <Select value={form.payment_method} onValueChange={(v) => set("payment_method", v)}>
                <SelectTrigger className="h-9 text-xs" aria-label="受領方法"><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.key} value={m.key} className="text-xs">{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">担当者</Label>
              <Select value={form.person_in_charge || ""} onValueChange={(v) => set("person_in_charge", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="担当者" /></SelectTrigger>
                <SelectContent>{PERSON_IN_CHARGE_OPTIONS.map((n) => <SelectItem key={n} value={n} className="text-xs">{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!isNew && (
              <div className="space-y-1.5">
                <Label className="text-xs">状態</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(RECEIPT_STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground"><span>税抜</span><span className="tabular-nums">{yen(totals.subtotal)}</span></div>
              {totals.tax_breakdown.map((b) => (
                <div key={b.rate} className="flex justify-between text-xs text-muted-foreground"><span>消費税（{b.rate}%）</span><span className="tabular-nums">{yen(b.tax)}</span></div>
              ))}
              <div className="flex justify-between font-bold border-t pt-1"><span>領収金額（税込）</span><span className="tabular-nums" data-testid="receipt-total">{yen(totals.total)}</span></div>
              <p className="text-[10px] text-muted-foreground pt-1">収入印紙（紙で渡す場合）: {stampDutyLabel(totals.subtotal)}。データ送付は不要</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm">領収書に含める明細（{items.length}／{sourceItems.length || items.length}行）</CardTitle>
            {source && (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(new Set(e.target.checked ? sourceItems.map((li) => li.id) : []))} aria-label="すべて選ぶ" /> すべて
              </label>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white text-xs">
                <th className="w-10 px-3 py-2"></th>
                <th className="text-left px-3 py-2 font-medium">摘要</th>
                <th className="text-right px-2 py-2 font-medium w-24">数量</th>
                <th className="text-right px-2 py-2 font-medium w-28">単価</th>
                <th className="text-right px-2 py-2 font-medium w-28">金額（税抜）</th>
                <th className="text-left px-2 py-2 font-medium w-16">税率</th>
              </tr>
            </thead>
            <tbody>
              {(source ? sourceItems : form.line_items).map((li) => {
                const on = source ? selected?.has(li.id) : true;
                const other = receiptedElsewhere.get(li.id);
                return (
                  <tr key={li.id} className={`border-b ${on ? "" : "opacity-50"}`}>
                    <td className="px-3 py-1.5 text-center">{source && <input type="checkbox" checked={!!on} onChange={() => toggle(li.id)} aria-label={`${li.name} を含める`} />}</td>
                    <td className="px-3 py-1.5">{li.name}{other && <span className="ml-2 text-[10px] text-amber-700">（{other} に含めた行）</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{li.quantity} {li.unit || ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{yen(li.unit_price)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{yen(li.amount)}</td>
                    <td className="px-2 py-1.5 text-xs">{li.tax_rate ?? 10}%</td>
                  </tr>
                );
              })}
              {(source ? sourceItems : form.line_items).length === 0 && (
                <tr><td colSpan={6} className="text-center text-xs text-muted-foreground py-8">元の書類に明細がありません</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">備考（PDF の下に小さく載ります）</CardTitle></CardHeader>
        <CardContent><Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={2} /></CardContent>
      </Card>

      {!isNew && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> 変更は「保存」を押すまで確定しません。PDF は保存済みの内容で作られます。A4 印刷用は上が領収書・下が控えで、切り取り線で半分に切ると A5 になります</p>
      )}
      {!isNew && emailLogs.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">送付履歴</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {emailLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30 text-xs">
                <Badge variant={log.status === "failed" ? "destructive" : "secondary"} className="text-[9px]">{log.status === "sent" ? "送信済" : "送信失敗"}</Badge>
                <span className="font-medium">{log.recipient_company}</span>
                <span className="text-muted-foreground">{log.recipient_email}</span>
                <span className="text-muted-foreground truncate">{log.subject}</span>
                {log.sent_at && <span className="text-muted-foreground ml-auto whitespace-nowrap">{new Date(log.sent_at).toLocaleString("ja-JP")}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isNew && (
        <DocumentEmailDialog open={mailOpen} onOpenChange={setMailOpen} type="receipt" doc={form} onSent={() => queryClient.invalidateQueries({ queryKey: ["receipt", id] })} />
      )}
    </div>
  );
}
