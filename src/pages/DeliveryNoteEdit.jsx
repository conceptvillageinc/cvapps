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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Save, FileDown, Plus, Trash2, Loader2, CheckCircle2, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";
import { PERSON_IN_CHARGE_OPTIONS, EMAIL_TO_PERSON_MAP } from "@/lib/constants";
import { todayString } from "@/lib/fiscal";
import { formatPostalCode } from "@/lib/postalCode";
import { useSystemSettings } from "@/lib/useSystemSettings";
import {
  newDocItem, docItemsFromEstimate, computeDocTotals, generateDocumentNumber,
  companyInfoFromSettings, DELIVERY_STATUS_MAP, TAX_RATES, openBlob,
} from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const noSpinner = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

function emptyForm(user) {
  return {
    project_id: null,
    estimate_id: null,
    client_id: null,
    client_name: "",
    client_honorific: "御中",
    client_postal_code: "",
    client_address: "",
    title: "",
    delivery_date: todayString(),
    line_items: [],
    notes: "",
    status: "draft",
    person_in_charge: EMAIL_TO_PERSON_MAP[user?.email] || "",
  };
}

/**
 * 納品書の作成・編集・表示。
 *   /delivery-notes/new?estimate=ID   見積の明細から作る
 *   /delivery-notes/new?project=ID    案件から作る（明細は手入力 or 見積を選んで取込）
 *   /delivery-notes/:id               編集
 */
export default function DeliveryNoteEdit() {
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

  const { data: existing, isLoading } = useQuery({
    queryKey: ["deliveryNote", id],
    queryFn: () => db.entities.DeliveryNote.get(id),
    enabled: !isNew,
  });

  const sourceEstimateId = searchParams.get("estimate");
  const sourceProjectId = searchParams.get("project");
  const { data: sourceEstimate } = useQuery({
    queryKey: ["estimate", sourceEstimateId],
    queryFn: () => db.entities.Estimate.get(sourceEstimateId),
    enabled: isNew && !!sourceEstimateId,
  });
  const projectId = form?.project_id || sourceProjectId || sourceEstimate?.project_id || null;
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => db.entities.Project.get(projectId),
    enabled: !!projectId,
  });
  const { data: projectEstimates = [] } = useQuery({
    queryKey: ["estimates", "byProject", projectId],
    queryFn: () => db.entities.Estimate.filter({ project_id: projectId }, "-created_date"),
    enabled: !!projectId,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });

  // 初期化
  useEffect(() => {
    if (form) return;
    if (!isNew) {
      if (existing) setForm({ ...emptyForm(user), ...existing, line_items: existing.line_items || [] });
      return;
    }
    if (sourceEstimateId && !sourceEstimate) return;
    if (sourceProjectId && !project) return;
    const base = emptyForm(user);
    if (sourceEstimate) {
      Object.assign(base, {
        estimate_id: sourceEstimate.id,
        project_id: sourceEstimate.project_id || null,
        client_name: sourceEstimate.client_name || "",
        client_honorific: sourceEstimate.client_honorific || "御中",
        title: sourceEstimate.estimate_title || "",
        delivery_date: sourceEstimate.desired_delivery_date || todayString(),
        line_items: docItemsFromEstimate(sourceEstimate),
        person_in_charge: sourceEstimate.person_in_charge || base.person_in_charge,
      });
    } else if (project) {
      Object.assign(base, { project_id: project.id, client_name: project.client_name || "", title: project.name || "" });
    }
    base.notes = company.delivery_notes || "";
    setForm(base);
     
  }, [isNew, existing, sourceEstimate, project, sourceEstimateId, sourceProjectId, company.delivery_notes]);

  // クライアントマスタから住所・郵便番号を補う
  useEffect(() => {
    if (!form || !form.client_name || form.client_address) return;
    const c = clients.find((x) => x.name === form.client_name);
    if (c) setForm((f) => ({ ...f, client_id: c.id, client_postal_code: c.postal_code || "", client_address: c.address || "" }));
     
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
  const addItem = () => set("line_items", [...form.line_items, newDocItem()]);
  const removeItem = (itemId) => set("line_items", form.line_items.filter((li) => li.id !== itemId));
  const importFromEstimate = (est) => {
    const items = docItemsFromEstimate(est);
    if (items.length === 0) { toast.info("その見積には明細がありません"); return; }
    setForm((f) => ({ ...f, estimate_id: est.id, title: f.title || est.estimate_title || "", line_items: [...f.line_items, ...items] }));
    toast.success(`${est.estimate_number} の明細を${items.length}行取り込みました`);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        client_name: (form.client_name || "").trim(),
        line_items: form.line_items.filter((li) => li.name || li.amount),
        ...totals,
        created_by: form.created_by || user?.id || null,
      };
      if (isNew) {
        payload.delivery_number = await generateDocumentNumber("delivery", form.delivery_date);
        return db.entities.DeliveryNote.create(payload);
      }
      return db.entities.DeliveryNote.update(id, payload);
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] });
      queryClient.invalidateQueries({ queryKey: ["deliveryNote", row.id] });
      toast.success(isNew ? `納品書 ${row.delivery_number} を作成しました` : "保存しました");
      setForm((f) => ({ ...f, ...row, line_items: row.line_items || f.line_items || [] }));
      if (isNew) navigate(`/delivery-notes/${row.id}`, { replace: true });
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const remove = useMutation({
    mutationFn: () => db.entities.DeliveryNote.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] }); toast.success("納品書を削除しました"); navigate("/delivery-notes"); },
    onError: (err) => toast.error("削除できませんでした: " + (err?.message || "不明なエラー")),
  });

  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await db.documents.pdf("delivery", id);
      openBlob(blob, `納品書_${form.delivery_number}_${form.client_name}.pdf`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  if (!form || (!isNew && isLoading)) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const st = DELIVERY_STATUS_MAP[form.status] || DELIVERY_STATUS_MAP.draft;
  const canSave = (form.client_name || "").trim() && form.delivery_date && !save.isPending;
  const locked = !!form.invoice_id;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/delivery-notes")}><ArrowLeft className="w-4 h-4" /></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight">{isNew ? "納品書を作成" : `納品書 ${form.delivery_number}`}</h1>
              {!isNew && <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>}
              {locked && <Badge className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100">請求済</Badge>}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {project && <Link to={`/projects/${project.id}`} className="text-primary hover:underline">案件 {project.project_number} {project.name}</Link>}
              {form.estimate_id && <Link to={`/estimates/${form.estimate_id}`} className="text-primary hover:underline">見積を開く</Link>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isNew && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadPdf} disabled={pdfLoading}>
                {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF
              </Button>
              {form.invoice_id ? (
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate(`/invoices/${form.invoice_id}`)}>
                  <Receipt className="w-3.5 h-3.5" /> 請求書を開く
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => navigate(`/invoices/new?delivery=${id}`)}>
                  <Receipt className="w-3.5 h-3.5" /> 請求書を作成
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive" disabled={locked}><Trash2 className="w-3.5 h-3.5" /> 削除</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>納品書を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>この操作は取り消せません。</AlertDialogDescription>
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

      {locked && (
        <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-md p-2.5">
          この納品書は請求書にまとめ済みです。金額を直す場合は、請求書側で該当の納品書を外してから編集してください。
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">宛先・件名</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">クライアント <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Input list="dn-clients" value={form.client_name} onChange={(e) => set("client_name", e.target.value)} className="h-9" disabled={locked} />
                <datalist id="dn-clients">{clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
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
              <Input value={form.client_postal_code || ""} onChange={(e) => set("client_postal_code", e.target.value)} placeholder="9630117" className="h-9 font-mono" disabled={locked} />
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
          <CardHeader className="pb-3"><CardTitle className="text-sm">納品情報</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">納品日 <span className="text-destructive">*</span></Label>
              <Input type="date" value={form.delivery_date || ""} onChange={(e) => set("delivery_date", e.target.value)} className="h-9" disabled={locked} />
              {isNew && <p className="text-[10px] text-muted-foreground">番号は納品日の年月で採番されます（D-YYMM-連番）</p>}
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
                  <SelectContent>{Object.entries(DELIVERY_STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground"><span>小計</span><span className="tabular-nums">{yen(totals.subtotal)}</span></div>
              {totals.tax_breakdown.map((b) => (
                <div key={b.rate} className="flex justify-between text-xs text-muted-foreground"><span>消費税（{b.rate}%）</span><span className="tabular-nums">{yen(b.tax)}</span></div>
              ))}
              <div className="flex justify-between font-bold border-t pt-1"><span>合計</span><span className="tabular-nums">{yen(totals.total)}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm">明細（{form.line_items.length}行）</CardTitle>
            <div className="flex items-center gap-2">
              {projectEstimates.length > 0 && !locked && (
                <Select onValueChange={(v) => { const est = projectEstimates.find((e) => e.id === v); if (est) importFromEstimate(est); }}>
                  <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="見積から明細を取り込む" /></SelectTrigger>
                  <SelectContent>
                    {projectEstimates.map((e) => <SelectItem key={e.id} value={e.id} className="text-xs">{e.estimate_number} {e.estimate_title || ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={addItem} disabled={locked}><Plus className="w-3.5 h-3.5" /> 行を追加</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
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
                  <tr><td colSpan={7} className="text-center text-xs text-muted-foreground py-8">明細がありません。「行を追加」または見積から取り込んでください</td></tr>
                )}
                {form.line_items.map((li) => (
                  <tr key={li.id} className="border-b">
                    <td className="px-2 py-1"><Input value={li.name} onChange={(e) => setItem(li.id, { name: e.target.value })} className="h-8 text-xs" disabled={locked} /></td>
                    <td className="px-2 py-1"><Input type="number" value={li.quantity} onChange={(e) => setItem(li.id, { quantity: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} disabled={locked} /></td>
                    <td className="px-2 py-1"><Input value={li.unit || ""} onChange={(e) => setItem(li.id, { unit: e.target.value })} className="h-8 text-xs" disabled={locked} /></td>
                    <td className="px-2 py-1"><Input type="number" value={li.unit_price} onChange={(e) => setItem(li.id, { unit_price: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} disabled={locked} /></td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">{yen(li.amount)}</td>
                    <td className="px-2 py-1">
                      <select value={li.tax_rate ?? 10} onChange={(e) => setItem(li.id, { tax_rate: Number(e.target.value) })} className="h-8 rounded-md border bg-background px-1.5 text-xs" disabled={locked}>
                        {TAX_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <button onClick={() => removeItem(li.id)} className="text-muted-foreground hover:text-destructive" disabled={locked}><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">備考（PDFに載ります）</CardTitle></CardHeader>
        <CardContent>
          <Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </CardContent>
      </Card>

      {!isNew && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> 変更は「保存」を押すまで確定しません。PDFは保存済みの内容で作られます</p>
      )}
      {isNew && form.line_items.length === 0 && sourceEstimateId && (
        <p className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> 見積に明細が無いため空で作成します</p>
      )}
    </div>
  );
}
