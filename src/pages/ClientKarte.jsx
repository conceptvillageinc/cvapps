import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Loader2, UserSquare, Save, Search, Link2, Image as ImageIcon, ExternalLink, FileText, CopyPlus, Copy, Lock,
  ChevronDown, ChevronUp, Pencil, Check,
} from "lucide-react";
import { toast } from "sonner";
import { INVOICE_DELIVERY_METHODS, STATUS_MAP, PROJECT_STATUS_MAP, getDealProbabilityColor } from "@/lib/constants";
import { DELIVERY_STATUS_MAP, INVOICE_STATUS_MAP, openPreviewTab, showBlobInTab } from "@/lib/documents";
import { formatPostalCode } from "@/lib/postalCode";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, todayString } from "@/lib/fiscal";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { specLabel } from "@/lib/printSpecs";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const yenCost = (n) => `¥${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;
const fmtDate = (d) => (d ? String(d).slice(0, 10).replace(/-/g, "/") : "");

/** 一覧・見出しに出す印刷仕様の要約 */
function specSummary(e) {
  const specs = e.print_specs || [];
  if (specs.length > 0) {
    return specs.map((sp, i) => {
      const q = (sp.quantities || []).map((n) => `${Number(n).toLocaleString()}枚`).join("/");
      return [specLabel(sp, i), sp.paper_type, sp.color_count, q].filter(Boolean).join("・");
    }).join("　");
  }
  const q = (e.quantities || []).map((n) => `${Number(n).toLocaleString()}枚`).join("/");
  return [e.print_type, e.size, e.paper_type, e.color_count, q].filter(Boolean).join("・");
}

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
    <a href={url || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center text-[10px] text-primary hover:underline" title="スクショを開く">
      {url && isImage
        ? <img src={url} alt="見積スクショ" className="h-10 w-14 rounded border object-cover bg-white" />
        : <span className="inline-flex items-center gap-1 h-7 px-2 rounded border bg-muted/30"><ImageIcon className="w-3.5 h-3.5" /> {isImage ? "画像" : "PDF"}</span>}
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

const TABS = [
  { key: "estimates", label: "見積" },
  { key: "projects", label: "案件" },
  { key: "invoices", label: "請求書" },
  { key: "deliveryNotes", label: "納品書" },
];

const GRID = "grid-cols-[24px_minmax(0,1fr)_64px_78px_44px_72px_86px_minmax(140px,180px)_64px]";

/**
 * クライアントカルテ: 左で見積（案件・請求書・納品書）を選び、右でその中身を見る。
 * 見積の右側は、これまでのスプレッドシートの「社内見積」に相当する情報
 * （原価・掛け率・単価・金額・入稿先URL・スクショ・社内メモ）を1画面にそろえる。
 */
export default function ClientKarte() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fiscalYearStartMonth } = useSystemSettings();
  const [notes, setNotes] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [tab, setTab] = useState("estimates");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const { data: client, isLoading } = useQuery({ queryKey: ["client", id], queryFn: () => db.entities.Client.get(id), enabled: !!id });
  const name = client?.name;
  const { data: projects = [] } = useQuery({ queryKey: ["projects", "byClient", name], queryFn: () => db.entities.Project.filter({ client_name: name }, "-registered_at"), enabled: !!name });
  const { data: estimates = [] } = useQuery({ queryKey: ["estimates", "byClient", name], queryFn: () => db.entities.Estimate.filter({ client_name: name }, "-created_date"), enabled: !!name });
  const { data: deliveryNotes = [] } = useQuery({ queryKey: ["deliveryNotes", "byClient", name], queryFn: () => db.entities.DeliveryNote.filter({ client_name: name }, "-delivery_date"), enabled: !!name });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices", "byClient", name], queryFn: () => db.entities.Invoice.filter({ client_name: name }, "-invoice_date"), enabled: !!name });
  const { data: masters = [] } = useQuery({ queryKey: ["priceMaster"], queryFn: () => db.entities.PriceMaster.list("-last_updated") });
  const masterById = useMemo(() => Object.fromEntries(masters.map((m) => [m.id, m])), [masters]);
  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

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

  // ---- 左の一覧（タブごと） ----
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const has = (...parts) => !q || parts.join(" ").toLowerCase().includes(q);
    if (tab === "estimates") {
      return estimates
        .filter((e) => has(e.estimate_number, e.estimate_title, e.print_type, specSummary(e), (e.line_items || []).map((li) => li.name || li.text || "").join(" ")))
        .map((e) => ({ id: e.id, number: e.estimate_number, date: fmtDate(e.created_date), title: e.estimate_title || e.print_type || "（件名なし）", total: e.total_amount, sub: specSummary(e), badge: e.is_final_submitted ? { label: "最終提出版", cls: "bg-amber-100 text-amber-700" } : STATUS_MAP[e.status] ? { label: STATUS_MAP[e.status].label, cls: STATUS_MAP[e.status].color } : null, raw: e }));
    }
    if (tab === "projects") {
      return projects
        .filter((p) => has(p.project_number, p.name))
        .map((p) => ({ id: p.id, number: p.project_number, date: fmtDate(p.registered_at), title: p.name || "（件名なし）", total: p.confirmed_revenue > 0 ? p.confirmed_revenue : p.expected_revenue, sub: `受注確度 ${p.deal_probability || "—"}　${p.phase || ""}`, badge: PROJECT_STATUS_MAP[p.status] ? { label: PROJECT_STATUS_MAP[p.status].label, cls: PROJECT_STATUS_MAP[p.status].color } : null, raw: p }));
    }
    if (tab === "invoices") {
      return invoices
        .filter((i) => has(i.invoice_number, i.title))
        .map((i) => ({ id: i.id, number: i.invoice_number, date: fmtDate(i.invoice_date), title: i.title || "（件名なし）", total: i.total, sub: i.due_date ? `入金期日 ${fmtDate(i.due_date)}` : "", badge: INVOICE_STATUS_MAP[i.status] ? { label: INVOICE_STATUS_MAP[i.status].label, cls: INVOICE_STATUS_MAP[i.status].color } : null, raw: i }));
    }
    return deliveryNotes
      .filter((n) => has(n.delivery_number, n.title))
      .map((n) => ({ id: n.id, number: n.delivery_number, date: fmtDate(n.delivery_date), title: n.title || "（件名なし）", total: n.total, sub: "", badge: DELIVERY_STATUS_MAP[n.status] ? { label: DELIVERY_STATUS_MAP[n.status].label, cls: DELIVERY_STATUS_MAP[n.status].color } : null, raw: n }));
  }, [tab, search, estimates, projects, invoices, deliveryNotes]);

  useEffect(() => {
    if (list.length === 0) { setSelectedId(null); return; }
    if (!list.some((x) => x.id === selectedId)) setSelectedId(list[0].id);
  }, [list, selectedId]);
  const current = list.find((x) => x.id === selectedId) || null;

  // ---- 見積の右側 ----
  const estimateView = useMemo(() => {
    if (tab !== "estimates" || !current) return null;
    const e = current.raw;
    const items = e.schema_version === 2 ? (e.line_items || []) : [];
    const totals = computeEstimateTotals(items, { taxInclusive: !!e.tax_inclusive });
    let cost = 0;
    const rows = items.map((li) => {
      if (li.row_type === "text") return { kind: "text", id: li.id, text: li.text || "" };
      if (li.row_type === "subtotal") return { kind: "subtotal", id: li.id, name: li.name || "小計", amount: li.amount };
      if (li.source_type === "rule") return { kind: "rule", id: li.id, name: li.name, amount: li.amount, rate: li.rate != null ? `${Math.round(Number(li.rate) * 100)}%` : "" };
      const hasCost = li.cost_price != null && li.cost_price !== "";
      if (hasCost) cost += (Number(li.cost_price) || 0) * (Number(li.quantity) || 1);
      let vendor = "", url = li.source_url || null, spec = "";
      if (li.source_type === "price_master") {
        const m = masterById[li.source_ref];
        vendor = m?.vendor_name || "価格マスタ"; url = url || m?.source_url || null; spec = m ? `${m.category}${m.spec_summary ? ` ${m.spec_summary}` : ""}` : "";
      } else if (li.source_type === "vendor_quote") {
        vendor = li.source_ref || "仕入先見積";
      } else if (li.source_type === "design_master") {
        vendor = "デザイン費マスタ";
      } else if (li.outsourcing_kind) {
        vendor = "外注";
      }
      return { kind: "item", id: li.id, name: li.name, category: li.category, quantity: li.quantity, unit: li.unit, cost_price: hasCost ? li.cost_price : null, markup_rate: li.markup_rate, unit_price: li.unit_price, amount: li.amount, vendor, url, spec, screenshot_path: li.screenshot_path || null, notes: li.notes || "", copied_from: li.copied_from || null };
    });
    // 旧形式（明細方式になる前）は印刷費1行として見せる
    if (e.schema_version !== 2 && e.selling_price > 0) {
      const qty = (e.quantities || [])[0] || 1;
      rows.push({ kind: "item", id: "legacy", name: `${e.print_type || "印刷費"}${e.selected_vendor ? `（${e.selected_vendor}）` : ""}`, category: "印刷費（紙）", quantity: qty, unit: "枚", cost_price: e.cost_price ? Number(e.cost_price) / qty : null, markup_rate: e.markup_rate, unit_price: Math.round(Number(e.selling_price) / qty), amount: Number(e.selling_price), vendor: e.selected_vendor || "", url: null, spec: "", screenshot_path: null, notes: "", copied_from: null });
      if (e.cost_price) cost += Number(e.cost_price);
    }
    const subtotal = e.schema_version === 2 ? totals.subtotal : Number(e.selling_price) || 0;
    const tax = e.schema_version === 2 ? totals.tax : Math.round(subtotal * 0.1);
    const project = projectById[e.project_id];
    return { e, rows, subtotal, tax, total: subtotal + tax, cost, profit: subtotal - cost, profitRate: subtotal > 0 ? ((subtotal - cost) / subtotal * 100).toFixed(1) : "0.0", project };
  }, [tab, current, masterById, projectById]);

  const openPdf = async () => {
    if (!estimateView) return;
    const e = estimateView.e;
    const tabWin = openPreviewTab();
    setPdfLoading(true);
    try {
      const blob = await db.documents.pdf("estimate", e.id, { stamp: false });
      const clean = (s) => String(s || "").replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
      showBlobInTab(tabWin, blob, `【${clean(e.client_name) || "クライアント"}】見積書_${clean(e.estimate_title) || e.estimate_number}.pdf`);
    } catch (err) {
      if (tabWin && !tabWin.closed) tabWin.close();
      toast.error("PDFを作成できませんでした: " + err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  if (isLoading || !client) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const counts = { estimates: estimates.length, projects: projects.length, invoices: invoices.length, deliveryNotes: deliveryNotes.length };

  return (
    <div className="max-w-7xl mx-auto space-y-3">
      {/* ヘッダー */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/clients")} className="shrink-0"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><UserSquare className="w-5 h-5 text-primary" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight truncate">{client.name}</h1>
          <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
            {client.name_kana && <span>{client.name_kana}</span>}
            {client.contact_person && <span>担当: {client.contact_person}</span>}
            {client.email && <span>{client.email}</span>}
            {client.phone && <span>{client.phone}</span>}
            {(client.invoice_delivery_method || client.has_recurring_billing) && (
              <span className="text-amber-700">請求書: {INVOICE_DELIVERY_METHODS[client.invoice_delivery_method] || "—"}{client.has_recurring_billing ? " ・ 定期" : ""}</span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setShowInfo((v) => !v)}>
          {showInfo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} 基本情報・メモ
        </Button>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => navigate("/clients")}><Pencil className="w-3.5 h-3.5" /> 編集</Button>
        <Button size="sm" className="text-xs" onClick={() => navigate(`/estimates/new?client=${encodeURIComponent(client.name)}`)}>＋ 新規見積</Button>
      </div>

      {/* 要約 */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        {[
          ["累計売上（税抜）", yen(stats.total)],
          [`${fiscalYearLabel(stats.fy, fiscalYearStartMonth).split("（")[0]}売上`, yen(stats.thisFy)],
          ["粗利（案件の合計）", `${yen(stats.gross)}${stats.grossRate != null ? ` / ${stats.grossRate}%` : ""}`],
          ["未入金", stats.unpaidCount ? `${stats.unpaidCount}件 ${yen(stats.unpaidTotal)}` : "なし"],
          ["進行中の案件", `${stats.openProjects}件`],
          ["最終請求日", stats.lastDate ? fmtDate(stats.lastDate) : "—"],
        ].map(([label, value]) => (
          <Card key={label}><CardContent className="pt-2.5 pb-2 px-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-base font-bold tabular-nums truncate">{value}</p></CardContent></Card>
        ))}
      </div>

      {/* 基本情報・メモ（開閉） */}
      {showInfo && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 space-y-3">
              <Field label="メール">{client.email}{Array.isArray(client.cc_emails) && client.cc_emails.filter(Boolean).length > 0 && <span className="block text-[10px] text-muted-foreground">CC: {client.cc_emails.filter(Boolean).join(", ")}</span>}</Field>
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
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">メモ（カルテ）</p>
                {notes !== null && <Button size="sm" className="h-7 text-xs gap-1" onClick={() => saveNotes.mutate()} disabled={saveNotes.isPending}><Save className="w-3 h-3" /> 保存</Button>}
              </div>
              <Textarea value={notes ?? client.notes ?? ""} onChange={(e) => setNotes(e.target.value)} rows={6} placeholder="担当者の好み、納品のルール、過去のトラブル、支払サイトなど" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* 左右2分割 */}
      <div className="flex gap-3 h-[calc(100vh-260px)] min-h-[460px]">
        {/* 左：一覧 */}
        <div className="w-[320px] shrink-0 bg-card border rounded-lg overflow-hidden flex flex-col">
          <div className="flex gap-1 p-2 border-b">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => { setTab(t.key); setSelectedId(null); }} className={`flex-1 h-7 rounded-md text-[11px] ${tab === t.key ? "bg-slate-800 text-white font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
                {t.label} {counts[t.key]}
              </button>
            ))}
          </div>
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "estimates" ? "件名・番号・仕様・明細名で絞り込み" : "件名・番号で絞り込み"} className="h-8 pl-8 text-xs" />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10">{search ? "該当がありません" : "まだありません"}</p>
            ) : list.map((row) => {
              const on = row.id === selectedId;
              return (
                <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full text-left px-3 py-2 border-b border-l-[3px] ${on ? "bg-primary/5 border-l-primary" : "border-l-transparent hover:bg-muted/30"}`}>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="font-mono text-muted-foreground">{row.number}</span>
                    <span className="text-muted-foreground/70">{row.date}</span>
                    {row.badge && <Badge className={`ml-auto text-[9px] px-1.5 py-0 ${row.badge.cls} hover:${row.badge.cls}`}>{row.badge.label}</Badge>}
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-[12.5px] font-medium truncate flex-1">{row.title}</span>
                    {row.total > 0 && <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{yen(row.total)}</span>}
                  </div>
                  {row.sub && <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">{row.sub}</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右：中身 */}
        <div className="flex-1 min-w-0 bg-card border rounded-lg flex flex-col overflow-hidden">
          {!current ? (
            <p className="text-xs text-muted-foreground text-center py-16">左の一覧から選んでください</p>
          ) : tab === "estimates" && estimateView ? (
            <EstimatePane view={estimateView} onOpenPdf={openPdf} pdfLoading={pdfLoading} clientName={client.name} />
          ) : (
            <SimplePane tab={tab} row={current} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 右側: 見積の中身（社内見積相当） */
function EstimatePane({ view, onOpenPdf, pdfLoading, clientName }) {
  const { e, rows, subtotal, tax, total, cost, profit, profitRate, project } = view;
  const st = STATUS_MAP[e.status];
  // 複製する明細の選択（見積を切り替えたら解除）
  const [picked, setPicked] = useState(() => new Set());
  useEffect(() => { setPicked(new Set()); }, [e.id]);
  const toggle = (rowId) => setPicked((prev) => { const n = new Set(prev); n.has(rowId) ? n.delete(rowId) : n.add(rowId); return n; });
  const itemRows = rows.filter((r) => r.kind === "item" && r.id !== "legacy");
  const pickedRows = itemRows.filter((r) => picked.has(r.id));
  const pickedTotal = pickedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const newUrl = (ids) => `/estimates/new?client=${encodeURIComponent(clientName)}&copy_from=${e.id}${ids ? `&lines=${encodeURIComponent(ids.join(","))}` : ""}`;
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b bg-muted/40">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{e.estimate_title || e.print_type || "（件名なし）"}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
            <span className="font-mono">{e.estimate_number}</span>
            <span>作成 {fmtDate(e.created_date)}</span>
            {e.person_in_charge && <span>担当 {e.person_in_charge}</span>}
            {e.is_final_submitted ? <span className="text-amber-700 font-medium">最終提出版</span> : st ? <span>{st.label}</span> : null}
            {e.deal_probability && <span>受注確度 {e.deal_probability}</span>}
            {e.tax_inclusive && <span className="text-primary">税込見積</span>}
            {project && <Link to={`/projects/${project.id}`} className="text-primary hover:underline">案件 {project.project_number} {project.name}</Link>}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <a href={`/estimates/${e.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-7 px-2 rounded-md border bg-background text-[11px] hover:bg-muted/50">
            <ExternalLink className="w-3 h-3" /> 見積を開く
          </a>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1" onClick={onOpenPdf} disabled={pdfLoading}>
            {pdfLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} 見積書PDF
          </Button>
        </div>
      </div>

      <div className="px-4 py-1.5 border-b flex items-center gap-2 text-[11px]">
        <span className="text-muted-foreground font-medium shrink-0">印刷仕様</span>
        <span className="text-foreground/80 truncate" title={specSummary(e)}>{specSummary(e) || "（未入力）"}</span>
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">社内見積（原価・掛け率・入稿先を表示）</span>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <div className={`grid ${GRID} gap-x-1.5 px-3 py-1.5 text-[10px] text-muted-foreground font-medium border-b sticky top-0 bg-background`}>
          <div></div><div>品名</div><div className="text-right">数量</div><div className="text-right">原価</div><div className="text-right">掛率</div><div className="text-right">単価</div><div className="text-right">金額</div><div>入稿先・社内メモ</div><div>スクショ</div>
        </div>
        {rows.length === 0 && <p className="text-xs text-muted-foreground text-center py-10">明細がありません</p>}
        {rows.map((r, idx) => {
          if (r.kind === "text") return <div key={r.id || idx} className="px-3 py-1.5 text-xs font-semibold text-foreground/80 bg-muted/30 border-b">{r.text || "　"}</div>;
          if (r.kind === "subtotal") return (
            <div key={r.id || idx} className={`grid ${GRID} gap-x-1.5 px-3 py-1 text-[11px] text-muted-foreground border-b bg-muted/10`}>
              <div className="col-span-6 text-right pr-2">{r.name}</div><div className="text-right font-medium tabular-nums">{yen(r.amount)}</div><div></div><div></div>
            </div>
          );
          if (r.kind === "rule") return (
            <div key={r.id || idx} className={`grid ${GRID} gap-x-1.5 px-3 py-1.5 text-[11px] text-muted-foreground/80 border-b items-center`}>
              <div><Lock className="w-3 h-3" /></div>
              <div className="flex items-center gap-1 truncate">{r.name} <span className="text-[9px]">（自動計算・複製しない）</span></div>
              <div></div><div></div><div className="text-right">{r.rate}</div><div></div><div className="text-right tabular-nums">{yen(r.amount)}</div><div></div><div></div>
            </div>
          );
          const on = picked.has(r.id);
          const copyable = r.id !== "legacy";
          return (
            <div key={r.id || idx} className={`grid ${GRID} gap-x-1.5 px-3 py-1.5 text-[11px] border-b items-start ${on ? "bg-primary/5" : ""}`}>
              <div className="pt-0.5">
                {copyable && (
                  <button type="button" onClick={() => toggle(r.id)} aria-label="複製する明細に選ぶ" className={`w-[15px] h-[15px] rounded border-[1.5px] inline-flex items-center justify-center ${on ? "bg-primary border-primary" : "border-muted-foreground/60 bg-background"}`}>
                    {on && <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3.5} />}
                  </button>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs truncate" title={r.name}>{r.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{[r.category, r.vendor, r.spec].filter(Boolean).join(" ・ ")}{r.copied_from ? `　（${r.copied_from} から複製）` : ""}</div>
              </div>
              <div className="text-right tabular-nums whitespace-nowrap">{Number(r.quantity || 0).toLocaleString()}{r.unit || ""}</div>
              <div className="text-right tabular-nums whitespace-nowrap text-amber-700">{r.cost_price != null ? yenCost(r.cost_price) : ""}</div>
              <div className="text-right tabular-nums text-muted-foreground">{r.markup_rate ? Number(r.markup_rate).toFixed(2) : ""}</div>
              <div className="text-right tabular-nums whitespace-nowrap">@{yen(r.unit_price)}</div>
              <div className="text-right text-xs font-medium tabular-nums whitespace-nowrap">{yen(r.amount)}</div>
              <div className="min-w-0 space-y-1">
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 max-w-full" title={r.url}>
                    <Link2 className="w-3 h-3 shrink-0" /> <span className="truncate">{r.url.replace(/^https?:\/\//, "")}</span>
                  </a>
                )}
                {r.notes && <p className="text-[10px] text-foreground/80 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-pre-wrap leading-snug">{r.notes}</p>}
              </div>
              <div><SourceScreenshot path={r.screenshot_path} /></div>
            </div>
          );
        })}
      </div>

      <div className="border-t px-4 py-2.5 flex gap-4 bg-muted/10">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium">備考（見積書に載る）</p>
          <p className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-line max-h-16 overflow-y-auto">{e.additional_notes || "（なし）"}</p>
        </div>
        <div className="w-[230px] shrink-0 text-[11px] tabular-nums space-y-0.5">
          <div className="flex justify-between text-muted-foreground"><span>小計（税別）</span><span>{yen(subtotal)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>消費税</span><span>{yen(tax)}</span></div>
          <div className="flex justify-between text-sm font-bold border-t pt-1 mt-1"><span>合計（税込）</span><span>{yen(total)}</span></div>
          {cost > 0 && (
            <>
              <div className="flex justify-between text-[10px] text-amber-700"><span>仕入合計（原価入力分）</span><span>{yen(cost)}</span></div>
              <div className="flex justify-between text-[10px] text-amber-700 font-semibold"><span>粗利</span><span>{yen(profit)}（{profitRate}%）</span></div>
            </>
          )}
        </div>
      </div>

      <div className="border-t px-4 py-2 flex items-center justify-between gap-3 bg-background">
        <span className="text-xs text-muted-foreground">
          選択中 <strong className="text-foreground">{pickedRows.length} 件</strong>
          {pickedRows.length > 0 && <span className="text-muted-foreground/80">　出し値 合計 {yen(pickedTotal)}</span>}
          <span className="ml-2 text-[10px]">（複製は新しいタブで新規見積として開きます）</span>
        </span>
        <div className="flex gap-2">
          <a href={newUrl(null)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border bg-background text-xs hover:bg-muted/50">
            <CopyPlus className="w-3.5 h-3.5" /> この見積をまるごと複製
          </a>
          {pickedRows.length > 0 ? (
            <a href={newUrl(pickedRows.map((r) => r.id))} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
              <Copy className="w-3.5 h-3.5" /> 選択した明細を複製
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary/40 text-primary-foreground text-xs font-semibold cursor-not-allowed" title="明細のチェックを付けてください">
              <Copy className="w-3.5 h-3.5" /> 選択した明細を複製
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/** 右側: 案件・請求書・納品書の要点（詳細は各画面で） */
function SimplePane({ tab, row }) {
  const r = row.raw;
  const link = tab === "projects" ? `/projects/${r.id}` : tab === "invoices" ? `/invoices/${r.id}` : `/delivery-notes/${r.id}`;
  const lines = tab === "projects" ? [] : (r.line_items || []);
  const fields = tab === "projects"
    ? [["案件番号", r.project_number], ["登録日", fmtDate(r.registered_at)], ["完了予定日", fmtDate(r.due_date)], ["入金予定日", fmtDate(r.payment_due_date)], ["受注確度", r.deal_probability], ["フェーズ", r.phase], ["見込売上", yen(r.expected_revenue)], ["見込原価", yen(r.expected_cost)], ["確定売上", r.confirmed_revenue > 0 ? yen(r.confirmed_revenue) : "—"], ["確定原価", r.confirmed_cost > 0 ? yen(r.confirmed_cost) : "—"]]
    : tab === "invoices"
      ? [["請求書番号", r.invoice_number], ["請求日", fmtDate(r.invoice_date)], ["入金期日", fmtDate(r.due_date)], ["状態", INVOICE_STATUS_MAP[r.status]?.label], ["送付方法", INVOICE_DELIVERY_METHODS[r.delivery_method]], ["担当", r.person_in_charge]]
      : [["納品書番号", r.delivery_number], ["納品日", fmtDate(r.delivery_date)], ["状態", DELIVERY_STATUS_MAP[r.status]?.label], ["担当", r.person_in_charge]];
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b bg-muted/40">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{row.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5"><span className="font-mono">{row.number}</span>　{row.date}</p>
        </div>
        <Link to={link} className="inline-flex items-center gap-1 h-7 px-2 rounded-md border bg-background text-[11px] hover:bg-muted/50 shrink-0"><ExternalLink className="w-3 h-3" /> 開く</Link>
      </div>
      <div className="p-4 space-y-4 overflow-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {fields.map(([k, v]) => (
            <div key={k}><p className="text-[10px] text-muted-foreground">{k}</p><p className="text-xs">{v || "—"}</p></div>
          ))}
        </div>
        {tab === "projects" && r.deal_probability && <Badge className={`text-[9px] ${getDealProbabilityColor(r.deal_probability)}`}>受注確度 {r.deal_probability}</Badge>}
        {tab === "projects" && r.notes && <div><p className="text-[10px] text-muted-foreground">メモ</p><p className="text-xs whitespace-pre-wrap">{r.notes}</p></div>}
        {lines.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_70px_90px_100px] gap-x-2 px-3 py-1.5 text-[10px] text-muted-foreground font-medium border-b bg-muted/30"><div>摘要</div><div className="text-right">数量</div><div className="text-right">単価</div><div className="text-right">金額</div></div>
            {lines.map((li, i) => (
              <div key={li.id || i} className="grid grid-cols-[minmax(0,1fr)_70px_90px_100px] gap-x-2 px-3 py-1.5 text-[11px] border-b last:border-0">
                <div className="truncate">{li.name}</div><div className="text-right tabular-nums">{Number(li.quantity || 0).toLocaleString()}{li.unit || ""}</div><div className="text-right tabular-nums">{yen(li.unit_price)}</div><div className="text-right tabular-nums font-medium">{yen(li.amount)}</div>
              </div>
            ))}
            <div className="flex justify-end gap-6 px-3 py-1.5 text-[11px] bg-muted/10"><span className="text-muted-foreground">小計 {yen(r.subtotal)}</span><span className="text-muted-foreground">消費税 {yen(r.tax)}</span><span className="font-bold">合計 {yen(r.total)}</span></div>
          </div>
        )}
        {tab !== "projects" && r.notes && <div><p className="text-[10px] text-muted-foreground">備考</p><p className="text-xs whitespace-pre-wrap">{r.notes}</p></div>}
      </div>
    </>
  );
}
