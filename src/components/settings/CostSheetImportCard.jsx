import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileSpreadsheet, Loader2, Search, Download, CheckCircle2, AlertTriangle, ChevronDown, Check, X } from "lucide-react";
import { toast } from "sonner";
import { matchClients } from "@/components/clients/ClientCombobox";
import { ordersFromCostSheets, parseCostLineKey, COST_SHEET_ORDER_AUTHOR } from "@/lib/costSheetOrders";

// ============================================================================
// 原価計算表（社内見積）の取り込み
//   ドライブのフォルダの URL を貼る → 中の「【原価計算表】◯期_クライアント名_社内見積」を列挙 →
//   クライアント一覧との突き合わせを確認して取り込む。タブ 1 枚 = 社内見積 1 件としてカルテに並ぶ。
//   同じファイルを取り直すと上書きされる（シートを直したあとの取り直し用）。
// ============================================================================

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("ja-JP") : "");
/** 表に出すファイル名（どのファイルにも付く「【原価計算表】◯期_」「_社内見積」を省く。期は隣の列に出る） */
const shortFileName = (name) => String(name || "").replace(/^【原価計算表】\s*(\d+期)?[_＿\s]*/, "").replace(/[_＿\s]*社内見積$/, "") || name;

/**
 * 表の中で使うクライアントの選択（名前を検索して選ぶ）。
 *   未選択のときは、ファイル名から読んだクライアント名で検索した状態で開く。
 */
function ClientPicker({ value, onChange, clients, fileClientName, label }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const selected = clients.find((c) => c.id === value) || null;
  const candidates = useMemo(() => matchClients(clients, q, 50), [clients, q]);
  const onOpenChange = (v) => {
    setOpen(v);
    if (v) { setQ(selected ? "" : fileClientName || ""); setActive(0); }
  };
  const pick = (id) => { onChange(id); setOpen(false); };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(candidates.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && candidates[active]) { e.preventDefault(); pick(candidates[active].id); }
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`h-7 w-full rounded-md border px-2 text-xs flex items-center gap-1 text-left ${selected ? "bg-background" : "bg-amber-50 border-amber-300 text-amber-900"}`}
          title={selected ? selected.name : fileClientName ? `ファイル名: ${fileClientName}` : "クライアントを選ぶ"}
          aria-label={label}
          data-testid="cost-sheet-client"
        >
          <span className="truncate flex-1">{selected ? selected.name : <>（未選択）{fileClientName ? <span className="text-[10.5px]">ファイル名: {fileClientName}</span> : null}</>}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown} placeholder="クライアント名で検索（一部でも可）" className="h-8 pl-7 text-xs" aria-label="クライアントを検索" />
          </div>
        </div>
        <ul className="max-h-64 overflow-auto py-1 text-xs" role="listbox">
          {candidates.length === 0 ? (
            <li className="px-3 py-3 text-center text-muted-foreground">「{q}」に合うクライアントがありません</li>
          ) : candidates.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(c.id); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-1.5 cursor-pointer flex items-center gap-2 ${i === active ? "bg-sky-100 text-sky-950" : ""}`}
            >
              <Check className={`w-3.5 h-3.5 shrink-0 ${c.id === value ? "opacity-100" : "opacity-0"}`} />
              <span className="truncate">{c.name}</span>
            </li>
          ))}
        </ul>
        {selected && (
          <div className="border-t p-1">
            <button type="button" onClick={() => pick("")} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded"><X className="w-3.5 h-3.5" /> 選択を外す</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * 取り込み済みの社内見積から、過去の入稿記録を作る（最終納品チェック ✓ の付いた印刷の行を、小見出しごとに 1 件に）。
 *   以前 1 行ずつ作った入稿記録（社内見積の取り込みで自動で作ったもの）は消して、まとめた形で作り直す。
 *   ただし、あとからスクショ・メモなどを編集したものは残す（その行はまとめに入れない）。手で登録した入稿記録は触らない。
 */
const editedAfterCreate = (o) => o.updated_at && o.created_at && new Date(o.updated_at) - new Date(o.created_at) > 5000;
function PastPrintOrders() {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState(null); // { rows, remove, kept, sheets, clients }
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const [sheets, orders] = await Promise.all([db.entities.CostSheet.list("-imported_at"), db.entities.PrintOrder.list("-ordered_on")]);
      // 1 行ずつ作った自動の記録（編集していないもの）は作り直す
      const single = orders.filter((o) => { const k = parseCostLineKey(o.estimate_line_id); return k && !k.grouped && o.created_by_name === COST_SHEET_ORDER_AUTHOR; });
      const remove = single.filter((o) => !editedAfterCreate(o));
      const removeIds = new Set(remove.map((o) => o.id));
      const keep = orders.filter((o) => !removeIds.has(o.id));
      const rows = ordersFromCostSheets(sheets, keep);
      const grouped = keep.filter((o) => parseCostLineKey(o.estimate_line_id)?.grouped).length;
      setPlan({ rows, remove, kept: single.length - remove.length, grouped, sheets: new Set(rows.map((r) => r.estimate_line_id.split(":")[1])).size, clients: new Set(rows.map((r) => r.client_name)).size });
    } catch (e) {
      toast.error("社内見積を読めませんでした: " + e.message);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      // 先に作ってから消す（途中で止まっても記録が消えたままにならないように）
      for (let i = 0; i < plan.rows.length; i += 50) await db.entities.PrintOrder.createMany(plan.rows.slice(i, i + 50));
      const ids = plan.remove.map((o) => o.id);
      for (let i = 0; i < ids.length; i += 100) await db.entities.PrintOrder.deleteMany(ids.slice(i, i + 100));
      queryClient.invalidateQueries({ queryKey: ["printOrders"] });
      toast.success(`${plan.rows.length} 件の入稿記録にまとめました`);
      setPlan({ ...plan, rows: [], remove: [], created: plan.rows.length, removed: ids.length });
    } catch (e) {
      const hint = /items/.test(e.message) ? "（先に Supabase で SQL 0032_print_order_items.sql を実行してください）" : "";
      toast.error("入稿記録を作れませんでした: " + e.message + hint);
    } finally {
      setBusy(false);
    }
  };
  const todo = plan && (plan.rows.length > 0 || plan.remove.length > 0);
  return (
    <div className="rounded-md border px-3 py-2.5 space-y-1.5 text-xs" data-testid="past-print-orders">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">過去の入稿記録を作る</span>
        <span className="text-muted-foreground">取り込み済みの社内見積で、右端の最終納品チェック（✓）が付いた印刷の行を、小見出しごとに 1 件（サイズ・送料などは内訳）にまとめて、クライアントカルテの「入稿」に足します</span>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={check} disabled={busy}>{busy && !plan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} 対象を確認する</Button>
      </div>
      {plan && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-muted/40 px-2.5 py-1.5" data-testid="past-print-orders-plan">
          {plan.created != null ? (
            <span className="text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {plan.created} 件の入稿記録にまとめました{plan.removed ? `（1 行ずつの記録 ${plan.removed} 件は消しました）` : ""}</span>
          ) : !todo ? (
            <span className="text-muted-foreground">新しく作る記録はありません{plan.grouped ? `（まとめ済み ${plan.grouped} 件）` : ""}</span>
          ) : (
            <>
              <span>
                社内見積 {plan.sheets} 件・{plan.clients} 社から <b>{plan.rows.length} 件</b>の入稿記録にまとめます。
                {plan.remove.length > 0 && <>以前 1 行ずつ作った <b>{plan.remove.length} 件</b>は消して置き換えます。</>}
                {plan.kept > 0 && <span className="text-muted-foreground">あとで編集した {plan.kept} 件はそのまま残します。</span>}
                <span className="text-muted-foreground">同じ内容（クライアント・入稿日・品名・金額が同じ）は 1 件だけにします。入稿日は社内見積のタブ名の日付（無ければ記入日）を目安に入れます</span>
              </span>
              <Button type="button" size="sm" className="h-7 text-xs ml-auto gap-1" onClick={run} disabled={busy} data-testid="past-print-orders-run">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} {plan.rows.length} 件にまとめる</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CostSheetImportCard() {
  const queryClient = useQueryClient();
  const [folderUrl, setFolderUrl] = useState("");
  const [files, setFiles] = useState(null);
  const [listing, setListing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState([]);
  const [overrides, setOverrides] = useState({}); // fileId → clientId
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => db.entities.Client.list("-name") });
  const sortedClients = useMemo(() => [...clients].sort((a, b) => String(a.name).localeCompare(String(b.name), "ja")), [clients]);

  const list = async () => {
    setListing(true); setFiles(null); setResults([]);
    try {
      const r = await db.functions.invoke("costSheetImport", { action: "list", folderUrl });
      setFiles(r.data?.files || []);
      if ((r.data?.files || []).length === 0) toast.message("このフォルダに原価計算表のスプレッドシートが見つかりませんでした");
    } catch (e) { toast.error("フォルダを読めませんでした: " + e.message); }
    finally { setListing(false); }
  };

  const clientOf = (f) => overrides[f.id] ?? f.client_id ?? "";
  const unmatched = (files || []).filter((f) => !clientOf(f));

  const run = async (targets) => {
    if (targets.length === 0) return;
    setRunning(true); setResults([]);
    setProgress({ done: 0, total: targets.length, current: "" });
    const out = [];
    for (const f of targets) {
      setProgress((p) => ({ ...p, current: f.name }));
      try {
        const r = await db.functions.invoke("costSheetImport", { action: "import", spreadsheetId: f.id, clientId: clientOf(f) || null, clientName: f.client_name });
        out.push({ id: f.id, name: f.name, ok: true, ...r.data });
      } catch (e) {
        out.push({ id: f.id, name: f.name, ok: false, error: e.message });
      }
      setResults([...out]);
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ["costSheets"] });
    const ok = out.filter((r) => r.ok);
    toast.success(`${ok.length} ファイル（${ok.reduce((s, r) => s + (r.imported || 0), 0)} 件の社内見積）を取り込みました${out.length - ok.length ? `。失敗 ${out.length - ok.length}` : ""}`);
    setFiles((prev) => (prev || []).map((f) => (ok.some((r) => r.id === f.id) ? { ...f, imported_at: new Date().toISOString() } : f)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> 原価計算表（社内見積）の取り込み</CardTitle>
        <CardDescription className="text-xs">
          ドライブの「【原価計算表】◯期_クライアント名_社内見積」を読み、タブ 1 枚を社内見積 1 件としてクライアントカルテの「社内見積」に並べます。明細・原価・売価・仕入先・入稿先 URL・貼ってあるスクショ（原価の根拠）を残します。読み取りはログイン中のアカウントの権限で行います
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-9 text-xs gap-1" onClick={list} disabled={listing || running}>{listing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} 原価計算表を探す</Button>
            <Input value={folderUrl} onChange={(e) => setFolderUrl(e.target.value)} className="h-9 flex-1 min-w-[280px]" placeholder="（任意）特定のファイルだけ読むときは、スプレッドシートかフォルダの URL を貼る" aria-label="スプレッドシートかフォルダの URL" />
          </div>
          <p className="text-[11px] text-muted-foreground">URL が空なら、14期・13期の原価計算表のフォルダを両方読みます。期とクライアントはファイル名（「【原価計算表】14期_クライアント名_社内見積」）から読み取ります</p>
        </div>

        {files && files.length > 0 && (
          <div className="rounded-md border overflow-hidden" data-testid="cost-sheet-files">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 text-xs">
              <span className="font-semibold">{files.length} ファイル</span>
              {unmatched.length > 0 ? <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> クライアントが決まっていないもの {unmatched.length}（右の欄で選んでください）</span> : <span className="text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> 全部クライアントに紐づきました</span>}
              <div className="ml-auto flex gap-1.5">
                <Button type="button" size="sm" className="h-7 text-xs gap-1" onClick={() => run(files.filter((f) => clientOf(f)))} disabled={running || files.filter((f) => clientOf(f)).length === 0}>{running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} 紐づいたものを全部取り込む</Button>
              </div>
            </div>
            {running && <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b">取り込み中 {progress.done}/{progress.total}　{progress.current}（1 ファイルに数十秒かかることがあります）</div>}
            <table className="w-full text-xs table-fixed">
              <colgroup><col /><col className="w-12" /><col className="w-[36%]" /><col className="w-24" /><col className="w-20" /></colgroup>
              <thead className="bg-slate-800 text-white"><tr><th className="text-left px-2 py-1.5">ファイル</th><th className="text-left px-2 py-1.5 whitespace-nowrap">期</th><th className="text-left px-2 py-1.5 whitespace-nowrap">クライアント</th><th className="text-left px-2 py-1.5 whitespace-nowrap">前回の取り込み</th><th></th></tr></thead>
              <tbody>
                {files.map((f) => {
                  const r = results.find((x) => x.id === f.id);
                  return (
                    <tr key={f.id} className="border-t">
                      <td className="px-2 py-1"><div className="line-clamp-2 break-all leading-snug" title={f.name}>{shortFileName(f.name)}</div>{r && (r.ok ? <><div className="text-[10px] text-emerald-700">取り込み {r.imported} 件{r.skipped ? `（空のタブ ${r.skipped}）` : ""}{r.orders ? `・入稿記録 ${r.orders} 行` : ""}</div>{r.note && <div className="text-[10px] text-amber-700">{r.note}</div>}</> : <div className="text-[10px] text-red-700">{r.error}</div>)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{f.period}</td>
                      <td className="px-2 py-1">
                        <ClientPicker value={clientOf(f)} onChange={(id) => setOverrides((o) => ({ ...o, [f.id]: id }))} clients={sortedClients} fileClientName={f.client_name} label={`${f.name} のクライアント`} />
                      </td>
                      <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{f.imported_at ? fmt(f.imported_at) : "—"}</td>
                      <td className="px-2 py-1 text-right"><Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => run([f])} disabled={running || !clientOf(f)}>取り込む</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <PastPrintOrders />
        <p className="text-[11px] text-muted-foreground">取り込むと、最終納品チェック（✓）の付いた印刷の行は入稿記録にも足します（すでにある行は足しません）。テンプレのタブ（金額の無いもの）は飛ばします。タブ名の「_失注」は失注、「_入稿日」「_日付」は入稿済として扱います。全タブに同じ画像（ロゴ・注意書き）は外し、行の近くに貼ったスクショだけを残します</p>
      </CardContent>
    </Card>
  );
}
