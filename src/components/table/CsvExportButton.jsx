import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * 一覧の「CSV出力」ボタン。いま画面に出ている count 件を書き出す（絞り込み・並び順はそのまま）。
 *   onExport: 書き出す（書き出した行数を返す。async でもよい）
 */
export default function CsvExportButton({ count, onExport, className = "" }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const n = await onExport();
      toast.success(`CSV を書き出しました${typeof n === "number" ? `（${n}行）` : ""}`);
    } catch (err) {
      toast.error("CSV を書き出せませんでした: " + (err?.message || "不明なエラー"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline"
      className={`gap-2 ${className}`}
      disabled={!count || busy}
      title={count ? `いま表示している ${count}件を CSV で書き出します（絞り込み・並び順はそのまま）` : "書き出す行がありません"}
      onClick={run}
      data-testid="csv-export"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} CSV出力<span className="text-xs text-muted-foreground tabular-nums">{count}件</span>
    </Button>
  );
}
