import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Puzzle } from "lucide-react";

/** 拡張機能「CV AX KIT アシスタント」が入っていないときの案内 */
export default function AssistantGuideDialog({ open, onOpenChange, onRetry }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="assistant-guide">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Puzzle className="w-5 h-5" /> Chrome 拡張機能が必要です</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <p>「グラフィックで調べる」は、お使いの Chrome に入れた拡張機能「CV AX KIT アシスタント」が、グラフィックのページを別のウィンドウで開いて価格を読み取ります（CV アプリのサーバーからはグラフィックを開けないため）。</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
            <li>社内の PC には、管理者が Google Workspace の管理コンソールから配布します。入っていないときは管理者に連絡してください。</li>
            <li>入れたあとは、このページを読み込み直してください。</li>
            <li>調べている間は、開いたウィンドウを閉じずにそのままにしてください（ほかの作業はできます）。価格を見るだけで、注文やログインはしません。</li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>閉じる</Button>
          <Button onClick={onRetry}>入れたので確かめる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
