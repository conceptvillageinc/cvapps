import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ImagePlus, X, ExternalLink, PackageCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { orderItems } from "@/lib/printOrders";
import PrintOrderItems from "@/components/printOrders/PrintOrderItems";

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

function useSigned(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    db.storage.signedUrl(path).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [path]);
  return url;
}

/**
 * 入稿記録の入力（新しく記録する／直す）。
 *   品名・枚数・金額・原価・仕入先は明細から自動で入り、入稿日・入稿先 URL・スクショ・メモを入れる。
 * @param {object} p
 * @param {object|null} p.order   記録（新規なら orderFromLine の値、既存なら print_orders の行）
 * @param {(saved: object) => void} [p.onSaved]
 */
export default function PrintOrderDialog({ open, onOpenChange, order, onSaved }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(order);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (open) setForm(order); }, [open, order]);
  const shotUrl = useSigned(form?.screenshot_path);
  if (!form) return null;
  const isNew = !form.id;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const upload = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast.error("20MB を超えるファイルは付けられません"); return; }
    setUploading(true);
    try {
      const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || [file.type === "image/png" ? ".png" : ".jpg"])[0].toLowerCase();
      const path = `print-orders/${form.estimate_id || "none"}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
      await db.integrations.Core.UploadFile({ file, path });
      set({ screenshot_path: path });
    } catch (e) {
      toast.error("スクショを付けられませんでした: " + e.message);
    } finally {
      setUploading(false);
    }
  };
  const onPaste = (e) => {
    const f = Array.from(e.clipboardData?.items || []).find((it) => it.kind === "file")?.getAsFile();
    if (f) { e.preventDefault(); upload(f); }
  };

  const save = async () => {
    if (!form.ordered_on) { toast.error("入稿日を入れてください"); return; }
    setBusy(true);
    try {
      const saved = isNew ? await db.entities.PrintOrder.create(form) : await db.entities.PrintOrder.update(form.id, form);
      toast.success(isNew ? "入稿記録を残しました" : "入稿記録を直しました");
      queryClient.invalidateQueries({ queryKey: ["printOrders"] });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      toast.error("保存できませんでした: " + e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm("この入稿記録を削除しますか？")) return;
    setBusy(true);
    try {
      await db.entities.PrintOrder.delete(form.id);
      toast.success("入稿記録を削除しました");
      queryClient.invalidateQueries({ queryKey: ["printOrders"] });
      onSaved?.(null);
      onOpenChange(false);
    } catch (e) {
      toast.error("削除できませんでした: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onPaste={onPaste} data-testid="print-order-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageCheck className="w-5 h-5 text-teal-700" /> {isNew ? "入稿した明細を記録" : "入稿記録"}</DialogTitle>
          <DialogDescription className="text-xs">この明細の品名・枚数・金額で入稿したことを残します。追加印刷のときに、入稿履歴から同じ内容で見積を作れます</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-0.5">
          <p className="font-medium">{form.name || "（品名なし）"}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {orderItems(form).length > 0 ? (
              <>{form.quantity != null ? `${Number(form.quantity).toLocaleString()}${form.unit || ""}　` : ""}合計 <b className="text-foreground">{yen(form.amount)}</b></>
            ) : (
              <>{form.quantity != null ? `${Number(form.quantity).toLocaleString()}${form.unit || ""}` : ""} × {yen(form.unit_price)} ＝ <b className="text-foreground">{yen(form.amount)}</b>
                {form.cost_price != null && <>　原価単価 {yen(form.cost_price)}</>}</>
            )}
            {form.vendor && <>　仕入先 {form.vendor}</>}
          </p>
          <PrintOrderItems order={form} className="pt-0.5" />
          {form.estimate_number && <p className="text-[11px] text-muted-foreground">見積 {form.estimate_number}{form.client_name ? `・${form.client_name}` : ""}</p>}
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">入稿日</Label>
            <Input type="date" value={form.ordered_on || ""} onChange={(e) => set({ ordered_on: e.target.value })} className="h-9 w-44" aria-label="入稿日" />
            <Label className="text-xs">入稿先 URL</Label>
            <div className="flex items-center gap-1.5">
              <Input value={form.source_url || ""} onChange={(e) => set({ source_url: e.target.value })} placeholder="https://（ネット印刷の注文ページなど）" className="h-9 text-xs" aria-label="入稿先 URL" />
              {form.source_url && <a href={form.source_url} target="_blank" rel="noreferrer" className="shrink-0 text-primary" title="開く"><ExternalLink className="w-4 h-4" /></a>}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">スクショ（注文画面・入稿データなど）</Label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer?.files?.[0]); }}
              className="rounded-md border border-dashed p-2 flex items-center gap-2"
            >
              <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
              {form.screenshot_path ? (
                <>
                  <a href={shotUrl || "#"} target="_blank" rel="noreferrer" className="shrink-0">
                    {shotUrl && /\.(png|jpe?g|gif|webp)$/i.test(form.screenshot_path) ? <img src={shotUrl} alt="スクショ" className="h-16 w-auto rounded border bg-white" /> : <span className="text-xs text-primary underline">スクショを開く</span>}
                  </a>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => set({ screenshot_path: null })}><X className="w-3.5 h-3.5" /> 外す</Button>
                </>
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} 画像を選ぶ
                </Button>
              )}
              <span className="text-[10.5px] text-muted-foreground">ドラッグ＆ドロップ、または Ctrl+V（⌘+V）で貼り付けもできます</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">メモ</Label>
            <Textarea value={form.memo || ""} onChange={(e) => set({ memo: e.target.value })} rows={2} placeholder="例: 入稿データは〇〇フォルダ／色校あり／特急で依頼" className="text-xs" aria-label="メモ" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {!isNew ? <Button type="button" variant="ghost" size="sm" className="text-destructive gap-1" onClick={remove} disabled={busy}><Trash2 className="w-3.5 h-3.5" /> 削除</Button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>キャンセル</Button>
            <Button type="button" size="sm" className="gap-1 bg-teal-700 hover:bg-teal-800" onClick={save} disabled={busy || uploading}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />} {isNew ? "入稿記録を残す" : "保存"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
