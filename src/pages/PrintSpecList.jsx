import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { usePrintTypes } from "@/lib/printTypes";
import { usePricingRules } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Sparkles, Plus, CheckCircle2, Pencil, Camera, ExternalLink,
  FileSpreadsheet, FilePlus2, TableProperties, Search, AlertTriangle, Image as ImageIcon,
} from "lucide-react";
import { blankSpec, missingFields, isPackageType, specAmounts, specMemo, specTotals, expandPatterns, applyPricePatch,
  SPEC_EXTRACT_SCHEMA, specExtractPrompt, specsFromResult, PRICE_SHOT_SCHEMA, priceShotPrompt, familyName,
} from "@/lib/printSpecList";
import PrintSpecCard from "@/components/printSpecs/PrintSpecCard";
import CostSheetWriteDialog from "@/components/printSpecs/CostSheetWriteDialog";
import { usePrintSpecAccess } from "@/lib/usePrintSpecAccess";
import AssistantGuideDialog from "@/components/printSpecs/AssistantGuideDialog";
import { detectAssistant, lookupItem } from "@/lib/graphicLookup";

const LOOKUP_LIMIT = 10;

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const unitYen = (n) => (Number(n) ? `¥${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");

/**
 * 印刷仕様の一覧（価格調べ）
 *   ① 議事録から印刷物を書き出し、過不足を直して確定
 *   ② 仕入（税抜）・価格ページの URL を入れる（スクショから読むこともできる。グラフィックの自動検索は拡張機能で次のステップ）
 *   ③ 社内見積（原価計算表）の形で確かめて、スプレッドシート・新しい見積・原価計算表に出力する
 */
export default function PrintSpecList() {
  const { allowed } = usePrintSpecAccess();
  if (!allowed) return <div className="max-w-xl mx-auto py-16 text-center text-sm text-muted-foreground">印刷仕様の一覧は試験運用中のため、まだお使いいただけません。</div>;
  return <PrintSpecListPage />;
}

function PrintSpecListPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { names: printTypes } = usePrintTypes();
  const { rules } = usePricingRules();

  const { data: list, isLoading } = useQuery({ queryKey: ["printSpecList", id], queryFn: () => db.entities.PrintSpecList.get(id), enabled: !!id });
  const { data: meeting } = useQuery({ queryKey: ["meeting", list?.meeting_id], queryFn: () => db.entities.Meeting.get(list.meeting_id), enabled: !!list?.meeting_id });

  const [items, setItems] = useState(null);
  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [aiNotes, setAiNotes] = useState("");
  const [writeOpen, setWriteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reading, setReading] = useState(null); // スクショを読んでいる行 id
  // グラフィックで調べる（拡張機能）
  const [assistant, setAssistant] = useState("");
  const [lookup, setLookup] = useState(null); // { running, current, step, status: { [id]: { state: run|ok|fail, text } } }
  const [guideOpen, setGuideOpen] = useState(false);
  const cancelRef = useRef(false);
  useEffect(() => { detectAssistant().then(setAssistant); }, []);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!list || dirty) return;
    setItems(list.items || []);
    setTitle(list.title || "");
  }, [list, dirty]);

  const confirmed = list?.status === "confirmed";
  const save = async (patch = {}, { silent = false } = {}) => {
    setSaving(true);
    try {
      const data = { items, title, ...patch };
      await db.entities.PrintSpecList.update(id, data);
      queryClient.setQueryData(["printSpecList", id], (cur) => (cur ? { ...cur, ...data } : cur));
      setDirty(false);
      if (!silent) toast.success("保存しました");
    } catch (e) { toast.error("保存できませんでした: " + e.message); }
    finally { setSaving(false); }
  };
  // 打ったら少し待って自動で保存
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save({}, { silent: true }), 1500);
    return () => clearTimeout(t);
  }, [items, title, dirty]);

  const edit = (next) => { setItems(next); setDirty(true); };
  // 調べている間も行が書き換わるので、いまの値から直す
  const setRow = (rid, patch) => { setItems((cur) => cur.map((it) => (it.id === rid ? { ...it, ...patch } : it))); setDirty(true); };
  const move = (i, d) => { const next = [...items]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x); edit(next); };

  const extract = async ({ replace = false } = {}) => {
    if (!meeting) { toast.error("議事録が見つかりません"); return; }
    if (replace && items.length && !window.confirm("いまの一覧を、議事録から書き出し直した内容に置き換えます。よろしいですか？（手で直した内容は消えます）")) return;
    setExtracting(true);
    try {
      const res = await db.integrations.Core.InvokeLLM({ prompt: specExtractPrompt(meeting, printTypes), response_json_schema: SPEC_EXTRACT_SCHEMA });
      const rows = specsFromResult(res, printTypes);
      if (rows.length === 0) { toast.message("議事録から印刷物が見つかりませんでした。行を足して入れてください"); return; }
      const next = replace ? rows : [...items, ...rows];
      setItems(next); setAiNotes(res?.notes || "");
      const nextTitle = title || res?.title || "";
      setTitle(nextTitle);
      await db.entities.PrintSpecList.update(id, { items: next, title: nextTitle });
      queryClient.setQueryData(["printSpecList", id], (cur) => (cur ? { ...cur, items: next, title: nextTitle } : cur));
      setDirty(false);
      toast.success(`${rows.length} 件の印刷物を書き出しました。過不足を確かめてください`);
    } catch (e) { toast.error("書き出せませんでした: " + e.message); }
    finally { setExtracting(false); }
  };
  // 議事録から作ったばかり（?auto=1）なら、すぐ書き出す
  useEffect(() => {
    if (autoStarted.current || !list || !meeting || !items || items.length || params.get("auto") !== "1") return;
    autoStarted.current = true;
    setParams({}, { replace: true });
    extract();
  }, [list, meeting, items]);

  const missingCount = useMemo(() => (items || []).reduce((s, it) => s + missingFields(it).length, 0), [items]);
  // 印刷枚数のパターンを 1 行ずつに広げた行（②仕入・③社内見積・出力はこの行で扱う）
  const rows = useMemo(() => expandPatterns(items || []), [items]);
  const setPriceRow = (row, patch) => { setItems((cur) => applyPricePatch(cur, row, patch)); setDirty(true); };
  const priced = useMemo(() => rows.filter((it) => Number(it.cost_total) > 0).length, [rows]);
  // 合計は 1 つ目のパターンだけ（ほかのパターンは見積の選択肢なので足さない）
  const hasPatterns = rows.some((r) => r.patterns > 1);
  const totals = useMemo(() => specTotals(rows.filter((r) => !(r.pattern > 1)), rules), [rows, rules]);

  const readShot = async (it, file) => {
    setReading(it.id);
    try {
      const { file_url: path } = await db.integrations.Core.UploadFile({ file });
      const res = await db.integrations.Core.InvokeLLM({ prompt: priceShotPrompt(it), file_urls: [path], response_json_schema: PRICE_SHOT_SCHEMA });
      const total = Math.round(Number(res?.total_ex_tax) || (Number(res?.total_inc_tax) ? Math.floor(Number(res.total_inc_tax) / 1.1) : 0));
      setPriceRow(it, { screenshot_path: path, ...(total ? { cost_total: total } : {}), price_note: [res?.condition, res?.note].filter(Boolean).join("　") || it.price_note });
      if (total) toast.success(`仕入 ${yen(total)}（税抜）を読み取りました`);
      else toast.message("価格を読み取れませんでした。手で入れてください");
    } catch (e) { toast.error("読み取れませんでした: " + e.message); }
    finally { setReading(null); }
  };
  const runLookup = async (targets) => {
    const v = assistant || await detectAssistant();
    setAssistant(v);
    if (!v) { setGuideOpen(true); return; }
    const list = targets.slice(0, LOOKUP_LIMIT);
    if (targets.length > LOOKUP_LIMIT) toast.message(`一度に調べるのは ${LOOKUP_LIMIT} 件までです。残りはもう一度押してください`);
    cancelRef.current = false;
    const status = {};
    setLookup({ running: true, current: null, step: "", status });
    let okCount = 0;
    for (const it of list) {
      if (cancelRef.current) break;
      status[it.id] = { state: "run", text: "グラフィックを開いています…" };
      setLookup({ running: true, current: it.id, status: { ...status } });
      const r = await lookupItem(it, {
        isCancelled: () => cancelRef.current,
        onStep: ({ step, reason }) => { status[it.id] = { state: "run", text: `${step} 手目: ${reason || ""}` }; setLookup({ running: true, current: it.id, status: { ...status } }); },
      });
      const log = { at: new Date().toISOString(), ok: r.ok, reason: r.reason || "", steps: r.steps, trace: r.trace || [], debug: r.debug || null };
      setPriceRow(it, { ...(r.ok ? r.patch : {}), lookup_log: log });
      if (r.ok) { okCount++; status[it.id] = { state: "ok", text: `${r.steps} 手で見つかりました${r.patch.needs_check ? "（仕様の違いあり・要確認）" : ""}` }; }
      else status[it.id] = { state: "fail", text: r.reason || "見つかりませんでした" };
      if (r.fatal) { toast.error(r.reason, { duration: 15000 }); setLookup({ running: false, current: null, status: { ...status } }); return; }
      setLookup({ running: true, current: null, status: { ...status } });
    }
    setLookup({ running: false, current: null, status: { ...status } });
    toast.success(`${okCount} / ${list.length} 件の価格をグラフィックで調べました${okCount < list.length ? "。見つからなかった行は手で入れてください" : ""}`);
  };

  const openShot = async (path) => { try { window.open(await db.storage.signedUrl(path, 600), "_blank", "noopener"); } catch (e) { toast.error(e.message); } };

  const recordOutput = async (out) => {
    const outputs = [...(list.outputs || []), { ...out, at: new Date().toISOString(), by: user?.full_name || user?.email || "" }];
    await db.entities.PrintSpecList.update(id, { outputs });
    queryClient.setQueryData(["printSpecList", id], (cur) => (cur ? { ...cur, outputs } : cur));
  };
  const exportSheet = async () => {
    setExporting(true);
    try {
      if (dirty) await save({}, { silent: true });
      const r = await db.functions.invoke("printSpecs", { action: "export", list: { ...list, items: rows, title }, rules, author: user?.full_name || "" });
      await recordOutput({ kind: "sheet", url: r.data.url, label: "スプレッドシート" });
      window.open(r.data.url, "_blank", "noopener");
    } catch (e) { toast.error("書き出せませんでした: " + e.message); }
    finally { setExporting(false); }
  };
  const toEstimate = async () => {
    if (dirty) await save({}, { silent: true });
    const q = new URLSearchParams({ specs: id });
    if (list.meeting_id) q.set("meeting", list.meeting_id);
    if (list.project_id) q.set("project", list.project_id);
    if (list.client_name) q.set("client", list.client_name);
    await recordOutput({ kind: "estimate", label: "新しい見積" });
    navigate(`/estimates/new?${q.toString()}`);
  };

  if (isLoading || !list || !items) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const groups = [
    { key: "package", label: "【パッケージ1.3掛】印刷費", rows: rows.filter((it) => isPackageType(it.print_type)) },
    { key: "other", label: "【パッケージ以外の制作物】", rows: rows.filter((it) => !isPackageType(it.print_type)) },
  ].filter((g) => g.rows.length);

  return (
    <div className="max-w-[1400px] mx-auto space-y-4" data-testid="print-spec-page">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => (list.meeting_id ? navigate(`/meetings/${list.meeting_id}`) : navigate(-1))}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <TableProperties className="w-5 h-5 text-primary shrink-0" />
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="一覧の件名（例: 天然とらふぐ贅沢セット 掛け紙・ラベル）" className="h-9 text-lg font-bold max-w-xl" aria-label="件名" />
            <Badge className={confirmed ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>{confirmed ? "一覧を確定済み" : "仕様を確かめ中"}</Badge>
            <span className="text-[11px] text-muted-foreground">{saving ? "保存中…" : dirty ? "未保存" : "保存済み"}</span>
          </div>
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
            {list.client_name && (list.client_id ? <Link to={`/clients/${list.client_id}`} className="text-primary hover:underline">{list.client_name}</Link> : <span>{list.client_name}</span>)}
            {meeting && <Link to={`/meetings/${meeting.id}`} className="text-primary hover:underline">議事録「{meeting.title}」</Link>}
            {list.created_by && <span>作成 {list.created_by}</span>}
          </p>
        </div>
      </div>

      {/* 進み具合 */}
      <ol className="grid grid-cols-3 gap-2 text-xs" data-testid="print-spec-steps">
        {[
          { n: 1, label: "仕様を確かめて確定", done: confirmed, sub: confirmed ? `${items.length} 件で確定` : missingCount ? `未確認 ${missingCount} 項目` : `${items.length} 件` },
          { n: 2, label: "仕入を入れる", done: rows.length > 0 && priced === rows.length, sub: `${priced}/${rows.length} 件入力済み` },
          { n: 3, label: "社内見積の形で出力", done: (list.outputs || []).length > 0, sub: (list.outputs || []).length ? `${list.outputs.length} 回出力` : "スプレッドシート・見積・原価計算表" },
        ].map((s) => (
          <li key={s.n} className={`rounded-lg border px-3 py-2 ${s.done ? "border-emerald-300 bg-emerald-50" : "bg-white"}`}>
            <p className="font-semibold flex items-center gap-1.5">{s.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <span className="w-4 h-4 rounded-full border text-[10px] grid place-items-center">{s.n}</span>}{s.label}</p>
            <p className="text-muted-foreground mt-0.5">{s.sub}</p>
          </li>
        ))}
      </ol>

      {/* ① 仕様の一覧 */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold">① 印刷物の仕様</h2>
            <span className="text-xs text-muted-foreground">「未確認」は議事録で決まっていない項目です。過不足を直してから確定してください</span>
            <div className="flex-1" />
            {!confirmed && meeting && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => extract({ replace: items.length > 0 })} disabled={extracting}>
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {items.length ? "議事録から書き出し直す" : "議事録から書き出す"}
              </Button>
            )}
            {!confirmed && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => edit([...items, blankSpec()])}><Plus className="w-4 h-4" /> 印刷物を足す</Button>}
            {confirmed
              ? <Button variant="outline" size="sm" className="gap-1.5" onClick={() => save({ status: "draft" }, { silent: true })}><Pencil className="w-4 h-4" /> 仕様を直す</Button>
              : <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={items.length === 0 || saving} onClick={() => { if (missingCount && !window.confirm(`未確認の項目が ${missingCount} 個あります。このまま確定しますか？（確定後も「仕様を直す」で直せます）`)) return; save({ status: "confirmed" }); }} data-testid="print-spec-confirm"><CheckCircle2 className="w-4 h-4" /> この一覧で確定</Button>}
          </div>
          {extracting && <p className="text-xs text-primary flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 議事録と文字起こしを読んで、印刷物を書き出しています（30 秒〜1 分ほど）</p>}
          {aiNotes && <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 whitespace-pre-wrap"><b>一覧に入れなかった確認事項</b>{"\n"}{aiNotes}</div>}

          <div className="space-y-3" data-testid="print-spec-table">
            {items.length === 0 && (
              <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{extracting ? "書き出しています…" : "まだ印刷物がありません。「議事録から書き出す」か「印刷物を足す」で入れてください"}</p>
            )}
            {items.map((it, i) => (
              <PrintSpecCard
                key={`${it.id}-${confirmed ? "c" : "e"}`}
                item={it} index={i} count={items.length} printTypes={printTypes} rules={rules} readOnly={confirmed} defaultOpen={!confirmed}
                onChange={(patch) => setRow(it.id, patch)}
                onMove={(d) => move(i, d)}
                onDuplicate={() => { const next = [...items]; next.splice(i + 1, 0, { ...it, id: blankSpec().id, cost_total: "", price_url: "", price_note: "", screenshot_path: "", prices: {}, lookup_log: null }); edit(next); }}
                onRemove={() => { if (window.confirm(`「${it.name || `印刷物 ${i + 1}`}」を消しますか？`)) edit(items.filter((x) => x.id !== it.id)); }}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ② 仕入 */}
      <Card className={confirmed ? "" : "opacity-70"}>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold">② 仕入（税抜）を入れる</h2>
            <span className="text-xs text-muted-foreground">{confirmed ? "グラフィックで見た価格を入れるか、価格ページのスクショから読み取ります" : "①を確定すると入れられます"}</span>
            <div className="flex-1" />
            {lookup?.running
              ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { cancelRef.current = true; }}><Loader2 className="w-4 h-4 animate-spin" /> 調べています… 止める</Button>
              : <Button size="sm" className="gap-1.5" disabled={!confirmed || rows.length === 0} onClick={() => runLookup(rows.filter((it) => !(Number(it.cost_total) > 0)).length ? rows.filter((it) => !(Number(it.cost_total) > 0)) : rows)} data-testid="graphic-lookup-run"
                  title="Chrome 拡張機能「CV AX KIT アシスタント」がグラフィックを開いて、価格・URL・スクショを入れます">
                  <Search className="w-4 h-4" /> グラフィックで調べる（{rows.filter((it) => !(Number(it.cost_total) > 0)).length || rows.length} 件）
                </Button>}
            <span className={`text-[10px] ${assistant ? "text-emerald-700" : "text-muted-foreground"}`}>{assistant ? `拡張機能 v${assistant}` : "拡張機能なし"}</span>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs" data-testid="print-spec-prices">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-2 py-1.5 text-left">品目・仕様</th>
                  <th className="px-1 py-1.5 text-right w-32">仕入 合計（税抜）</th>
                  <th className="px-1 py-1.5 text-right w-24">単価</th>
                  <th className="px-1 py-1.5 text-left w-56">価格ページの URL</th>
                  <th className="px-1 py-1.5 text-left w-56">価格の条件（商品・納期など）</th>
                  <th className="px-1 py-1.5 w-28">スクショ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const a = specAmounts(it, rules);
                  return (
                    <tr key={it.id} className="border-t align-top" data-testid="print-spec-price-row">
                      <td className="px-2 py-1.5">
                        <p className="font-medium flex items-center gap-1.5">{it.name || "（品目なし）"}
                          {it.checked_at && <span className={`rounded px-1 text-[10px] ${it.needs_check ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{it.needs_check ? "グラフィック・要確認" : "グラフィックで確認"}</span>}
                          {confirmed && !lookup?.running && <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => runLookup([it])}>調べ直す</button>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{specMemo({ ...it, price_note: "", notes: "" })}{it.quantity ? `　${Number(it.quantity).toLocaleString()}${it.unit || ""}` : ""}</p>
                        {!lookup?.status?.[it.id] && it.lookup_log && !it.lookup_log.ok && <p className="mt-0.5 text-[11px] text-red-600">前回グラフィックで見つからなかった理由: {it.lookup_log.reason}</p>}
                        {it.lookup_log && !lookup?.running && <LookupLog log={it.lookup_log} item={it} />}
                        {lookup?.status?.[it.id] && <p data-testid="graphic-lookup-status" className={`mt-0.5 text-[11px] flex items-center gap-1 ${lookup.status[it.id].state === "fail" ? "text-red-600" : lookup.status[it.id].state === "ok" ? "text-emerald-700" : "text-primary"}`}>{lookup.status[it.id].state === "run" && <Loader2 className="w-3 h-3 animate-spin" />}{lookup.status[it.id].text}</p>}
                      </td>
                      <td className="px-1 py-1"><Input type="number" value={it.cost_total ?? ""} disabled={!confirmed} onChange={(e) => setPriceRow(it, { cost_total: e.target.value === "" ? "" : Number(e.target.value) })} className={`h-7 text-xs text-right tabular-nums ${confirmed && !(Number(it.cost_total) > 0) ? "border-amber-300" : ""}`} aria-label={`${it.name}の仕入`} /></td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{unitYen(a.costUnit)}</td>
                      <td className="px-1 py-1"><div className="flex gap-1"><Input value={it.price_url || ""} disabled={!confirmed} onChange={(e) => setPriceRow(it, { price_url: e.target.value })} placeholder="https://www.graphic.jp/…" className="h-7 text-xs" />{it.price_url && <a href={it.price_url} target="_blank" rel="noreferrer" className="shrink-0 grid place-items-center w-7 text-primary" aria-label="価格ページを開く"><ExternalLink className="w-3.5 h-3.5" /></a>}</div></td>
                      <td className="px-1 py-1"><Input value={it.price_note || ""} disabled={!confirmed} onChange={(e) => setPriceRow(it, { price_note: e.target.value })} placeholder="例: ラベル印刷 A4 300枚 6営業日" className="h-7 text-xs" /></td>
                      <td className="px-1 py-1 whitespace-nowrap">
                        <ShotPicker disabled={!confirmed || reading === it.id} busy={reading === it.id} onPick={(f) => readShot(it, f)} />
                        {it.screenshot_path && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openShot(it.screenshot_path)} aria-label="スクショを見る"><ImageIcon className="w-3.5 h-3.5" /></Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ③ 社内見積の形 */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold">③ 社内見積（原価計算表）の形</h2>
            <span className="text-xs text-muted-foreground">売価単価 = 仕入単価 × 掛け率 を 1 円単位で切り上げ（原価計算表と同じ）</span>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs" data-testid="print-spec-costsheet">
              <thead>
                <tr className="bg-[#fce4d6] text-slate-800">
                  <th className="px-2 py-1.5 text-left">項目</th>
                  <th className="px-2 py-1.5 text-left">備考</th>
                  <th className="px-2 py-1.5 text-right w-24">金額・単価</th>
                  <th className="px-2 py-1.5 text-right w-16">数量</th>
                  <th className="px-2 py-1.5 text-left w-12">単位</th>
                  <th className="px-2 py-1.5 text-right w-24 bg-slate-200">計</th>
                  <th className="px-2 py-1.5 text-right w-14">掛け率</th>
                  <th className="px-2 py-1.5 text-right w-20">売価単価</th>
                  <th className="px-2 py-1.5 text-right w-24">売価計</th>
                  <th className="px-2 py-1.5 text-left w-28">仕入先・URL</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="bg-amber-50"><td colSpan={10} className="px-2 py-1 font-semibold text-amber-900">{g.label}</td></tr>
                    {g.rows.map((it) => {
                      const a = specAmounts(it, rules);
                      return (
                        <tr key={it.id} className="border-t" data-testid="print-spec-cs-row">
                          <td className="px-2 py-1.5 font-medium">{it.name}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{specMemo(it)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{a.costUnit ? a.costUnit.toLocaleString(undefined, { maximumFractionDigits: 2 }) : <span className="text-amber-700">未入力</span>}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{a.qty ? a.qty.toLocaleString() : "—"}</td>
                          <td className="px-2 py-1.5">{it.unit}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums bg-slate-50">{a.costCalc ? a.costCalc.toLocaleString() : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{a.markup}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{a.sellUnit ? a.sellUnit.toLocaleString() : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{a.sellTotal ? a.sellTotal.toLocaleString() : "—"}</td>
                          <td className="px-2 py-1.5 truncate max-w-[10rem]">{it.price_url ? <a href={it.price_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{it.vendor || "グラフィック"}</a> : <span className="text-muted-foreground">{it.vendor || ""}</span>}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                <tr className="border-t bg-blue-50/60 font-semibold">
                  <td className="px-2 py-2" colSpan={5}>合計（税別）{hasPatterns && <span className="ml-2 text-[11px] font-normal text-slate-500">枚数のパターンは 1 つ目だけで合計</span>}{priced < rows.length && <span className="ml-2 text-[11px] font-normal text-amber-700">仕入が未入力の行が {rows.length - priced} 件あります</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{totals.cost.toLocaleString()}</td>
                  <td></td><td></td>
                  <td className="px-2 py-2 text-right tabular-nums">{totals.sell.toLocaleString()}</td>
                  <td className="px-2 py-2 text-[11px] font-normal">粗利 {yen(totals.gross)}{totals.margin !== null ? `（${(totals.margin * 100).toFixed(1)}%）` : ""}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-testid="print-spec-outputs">
            <span className="text-xs font-semibold">出力</span>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!confirmed || exporting} onClick={exportSheet}>{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} スプレッドシートに書き出す</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!confirmed} onClick={toEstimate}><FilePlus2 className="w-4 h-4" /> 新しい見積に取り込む</Button>
            <Button size="sm" className="gap-1.5" disabled={!confirmed} onClick={() => setWriteOpen(true)} data-testid="print-spec-write-open"><TableProperties className="w-4 h-4" /> 原価計算表に行を足す</Button>
            {!confirmed && <span className="text-[11px] text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> ①の一覧を確定すると出力できます</span>}
          </div>
          {(list.outputs || []).length > 0 && (
            <ul className="text-[11px] text-muted-foreground space-y-0.5">
              {[...list.outputs].reverse().slice(0, 5).map((o, i) => (
                <li key={i}>{new Date(o.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} {o.by}：{o.label}{o.url && <> <a href={o.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">開く</a></>}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AssistantGuideDialog open={guideOpen} onOpenChange={setGuideOpen} onRetry={async () => { const v = await detectAssistant(); setAssistant(v); if (v) { setGuideOpen(false); toast.success("拡張機能が見つかりました"); } else toast.error("まだ見つかりません。拡張機能を入れたあと、このページを読み込み直してください"); }} />
      <CostSheetWriteDialog
        open={writeOpen} onOpenChange={setWriteOpen}
        list={{ ...list, items: rows, title }} rules={rules}
        defaultAuthor={familyName(user?.full_name || "")}
        onDone={(out) => recordOutput({ kind: "cost_sheet", url: out.url, label: `原価計算表「${out.tab}」に ${out.written.length} 行` })}
      />
    </div>
  );
}

function ShotPicker({ onPick, disabled, busy }) {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
      <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" disabled={disabled} onClick={() => ref.current?.click()} title="価格ページのスクショを選ぶと、仕入（税抜）を読み取ります">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} 読む
      </Button>
    </>
  );
}

/** グラフィックで調べた経過（何を押したか）と、うまくいかなかったときの診断情報のコピー */
function LookupLog({ log, item }) {
  const [open, setOpen] = useState(false);
  const copy = async () => {
    const lines = [
      `【グラフィックで調べた経過】${item.name}（${[item.size, item.paper, item.colors, item.quantity ? `${item.quantity}${item.unit || ""}` : ""].filter(Boolean).join("／")}）`,
      `結果: ${log.ok ? "見つかった" : `見つからなかった（${log.reason}）`}　${log.steps} 手　${new Date(log.at).toLocaleString("ja-JP")}`,
      ...(log.trace || []).map((t) => `${t.step}. ${t.page} ${t.action}${t.target ? ` 「${t.target}」` : ""}${t.value ? ` = ${t.value}` : ""} … ${t.reason || ""}`),
      ...(log.debug ? [
        "", `【最後のページ】${log.debug.title} ${log.debug.url}`,
        "【選択肢・ボタン】", ...(log.debug.controls || []),
        "【表】", ...(log.debug.tables || []).flatMap((t) => [`- ${t.title || "（見出しなし）"}`, ...t.rows]),
        "【本文（先頭）】", log.debug.text || "",
      ] : []),
    ];
    try { await navigator.clipboard.writeText(lines.join("\n")); toast.success("経過をコピーしました。チャットに貼り付けて送ってください"); } catch { toast.error("コピーできませんでした"); }
  };
  return (
    <div className="mt-0.5 text-[11px]">
      <button type="button" className="text-muted-foreground hover:underline" onClick={() => setOpen((v) => !v)}>{open ? "経過を閉じる" : `経過を見る（${log.steps || 0} 手）`}</button>
      <button type="button" className="ml-2 text-primary hover:underline" onClick={copy}>経過をコピー</button>
      {open && (
        <ol className="mt-1 max-h-48 overflow-y-auto rounded border bg-muted/30 px-2 py-1 space-y-0.5">
          {(log.trace || []).map((t) => <li key={t.step} className="text-muted-foreground"><span className="tabular-nums">{t.step}.</span> {t.reason || `${t.action} ${t.target || ""}`}</li>)}
        </ol>
      )}
    </div>
  );
}
