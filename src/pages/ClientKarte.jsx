import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, UserSquare, Save, FolderKanban, FileText, Truck, Receipt, Globe, Search, Link2, Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { INVOICE_DELIVERY_METHODS, STATUS_MAP, PROJECT_STATUS_MAP, getDealProbabilityColor } from "@/lib/constants";
import { DELIVERY_STATUS_MAP, INVOICE_STATUS_MAP } from "@/lib/documents";
import { formatPostalCode } from "@/lib/postalCode";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, todayString } from "@/lib/fiscal";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/** 明細に貼った印刷所の見積スクショ（非公開バケットなので署名付きURLで表示） */
function SourceScreenshot({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    db.storage.signedUrl(path).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [path]);
  if (!path) return null;
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(path);
  return (
    <a href={url || "#"} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1.5 text-[10px] text-primary hover:underline" title="スクショを開く">
      {url && isImage
        ? <img src={url} alt="見積スクショ" className="h-16 w-auto max-w-[160px] rounded border object-cover bg-white" />
        : <span className="inline-flex items-center gap-1 h-8 px-2 rounded border bg-muted/30"><ImageIcon className="w-3.5 h-3.5" /> {isImage ? "スクショ" : "PDF"}</span>}
    </a>
  );
}

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

  // 入稿先・仕入先（一次情報）: 見積ごとに、入稿先URL・スクショ・社内メモ・原価を持つ明細を並べる
  // （ネット印刷取込・仕入先見積の行に加え、手入力の行でも URL／スクショ／メモがあれば対象）
  const sourceGroups = useMemo(() => {
    const masterById = Object.fromEntries(masters.map((m) => [m.id, m]));
    const groups = [];
    const sorted = [...estimates].sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
    for (const e of sorted) {
      const rows = [];
      for (const li of e.line_items || []) {
        if (li.row_type === "text" || li.row_type === "subtotal" || li.source_type === "rule") continue;
        let kind = null, vendor = "", url = li.source_url || null, spec = "";
        if (li.source_type === "price_master") {
          const m = masterById[li.source_ref];
          kind = "ネット印刷"; vendor = m?.vendor_name || "価格マスタ"; url = url || m?.source_url || null;
          spec = m ? `${m.category}${m.spec_summary ? ` ${m.spec_summary}` : ""}` : "";
        } else if (li.source_type === "vendor_quote") {
          kind = "仕入先見積"; vendor = li.source_ref || "（仕入先）";
        } else if (li.source_url || li.screenshot_path || li.notes) {
          kind = li.outsourcing_kind ? "外注" : "手入力"; vendor = li.source_ref || "";
        } else continue;
        rows.push({ id: li.id, kind, vendor, url, spec, name: li.name, quantity: li.quantity, unit: li.unit, cost_price: li.cost_price, unit_price: li.unit_price, screenshot_path: li.screenshot_path || null, notes: li.notes || "", copied_from: li.copied_from || null });
      }
      if (rows.length > 0) groups.push({ estimate: e, rows });
    }
    return groups;
  }, [estimates, masters]);
  const [sourceFilter, setSourceFilter] = useState("");
  const filteredGroups = useMemo(() => {
    const q = sourceFilter.trim().toLowerCase();
    if (!q) return sourceGroups;
    return sourceGroups
      .map((g) => ({ ...g, rows: g.rows.filter((r) => `${r.vendor} ${r.name} ${r.spec} ${r.notes} ${r.url || ""} ${g.estimate.estimate_title || ""}`.toLowerCase().includes(q)) }))
      .filter((g) => g.rows.length > 0);
  }, [sourceGroups, sourceFilter]);

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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-sm flex items-center gap-2"><Globe className="w-4 h-4" /> 入稿先・仕入先（一次情報）</CardTitle>
              <p className="text-[10px] text-muted-foreground mt-0.5">見積ごとに、明細の入稿先URL・印刷所の見積スクショ・社内メモ・原価を並べています。明細のこれらの欄は見積書タブの「社内確認用」をONにすると編集できます</p>
            </div>
            <div className="relative sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} placeholder="メーカー・品名・メモで絞り込み" className="h-8 pl-8 text-xs" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{sourceFilter ? "該当する明細がありません" : "見積の明細に入稿先の記録がありません（ネット印刷取込・仕入先見積の行、または入稿先URL・スクショ・社内メモを入れた行が対象）"}</p>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map(({ estimate: e, rows }) => (
                <div key={e.id} className="border rounded-md overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-muted/40 text-xs">
                    <Link to={`/estimates/${e.id}`} className="font-mono text-primary hover:underline">{e.estimate_number}</Link>
                    <span className="text-muted-foreground">{e.created_date ? String(e.created_date).slice(0, 10).replace(/-/g, "/") : ""}</span>
                    <span className="font-medium truncate flex-1">{e.estimate_title || e.print_type || ""}</span>
                    {e.is_final_submitted && <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100">最終提出版</Badge>}
                    {e.total_amount > 0 && <span className="tabular-nums text-muted-foreground">{yen(e.total_amount)}</span>}
                  </div>
                  <div className="divide-y">
                    {rows.map((r) => (
                      <div key={r.id} className="px-3 py-2 text-xs grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Badge variant="outline" className="text-[9px] font-normal">{r.kind}</Badge>
                            {r.vendor && <span className="font-medium">{r.vendor}</span>}
                            <span className="truncate">{r.name}</span>
                            {r.spec && <span className="text-muted-foreground">{r.spec}</span>}
                            {r.copied_from && <span className="text-[10px] text-muted-foreground">（{r.copied_from} から複製）</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
                            <span className="tabular-nums">{Number(r.quantity || 0).toLocaleString()}{r.unit || ""}</span>
                            {r.cost_price != null && <span className="tabular-nums text-amber-700">原価 ¥{Number(r.cost_price).toLocaleString()}</span>}
                            <span className="tabular-nums">@¥{Number(r.unit_price || 0).toLocaleString()}</span>
                            {r.url && (
                              <a href={r.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5 max-w-[360px] truncate" title={r.url}>
                                <Link2 className="w-3 h-3 shrink-0" /> <span className="truncate">{r.url.replace(/^https?:\/\//, "")}</span>
                              </a>
                            )}
                          </div>
                          {r.notes && <p className="text-[11px] text-foreground/80 bg-amber-50 border border-amber-200 rounded px-2 py-1 whitespace-pre-wrap">{r.notes}</p>}
                        </div>
                        <SourceScreenshot path={r.screenshot_path} />
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
