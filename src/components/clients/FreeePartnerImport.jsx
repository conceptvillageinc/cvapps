import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileUp, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { decodeCsv, parseCsvText } from "@/lib/bankImport";
import { readFreeePartners, matchPartners } from "@/lib/freeePartners";
import { formatPostalCode } from "@/lib/postalCode";

/**
 * クライアント一覧の「freee の取引先 CSV から郵便番号・住所を補う」。
 *   CSV を選ぶ → 埋める内容を一覧で確認 → チェックした行だけ保存する。CSV は保存しない。
 */
export default function FreeePartnerImport({ open, onOpenChange, clients }) {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [result, setResult] = useState(null); // { file, proposals, unmatched, partners }
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const close = (v) => { if (busy) return; onOpenChange(v); if (!v) { setResult(null); setPicked(new Set()); } };

  const read = async (file) => {
    if (!file) return;
    try {
      const { partners, error } = readFreeePartners(parseCsvText(await decodeCsv(file)));
      if (error) { toast.error(error); return; }
      const { proposals, unmatched } = matchPartners(clients, partners);
      setResult({ file: file.name, proposals, unmatched, partners: partners.length });
      setPicked(new Set(proposals.map((p) => p.client.id)));
    } catch (e) {
      toast.error("CSV を読めませんでした: " + e.message);
    }
  };

  const apply = async () => {
    const rows = result.proposals.filter((p) => picked.has(p.client.id));
    if (rows.length === 0) return;
    setBusy(true);
    let done = 0;
    try {
      for (const p of rows) {
        const patch = {};
        if (p.postal) patch.postal_code = p.postal;
        if (p.address) patch.address = p.address;
        await db.entities.Client.update(p.client.id, patch);
        done += 1;
      }
      toast.success(`${done} 件のクライアントに郵便番号・住所を入れました`);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      close(false);
    } catch (e) {
      toast.error(`${done} 件まで保存しました。残りは保存できませんでした: ${e.message}`);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const postalCount = result ? result.proposals.filter((p) => picked.has(p.client.id) && p.postal).length : 0;
  const addressCount = result ? result.proposals.filter((p) => picked.has(p.client.id) && p.address).length : 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl" data-testid="freee-partner-import">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" /> freee の取引先 CSV から郵便番号・住所を補う</DialogTitle>
          <DialogDescription className="text-xs">
            freee（会計・販売）の「取引先」から書き出した CSV を選ぶと、クライアント名で突き合わせて、空になっている郵便番号・住所だけを埋めます。入っている値は変えません。CSV はこの画面で読むだけで、アプリには保存しません
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ""; }} data-testid="freee-partner-file" />
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => inputRef.current?.click()} disabled={busy}><FileUp className="w-4 h-4" /> 取引先の CSV を選ぶ</Button>
          {result && <span className="text-xs text-muted-foreground">{result.file}（取引先 {result.partners} 件）</span>}
        </div>

        {result && (
          result.proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-md bg-muted/30 px-3 py-4 text-center">埋められるクライアントはありませんでした{result.unmatched ? `（郵便番号か住所が空で、CSV に同じ名前の取引先が無いクライアント ${result.unmatched} 件）` : ""}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs">
                <b>{result.proposals.length} 件</b>のクライアントに入れられます（郵便番号 {postalCount} 件・住所 {addressCount} 件）。
                {result.unmatched > 0 && <span className="text-muted-foreground">CSV に同じ名前の取引先が無いクライアントが {result.unmatched} 件あります（そのまま）</span>}
              </p>
              <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="w-8 px-2 py-1.5"><Checkbox checked={picked.size === result.proposals.length} onCheckedChange={(v) => setPicked(v ? new Set(result.proposals.map((p) => p.client.id)) : new Set())} aria-label="すべて選ぶ" /></th>
                      <th className="text-left px-2 py-1.5 font-medium">クライアント</th>
                      <th className="text-left px-2 py-1.5 font-medium w-24">郵便番号</th>
                      <th className="text-left px-2 py-1.5 font-medium">住所</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.proposals.map((p) => (
                      <tr key={p.client.id} className="border-t align-top" data-testid="freee-partner-row">
                        <td className="px-2 py-1.5"><Checkbox checked={picked.has(p.client.id)} onCheckedChange={() => toggle(p.client.id)} aria-label={`${p.client.name} に入れる`} /></td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{p.client.name}</div>
                          {p.partnerName !== p.client.name && <div className="text-[10px] text-muted-foreground">freee: {p.partnerName}</div>}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{p.postal ? formatPostalCode(p.postal) : <span className="text-muted-foreground">{p.client.postal_code ? formatPostalCode(p.client.postal_code) : "—"}（そのまま）</span>}</td>
                        <td className="px-2 py-1.5">{p.address || <span className="text-muted-foreground">{p.client.address || "—"}（そのまま）</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => close(false)} disabled={busy}>閉じる</Button>
          {result && result.proposals.length > 0 && (
            <Button type="button" size="sm" className="gap-1.5" onClick={apply} disabled={busy || picked.size === 0} data-testid="freee-partner-apply">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />} {picked.size} 件に入れる
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
