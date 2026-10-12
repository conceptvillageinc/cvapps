import { useMemo, useRef, useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Camera, Loader2, Upload, Plus, Trash2, AlertTriangle, ImagePlus } from "lucide-react";
import { BILL_TO } from "@/lib/payables";
import { CARD_OCR_PROMPT, CARD_OCR_SCHEMA, ocrRowsFromResult, ocrRowToCharge, shrinkImage, existingFingerprints } from "@/lib/cardCharges";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const MAX_PHOTOS = 10;

/**
 * VISA（紙の利用明細）を写真から読み取って取り込む。
 *   1. 明細の写真を選ぶ（何枚でも。1 枚ずつ読み取る）
 *   2. 読み取った行を表で確かめ、直す（日付・利用先・金額・利用者。要らない行は外す）
 *   3. 取り込む（種類は VISA。同じ明細は二重に入らない）
 *   写真は読み取りが終わったら保管庫から消す（カードの情報を残さない）。
 */
export default function CardOcrDialog({ open, onOpenChange, month, onDone }) {
  const [statementMonth, setStatementMonth] = useState(month);
  const [entity, setEntity] = useState("cv");
  const [cardLabel, setCardLabel] = useState("VISA");
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState([]);
  const [progress, setProgress] = useState(null); // { done, total }
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const reset = () => { setRows([]); setNotes([]); setProgress(null); };
  const close = (v) => { if (!v && (progress || saving)) return; onOpenChange(v); if (!v) reset(); };

  const pick = async (e) => {
    const files = [...(e.target.files || [])].slice(0, MAX_PHOTOS);
    e.target.value = "";
    if (files.length === 0) return;
    setProgress({ done: 0, total: files.length });
    const added = []; const msgs = [];
    for (const [i, f] of files.entries()) {
      let path = null;
      try {
        const file = await shrinkImage(f);
        ({ file_url: path } = await db.integrations.Core.UploadFile({ file }));
        const res = await db.integrations.Core.InvokeLLM({ prompt: CARD_OCR_PROMPT, file_urls: [path], response_json_schema: CARD_OCR_SCHEMA });
        const sm = /^\d{4}-\d{2}$/.test(res?.statement_month || "") ? res.statement_month : statementMonth;
        const got = ocrRowsFromResult(res, { statementMonth: sm, fileName: f.name });
        added.push(...got);
        if (res?.notes) msgs.push(`${f.name}: ${res.notes}`);
        if (got.length === 0) msgs.push(`${f.name}: 利用明細の行が見つかりませんでした`);
      } catch (err) {
        msgs.push(`${f.name}: 読み取れませんでした（${err.message}）`);
      } finally {
        if (path) db.storage.remove([path]).catch(() => {}); // 写真は残さない
        setProgress({ done: i + 1, total: files.length });
      }
    }
    setRows((cur) => [...cur, ...added]);
    setNotes((cur) => [...cur, ...msgs]);
    setProgress(null);
    if (added.length) toast.success(`${added.length} 行を読み取りました。内容を確かめてください`);
  };

  const set = (key, patch) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((cur) => [...cur, { key: `manual#${Date.now()}`, file_name: "手で追加", charged_at: "", merchant: "", amount: 0, holder: "", memo: "", include: true }]);
  const removeRow = (key) => setRows((cur) => cur.filter((r) => r.key !== key));

  const charges = useMemo(() => rows.filter((r) => r.include).map((r) => ({ r, c: ocrRowToCharge(r, { entity, cardLabel }) })), [rows, entity, cardLabel]);
  const valid = charges.filter((x) => x.c).map((x) => x.c);
  const invalid = charges.length - valid.length;
  const total = valid.reduce((s, c) => s + c.amount, 0);
  const months = [...new Set(valid.map((c) => c.charge_month))].sort();

  const doImport = async () => {
    if (valid.length === 0) return;
    setSaving(true);
    try {
      const have = await existingFingerprints(db, valid);
      let added = 0; let dup = 0;
      for (const c of valid) {
        if (have.has(c.fingerprint)) { dup++; continue; }
        await db.entities.CardCharge.create(c);
        have.add(c.fingerprint); added++;
      }
      toast.success(`VISA の明細 ${added} 件を取り込みました${dup ? `（重複 ${dup} 件は飛ばしました）` : ""}`);
      onDone(); onOpenChange(false); reset();
    } catch (e) { toast.error("取り込めませんでした: " + e.message); onDone(); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="card-ocr-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Camera className="w-5 h-5" /> VISA の紙明細を写真から読み取る</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm min-w-0">
          <p className="text-xs text-muted-foreground">利用明細書を 1 ページずつ撮った写真を選んでください（スマホの写真のままで大丈夫です。{MAX_PHOTOS} 枚まで）。読み取った行は下の表で直せます。写真は読み取りが終わったら消し、残しません。この明細は daichi だけが見られます。</p>
          <div className="flex flex-wrap items-end gap-2">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={pick} data-testid="card-ocr-file" />
            <Button size="sm" variant={rows.length ? "outline" : "default"} className="h-9 gap-1" onClick={() => fileRef.current?.click()} disabled={!!progress}>
              {progress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              {progress ? `読み取り中… ${progress.done}/${progress.total} 枚` : rows.length ? "写真を足す" : "写真を選ぶ"}
            </Button>
            <div className="flex-1" />
            <div className="space-y-0.5">
              <Label className="text-[11px]">明細のお支払い月</Label>
              <Input type="month" value={statementMonth} onChange={(e) => setStatementMonth(e.target.value)} className="h-9 w-36" aria-label="明細のお支払い月" />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[11px]">どの会社のカード</Label>
              <select value={entity} onChange={(e) => setEntity(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="会社">
                {BILL_TO.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
              </select>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[11px]">カードの名前</Label>
              <Input value={cardLabel} onChange={(e) => setCardLabel(e.target.value)} className="h-9 w-36" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">利用日に年が書かれていない明細は、お支払い月から年を決めます（お支払い月より後の月は前の年）。写真にお支払い月が写っていればそちらを使います。</p>

          {notes.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-0.5" data-testid="card-ocr-notes">
              {notes.map((n, i) => <p key={i} className="flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {n}</p>)}
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs border-b bg-muted/40">
                <span className="font-semibold">取り込む {valid.length} 件 ／ 合計 {yen(total)}</span>
                {months.length > 0 && <span className="text-muted-foreground">利用月: {months.join("・")}</span>}
                {invalid > 0 && <span className="text-amber-700">日付か金額が無い {invalid} 行は取り込みません</span>}
                <div className="flex-1" />
                <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={addRow}><Plus className="w-3.5 h-3.5" /> 行を足す</Button>
              </div>
              <div className="max-h-[45vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 z-10">
                    <tr>
                      <th className="w-8 px-2 py-1"></th>
                      <th className="text-left px-1 py-1 w-36">利用日</th>
                      <th className="text-left px-1 py-1">利用先</th>
                      <th className="text-right px-1 py-1 w-28">金額（税込）</th>
                      <th className="text-left px-1 py-1 w-28">利用者</th>
                      <th className="text-left px-1 py-1 w-40">メモ</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const bad = r.include && !ocrRowToCharge(r);
                      return (
                        <tr key={r.key} className={`border-t ${r.include ? "" : "opacity-40"} ${bad ? "bg-amber-50" : ""}`} data-testid="card-ocr-row">
                          <td className="px-2 py-0.5 text-center"><input type="checkbox" checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} aria-label="取り込む" /></td>
                          <td className="px-1 py-0.5"><Input type="date" value={r.charged_at} onChange={(e) => set(r.key, { charged_at: e.target.value })} className={`h-7 text-xs ${r.include && !r.charged_at ? "border-amber-400" : ""}`} /></td>
                          <td className="px-1 py-0.5"><Input value={r.merchant} onChange={(e) => set(r.key, { merchant: e.target.value })} className="h-7 text-xs" /></td>
                          <td className="px-1 py-0.5"><Input type="number" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })} className={`h-7 text-xs text-right tabular-nums ${r.include && !Number(r.amount) ? "border-amber-400" : ""}`} /></td>
                          <td className="px-1 py-0.5"><Input value={r.holder} onChange={(e) => set(r.key, { holder: e.target.value })} className="h-7 text-xs" /></td>
                          <td className="px-1 py-0.5"><Input value={r.memo} onChange={(e) => set(r.key, { memo: e.target.value })} className="h-7 text-xs" title={r.file_name} /></td>
                          <td className="px-1 py-0.5"><Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeRow(r.key)} aria-label="行を消す"><Trash2 className="w-3.5 h-3.5" /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={!!progress || saving}>キャンセル</Button>
          <Button onClick={doImport} disabled={valid.length === 0 || saving || !!progress} className="gap-1.5" data-testid="card-ocr-import">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} VISA の明細として {valid.length} 件を取り込む
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
