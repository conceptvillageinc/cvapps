import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, TableProperties, Plus, ExternalLink, CheckCircle2, RefreshCw } from "lucide-react";
import { costSheetRows, entryDate } from "@/lib/printSpecList";
import { todayString } from "@/lib/fiscal";

const NEW_TAB = "__new__";
const TEMPLATE_KEY = "cost_sheet_template_url";
const STATUS_LABEL = { submitted: { t: "入稿済", c: "bg-emerald-100 text-emerald-700" }, lost: { t: "失注", c: "bg-slate-200 text-slate-600" }, open: { t: "未確定", c: "bg-amber-100 text-amber-700" } };
const periodNum = (p) => Number(/(\d+)/.exec(p || "")?.[1] || 0);
const sheetIdOf = (u) => /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(String(u || ""))?.[1] || "";

/**
 * 原価計算表に行を足す。
 *   1. ファイル（このクライアントの原価計算表。取り込み済みのもの、または URL を貼る）
 *   2. タブ（一覧から選ぶ。最初は左から見て最初の「未確定」のタブ）か、新しいタブを作る（テンプレートを写して、いちばん左に置く）
 *   3. 「【パッケージ1.3掛】印刷費」「【パッケージ以外の制作物】」の空いている行に書く（計算式の列は触らない）
 */
export default function CostSheetWriteDialog({ open, onOpenChange, list, rules, defaultAuthor, onDone }) {
  const queryClient = useQueryClient();
  const { settings } = useSystemSettings();
  const templateRow = settings.find((x) => x.setting_key === TEMPLATE_KEY) || null;
  const [templateUrl, setTemplateUrl] = useState("");
  const { data: costSheets = [] } = useQuery({
    queryKey: ["costSheets", "client", list.client_name],
    queryFn: () => db.entities.CostSheet.filter({ client_name: list.client_name }),
    enabled: open && !!list.client_name,
  });
  const files = useMemo(() => {
    const m = new Map();
    for (const cs of costSheets) {
      if (!m.has(cs.spreadsheet_id)) m.set(cs.spreadsheet_id, { id: cs.spreadsheet_id, title: cs.file_title || cs.sheet_title, period: cs.period, tabs: 0 });
      m.get(cs.spreadsheet_id).tabs++;
    }
    return [...m.values()].sort((a, b) => periodNum(b.period) - periodNum(a.period));
  }, [costSheets]);

  const [fileId, setFileId] = useState("");
  const [pasted, setPasted] = useState("");
  const [tabs, setTabs] = useState(null); // { file_title, url, tabs: [...] }
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [tab, setTab] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setNewTitle(list.title || "");
    let saved = ""; try { saved = window.localStorage.getItem("cv.costSheetAuthor") || ""; } catch { /* noop */ }
    setAuthor(saved || defaultAuthor || "");
    setTemplateUrl(templateRow?.setting_value || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !fileId && files.length) setFileId(files[0].id); }, [open, files, fileId]);

  const activeId = sheetIdOf(pasted) || fileId;
  const loadTabs = async (id = activeId) => {
    if (!id) return;
    setLoadingTabs(true); setTabs(null);
    try {
      const r = await db.functions.invoke("printSpecs", { action: "tabs", spreadsheet_id: id });
      setTabs(r.data);
      const firstOpen = r.data.tabs.find((t) => t.status === "open" && !/テンプレ|原本|ひな形|雛形/.test(t.title));
      setTab(firstOpen ? String(firstOpen.sheet_id) : NEW_TAB);
    } catch (e) { toast.error("タブを読めませんでした: " + e.message); }
    finally { setLoadingTabs(false); }
  };
  useEffect(() => { if (open && activeId) loadTabs(activeId); }, [open, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => costSheetRows(list.items || [], rules, { author, date: entryDate(todayString()) }), [list.items, rules, author]);
  const pkg = rows.filter((r) => r.group === "package").length;

  const saveTemplate = async () => {
    const data = { setting_key: TEMPLATE_KEY, setting_value: templateUrl.trim(), description: "原価計算表のテンプレートのタブ（新しいタブを作るときに写す元）" };
    if (templateRow) await db.entities.SystemSettings.update(templateRow.id, data);
    else await db.entities.SystemSettings.create(data);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
    toast.success("テンプレートを登録しました");
  };

  const run = async () => {
    setRunning(true);
    try { window.localStorage.setItem("cv.costSheetAuthor", author); } catch { /* noop */ }
    try {
      let sheetId = Number(tab);
      if (tab === NEW_TAB) {
        const r = await db.functions.invoke("printSpecs", { action: "new_tab", spreadsheet_id: activeId, title: newTitle.trim() });
        sheetId = r.data.sheet_id;
      }
      const r = await db.functions.invoke("printSpecs", { action: "write", spreadsheet_id: activeId, sheet_id: sheetId, rows });
      setResult(r.data);
      onDone?.(r.data);
      toast.success(`原価計算表「${r.data.tab}」に ${r.data.written.length} 行を書き込みました`);
    } catch (e) { toast.error("書き込めませんでした: " + e.message); }
    finally { setRunning(false); }
  };

  const tabInfo = tabs?.tabs.find((t) => String(t.sheet_id) === tab);
  const canRun = !!activeId && !!tab && rows.length > 0 && !!author.trim() && (tab !== NEW_TAB || !!newTitle.trim());

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="cost-sheet-write-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><TableProperties className="w-5 h-5" /> 原価計算表に行を足す</DialogTitle></DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm" data-testid="cost-sheet-write-result">
            <p className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 className="w-5 h-5" /> 「{result.tab}」に {result.written.length} 行を書き込みました</p>
            <ul className="rounded-md border divide-y text-xs">
              {result.written.map((w) => <li key={w.row} className="px-3 py-1.5 flex gap-3"><span className="tabular-nums text-muted-foreground w-14">{w.row} 行目</span><span className="flex-1">{w.name}</span><span className="text-muted-foreground">{w.group === "package" ? "パッケージ1.3掛" : "パッケージ以外"}</span></li>)}
            </ul>
            <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="w-4 h-4" /> 原価計算表を開いて確かめる</a>
            <p className="text-[11px] text-muted-foreground">仕入計・売価・粗利はシートの計算式で出ます。CV アプリのクライアントカルテに反映するには、システム設定の「社内見積の取り込み」でこのファイルを取り込み直してください。</p>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="space-y-1">
              <Label className="text-xs">ファイル（{list.client_name || "クライアント未設定"} の原価計算表）</Label>
              {files.length > 0 ? (
                <select value={fileId} onChange={(e) => { setFileId(e.target.value); setPasted(""); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label="原価計算表のファイル">
                  {files.map((f) => <option key={f.id} value={f.id}>{f.title}（{f.period || "期不明"}・取り込み済み {f.tabs} タブ）</option>)}
                </select>
              ) : <p className="text-xs text-amber-700">このクライアントの原価計算表はまだ取り込まれていません。下に URL を貼ってください。</p>}
              <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="ほかのファイルなら、スプレッドシートの URL を貼る" className="h-8 text-xs" aria-label="スプレッドシートの URL" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs">タブ</Label>
                {tabs && <a href={tabs.url} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">{tabs.file_title}</a>}
                <div className="flex-1" />
                <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={() => loadTabs()} disabled={!activeId || loadingTabs}><RefreshCw className={`w-3 h-3 ${loadingTabs ? "animate-spin" : ""}`} /> 読み直す</Button>
              </div>
              {loadingTabs && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> タブを読んでいます…</p>}
              {tabs && (
                <div className="rounded-md border max-h-56 overflow-y-auto divide-y" role="radiogroup" aria-label="書き込むタブ" data-testid="cost-sheet-tabs">
                  <label className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${tab === NEW_TAB ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                    <input type="radio" checked={tab === NEW_TAB} onChange={() => setTab(NEW_TAB)} />
                    <Plus className="w-4 h-4 text-primary" /><span className="font-medium text-primary">新しいタブを作る</span>
                    <span className="text-[11px] text-muted-foreground">テンプレートを写して、いちばん左に置きます</span>
                  </label>
                  {tabs.tabs.map((t) => (
                    <label key={t.sheet_id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${tab === String(t.sheet_id) ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                      <input type="radio" checked={tab === String(t.sheet_id)} onChange={() => setTab(String(t.sheet_id))} />
                      <span className="flex-1 truncate">{t.title}</span>
                      <span className={`rounded px-1.5 text-[10px] ${STATUS_LABEL[t.status]?.c || ""}`}>{STATUS_LABEL[t.status]?.t}</span>
                    </label>
                  ))}
                </div>
              )}
              {tab === NEW_TAB && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="space-y-0.5">
                    <Label className="text-[11px]">新しいタブの名前</Label>
                    <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="h-8" aria-label="新しいタブの名前" />
                    <p className="text-[10px] text-muted-foreground">入稿したら、これまでどおり名前の後ろに「_261012」のように日付を付けてください</p>
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[11px]">写す元のテンプレート（原価計算表のテンプレートのタブの URL）</Label>
                    <div className="flex gap-1.5">
                      <Input value={templateUrl} onChange={(e) => setTemplateUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…" className="h-8 text-xs" aria-label="テンプレートの URL" />
                      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={templateUrl.trim() === (templateRow?.setting_value || "")} onClick={saveTemplate}>登録</Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{templateRow?.setting_value ? "登録済みのテンプレートを写します（全員共通）" : "未登録のときは、このファイルの「テンプレ」「原本」という名前のタブを写します"}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-0.5">
                <Label className="text-xs">記入者</Label>
                <Input value={author} onChange={(e) => setAuthor(e.target.value)} className="h-8" aria-label="記入者" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs">記入日時</Label>
                <Input value={entryDate(todayString())} readOnly className="h-8 bg-muted/40" />
              </div>
            </div>

            <div className="rounded-md border text-xs">
              <p className="px-3 py-1.5 border-b bg-muted/40 font-semibold">書き込む {rows.length} 行{tab && tab !== NEW_TAB && tabInfo ? `（「${tabInfo.title}」）` : tab === NEW_TAB ? `（新しいタブ「${newTitle}」）` : ""}</p>
              <ul className="divide-y">
                {rows.map((r, i) => (
                  <li key={i} className="px-3 py-1.5 flex gap-2">
                    <span className={`shrink-0 rounded px-1 text-[10px] ${r.group === "package" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"}`}>{r.group === "package" ? "パッケージ1.3掛" : "パッケージ以外"}</span>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="tabular-nums text-muted-foreground">{r.cost_unit ? `${Number(r.cost_unit).toLocaleString()} × ${Number(r.qty || 0).toLocaleString()}${r.unit}` : "仕入未入力"}</span>
                  </li>
                ))}
              </ul>
              <p className="px-3 py-1.5 border-t text-[11px] text-muted-foreground">
                {pkg > 0 && "「【パッケージ1.3掛】印刷費」"}{pkg > 0 && pkg < rows.length && "と"}{pkg < rows.length && "「【パッケージ以外の制作物】」"}の見出しの下の空いている行に、記入日時・記入者・項目・備考・金額・単価・数量・仕入先・URL を書きます。計算式の列は触らず、入稿の黄色も付けません。空いている行が足りなければ行を足します。
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {result
            ? <Button onClick={() => onOpenChange(false)}>閉じる</Button>
            : <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>キャンセル</Button>
                <Button onClick={run} disabled={!canRun || running} className="gap-1.5" data-testid="cost-sheet-write-run">{running && <Loader2 className="w-4 h-4 animate-spin" />}{tab === NEW_TAB ? "新しいタブを作って書き込む" : "このタブに書き込む"}</Button>
              </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
