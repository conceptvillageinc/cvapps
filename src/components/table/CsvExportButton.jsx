import { Download, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * 一覧の「CSV出力」ボタン。いま画面に出ている count 件を書き出す。
 *   onExport: 1行＝1件で書き出す
 *   onExportLines: 渡すと「1行＝1明細」「両方」も選べるメニューにする（見積・納品書・請求書）
 */
export default function CsvExportButton({ count, onExport, onExportLines, className = "" }) {
  const run = async (fn, label) => {
    try {
      const n = await fn();
      toast.success(`${label}を書き出しました${typeof n === "number" ? `（${n}行）` : ""}`);
    } catch (err) {
      toast.error("CSV を書き出せませんでした: " + (err?.message || "不明なエラー"));
    }
  };
  const disabled = !count;
  const title = disabled ? "書き出す行がありません" : `いま表示している ${count}件を CSV で書き出します（絞り込み・並び順はそのまま）`;

  if (!onExportLines) {
    return (
      <Button variant="outline" className={`gap-2 ${className}`} disabled={disabled} title={title} onClick={() => run(onExport, "CSV")} data-testid="csv-export">
        <Download className="w-4 h-4" /> CSV出力<span className="text-xs text-muted-foreground tabular-nums">{count}件</span>
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`gap-2 ${className}`} disabled={disabled} title={title} data-testid="csv-export">
          <Download className="w-4 h-4" /> CSV出力<span className="text-xs text-muted-foreground tabular-nums">{count}件</span><ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">表示中の {count}件（絞り込み・並び順そのまま）</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run(async () => { await onExport(); await new Promise((r) => setTimeout(r, 500)); await onExportLines(); }, "書類ごと・明細ごとの CSV（2ファイル）")} data-testid="csv-export-both">
          <span><span className="block text-sm font-medium">両方（2ファイル）</span><span className="block text-[11px] text-muted-foreground">書類ごとの CSV と、明細ごとの CSV</span></span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(onExport, "書類ごとの CSV")} data-testid="csv-export-docs">
          <span><span className="block text-sm">書類ごと</span><span className="block text-[11px] text-muted-foreground">1行＝1書類（合計の金額）</span></span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(onExportLines, "明細ごとの CSV")} data-testid="csv-export-lines">
          <span><span className="block text-sm">明細ごと</span><span className="block text-[11px] text-muted-foreground">1行＝1明細（品名・数量・単価・金額）</span></span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
