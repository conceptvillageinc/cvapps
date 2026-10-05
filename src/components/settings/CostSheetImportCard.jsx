import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileSpreadsheet, Loader2, Search, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// ============================================================================
// 原価計算表（社内見積）の取り込み
//   ドライブのフォルダの URL を貼る → 中の「【原価計算表】◯期_クライアント名_社内見積」を列挙 →
//   クライアント一覧との突き合わせを確認して取り込む。タブ 1 枚 = 社内見積 1 件としてカルテに並ぶ。
//   同じファイルを取り直すと上書きされる（シートを直したあとの取り直し用）。
// ============================================================================

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("ja-JP") : "");

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
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-white"><tr><th className="text-left px-2 py-1.5">ファイル</th><th className="text-left px-2 py-1.5 w-14">期</th><th className="text-left px-2 py-1.5 w-56">クライアント</th><th className="text-left px-2 py-1.5 w-24">前回の取り込み</th><th className="w-20"></th></tr></thead>
              <tbody>
                {files.map((f) => {
                  const r = results.find((x) => x.id === f.id);
                  return (
                    <tr key={f.id} className="border-t">
                      <td className="px-2 py-1"><div className="truncate max-w-[360px]" title={f.name}>{f.name}</div>{r && (r.ok ? <div className="text-[10px] text-emerald-700">取り込み {r.imported} 件{r.skipped ? `（空のタブ ${r.skipped}）` : ""}</div> : <div className="text-[10px] text-red-700">{r.error}</div>)}</td>
                      <td className="px-2 py-1">{f.period}</td>
                      <td className="px-2 py-1">
                        <select value={clientOf(f)} onChange={(e) => setOverrides((o) => ({ ...o, [f.id]: e.target.value }))} className={`h-7 w-full rounded-md border px-1 text-xs ${clientOf(f) ? "bg-background" : "bg-amber-50 border-amber-300"}`} aria-label={`${f.name} のクライアント`}>
                          <option value="">（未選択）{f.client_name ? `　ファイル名: ${f.client_name}` : ""}</option>
                          {sortedClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{f.imported_at ? fmt(f.imported_at) : "—"}</td>
                      <td className="px-2 py-1 text-right"><Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => run([f])} disabled={running || !clientOf(f)}>取り込む</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">テンプレのタブ（金額の無いもの）は飛ばします。タブ名の「_失注」は失注、「_入稿日」「_日付」は入稿済として扱います。全タブに同じ画像（ロゴ・注意書き）は外し、行の近くに貼ったスクショだけを残します</p>
      </CardContent>
    </Card>
  );
}
