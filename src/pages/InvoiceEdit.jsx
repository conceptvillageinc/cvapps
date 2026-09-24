import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Save, FileDown, FileOutput, Plus, Trash2, Loader2, Truck, Send, CircleCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import DocumentEmailDialog from "@/components/documents/DocumentEmailDialog";
import { Mail } from "lucide-react";
import { PERSON_IN_CHARGE_OPTIONS, EMAIL_TO_PERSON_MAP, INVOICE_DELIVERY_METHODS } from "@/lib/constants";
import { todayString } from "@/lib/fiscal";
import { formatPostalCode } from "@/lib/postalCode";
import { useSystemSettings } from "@/lib/useSystemSettings";
import {
  newDocItem, computeDocTotals, generateDocumentNumber, defaultDueDate,
  companyInfoFromSettings, INVOICE_STATUS_MAP, TAX_RATES, openBlob, openPreviewTab, showBlobInTab,
} from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const noSpinner = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

function emptyForm(user) {
  const today = todayString();
  return {
    project_id: null,
    client_id: null,
    client_name: "",
    client_honorific: "御中",
    client_postal_code: "",
    client_address: "",
    title: "",
    invoice_date: today,
    due_date: defaultDueDate(today),
    line_items: [],
    notes: "",
    status: "draft",
    sent_at: null,
    paid_at: null,
    paid_amount: null,
    delivery_method: null,
    person_in_charge: EMAIL_TO_PERSON_MAP[user?.email] || "",
  };
}

/** 納品書の明細を請求書の明細に写す（取引日 = 納品日） */
function itemsFromDeliveryNote(dn) {
  return (dn.line_items || []).map((li) => newDocItem({
    ...li,
    id: undefined,
    transaction_date: dn.delivery_date,
    delivery_note_id: dn.id,
    delivery_number: dn.delivery_number,
  }));
}

/**
 * 請求書の作成・編集・表示。
 *   /invoices/new?delivery=ID  納品書から作る（同じクライアントの未請求の納品書をまとめられる）
 *   /invoices/new?project=ID   案件から作る
 *   /invoices/:id              編集
 */
export default function InvoiceEdit() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);

  const [form, setForm] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [paidForm, setPaidForm] = useState({ paid_at: todayString(), paid_amount: "" });

  const { data: existing, isLoading } = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => db.entities.Invoice.get(id),
    enabled: !isNew,
  });
  const sourceDeliveryId = searchParams.get("delivery");
  const sourceProjectId = searchParams.get("project");
  const { data: sourceDelivery } = useQuery({
    queryKey: ["deliveryNote", sourceDeliveryId],
    queryFn: () => db.entities.DeliveryNote.get(sourceDeliveryId),
    enabled: isNew && !!sourceDeliveryId,
  });
  const projectId = form?.project_id || sourceProjectId || sourceDelivery?.project_id || null;
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => db.entities.Project.get(projectId),
    enabled: !!projectId,
  });
  const { data: emailLogs = [] } = useQuery({
    queryKey: ["emailLogs", "invoice", id],
    queryFn: () => db.entities.EmailLog.filter({ document_type: "invoice", document_id: id }, "-created_date"),
    enabled: !isNew,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });
  // まとめる候補: 同じクライアントの納品書（未請求 + この請求書に含めたもの）
  const { data: clientNotes = [] } = useQuery({
    queryKey: ["deliveryNotes", "byClient", form?.client_name],
    queryFn: () => db.entities.DeliveryNote.filter({ client_name: form.client_name }, "-delivery_date"),
    enabled: !!form?.client_name,
  });
  const candidateNotes = useMemo(
    () => clientNotes.filter((n) => !n.invoice_id || (!isNew && n.invoice_id === id)),
    [clientNotes, isNew, id],
  );
  const includedNoteIds = useMemo(
    () => [...new Set((form?.line_items || []).map((li) => li.delivery_note_id).filter(Boolean))],
    [form?.line_items],
  );

  // 初期化
  useEffect(() => {
    if (form) return;
    if (!isNew) {
      if (existing) setForm({ ...emptyForm(user), ...existing, line_items: existing.line_items || [] });
      return;
    }
    if (sourceDeliveryId && !sourceDelivery) return;
    if (sourceProjectId && !project) return;
    const base = emptyForm(user);
    if (sourceDelivery) {
      Object.assign(base, {
        project_id: sourceDelivery.project_id || null,
        client_id: sourceDelivery.client_id || null,
        client_name: sourceDelivery.client_name || "",
        client_honorific: sourceDelivery.client_honorific || "御中",
        client_postal_code: sourceDelivery.client_postal_code || "",
        client_address: sourceDelivery.client_address || "",
        title: sourceDelivery.title || "",
        line_items: itemsFromDeliveryNote(sourceDelivery),
        person_in_charge: sourceDelivery.person_in_charge || base.person_in_charge,
      });
    } else if (project) {
      Object.assign(base, { project_id: project.id, client_name: project.client_name || "", title: project.name || "" });
    }
    base.notes = company.invoice_notes || "";
    setForm(base);
     
  }, [isNew, existing, sourceDelivery, project, sourceDeliveryId, sourceProjectId, company.invoice_notes]);

  // クライアントマスタから住所・送付方法を補う
  useEffect(() => {
    if (!form || !form.client_name) return;
    const c = clients.find((x) => x.name === form.client_name);
    if (!c) return;
    setForm((f) => ({
      ...f,
      client_id: f.client_id || c.id,
      client_postal_code: f.client_postal_code || c.postal_code || "",
      client_address: f.client_address || c.address || "",
      delivery_method: f.delivery_method || c.invoice_delivery_method || null,
    }));
     
  }, [form?.client_name, clients.length]);

  const totals = useMemo(() => computeDocTotals(form?.line_items || []), [form?.line_items]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (itemId, patch) => setForm((f) => ({
    ...f,
    line_items: f.line_items.map((li) => {
      if (li.id !== itemId) return li;
      const next = { ...li, ...patch };
      if ("quantity" in patch || "unit_price" in patch) next.amount = Math.round((Number(next.quantity) || 0) * (Number(next.unit_price) || 0));
      return next;
    }),
  }));
  const addItem = () => set("line_items", [...form.line_items, newDocItem({ transaction_date: form.invoice_date })]);
  const removeItem = (itemId) => set("line_items", form.line_items.filter((li) => li.id !== itemId));

  const toggleNote = (dn) => {
    if (includedNoteIds.includes(dn.id)) {
      set("line_items", form.line_items.filter((li) => li.delivery_note_id !== dn.id));
    } else {
      setForm((f) => ({ ...f, title: f.title || dn.title || "", line_items: [...f.line_items, ...itemsFromDeliveryNote(dn)] }));
    }
  };

  const locked = form?.status === "paid" || form?.status === "cancelled";

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        client_name: (form.client_name || "").trim(),
        line_items: form.line_items.filter((li) => li.name || li.amount),
        ...totals,
        created_by: form.created_by || user?.id || null,
      };
      let row;
      if (isNew) {
        payload.invoice_number = await generateDocumentNumber("invoice", form.invoice_date);
        row = await db.entities.Invoice.create(payload);
      } else {
        row = await db.entities.Invoice.update(id, payload);
      }
      // 納品書側の「請求済」を同期する
      const nowIncluded = new Set(payload.line_items.map((li) => li.delivery_note_id).filter(Boolean));
      for (const dn of clientNotes) {
        const was = dn.invoice_id === row.id;
        const now = nowIncluded.has(dn.id);
        if (now && !was) await db.entities.DeliveryNote.update(dn.id, { invoice_id: row.id, status: "issued" });
        if (!now && was) await db.entities.DeliveryNote.update(dn.id, { invoice_id: null });
      }
      return row;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", row.id] });
      queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] });
      toast.success(isNew ? `請求書 ${row.invoice_number} を作成しました` : "保存しました");
      setForm((f) => ({ ...f, ...row, line_items: row.line_items || f.line_items || [] }));
      if (isNew) navigate(`/invoices/${row.id}`, { replace: true });
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const quick = useMutation({
    mutationFn: (patch) => db.entities.Invoice.update(id, patch),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
      setForm((f) => ({ ...f, ...row, line_items: row.line_items || f.line_items || [] }));
    },
    onError: (err) => toast.error("更新できませんでした: " + (err?.message || "不明なエラー")),
  });

  const remove = useMutation({
    mutationFn: async () => {
      for (const dn of clientNotes) if (dn.invoice_id === id) await db.entities.DeliveryNote.update(dn.id, { invoice_id: null });
      return db.entities.Invoice.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] });
      toast.success("請求書を削除しました");
      navigate("/invoices");
    },
    onError: (err) => toast.error("削除できませんでした: " + (err?.message || "不明なエラー")),
  });

  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await db.documents.pdf("invoice", id);
      openBlob(blob, `請求書_${form.invoice_number}_${form.client_name}.pdf`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  // 印刷用に新しいタブで開く（ブラウザのPDF表示から印刷できる）
  const previewPdf = async () => {
    const tab = openPreviewTab();
    setPdfLoading(true);
    try {
      const blob = await db.documents.pdf("invoice", id);
      showBlobInTab(tab, blob, `請求書_${form.invoice_number}_${form.client_name}.pdf`);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      toast.error(err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  if (!form || (!isNew && isLoading)) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const st = INVOICE_STATUS_MAP[form.status] || INVOICE_STATUS_MAP.draft;
  const canSave = (form.client_name || "").trim() && form.invoice_date && !save.isPending && !locked;
  const isOverdue = form.status === "sent" && form.due_date && form.due_date < todayString();

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/invoices")}><ArrowLeft className="w-4 h-4" /></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight">{isNew ? "請求書を作成" : `請求書 ${form.invoice_number}`}</h1>
              {!isNew && <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>}
              {isOverdue && <Badge className="text-[10px] bg-red-100 text-red-700 hover:bg-red-100">期日超過</Badge>}
              {form.legacy_id && <Badge variant="outline" className="text-[10px] font-normal">freeeから取込</Badge>}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {project && <Link to={`/projects/${project.id}`} className="text-primary hover:underline">案件 {project.project_number} {project.name}</Link>}
              {form.delivery_method && <span>送付方法: {INVOICE_DELIVERY_METHODS[form.delivery_method] || form.delivery_method}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {!isNew && (
            <>
              <Button size="sm" className="gap-1.5 text-xs" onClick={previewPdf} disabled={pdfLoading}>
                {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileOutput className="w-3.5 h-3.5" />} 印刷用に新しいタブで開く
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadPdf} disabled={pdfLoading}>
                <FileDown className="w-3.5 h-3.5" /> PDF保存
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setMailOpen(true)}>
                <Mail className="w-3.5 h-3.5" /> メール送付
              </Button>
              {form.status === "draft" && (
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => quick.mutate({ status: "sent", sent_at: new Date().toISOString() })}>
                  <Send className="w-3.5 h-3.5" /> 送付済にする
                </Button>
              )}
              {(form.status === "draft" || form.status === "sent") && (
                <Button size="sm" className="gap-1.5 text-xs" onClick={() => { setPaidForm({ paid_at: todayString(), paid_amount: String(form.total || "") }); setPaidOpen(true); }}>
                  <CircleCheck className="w-3.5 h-3.5" /> 入金済にする
                </Button>
              )}
              {form.status === "paid" && (
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => quick.mutate({ status: "sent", paid_at: null, paid_amount: null })}>
                  <Undo2 className="w-3.5 h-3.5" /> 入金を取り消す
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive" disabled={form.status === "paid"}><Trash2 className="w-3.5 h-3.5" /> 削除</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>請求書を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>まとめていた納品書は「未請求」に戻ります。この操作は取り消せません。</AlertDialogDescription>
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
            {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {isNew ? "作成" : "保存"}
          </Button>
        </div>
      </div>

      {form.status === "paid" && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-2.5">
          {form.paid_at} に {yen(form.paid_amount ?? form.total)} の入金を確認済みです。内容の編集はできません。
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">宛先・件名</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">請求先 <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Input list="inv-clients" value={form.client_name} onChange={(e) => set("client_name", e.target.value)} className="h-9" disabled={locked || includedNoteIds.length > 0} />
                <datalist id="inv-clients">{clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
                <Select value={form.client_honorific} onValueChange={(v) => set("client_honorific", v)} disabled={locked}>
                  <SelectTrigger className="h-9 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="御中" className="text-xs">御中</SelectItem>
                    <SelectItem value="様" className="text-xs">様</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">郵便番号</Label>
              <Input value={form.client_postal_code || ""} onChange={(e) => set("client_postal_code", e.target.value)} className="h-9 font-mono" disabled={locked} />
              {form.client_postal_code && <p className="text-[10px] text-muted-foreground">〒{formatPostalCode(form.client_postal_code)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">住所</Label>
              <Input value={form.client_address || ""} onChange={(e) => set("client_address", e.target.value)} className="h-9" disabled={locked} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">件名</Label>
              <Input value={form.title || ""} onChange={(e) => set("title", e.target.value)} className="h-9" disabled={locked} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">請求情報</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">請求日 <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.invoice_date || ""} onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value, due_date: f.due_date && f.due_date !== defaultDueDate(f.invoice_date) ? f.due_date : defaultDueDate(e.target.value) }))} className="h-9" disabled={locked} />
              {isNew && <p className="text-[10px] text-muted-foreground">番号は請求日の年月で採番されます（I-YYMM-連番）</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">入金期日</Label>
              <Input type="date" value={form.due_date || ""} onChange={(e) => set("due_date", e.target.value)} className="h-9" disabled={locked} />
              <p className="text-[10px] text-muted-foreground">既定: 請求日の翌月末</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">送付方法</Label>
              <Select value={form.delivery_method || "none"} onValueChange={(v) => set("delivery_method", v === "none" ? null : v)} disabled={locked}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">未設定</SelectItem>
                  {Object.entries(INVOICE_DELIVERY_METHODS).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">担当者</Label>
              <Select value={form.person_in_charge || ""} onValueChange={(v) => set("person_in_charge", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="担当者" /></SelectTrigger>
                <SelectContent>{PERSON_IN_CHARGE_OPTIONS.map((n) => <SelectItem key={n} value={n} className="text-xs">{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground"><span>小計</span><span className="tabular-nums">{yen(totals.subtotal)}</span></div>
              {totals.tax_breakdown.map((b) => (
                <div key={b.rate} className="flex justify-between text-xs text-muted-foreground"><span>消費税（{b.rate}%）</span><span className="tabular-nums">{yen(b.tax)}</span></div>
              ))}
              <div className="flex justify-between font-bold border-t pt-1"><span>請求金額</span><span className="tabular-nums">{yen(totals.total)}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* まとめる納品書 */}
      {form.client_name && !locked && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Truck className="w-4 h-4" /> まとめる納品書（{form.client_name}）</CardTitle>
          </CardHeader>
          <CardContent>
            {candidateNotes.length === 0 ? (
              <p className="text-xs text-muted-foreground">未請求の納品書がありません。明細は下の表に直接入力できます</p>
            ) : (
              <div className="space-y-1">
                {candidateNotes.map((dn) => {
                  const on = includedNoteIds.includes(dn.id);
                  return (
                    <label key={dn.id} className={`flex items-center gap-3 p-2 rounded-md text-xs cursor-pointer ${on ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                      <Checkbox checked={on} onCheckedChange={() => toggleNote(dn)} />
                      <span className="font-mono text-muted-foreground">{dn.delivery_number}</span>
                      <span className="text-muted-foreground">{dn.delivery_date}</span>
                      <span className="flex-1 truncate">{dn.title || "（件名なし）"}</span>
                      {dn.project_id && projectId && dn.project_id !== projectId && <Badge variant="outline" className="text-[9px] font-normal">別案件</Badge>}
                      <span className="tabular-nums">{yen(dn.total)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">明細（{form.line_items.length}行）</CardTitle>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={addItem} disabled={locked}><Plus className="w-3.5 h-3.5" /> 行を追加</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
                  <th className="text-left px-2 py-2 font-medium w-32">取引日</th>
                  <th className="text-left px-3 py-2 font-medium">摘要</th>
                  <th className="text-right px-2 py-2 font-medium w-20">数量</th>
                  <th className="text-left px-2 py-2 font-medium w-16">単位</th>
                  <th className="text-right px-2 py-2 font-medium w-28">単価</th>
                  <th className="text-right px-2 py-2 font-medium w-28">金額</th>
                  <th className="text-left px-2 py-2 font-medium w-20">税率</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {form.line_items.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-8">明細がありません。納品書をチェックするか「行を追加」してください</td></tr>
                )}
                {form.line_items.map((li) => (
                  <tr key={li.id} className="border-b">
                    <td className="px-2 py-1"><Input type="date" value={li.transaction_date || ""} onChange={(e) => setItem(li.id, { transaction_date: e.target.value })} className="h-8 text-xs" disabled={locked} /></td>
                    <td className="px-2 py-1">
                      <Input value={li.name} onChange={(e) => setItem(li.id, { name: e.target.value })} className="h-8 text-xs" disabled={locked} />
                      {li.delivery_number && <span className="text-[10px] text-muted-foreground">納品書 {li.delivery_number}</span>}
                    </td>
                    <td className="px-2 py-1"><Input type="number" value={li.quantity} onChange={(e) => setItem(li.id, { quantity: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} disabled={locked} /></td>
                    <td className="px-2 py-1"><Input value={li.unit || ""} onChange={(e) => setItem(li.id, { unit: e.target.value })} className="h-8 text-xs" disabled={locked} /></td>
                    <td className="px-2 py-1"><Input type="number" value={li.unit_price} onChange={(e) => setItem(li.id, { unit_price: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} disabled={locked} /></td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">{yen(li.amount)}</td>
                    <td className="px-2 py-1">
                      <select value={li.tax_rate ?? 10} onChange={(e) => setItem(li.id, { tax_rate: Number(e.target.value) })} className="h-8 rounded-md border bg-background px-1.5 text-xs" disabled={locked}>
                        {TAX_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1"><button onClick={() => removeItem(li.id)} className="text-muted-foreground hover:text-destructive" disabled={locked}><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">備考（PDFに載ります）</CardTitle></CardHeader>
        <CardContent><Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={3} disabled={locked} /></CardContent>
      </Card>

      <Dialog open={paidOpen} onOpenChange={setPaidOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>入金を記録</DialogTitle>
            <DialogDescription className="text-xs">銀行明細との自動照合は S4 で追加します。ここでは手動で記録します</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">入金日</Label>
              <Input type="date" value={paidForm.paid_at} onChange={(e) => setPaidForm({ ...paidForm, paid_at: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">入金額</Label>
              <Input type="number" value={paidForm.paid_amount} onChange={(e) => setPaidForm({ ...paidForm, paid_amount: e.target.value })} className={`h-9 text-right ${noSpinner}`} />
              {Number(paidForm.paid_amount) !== Number(form.total) && paidForm.paid_amount !== "" && (
                <p className="text-[10px] text-amber-700">請求金額 {yen(form.total)} と差があります（振込手数料などの場合はそのまま記録できます）</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaidOpen(false)}>キャンセル</Button>
            <Button onClick={() => { quick.mutate({ status: "paid", paid_at: paidForm.paid_at, paid_amount: Number(paidForm.paid_amount) || form.total }); setPaidOpen(false); }}>記録する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        <DocumentEmailDialog
          open={mailOpen}
          onOpenChange={setMailOpen}
          type="invoice"
          doc={form}
          onSent={() => queryClient.invalidateQueries({ queryKey: ["invoice", id] })}
        />
      )}
    </div>
  );
}
