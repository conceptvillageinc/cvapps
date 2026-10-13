import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Copy, ExternalLink, Loader2, KeyRound, CalendarClock, RefreshCw, Link2 } from "lucide-react";
import { toast } from "sonner";
import { jpDate } from "@/lib/schedule";

/** クライアント向けの共有リンク（通常は URL だけで開ける。パスワード・期限は任意） */
export default function ShareDialog({ open, onOpenChange, project }) {
  const qc = useQueryClient();
  const key = ["scheduleShare", project.id];
  const { data: share, isLoading } = useQuery({
    queryKey: key,
    enabled: open,
    queryFn: async () => (await db.functions.invoke("scheduleShare", { action: "get", project_id: project.id })).data.share,
  });
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const call = async (payload, done) => {
    setBusy(true);
    try {
      const { data } = await db.functions.invoke("scheduleShare", { project_id: project.id, ...payload });
      qc.setQueryData(key, data.share);
      if (done) toast.success(done);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const url = share ? `${window.location.origin}/s/${share.token}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success("URL をコピーしました"); } catch { toast.error("コピーできませんでした。URL を選んでコピーしてください"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4" /> クライアント向けの共有リンク</DialogTitle>
          <DialogDescription className="text-xs">
            URL を知っている人は、ログインなしで工程表を見られます（見るだけ）。「工程表に出す」にチェックした工程だけが出て、社内メモや時間は出ません。
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !share ? (
          <div className="py-4 text-center space-y-3">
            <p className="text-sm text-muted-foreground">まだ共有リンクはありません。</p>
            <Button onClick={() => call({ action: "configure", enabled: true }, "共有リンクを作りました")} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} 共有リンクを作る
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="font-medium">{share.enabled ? "公開中" : "停止中（開けません）"}</p>
                <p className="text-[11px] text-muted-foreground">止めると、URL を知っていても開けなくなります</p>
              </div>
              <Switch checked={share.enabled} disabled={busy} onCheckedChange={(v) => call({ action: "configure", enabled: v }, v ? "公開しました" : "共有を止めました")} />
            </div>

            <div className="space-y-1.5">
              <div className="flex gap-2">
                <Input readOnly value={url} className="text-xs font-mono" onFocus={(e) => e.target.select()} data-testid="share-url" />
                <Button variant="outline" size="icon" onClick={copy} title="コピー"><Copy className="w-4 h-4" /></Button>
                <Button variant="outline" size="icon" asChild title="開く"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /></a></Button>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> パスワード（任意）</p>
              {share.has_password ? (
                <div className="flex items-center justify-between">
                  <p className="text-xs">パスワードを付けています（開くときに入力）</p>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => call({ action: "configure", clear_password: true }, "パスワードを外しました")}>外す</Button>
                </div>
              ) : <p className="text-xs text-muted-foreground">付けていません（URL だけで開けます）</p>}
              <div className="flex gap-2">
                <Input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={share.has_password ? "新しいパスワード" : "4 文字以上"} className="text-xs" />
                <Button size="sm" disabled={busy || password.length < 4} onClick={() => call({ action: "configure", password }, "パスワードを設定しました").then(() => setPassword(""))}>設定</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">パスワードは保存後は見られません。クライアントにはメールなど URL と別の方法で伝えてください。</p>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium flex items-center gap-1.5"><CalendarClock className="w-4 h-4" /> 期限（任意）</p>
              <div className="flex items-center gap-2">
                <Input type="date" defaultValue={share.expires_at || ""} key={share.expires_at || "none"} className="text-xs w-44" onBlur={(e) => (e.target.value || null) !== (share.expires_at || null) && call({ action: "configure", expires_at: e.target.value || null }, e.target.value ? "期限を設定しました" : "期限を外しました")} />
                {share.expires_at && <Button size="sm" variant="ghost" disabled={busy} onClick={() => call({ action: "configure", expires_at: null }, "期限を外しました")}>外す</Button>}
              </div>
              <p className="text-[11px] text-muted-foreground">{share.expires_at ? `${jpDate(share.expires_at)}まで見られます` : "期限なし"}</p>
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <p className="text-[11px] text-muted-foreground">URL を作り直すと、前の URL は開けなくなります</p>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => window.confirm("URL を作り直しますか？前の URL は開けなくなります") && call({ action: "regenerate" }, "URL を作り直しました")}><RefreshCw className="w-3.5 h-3.5" /> 作り直す</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
