import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, UserSquare, ExternalLink, Save, FolderKanban, FileText, Truck, Receipt, Globe } from "lucide-react";
import { toast } from "sonner";
import { INVOICE_DELIVERY_METHODS, STATUS_MAP, PROJECT_STATUS_MAP, getDealProbabilityColor } from "@/lib/constants";
import { DELIVERY_STATUS_MAP, INVOICE_STATUS_MAP } from "@/lib/documents";
import { formatPostalCode } from "@/lib/postalCode";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, todayString } from "@/lib/fiscal";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

function Field({ label, children }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="text-sm break-words">{children || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

/**
 * クライアントカルテ: 1社の案件・見積・納品・請求・入金・入稿先を1画面に集約する。
 */
export default function ClientKarte() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fiscalYearStartMonth } = useSystemSettings();
  const [notes, setNotes] = useState(null);

  const { data: client, isLoading } = useQuery({ queryKey: ["client", id], queryFn: () => db.entities.Client.get(id), enabled: !!id });
  const name = client?.name;
  const { data: projects = [] } = useQuery({ queryKey: ["projects", "byClient", name], queryFn: () => db.entities.Project.filter({ client_name: name }, "-registered_at"), enabled: !!name });
  const { data: estimates = [] } = useQuery({ queryKey: ["estimates", "byClient", name], queryFn: () => db.entities.Estimate.filter({ client_name: name }, "-created_date"), enabled: !!name });
  const { data: deliveryNotes = [] } = useQuery({ queryKey: ["deliveryNotes", "byClient", name], queryFn: () => db.entities.DeliveryNote.filter({ client_name: name }, "-delivery_date"), enabled: !!name });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices", "byClient", name], queryFn: () => db.entities.Invoice.filter({ client_name: name }, "-invoice_date"), enabled: !!name });
  const { data: masters = [] } = useQuery({ queryKey: ["priceMaster"], queryFn: () => db.entities.PriceMaster.list("-last_updated") });

  const saveNotes = useMutation({
    mutationFn: () => db.entities.Client.update(id, { notes }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["client", id] }); queryClient.invalidateQueries({ queryKey: ["clients"] }); toast.success("メモを保存しました"); setNotes(null); },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const stats = useMemo(() => {
    const fy = fiscalYearOf(todayString(), fiscalYearStartMonth);
    const { from, to } = fiscalYearRange(fy, fiscalYearStartMonth);
    const valid = invoices.filter((i) => i.status !== "cancelled");
    const total = valid.reduce((s, i) => s + Number(i.subtotal || 0), 0);
    const thisFy = valid.filter((i) => i.invoice_date >= from && i.invoice_date <= to).reduce((s, i) => s + Number(i.subtotal || 0), 0);
    const unpaid = valid.filter((i) => i.status === "sent" || i.status === "draft");
    const last = [...valid].sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || ""))[0];
    const gross = projects.reduce((s, p) => s + Number(p.confirmed_revenue > 0 ? p.actual_gross_profit : p.expected_gross_profit) || 0, 0);
    const grossBase = projects.reduce((s, p) => s + Number(p.confirmed_revenue > 0 ? p.confirmed_revenue : p.expected_revenue) || 0, 0);
    return { fy, total, thisFy, gross, grossRate: grossBase > 0 ? Math.round((gross / grossBase) * 100) : null, unpaidCount: unpaid.length, unpaidTotal: unpaid.reduce((s, i) => s + Number(i.total || 0), 0), openProjects: projects.filter((p) => p.status === "open").length, lastDate: last?.invoice_date || null };
  }, [invoices, projects, fiscalYearStartMonth]);

  // 入稿先（一次情報）: 見積明細の価格マスタ・仕入先見積・複製元
  const sources = useMemo(() => {
    const masterById = Object.fromEntries(masters.map((m) => [m.id, m]));
    const map = new Map();
    for (const e of estimates) {
      for (const li of e.line_items || []) {
        if (li.row_type === "text" || li.row_type === "subtotal" || li.source_type === "rule") continue;
        let key, entry;
        if (li.source_type === "price_master") {
          const m = masterById[li.source_ref];
          const url = li.source_url || m?.source_url || null;
          key = `pm:${m?.vendor_name || ""}:${url || li.source_ref}`;
          entry = { kind: "ネット印刷", vendor: m?.vendor_name || "価格マスタ", url, spec: m ? `${m.category} ${m.spec_summary || ""}` : "" };
        } else if (li.source_type === "vendor_quote") {
          key = `vq:${li.source_ref || ""}`;
          entry = { kind: "仕入先見積", vendor: li.source_ref || "（仕入先）", url: null, spec: "" };
        } else continue;
        const cur = map.get(key) || { ...entry, items: [] };
        cur.items.push({ estimate: e, name: li.name, quantity: li.quantity, unit: li.unit, cost_price: li.cost_price, unit_price: li.unit_price, copied_from: li.copied_from });
        map.set(key, cur);
      }
    }
    return [...map.values()];
  }, [estimates, masters]);

  if (isLoading || !client) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/clients")} className="shrink-0"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2"><UserSquare className="w-5 h-5 text-muted-foreground" /> {client.name}</h1>
          <p className="text-xs text-muted-foreground">{client.name_kana || ""}　{client.contact_person && `担当: ${client.contact_person}`}</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate(`/estimates/new`)}>新規見積</Button>
      </div>

      {/* 要約 */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          ["累計売上（税抜）", yen(stats.total)],
          [`${fiscalYearLabel(stats.fy, fiscalYearStartMonth).split("（")[0]}売上`, yen(stats.thisFy)],
          ["粗利（案件の合計）", `${yen(stats.gross)}${stats.grossRate != null ? ` / ${stats.grossRate}%` : ""}`],
          ["未入金", stats.unpaidCount ? `${stats.unpaidCount}件 ${yen(stats.unpaidTotal)}` : "なし"],
          ["進行中の案件", `${stats.openProjects}件`],
          ["最終請求日", stats.lastDate || "—"],
        ].map(([label, value]) => (
          <Card key={label}><CardContent className="pt-4 pb-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-lg font-bold tabular-nums">{value}</p></CardContent></Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">基本情報</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="メール">{client.email}</Field>
            <Field label="電話">{client.phone}</Field>
            <Field label="住所">{client.postal_code ? `〒${formatPostalCode(client.postal_code)} ` : ""}{client.address}</Field>
            <Field label="請求書の送付">
              {INVOICE_DELIVERY_METHODS[client.invoice_delivery_method] || "—"}
              {client.has_recurring_billing && <Badge className="ml-2 text-[9px] bg-teal-100 text-teal-700 hover:bg-teal-100">定期売上あり</Badge>}
              {client.invoice_delivery_notes && <p className="text-xs text-amber-700 mt-0.5">{client.invoice_delivery_notes}</p>}
            </Field>
            <Field label="振込名義（入金確認で学習）">{(client.bank_payee_names || []).join(" / ")}</Field>
            <p className="text-[10px] text-muted-foreground">項目の編集は <Link to="/clients" className="text-primary hover:underline">クライアント一覧</Link> で</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">メモ（カルテ）</CardTitle>
              {notes !== null && <Button size="sm" className="h-7 text-xs gap-1" onClick={() => saveNotes.mutate()} disabled={saveNotes.isPending}><Save className="w-3 h-3" /> 保存</Button>}
            </div>
          </CardHeader>
          <CardContent>
            <Textarea value={notes ?? client.notes ?? ""} onChange={(e) => setNotes(e.target.value)} rows={6} placeholder="担当者の好み、納品のルール、過去のトラブル、支払サイトなど" />
          </CardContent>
        </Card>
      </div>

      {/* 案件 */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FolderKanban className="w-4 h-4" /> 案件（{projects.length}件）</CardTitle></CardHeader>
        <CardContent>
          {projects.length === 0 ? <p className="text-xs text-muted-foreground">案件がありません</p> : (
            <div className="divide-y">
              {projects.slice(0, 30).map((p) => {
                const st = PROJECT_STATUS_MAP[p.status] || PROJECT_STATUS_MAP.open;
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-3 py-2 text-xs hover:bg-muted/40 -mx-2 px-2 rounded">
                    <span className="font-mono text-muted-foreground w-24 shrink-0">{p.project_number}</span>
                    <span className="text-muted-foreground w-20 shrink-0">{p.registered_at}</span>
                    <span className="flex-1 truncate">{p.name}</span>
                    <Badge className={`text-[9px] ${getDealProbabilityColor(p.deal_probability)}`}>{p.deal_probability}</Badge>
                    <Badge className={`text-[9px] ${st.color}`}>{st.label}</Badge>
                    <span className="tabular-nums w-24 text-right">{yen(p.expected_revenue)}</span>
                  </Link>
                );
              })}
              {projects.length > 30 && <p className="text-[10px] text-muted-foreground pt-2">他 {projects.length - 30}件は案件一覧で</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> 見積（{estimates.length}件）</CardTitle></CardHeader>
          <CardContent>
            {estimates.length === 0 ? <p className="text-xs text-muted-foreground">見積がありません</p> : (
              <div className="divide-y">
                {estimates.slice(0, 20).map((e) => {
                  const st = STATUS_MAP[e.status] || STATUS_MAP.draft;
                  return (
                    <Link key={e.id} to={`/estimates/${e.id}`} className="flex items-center gap-2 py-2 text-xs hover:bg-muted/40 -mx-2 px-2 rounded">
                      <span className="font-mono text-muted-foreground w-24 shrink-0">{e.estimate_number}</span>
                      <span className="flex-1 truncate">{e.estimate_title || e.print_type || "（件名なし）"}</span>
                      {e.is_final_submitted && <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100">最終</Badge>}
                      <Badge className={`text-[9px] ${st.color}`}>{st.label}</Badge>
                      <span className="tabular-nums w-20 text-right">{e.total_amount ? yen(e.total_amount) : "—"}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Receipt className="w-4 h-4" /> 請求書（{invoices.length}件）</CardTitle></CardHeader>
          <CardContent>
            {invoices.length === 0 ? <p className="text-xs text-muted-foreground">請求書がありません</p> : (
              <div className="divide-y">
                {invoices.slice(0, 20).map((inv) => {
                  const st = INVOICE_STATUS_MAP[inv.status] || INVOICE_STATUS_MAP.draft;
                  return (
                    <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center gap-2 py-2 text-xs hover:bg-muted/40 -mx-2 px-2 rounded">
                      <span className="font-mono text-muted-foreground w-24 shrink-0 truncate">{inv.invoice_number}</span>
                      <span className="text-muted-foreground w-20 shrink-0">{inv.invoice_date}</span>
                      <span className="flex-1 truncate">{inv.title || "（件名なし）"}</span>
                      <Badge className={`text-[9px] ${st.color}`}>{st.label}</Badge>
                      <span className="tabular-nums w-20 text-right">{yen(inv.total)}</span>
                    </Link>
                  );
                })}
                {invoices.length > 20 && <p className="text-[10px] text-muted-foreground pt-2">他 {invoices.length - 20}件は請求書一覧で</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Truck className="w-4 h-4" /> 納品書（{deliveryNotes.length}件）</CardTitle></CardHeader>
        <CardContent>
          {deliveryNotes.length === 0 ? <p className="text-xs text-muted-foreground">納品書がありません</p> : (
            <div className="divide-y">
              {deliveryNotes.slice(0, 20).map((n) => {
                const st = DELIVERY_STATUS_MAP[n.status] || DELIVERY_STATUS_MAP.draft;
                return (
                  <Link key={n.id} to={`/delivery-notes/${n.id}`} className="flex items-center gap-2 py-2 text-xs hover:bg-muted/40 -mx-2 px-2 rounded">
                    <span className="font-mono text-muted-foreground w-24 shrink-0">{n.delivery_number}</span>
                    <span className="text-muted-foreground w-20 shrink-0">{n.delivery_date}</span>
                    <span className="flex-1 truncate">{n.title || "（件名なし）"}</span>
                    <Badge className={`text-[9px] ${st.color}`}>{st.label}</Badge>
                    <span className="tabular-nums w-20 text-right">{yen(n.total)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 入稿先 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Globe className="w-4 h-4" /> 入稿先・仕入先（一次情報）</CardTitle>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? <p className="text-xs text-muted-foreground">見積の明細に入稿先の記録がありません（ネット印刷取込・仕入先見積から作った明細が対象）</p> : (
            <div className="space-y-3">
              {sources.map((s, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] font-normal">{s.kind}</Badge>
                    <span className="font-medium">{s.vendor}</span>
                    {s.spec && <span className="text-muted-foreground">{s.spec}</span>}
                    {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">価格ページ <ExternalLink className="w-3 h-3" /></a>}
                  </div>
                  <div className="pl-3 mt-1 space-y-0.5">
                    {s.items.slice(0, 5).map((it, j) => (
                      <div key={j} className="flex items-center gap-2 text-muted-foreground">
                        <Link to={`/estimates/${it.estimate.id}`} className="font-mono hover:underline">{it.estimate.estimate_number}</Link>
                        <span className="truncate flex-1">{it.name}</span>
                        <span className="tabular-nums">{Number(it.quantity || 0).toLocaleString()}{it.unit || ""}</span>
                        {it.cost_price != null && <span className="tabular-nums">原価 ¥{Number(it.cost_price).toLocaleString()}</span>}
                        <span className="tabular-nums">@¥{Number(it.unit_price || 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
