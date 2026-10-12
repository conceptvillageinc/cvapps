import { useEffect, useMemo, useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Tags, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { BILL_TO } from "@/lib/payables";
import { importBatches } from "@/lib/cardCharges";
import { CARD_BRANDS } from "@/lib/usePayablesAccess";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const entityLabel = (code) => BILL_TO.find((b) => b.code === code)?.label || code;
const fmtAt = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const ym = (m) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;

/**
 * すでに取り込んだカード明細の種類（MF / JCB / VISA）を、取り込みのまとまりごとに決める（daichi だけ）。
 *   まとまり = 同じ会社・カード名で、続けて取り込んだ明細（CSV 1 回分）。
 *   決めるまでは daichi だけが見られ、MF にすると hinako も見られるようになる。
 */
export default function CardBrandClassifyDialog({ open, onOpenChange, rows, onDone }) {
  const batches = useMemo(() => importBatches(rows), [rows]);
  const [choice, setChoice] = useState({}); // batch key → brand
  const [openKey, setOpenKey] = useState(null);
  const [saving, setSaving] = useState(null); // { done, total }

  // 開いたときは推し量った種類を入れておく（決めるのは「保存」を押したとき）
  useEffect(() => {
    if (open) setChoice((prev) => Object.fromEntries(batches.map((b) => [b.key, b.key in prev ? prev[b.key] : b.guess])));
    else setChoice({});
  }, [open, batches]);

  const chosen = batches.filter((b) => choice[b.key]);
  const count = chosen.reduce((s, b) => s + b.rows.length, 0);

  const save = async () => {
    const todo = chosen.flatMap((b) => b.rows.map((r) => ({ id: r.id, brand: choice[b.key] })));
    if (todo.length === 0) return;
    setSaving({ done: 0, total: todo.length });
    try {
      for (let i = 0; i < todo.length; i += 10) {
        const chunk = todo.slice(i, i + 10);
        await Promise.all(chunk.map((t) => db.entities.CardCharge.update(t.id, { card_brand: t.brand })));
        setSaving({ done: Math.min(i + 10, todo.length), total: todo.length });
      }
      toast.success(`${todo.length} 件の明細の種類を決めました`);
      onDone(); onOpenChange(false);
    } catch (e) { toast.error("保存できませんでした: " + e.message); onDone(); }
    finally { setSaving(null); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="card-classify-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Tags className="w-5 h-5" /> 取り込んだカード明細の種類を決める</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm min-w-0">
          <p className="text-xs text-muted-foreground">これまでに取り込んだ明細を、取り込み 1 回ごとにまとめています。どのカードの明細か選んで「保存」してください。<b>MF</b> にした明細は hinako も見られるようになり、<b>JCB・VISA</b> は daichi だけのままです。カード名などから推し量った種類を最初に入れてあります（決めるのは保存したとき）。</p>
          {batches.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">種類が決まっていない明細はありません</p>
          ) : (
            <div className="rounded-lg border divide-y">
              {batches.map((b) => {
                const isOpen = openKey === b.key;
                return (
                  <div key={b.key} data-testid="card-classify-batch">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <button type="button" className="text-muted-foreground" onClick={() => setOpenKey(isOpen ? null : b.key)} aria-label="明細を見る">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {b.card_label || "（カード名なし）"}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{entityLabel(b.entity)}・{b.source === "ocr" ? "写真から読み取り" : b.source === "csv" ? "CSV" : b.source}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          取り込み {fmtAt(b.importedAt)}{"　"}利用月 {b.months.length > 2 ? `${ym(b.months[0])}〜${ym(b.months[b.months.length - 1])}` : b.months.map(ym).join("・")}{"　"}<b className="text-foreground">{b.rows.length} 件</b> {yen(b.total)}
                          {b.holders.length > 0 && <>{"　"}利用者 {b.holders.slice(0, 3).join("・")}{b.holders.length > 3 ? " ほか" : ""}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1" role="radiogroup" aria-label="カードの種類">
                        {CARD_BRANDS.map((br) => (
                          <button key={br.key} type="button" role="radio" aria-checked={choice[b.key] === br.key} onClick={() => setChoice({ ...choice, [b.key]: choice[b.key] === br.key ? "" : br.key })}
                            className={`rounded-md border px-2.5 py-1 text-xs ${choice[b.key] === br.key ? `${br.cls} ring-2 ring-primary/40 font-semibold` : "bg-white text-muted-foreground hover:bg-muted/50"}`}>
                            {br.short}
                          </button>
                        ))}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="px-10 pb-2">
                        <table className="w-full text-xs">
                          <tbody>
                            {b.rows.slice(0, 50).map((r) => (
                              <tr key={r.id} className="border-t"><td className="py-0.5 w-24 tabular-nums">{String(r.charged_at).replace(/-/g, "/")}</td><td className="py-0.5">{r.merchant}</td><td className="py-0.5 w-24 text-right tabular-nums">{yen(r.amount)}</td><td className="py-0.5 w-28 pl-3 text-muted-foreground">{r.holder || ""}</td></tr>
                            ))}
                          </tbody>
                        </table>
                        {b.rows.length > 50 && <p className="text-[11px] text-muted-foreground mt-1">ほか {b.rows.length - 50} 件</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>閉じる</Button>
          <Button onClick={save} disabled={count === 0 || !!saving} className="gap-1.5" data-testid="card-classify-save">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中 {saving.done}/{saving.total}</> : <>種類を決めた {chosen.length} 回分（{count} 件）を保存</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
