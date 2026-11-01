import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, FileUp, Loader2, X, Plus, Trash2, Repeat, FileText, Truck, Search, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayString } from "@/lib/fiscal";
import { DEFAULT_VALIDITY_MONTHS, lineAmount } from "@/lib/constants";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { computeDocTotals, generateDocumentNumber } from "@/lib/documents";
import { generateEstimateNumber } from "@/lib/estimateNumber";
import { generateProjectNumber } from "@/lib/projectNumber";
import {
  MAX_HANDOVER_FILES, readFreeeDocument, readSubtotal, toEstimateLines, toNoteLines, matchClient, rankProjects, handoverMemo, nameSimilarity,
} from "@/lib/freeeHandover";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const DOC_LABEL = { estimate: "見積書", delivery_note: "納品書", invoice: "請求書" };

// ============================================================================
// freee販売引き継ぎ
//   ① 定期売上の見積書 → 案件と見積を作って、案件の画面で「定期売上にする」へ
//   ② 見積書・納品書   → すでにある案件に紐づけて、CVアプリの見積・納品書を作る
// ============================================================================
export default function FreeeHandover() {
  const [tab, setTab] = useState("recurring");
  const { data: clients = [] } = useQuery({ queryKey: ["clients", "all"], queryFn: () => db.entities.Client.listAll("name") });
  const { data: projects = [] } = useQuery({ queryKey: ["projects", "all"], queryFn: () => db.entities.Project.listAll("-registered_at") });

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-teal-600" /> freee販売引き継ぎ</h1>
        <p className="text-sm text-muted-foreground mt-0.5">freee販売の見積書・納品書のスクショ画像か PDF を読み取って、CVアプリの案件・見積・納品書を作ります</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="recurring" className="gap-1.5" data-testid="tab-recurring"><Repeat className="w-3.5 h-3.5" /> ① 定期売上を登録</TabsTrigger>
          <TabsTrigger value="docs" className="gap-1.5" data-testid="tab-docs"><FileText className="w-3.5 h-3.5" /> ② 見積書・納品書を登録</TabsTrigger>
        </TabsList>
        <TabsContent value="recurring" className="mt-4">
          <RecurringHandover clients={clients} />
        </TabsContent>
        <TabsContent value="docs" className="mt-4">
          <DocsHandover clients={clients} projects={projects} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ① 定期売上を登録
// ---------------------------------------------------------------------------
function RecurringHandover({ clients }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { dealProbabilityOptions = [] } = useSystemSettings();
  const [doc, setDoc] = useState(null);
  const [clientName, setClientName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [saving, setSaving] = useState(false);

  const onRead = (d) => {
    setDoc(d);
    const c = matchClient(clients, d.client_name);
    setClientName(c?.name || d.client_name);
    setProjectName(d.title || d.line_items[0]?.name || "");
  };
  const matched = clients.find((c) => c.name === clientName.trim());
  // 「12ヶ月 × 月額」のように期間分の金額で書いてある明細（定期売上の月額は 1 か月分にする）
  const MONTH_UNIT = /^(ヶ月|か月|カ月|ケ月|ヵ月|月)$/;
  const multiMonth = (doc?.line_items || []).filter((li) => MONTH_UNIT.test(String(li.unit || "").trim()) && Number(li.quantity) > 1);
  const toOneMonth = () => setDoc({ ...doc, line_items: doc.line_items.map((li) => (multiMonth.includes(li) ? { ...li, quantity: 1, amount: lineAmount(1, Number(li.unit_price) || 0) } : li)) });

  const create = async () => {
    setSaving(true);
    try {
      const name = clientName.trim();
      let client = matched;
      if (!client && name) client = await db.entities.Client.create({ name, quote_count: 0 });
      const registeredAt = doc.issue_date || todayString();
      const probability = dealProbabilityOptions.find((o) => /定期/.test(o)) || "A";
      const project = await db.entities.Project.create({
        project_number: await generateProjectNumber(registeredAt),
        client_id: client?.id || null, client_name: name, name: projectName.trim(),
        deal_probability: probability, phase: "未着手", status: "open",
        expected_revenue: 0, expected_cost: 0, other_cost: 0,
        registered_at: registeredAt, notes: [handoverMemo(doc, "定期売上の見積書"), doc.period ? `期間: ${doc.period}` : ""].filter(Boolean).join("\n"),
        created_by: user?.id || null,
      });
      await createEstimate({ doc, project, user });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success(`案件 ${project.project_number} と見積を作りました。毎月請求する明細と期間を選んで「定期売上にする」を押してください`);
      navigate(`/projects/${project.id}?recurring=1`);
    } catch (err) {
      toast.error("作成できませんでした: " + (err?.message || "不明なエラー"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Steps items={["定期売上の見積書（freee販売）を読み取る", "内容を確かめる", "案件と見積を作る", "案件の画面で、毎月請求する明細と期間を選んで「定期売上にする」"]} />
      <ReadCard onRead={onRead} hint="freee販売で作った定期売上（月額）の見積書" />
      {doc && (
        <>
          <ReviewCard doc={doc} onChange={setDoc} />
          {multiMonth.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="fh-multimonth">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 min-w-[16rem]">
                期間分の金額になっている明細があります（{multiMonth.map((li) => `${li.name}: ${li.quantity}${li.unit} × ${yen(li.unit_price)}`).join("、")}）。
                定期売上の月額は明細の金額で決まるので、1 か月分（数量 1）にしてください
              </span>
              <Button size="sm" variant="outline" className="h-7 text-xs bg-white" onClick={toOneMonth} data-testid="fh-one-month">1 か月分に直す</Button>
            </div>
          )}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">案件を作る</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">クライアント</Label>
                  <Input list="fh-clients" value={clientName} onChange={(e) => setClientName(e.target.value)} className="h-9" aria-label="クライアント" />
                  <datalist id="fh-clients">{clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
                  <p className={`text-[11px] ${matched ? "text-emerald-700" : "text-amber-700"}`}>
                    {matched ? `クライアント一覧の「${matched.name}」に紐づけます` : "クライアント一覧にない名前です（新しく登録します）"}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">案件名</Label>
                  <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="h-9" aria-label="案件名" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                案件（受注確度は定期売上）と、読み取った明細の見積（提出済み）を作ります。そのあと案件の画面で「定期売上にする」が開くので、
                毎月請求する明細・開始月・終了月を選んで登録してください。{doc.period && <>読み取った期間: <strong>{doc.period}</strong></>}
              </p>
              <Button className="gap-2 bg-rose-600 hover:bg-rose-700" disabled={saving || !clientName.trim() || !projectName.trim() || !doc.line_items.length} onClick={create} data-testid="fh-create-recurring">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />} 案件と見積を作って、定期売上の設定へ
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ② 見積書・納品書を登録
// ---------------------------------------------------------------------------
function DocsHandover({ clients, projects }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [doc, setDoc] = useState(null);
  const [kind, setKind] = useState("estimate");
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState([]); // 作った書類（この画面にいる間だけ）
  const readRef = useRef(null);

  const onRead = (d) => {
    setDoc(d);
    setKind(d.doc_type === "delivery_note" ? "delivery_note" : "estimate");
    const top = rankProjects(projects, d)[0];
    setProjectId(top && top.score >= 0.45 ? top.project.id : "");
    setQuery("");
  };

  const ranked = useMemo(() => {
    if (!doc) return [];
    const q = query.trim();
    const list = q
      ? projects.filter((p) => [p.project_number, p.client_name, p.name].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase())).map((p) => ({ project: p, score: nameSimilarity(p.client_name, doc.client_name) }))
      : rankProjects(projects, doc);
    return list.slice(0, 8);
  }, [doc, projects, query]);
  const picked = projects.find((p) => p.id === projectId);

  const create = async () => {
    setSaving(true);
    try {
      let row, url;
      if (kind === "estimate") {
        row = await createEstimate({ doc, project: picked, user });
        url = `/estimates/${row.id}`;
      } else {
        const client = clients.find((c) => c.id === picked.client_id) || clients.find((c) => c.name === picked.client_name);
        const items = toNoteLines(doc);
        const date = doc.issue_date || todayString();
        row = await db.entities.DeliveryNote.create({
          delivery_number: await generateDocumentNumber("delivery", date),
          project_id: picked.id, client_id: picked.client_id || client?.id || null,
          client_name: picked.client_name || doc.client_name, client_honorific: "御中",
          client_postal_code: client?.postal_code || "", client_address: client?.address || "",
          title: doc.title || picked.name, delivery_date: date, line_items: items, ...computeDocTotals(items),
          status: "issued", created_by: user?.id || null,
        });
        url = `/delivery-notes/${row.id}`;
      }
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["deliveryNotes"] });
      setDone((prev) => [{ kind, number: row.estimate_number || row.delivery_number, url, project: picked, freeeNumber: doc.doc_number }, ...prev]);
      toast.success(`${kind === "estimate" ? "見積" : "納品書"} ${row.estimate_number || row.delivery_number} を作りました（案件 ${picked.project_number}）`);
      setDoc(null);
      readRef.current?.reset();
    } catch (err) {
      toast.error("作成できませんでした: " + (err?.message || "不明なエラー"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Steps items={["freee販売の見積書か納品書を読み取る", "内容を確かめる", "紐づける案件を選ぶ", "CVアプリの見積・納品書を作る"]} />
      <ReadCard ref={readRef} onRead={onRead} hint="freee販売で作った見積書・納品書（1 枚ずつ）" />
      {doc && (
        <>
          <ReviewCard doc={doc} onChange={setDoc} />
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">案件に紐づけて作る</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">作る書類</span>
                {[["estimate", "見積", FileText], ["delivery_note", "納品書", Truck]].map(([k, l, Icon]) => (
                  <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} className="h-8 gap-1 text-xs" onClick={() => setKind(k)} data-testid={`fh-kind-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</Button>
                ))}
                {doc.doc_type === "invoice" && <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 請求書として読み取りました。見積か納品書を選んでください</span>}
              </div>
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="案件番号・クライアント・案件名で探す（空のときは、宛先・件名の近い順）" className="h-9 pl-8 text-xs" aria-label="案件を探す" />
                </div>
                <div className="rounded-md border divide-y" data-testid="fh-projects">
                  {ranked.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">見つかりません</p>}
                  {ranked.map(({ project: p }) => (
                    <label key={p.id} className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer ${projectId === p.id ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                      <input type="radio" name="fh-project" checked={projectId === p.id} onChange={() => setProjectId(p.id)} />
                      <span className="font-mono text-muted-foreground shrink-0">{p.project_number}</span>
                      <span className="shrink-0 max-w-[12rem] truncate">{p.client_name}</span>
                      <span className="flex-1 truncate font-medium">{p.name}</span>
                      <span className="text-muted-foreground shrink-0">{p.registered_at}</span>
                      <span className="tabular-nums shrink-0 w-20 text-right">{yen(p.expected_revenue)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Button className="gap-2" disabled={saving || !picked || !doc.line_items.length} onClick={create} data-testid="fh-create-doc">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : kind === "estimate" ? <FileText className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                {picked ? `案件 ${picked.project_number} に${kind === "estimate" ? "見積" : "納品書"}を作る` : "案件を選んでください"}
              </Button>
              {kind === "delivery_note" && <p className="text-[11px] text-muted-foreground">納品書は「発行済」で作ります。納品書番号は納品日の月で採番します（D-YYMM-連番）</p>}
            </CardContent>
          </Card>
        </>
      )}
      {done.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> 作った書類（{done.length}件）</CardTitle></CardHeader>
          <CardContent className="divide-y text-xs" data-testid="fh-done">
            {done.map((d, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5">
                <span className="w-12 text-muted-foreground">{d.kind === "estimate" ? "見積" : "納品書"}</span>
                <Link to={d.url} target="_blank" className="font-mono text-primary hover:underline inline-flex items-center gap-1">{d.number}<ExternalLink className="w-3 h-3" /></Link>
                <span className="text-muted-foreground">← freee {d.freeeNumber || "（番号なし）"}</span>
                <span className="flex-1 truncate">{d.project.project_number}　{d.project.client_name}　{d.project.name}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 読み取った内容から CVアプリの見積を作る（提出済み・承認済みで作る） */
async function createEstimate({ doc, project, user }) {
  const lines = toEstimateLines(doc);
  const totals = computeEstimateTotals(lines, { taxInclusive: doc.prices_include_tax });
  const estimateNumber = await generateEstimateNumber(db);
  const date = doc.issue_date || todayString();
  return db.entities.Estimate.create({
    schema_version: 2,
    estimate_number: estimateNumber, project_group_id: estimateNumber, revision_label: "初回",
    project_id: project.id, client_name: project.client_name || doc.client_name, client_honorific: "御中",
    estimate_title: doc.title || project.name, estimate_date: date, validity_period_months: DEFAULT_VALIDITY_MONTHS,
    line_items: lines, tax_inclusive: !!doc.prices_include_tax, total_amount: totals.total,
    status: "approved", submission_status: "submitted", submitted_at: `${date}T00:00:00+09:00`, is_final_submitted: true,
    deal_probability: project.deal_probability || "A", phase: project.phase || "未着手",
    person_in_charge: user?.full_name || "",
  });
}

// ---------------------------------------------------------------------------
// 共通の部品
// ---------------------------------------------------------------------------
function Steps({ items }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((t, i) => <li key={i}><span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-teal-600 text-white text-[10px] mr-1">{i + 1}</span>{t}</li>)}
    </ol>
  );
}

/** ファイルを選ぶ（ドロップ・貼り付けも可）→ 読み取る */
const ReadCard = forwardRef(function ReadCard({ onRead, hint }, ref) {
  const [files, setFiles] = useState([]);
  const [reading, setReading] = useState(false);
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => ({ reset: () => setFiles([]) }));
  const add = (list) => {
    const ok = [...(list || [])].filter((f) => /^image\//.test(f.type) || f.type === "application/pdf");
    if (!ok.length) { toast.error("画像か PDF を選んでください"); return; }
    setFiles((prev) => [...prev, ...ok].slice(0, MAX_HANDOVER_FILES));
  };
  const read = async () => {
    setReading(true);
    try {
      const d = await readFreeeDocument(files);
      if (!d.line_items.length) toast.warning("明細を読み取れませんでした。下の表に手で入れてください");
      onRead(d);
    } catch (err) {
      toast.error("読み取れませんでした: " + (err?.message || "不明なエラー"));
    } finally {
      setReading(false);
    }
  };
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div
          className="rounded-lg border-2 border-dashed border-teal-300 bg-teal-50/50 px-4 py-6 text-center text-xs text-teal-900 cursor-pointer hover:bg-teal-50"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
          onPaste={(e) => add(e.clipboardData.files)}
          tabIndex={0}
          data-testid="fh-drop"
        >
          <FileUp className="w-6 h-6 mx-auto mb-1 text-teal-600" />
          <p className="font-medium">{hint}のスクショ画像か PDF を、ここに置くか選んでください</p>
          <p className="text-[11px] text-teal-800/80 mt-0.5">コピーしたスクショは、ここをクリックしてから Ctrl+V（⌘+V）で貼り付けられます。同じ書類の複数ページは {MAX_HANDOVER_FILES} 枚まで一緒に読めます</p>
          <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="fh-file" />
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-[11px]">
                {f.name || "貼り付けた画像"}
                <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive" aria-label="外す"><X className="w-3 h-3" /></button>
              </span>
            ))}
            <Button size="sm" className="h-8 gap-1.5 ml-auto" onClick={read} disabled={reading} data-testid="fh-read">
              {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />} {reading ? "読み取っています…（10〜30 秒）" : "読み取る"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

/** 読み取った内容を確かめて直す */
function ReviewCard({ doc, onChange }) {
  const set = (patch) => onChange({ ...doc, ...patch });
  const setLine = (key, patch) => set({
    line_items: doc.line_items.map((li) => {
      if (li.key !== key) return li;
      const next = { ...li, ...patch };
      if ("quantity" in patch || "unit_price" in patch) next.amount = lineAmount(Number(next.quantity) || 0, Number(next.unit_price) || 0);
      return next;
    }),
  });
  const sum = readSubtotal(doc);
  const mismatch = doc.subtotal > 0 && Math.abs(sum - doc.subtotal) >= 1;
  return (
    <Card data-testid="fh-review">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          読み取った内容 <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal">{DOC_LABEL[doc.doc_type] || "書類"}</span>
          <span className="text-[11px] font-normal text-muted-foreground">違うところは直してください</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="宛先（クライアント）"><Input value={doc.client_name} onChange={(e) => set({ client_name: e.target.value })} className="h-8 text-xs" /></Field>
          <Field label="件名"><Input value={doc.title} onChange={(e) => set({ title: e.target.value })} className="h-8 text-xs" /></Field>
          <Field label="日付"><Input type="date" value={doc.issue_date} onChange={(e) => set({ issue_date: e.target.value })} className="h-8 text-xs" /></Field>
          <Field label="freee の番号"><Input value={doc.doc_number} onChange={(e) => set({ doc_number: e.target.value })} className="h-8 text-xs" /></Field>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">単価・金額</span>
          {[[false, "税抜"], [true, "税込（内税）"]].map(([v, l]) => (
            <Button key={l} size="sm" variant={doc.prices_include_tax === v ? "default" : "outline"} className="h-7 text-xs" onClick={() => set({ prices_include_tax: v })}>{l}</Button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-2 py-1.5 font-medium">品名</th>
                <th className="text-right px-2 py-1.5 font-medium w-20">数量</th>
                <th className="text-left px-2 py-1.5 font-medium w-16">単位</th>
                <th className="text-right px-2 py-1.5 font-medium w-28">単価</th>
                <th className="text-right px-2 py-1.5 font-medium w-28">金額</th>
                <th className="text-right px-2 py-1.5 font-medium w-16">税率</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {doc.line_items.map((li) => (
                <tr key={li.key}>
                  <td className="px-1 py-1"><Input value={li.name} onChange={(e) => setLine(li.key, { name: e.target.value })} className="h-7 text-xs" aria-label="品名" /></td>
                  <td className="px-1 py-1"><Input type="number" value={li.quantity} onChange={(e) => setLine(li.key, { quantity: e.target.value })} className="h-7 text-xs text-right" aria-label="数量" /></td>
                  <td className="px-1 py-1"><Input value={li.unit} onChange={(e) => setLine(li.key, { unit: e.target.value })} className="h-7 text-xs" aria-label="単位" /></td>
                  <td className="px-1 py-1"><Input type="number" value={li.unit_price} onChange={(e) => setLine(li.key, { unit_price: e.target.value })} className="h-7 text-xs text-right" aria-label="単価" /></td>
                  <td className="px-2 py-1 text-right tabular-nums">{yen(li.amount)}</td>
                  <td className="px-1 py-1">
                    <select value={li.tax_rate} onChange={(e) => setLine(li.key, { tax_rate: Number(e.target.value) })} className="h-7 w-full rounded border bg-white px-1 text-xs" aria-label="税率">
                      <option value={10}>10%</option><option value={8}>8%</option>
                    </select>
                  </td>
                  <td className="px-1 py-1 text-center"><button type="button" onClick={() => set({ line_items: doc.line_items.filter((x) => x.key !== li.key) })} className="text-muted-foreground hover:text-destructive" aria-label="行を消す"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => set({ line_items: [...doc.line_items, { key: Math.random().toString(36).slice(2, 10), name: "", quantity: 1, unit: "式", unit_price: 0, amount: 0, tax_rate: 10 }] })}><Plus className="w-3 h-3" /> 行を追加</Button>
          <span className="ml-auto text-xs">明細の合計（税抜） <strong className="tabular-nums">{yen(sum)}</strong>{doc.subtotal > 0 && <span className="text-muted-foreground">　書類の小計 {yen(doc.subtotal)}</span>}</span>
        </div>
        {mismatch && <p className="text-xs text-amber-800 flex items-center gap-1" data-testid="fh-mismatch"><AlertTriangle className="w-3.5 h-3.5" /> 明細の合計が書類の小計と合いません。読み取りが違う行がないか確かめてください</p>}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">{label}</Label>{children}</div>;
}
