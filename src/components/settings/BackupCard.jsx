import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatabaseBackup, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const FOLDER_URL = "https://drive.google.com/drive/folders/13qGrN50sYWjl-O35hH2hcQs9ikyrEm-7";
const mb = (b) => `${(Number(b || 0) / 1024 / 1024).toFixed(1)} MB`;

/** バックアップの状態と「今すぐ作る」。実行は毎週 月曜 4:00（日本時間）に自動 */
export default function BackupCard({ settings, isAdmin }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const last = useMemo(() => {
    const row = settings.find((s) => s.setting_key === "backup_last");
    if (!row) return null;
    try { return JSON.parse(row.setting_value); } catch { return null; }
  }, [settings]);

  const run = async () => {
    setRunning(true);
    try {
      const r = await db.functions.invoke("backup", {});
      const s = r.data || {};
      toast.success(`バックアップを作りました（${s.rows || 0} 行、ファイル ${s.files_uploaded || 0} 件）`);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error("バックアップに失敗しました: " + e.message);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    } finally { setRunning(false); }
  };

  const ok = last && !last.failed && (last.errors || []).length === 0;
  const when = last?.at ? new Date(last.at).toLocaleString("ja-JP") : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><DatabaseBackup className="w-4 h-4" /> バックアップ</CardTitle>
        <CardDescription className="text-xs">
          毎週 月曜 4:00（日本時間）に、全テーブルを ZIP にして Google ドライブの <a href={FOLDER_URL} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">バックアップ用フォルダ <ExternalLink className="w-3 h-3" /></a> へ置き、音声・PDF などのファイルも差分で写します。直近 8 週分と各月の最初の 1 つ（12 か月分）を残します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {last ? (
          <div className={`rounded-md border p-3 text-xs space-y-1 ${ok ? "border-emerald-200 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40"}`}>
            <p className="flex items-center gap-1.5 font-medium">
              {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
              最後のバックアップ: {when}{last.trigger === "cron" ? "（自動）" : last.trigger ? "（手動）" : ""}
            </p>
            {!last.failed && (
              <p className="text-muted-foreground">
                テーブル {last.rows?.toLocaleString()} 行（ZIP {mb(last.zip_bytes)}）／ ファイル {last.files_total} 件のうち 今回 {last.files_uploaded} 件を写し、{last.files_skipped} 件は写し済み
                {last.files_remaining > 0 ? `、残り ${last.files_remaining} 件は次回` : ""}／ {last.seconds} 秒
              </p>
            )}
            {(last.errors || []).length > 0 && (
              <ul className="text-amber-800 list-disc pl-4">{last.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}{last.errors.length > 5 && <li>他 {last.errors.length - 5} 件</li>}</ul>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">まだバックアップは作られていません。最初の自動実行は次の月曜 4:00 です</p>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" className="gap-1.5" onClick={run} disabled={running || !isAdmin}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseBackup className="w-4 h-4" />} {running ? "作成中…（数分かかることがあります）" : "今すぐバックアップを作る"}
          </Button>
          {!isAdmin && <span className="text-[11px] text-muted-foreground">管理者だけが実行できます</span>}
        </div>
        <p className="text-[11px] text-muted-foreground">復元の手順はリポジトリの docs/backup-restore.md にあります。Supabase 側の毎日の自動バックアップ（Pro プラン）とは別に、手元に残す写しです</p>
      </CardContent>
    </Card>
  );
}
