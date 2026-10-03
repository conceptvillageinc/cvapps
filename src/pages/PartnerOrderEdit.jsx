import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { partnerOrderFilename } from "@/lib/docFilename";
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
import { ArrowLeft, Save, FileDown, FileOutput, Trash2, Loader2, CheckCircle2, Mail, Stamp, ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import DocumentEmailDialog from "@/components/documents/DocumentEmailDialog";
import ClientCombobox from "@/components/clients/ClientCombobox";
import { PERSON_IN_CHARGE_OPTIONS, EMAIL_TO_PERSON_MAP } from "@/lib/constants";
import { todayString } from "@/lib/fiscal";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { lineTaxRate, toTaxExclusiveUnitPrice } from "@/lib/estimateTotals";
import { formatPostalCode } from "@/lib/postalCode";
import {
  computeDocTotals, generateDocumentNumber, companyInfoFromSettings, PARTNER_ORDER_STATUS_MAP, DELIVERY_TO_KINDS, paymentTermsFromSettings,
  TAX_RATES, openBlob, openPreviewTab, showBlobInTab,
} from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const noSpinner = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
const uid = () => `po_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** 見積の明細行（テキスト行・小計行を除く）を、発注書の行にする。単価の初期値は原価（仕入単価） */
function orderItemsFromEstimate(estimate) {
  const inclusive = !!estimate?.tax_inclusive;
  return (estimate?.line_items || [])
    .filter((li) => li.row_type !== "text" && li.row_type !== "subtotal")
    .map((li) => {
      const rate = lineTaxRate(li);
      const qty = Number(li.quantity) || 1;
      const cost = li.cost_price != null && li.cost_price !== "" ? Number(li.cost_price) : null;
      const sell = inclusive ? toTaxExclusiveUnitPrice(li.unit_price, rate) : (Number(li.unit_price) || 0);
      return { id: uid(), source_line_id: li.id, name: li.name || "", quantity: qty, unit: li.unit || "式", unit_price: cost ?? "", amount: cost != null ? Math.round(cost * qty) : 0, tax_rate: rate, sell_price: sell, has_cost: cost != null };
    });
}

/**
 * 発注書（CV → 連携先）の作成・編集。
 *   /partner-orders/new?estimate=ID   見積の明細から作る
 *   /partner-orders/:id               編集
 */
export default function PartnerOrderEdit() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  const terms = useMemo(() => paymentTermsFromSettings(settings), [settings]);

  const [form, setForm] = useState(null);
  const [selected, setSelected] = useState(null); // 見積の行 id のうち含めるもの
  const [withStamp, setWithStamp] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [customTerm, setCustomTerm] = useState("");

  const { data: existing, isLoading } = useQuery({ queryKey: ["partnerOrder", id], queryFn: () => db.entities.PartnerOrder.get(id), enabled: !isNew });
  const estimateId = searchParams.get("estimate") || existing?.estimate_id || null;
  // 見積の画面と同じキー・同じ形（配列で持って先頭を使う）にそろえる。別の形で持つとキャッシュが混ざる
  const { data: estimate } = useQuery({ queryKey: ["estimate", estimateId], queryFn: () => db.entities.Estimate.filter({ id: estimateId }), select: (d) => (Array.isArray(d) ? d[0] : d), enabled: !!estimateId });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => db.entities.Client.list("-name") });
  const { data: vendors = [] } = useQuery({ queryKey: ["printVendors"], queryFn: () => db.entities.PrintVendor.list("name") });
  const { data: siblings = [] } = useQuery({
    queryKey: ["partnerOrders", "byEstimate", estimateId],
    queryFn: () => db.entities.PartnerOrder.filter({ estimate_id: estimateId }, "-order_date"),
    enabled: !!estimateId, retry: false,
  });
  const { data: emailLogs = [] } = useQuery({
    queryKey: ["emailLogs", "partner_order", id],
    queryFn: () => db.entities.EmailLog.filter({ document_type: "partner_order", document_id: id }, "-created_date"),
    enabled: !isNew,
  });

  // 連携先の候補: クライアント一覧 ＋ 印刷所情報（名前が同じなら 1 つに）
  const partners = useMemo(() => {
    const list = [];
    for (const c of clients) list.push({ id: c.id, name: c.name, name_kana: c.name_kana, contact_person: c.contact_person, email: c.email, cc_emails: c.cc_emails, postal_code: c.postal_code, address: c.address, source: "client" });
    for (const v of vendors) if (!list.some((x) => x.name === v.name)) list.push({ id: v.id, name: v.name, contact_person: v.contact_person, email: v.email, postal_code: "", address: "", source: "print_vendor" });
    return list;
  }, [clients, vendors]);
  const partner = useMemo(() => partners.find((p) => p.name === (form?.partner_name || "").trim()) || null, [partners, form?.partner_name]);

  const estimateItems = useMemo(() => orderItemsFromEstimate(estimate), [estimate]);
  const orderedElsewhere = useMemo(() => {
    const m = new Map();
    for (const o of siblings) { if (o.id === id) continue; for (const li of o.line_items || []) if (li.source_line_id) m.set(li.source_line_id, o.po_number); }
    return m;
  }, [siblings, id]);

  // 初期化
  useEffect(() => {
    if (form) return;
    if (!isNew) { if (existing) { setForm({ ...existing, line_items: existing.line_items || [] }); setSelected(null); } return; }
    if (estimateId && !estimate) return;
    const base = {
      estimate_id: estimate?.id || null, project_id: estimate?.project_id || null,
      partner_type: "client", partner_id: null, partner_name: "", partner_honorific: "御中", partner_postal_code: "", partner_address: "", partner_contact: "",
      title: estimate?.estimate_title || "", order_date: todayString(), due_date: estimate?.desired_delivery_date || "",
      delivery_to_kind: "cv", delivery_to: "", payment_terms: terms[0] || "", line_items: [], notes: "", status: "issued",
      person_in_charge: estimate?.person_in_charge || EMAIL_TO_PERSON_MAP[user?.email] || "",
    };
    setForm(base);
    setSelected(new Set(estimateItems.filter((li) => !orderedElsewhere.has(li.source_line_id)).map((li) => li.source_line_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, existing, estimate, estimateId, terms.length]);

  // 連携先を選んだら住所・担当者を入れる
  useEffect(() => {
    if (!form || !partner) return;
    if (form.partner_id === partner.id && form.partner_type === partner.source) return;
    setForm((f) => ({ ...f, partner_type: partner.source, partner_id: partner.id, partner_postal_code: partner.postal_code || "", partner_address: partner.address || "", partner_contact: partner.contact_person || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner?.id]);

  // 納品先の初期文: CV は会社情報の最初の拠点、クライアント直送は見積のクライアントの住所
  const deliveryPreset = (kind) => {
    if (kind === "cv") { const loc = (company.locations || [])[0]; return loc ? `${company.name}　〒${formatPostalCode(loc.postal)} ${loc.address || ""}` : company.name; }
    if (kind === "client") { const c = clients.find((x) => x.name === estimate?.client_name); return c ? `${c.name}　〒${formatPostalCode(c.postal_code || "")} ${c.address || ""}` : (estimate?.client_name || ""); }
    return "";
  };
  useEffect(() => {
    if (!form || !isNew || form.delivery_to) return;
    const text = deliveryPreset(form.delivery_to_kind);
    if (text) setForm((f) => ({ ...f, delivery_to: text }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.delivery_to_kind, company.locations?.length, clients.length, estimate?.client_name]);

  // 編集中の明細（見積から選んだ行 ＋ 手で足した行）
  const items = form?.line_items || [];
  // 見積から選び直したとき、選んだ行を明細にそろえる（既存の編集内容は残す）
  useEffect(() => {
    if (!form || !selected || !estimate) return;
    setForm((f) => {
      const byId = new Map((f.line_items || []).map((li) => [li.source_line_id || li.id, li]));
      const picked = estimateItems.filter((li) => selected.has(li.source_line_id)).map((li) => byId.get(li.source_line_id) || li);
      const manual = (f.line_items || []).filter((li) => !li.source_line_id);
      return { ...f, line_items: [...picked, ...manual] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, estimateItems.length]);
  const totals = useMemo(() => computeDocTotals(items), [items]);

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
  const addItem = () => set("line_items", [...items, { id: uid(), name: "", quantity: 1, unit: "式", unit_price: "", amount: 0, tax_rate: 10 }]);
  const removeItem = (li) => { if (li.source_line_id && selected) setSelected((s) => { const n = new Set(s); n.delete(li.source_line_id); return n; }); else set("line_items", items.filter((x) => x.id !== li.id)); };
  const toggle = (sourceId) => setSelected((s) => { const n = new Set(s || items.map((li) => li.source_line_id).filter(Boolean)); if (n.has(sourceId)) n.delete(sourceId); else n.add(sourceId); return n; });

  const save = useMutation({
    mutationFn: async () => {
      if (!partner && !(form.partner_name || "").trim()) throw new Error("連携先を選んでください");
      const rows = items.filter((li) => li.name || Number(li.amount));
      if (rows.length === 0) throw new Error("発注する明細を 1 行以上入れてください");
      const payload = {
        ...form, partner_name: (form.partner_name || "").trim(),
        line_items: rows.map(({ sell_price, has_cost, ...li }) => ({ ...li, unit_price: Number(li.unit_price) || 0, amount: Math.round((Number(li.quantity) || 0) * (Number(li.unit_price) || 0)) })),
        created_by: form.created_by || user?.id || null,
      };
      Object.assign(payload, computeDocTotals(payload.line_items));
      if (isNew) { payload.po_number = await generateDocumentNumber("partner_order", form.order_date); return db.entities.PartnerOrder.create(payload); }
      return db.entities.PartnerOrder.update(id, payload);
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["partnerOrders"] });
      queryClient.invalidateQueries({ queryKey: ["partnerOrder", row.id] });
      toast.success(isNew ? `発注書 ${row.po_number} を発行しました` : "保存しました");
      setForm((f) => ({ ...f, ...row, line_items: row.line_items || f.line_items || [] }));
      if (isNew) navigate(`/partner-orders/${row.id}`, { replace: true });
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });
  const remove = useMutation({
    mutationFn: () => db.entities.PartnerOrder.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["partnerOrders"] }); toast.success("発注書を削除しました"); navigate("/partner-orders"); },
    onError: (err) => toast.error("削除できませんでした: " + (err?.message || "不明なエラー")),
  });
  const addTerm = useMutation({
    mutationFn: async (text) => {
      const next = [...new Set([...terms, text])];
      const row = settings.find((s) => s.setting_key === "po_payment_terms");
      const data = { setting_key: "po_payment_terms", setting_value: JSON.stringify(next), description: "発注書の支払条件の定型文" };
      if (row) await db.entities.SystemSettings.update(row.id, data); else await db.entities.SystemSettings.create(data);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["settings"] }); toast.success("支払条件の定型文に追加しました"); setCustomTerm(""); },
    onError: (e) => toast.error("追加できませんでした: " + e.message),
  });

  const downloadPdf = async () => {
    setPdfLoading(true);
    try { openBlob(await db.documents.pdf("partner_order", id, { stamp: withStamp }), partnerOrderFilename(form)); }
    catch (err) { toast.error(err.message); } finally { setPdfLoading(false); }
  };
  const previewPdf = async () => {
    const tab = openPreviewTab(); setPdfLoading(true);
    try { showBlobInTab(tab, await db.documents.pdf("partner_order", id, { stamp: withStamp }), partnerOrderFilename(form)); }
    catch (err) { if (tab && !tab.closed) tab.close(); toast.error(err.message); } finally { setPdfLoading(false); }
  };

  if (!form || (!isNew && isLoading)) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (isNew && !estimate) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-2">
        <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="font-medium">発注書は見積から作ります</p>
        <p className="text-sm text-muted-foreground">見積の画面を開き、「連携先へ発注書を作る」を押してください。</p>
      </div>
    );
  }

  const st = PARTNER_ORDER_STATUS_MAP[form.status] || PARTNER_ORDER_STATUS_MAP.issued;
  const canSave = (form.partner_name || "").trim() && form.order_date && items.length > 0 && !save.isPending;
  const missingPrice = items.filter((li) => li.unit_price === "" || li.unit_price === null || li.unit_price === undefined).length;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(estimateId ? `/estimates/${estimateId}` : "/partner-orders")}><ArrowLeft className="w-4 h-4" /></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight">{isNew ? "連携先へ発注書を作る" : `発注書 ${form.po_number}`}</h1>
              {!isNew && <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {estimate && <Link to={`/estimates/${estimate.id}`} className="text-primary hover:underline">見積 {estimate.estimate_number} {estimate.estimate_title || ""}（{estimate.client_name}）</Link>}
              {form.project_id && <Link to={`/projects/${form.project_id}`} className="text-primary hover:underline">案件を開く</Link>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {!isNew && (
            <>
              <label className="flex items-center gap-1 text-[11px] cursor-pointer mr-1"><input type="checkbox" checked={withStamp} onChange={(e) => setWithStamp(e.target.checked)} /> <Stamp className="w-3.5 h-3.5" /> 社印を押す</label>
              <Button size="sm" className="gap-1.5 text-xs" onClick={previewPdf} disabled={pdfLoading}>{pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileOutput className="w-3.5 h-3.5" />} 印刷用に新しいタブで開く</Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadPdf} disabled={pdfLoading}><FileDown className="w-3.5 h-3.5" /> PDF保存</Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setMailOpen(true)}><Mail className="w-3.5 h-3.5" /> 連携先へメール送付</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /> 削除</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>発注書を削除しますか？</AlertDialogTitle><AlertDialogDescription>この操作は取り消せません。番号 {form.po_number} は欠番になります。</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground">削除</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => save.mutate()} disabled={!canSave}>{save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {isNew ? "発行" : "保存"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">連携先・件名</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">連携先 <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal">クライアント一覧と印刷所情報から検索</span></Label>
              <div className="flex gap-2">
                <ClientCombobox value={form.partner_name} onChange={(v) => set("partner_name", v)} clients={partners} inputClassName="h-9" className="flex-1" placeholder="連携先の名前で検索（一部でも可）" listLabel="クライアント一覧・印刷所情報" matchedText={(p) => `${p.source === "print_vendor" ? "印刷所情報" : "クライアント一覧"}の「${p.name}」に紐づきます${p.email ? `（${p.email}）` : "（メールアドレス未登録）"}`} />
                <Select value={form.partner_honorific} onValueChange={(v) => set("partner_honorific", v)}>
                  <SelectTrigger className="h-9 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="御中" className="text-xs">御中</SelectItem><SelectItem value="様" className="text-xs">様</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">郵便番号</Label><Input value={form.partner_postal_code || ""} onChange={(e) => set("partner_postal_code", e.target.value)} className="h-9 font-mono" /></div>
            <div className="space-y-1.5"><Label className="text-xs">住所</Label><Input value={form.partner_address || ""} onChange={(e) => set("partner_address", e.target.value)} className="h-9" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">件名</Label><Input value={form.title || ""} onChange={(e) => set("title", e.target.value)} className="h-9" aria-label="件名" /></div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">納品先</Label>
              <div className="flex flex-wrap gap-2 mb-1">
                {DELIVERY_TO_KINDS.map((k) => (
                  <button key={k.key} type="button" onClick={() => setForm((f) => ({ ...f, delivery_to_kind: k.key, delivery_to: k.key === "other" ? "" : deliveryPreset(k.key) }))} className={`h-7 px-2.5 rounded-full border text-[11px] ${form.delivery_to_kind === k.key ? "bg-slate-800 text-white border-slate-800" : "bg-background hover:bg-muted"}`}>{k.label}</button>
                ))}
              </div>
              <Textarea value={form.delivery_to || ""} onChange={(e) => set("delivery_to", e.target.value)} rows={2} placeholder={form.delivery_to_kind === "other" ? "納品先の名前・住所を入力" : ""} className="text-sm" aria-label="納品先" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">発注情報</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5"><Label className="text-xs">発注日 <span className="text-destructive">*</span></Label><Input type="date" value={form.order_date || ""} onChange={(e) => set("order_date", e.target.value)} className="h-9" />{isNew && <p className="text-[10px] text-muted-foreground">番号は発注日の年月で採番（PO-YYMM-連番）</p>}</div>
            <div className="space-y-1.5"><Label className="text-xs">納期</Label><Input type="date" value={form.due_date || ""} onChange={(e) => set("due_date", e.target.value)} className="h-9" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs">支払条件</Label>
              <select value={terms.includes(form.payment_terms) ? form.payment_terms : "__custom"} onChange={(e) => { if (e.target.value !== "__custom") set("payment_terms", e.target.value); else set("payment_terms", customTerm); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label="支払条件">
                {terms.map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="__custom">（自由に入力）</option>
              </select>
              {!terms.includes(form.payment_terms) && (
                <div className="flex gap-1.5">
                  <Input value={form.payment_terms || ""} onChange={(e) => { set("payment_terms", e.target.value); setCustomTerm(e.target.value); }} placeholder="例: 検収後 30 日以内" className="h-8 text-xs" />
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs shrink-0" disabled={!(form.payment_terms || "").trim() || addTerm.isPending} onClick={() => addTerm.mutate(form.payment_terms.trim())}>定型文に追加</Button>
                </div>
              )}
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
                  <SelectContent>{Object.entries(PARTNER_ORDER_STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground"><span>税抜</span><span className="tabular-nums">{yen(totals.subtotal)}</span></div>
              {totals.tax_breakdown.map((b) => <div key={b.rate} className="flex justify-between text-xs text-muted-foreground"><span>消費税（{b.rate}%）</span><span className="tabular-nums">{yen(b.tax)}</span></div>)}
              <div className="flex justify-between font-bold border-t pt-1"><span>発注金額（税込）</span><span className="tabular-nums" data-testid="po-total">{yen(totals.total)}</span></div>
              {missingPrice > 0 && <p className="text-[10px] text-amber-700 pt-1">単価が空の行が {missingPrice} 行あります（見積に原価が無い行）。発注金額を入れてください</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm">発注する明細（{items.length}行）<span className="ml-2 text-xs font-normal text-muted-foreground">単価の初期値は見積の原価（仕入単価）。連携先に合わせて書き換えてください</span></CardTitle>
            <div className="flex items-center gap-2">
              {estimate && estimateItems.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={estimateItems.every((li) => (selected || new Set(items.map((x) => x.source_line_id))).has(li.source_line_id))} onChange={(e) => setSelected(new Set(e.target.checked ? estimateItems.map((li) => li.source_line_id) : []))} aria-label="見積の全行" /> 見積の全行
                </label>
              )}
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={addItem}><Plus className="w-3.5 h-3.5" /> 行を追加</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
                  <th className="w-10 px-3 py-2"></th>
                  <th className="text-left px-3 py-2 font-medium">名称</th>
                  <th className="text-right px-2 py-2 font-medium w-20">数量</th>
                  <th className="text-left px-2 py-2 font-medium w-16">単位</th>
                  <th className="text-right px-2 py-2 font-medium w-28">単価（税抜）</th>
                  <th className="text-right px-2 py-2 font-medium w-28">金額</th>
                  <th className="text-left px-2 py-2 font-medium w-20">税率</th>
                  <th className="text-right px-2 py-2 font-medium w-28 text-white/70">見積の出し値</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {/* 見積の行（チェックで含める／外す） */}
                {estimate && estimateItems.map((src) => {
                  const li = items.find((x) => x.source_line_id === src.source_line_id);
                  const on = !!li;
                  const other = orderedElsewhere.get(src.source_line_id);
                  return (
                    <tr key={src.source_line_id} className={`border-b ${on ? "" : "opacity-50 bg-muted/20"}`}>
                      <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={on} onChange={() => toggle(src.source_line_id)} aria-label={`${src.name} を含める`} /></td>
                      <td className="px-2 py-1">{on ? <Input value={li.name} onChange={(e) => setItem(li.id, { name: e.target.value })} className="h-8 text-xs" /> : <span className="text-xs px-1">{src.name}</span>}{other && <span className="ml-2 text-[10px] text-amber-700">（{other} で発注済み）</span>}</td>
                      <td className="px-2 py-1">{on ? <Input type="number" value={li.quantity} onChange={(e) => setItem(li.id, { quantity: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} aria-label="数量" /> : <span className="text-xs block text-right">{src.quantity}</span>}</td>
                      <td className="px-2 py-1">{on ? <Input value={li.unit || ""} onChange={(e) => setItem(li.id, { unit: e.target.value })} className="h-8 text-xs" /> : <span className="text-xs">{src.unit}</span>}</td>
                      <td className="px-2 py-1">{on ? <Input type="number" value={li.unit_price} onChange={(e) => setItem(li.id, { unit_price: e.target.value })} placeholder="発注単価" className={`h-8 text-xs text-right ${noSpinner} ${li.unit_price === "" ? "border-amber-400" : ""}`} aria-label={`${src.name} の単価`} /> : ""}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{on ? yen(li.amount) : ""}</td>
                      <td className="px-2 py-1">{on ? (
                        <select value={li.tax_rate ?? 10} onChange={(e) => setItem(li.id, { tax_rate: Number(e.target.value) })} className="h-8 rounded-md border bg-background px-1.5 text-xs">{TAX_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select>
                      ) : null}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-xs text-muted-foreground" title="クライアントへの見積単価（発注書には出ません）">{yen(src.sell_price)}</td>
                      <td></td>
                    </tr>
                  );
                })}
                {/* 手で足した行 */}
                {items.filter((li) => !li.source_line_id).map((li) => (
                  <tr key={li.id} className="border-b">
                    <td className="px-3 py-1.5 text-center text-[10px] text-muted-foreground">追加</td>
                    <td className="px-2 py-1"><Input value={li.name} onChange={(e) => setItem(li.id, { name: e.target.value })} className="h-8 text-xs" placeholder="名称" /></td>
                    <td className="px-2 py-1"><Input type="number" value={li.quantity} onChange={(e) => setItem(li.id, { quantity: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} /></td>
                    <td className="px-2 py-1"><Input value={li.unit || ""} onChange={(e) => setItem(li.id, { unit: e.target.value })} className="h-8 text-xs" /></td>
                    <td className="px-2 py-1"><Input type="number" value={li.unit_price} onChange={(e) => setItem(li.id, { unit_price: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} /></td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">{yen(li.amount)}</td>
                    <td className="px-2 py-1"><select value={li.tax_rate ?? 10} onChange={(e) => setItem(li.id, { tax_rate: Number(e.target.value) })} className="h-8 rounded-md border bg-background px-1.5 text-xs">{TAX_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
                    <td></td>
                    <td className="px-1 py-1"><button onClick={() => removeItem(li)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
                {items.length === 0 && !estimate && <tr><td colSpan={9} className="text-center text-xs text-muted-foreground py-8">明細がありません</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">備考（PDF に載ります）</CardTitle></CardHeader>
        <CardContent><Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="例: 入稿データは PDF で送ります。色校正 1 回を含みます" /></CardContent>
      </Card>

      {!isNew && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> 変更は「保存」を押すまで確定しません。PDF は保存済みの内容で作られます。右端の「見積の出し値」は社内確認用で、発注書には載りません</p>}
      {siblings.filter((o) => o.id !== id).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">同じ見積から出した他の発注書</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {siblings.filter((o) => o.id !== id).map((o) => (
              <Link key={o.id} to={`/partner-orders/${o.id}`} className="flex items-center gap-3 p-2 rounded-md bg-muted/30 text-xs hover:bg-muted/60">
                <span className="font-mono">{o.po_number}</span><span className="text-muted-foreground">{o.order_date}</span><span className="truncate flex-1">{o.partner_name}</span><span className="tabular-nums font-medium">{yen(o.total)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      {!isNew && emailLogs.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">送付履歴</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {emailLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30 text-xs">
                <Badge variant={log.status === "failed" ? "destructive" : "secondary"} className="text-[9px]">{log.status === "sent" ? "送信済" : "送信失敗"}</Badge>
                <span className="font-medium">{log.recipient_company}</span><span className="text-muted-foreground">{log.recipient_email}</span><span className="text-muted-foreground truncate">{log.subject}</span>
                {log.sent_at && <span className="text-muted-foreground ml-auto whitespace-nowrap">{new Date(log.sent_at).toLocaleString("ja-JP")}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {!isNew && (
        <DocumentEmailDialog open={mailOpen} onOpenChange={setMailOpen} type="partner_order" doc={form} recipient={partner ? { name: partner.name, email: partner.email, cc_emails: partner.cc_emails } : { name: form.partner_name, email: "" }} onSent={() => queryClient.invalidateQueries({ queryKey: ["partnerOrder", id] })} />
      )}
    </div>
  );
}
