import { useRef, useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BookOpen, Loader2, Upload, AlertTriangle, ImagePlus, X } from "lucide-react";
import { BANK_LABELS, BANK_CODES, rowsFromPassbook } from "@/lib/bankImport";
import { readPassbook } from "@/lib/passbook";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const MAX_FILES = 5;
const toInt = (v) => Math.round(Number(String(v).replace(/[,\s]/g, "")) || 0);

/**
 * 通帳の画像から明細を取り込む（大東銀行など、CSV が出せない口座向け）
 *   画像を AI に読ませ、行ごとに確認・修正してから bank_transactions に入れる。
 *   同じ行（銀行・日付・摘要・金額・残高が同じ）は二重に入らない。
 */
export default function PassbookImportDialog({ open, onOpenChange, userId, onDone }) {
  const [bank, setBank] = useState("daito");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState(null); // { bank_name, account_label, lines, notes }
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  const setList = (next) => { setFiles(next); setPreviews(next.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null))); };
  const pick = (list) => {
    const picked = Array.from(list || []).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (picked.length === 0) { toast.error("通帳の写真（JPG・PNG）か PDF を選んでください"); return; }
    setList([...files, ...picked].slice(0, MAX_FILES));
    if (inputRef.current) inputRef.current.value = "";
  };

  const read = async () => {
    if (files.length === 0) return;
    setReading(true);
    try {
      const r = await readPassbook(files);
      if (r.lines.length === 0) toast.error("明細の行を読み取れませんでした。ページ全体が写るように撮り直してください");
      if (/東邦/.test(r.bank_name)) setBank("toho"); else if (/琉球/.test(r.bank_name)) setBank("ryukyu"); else if (/大東/.test(r.bank_name)) setBank("daito");
      setResult(r);
    } catch (e) { toast.error("読み取れませんでした: " + (e?.message || e)); }
    finally { setReading(false); }
  };

  const patch = (id, data) => setResult((r) => ({ ...r, lines: r.lines.map((l) => (l.id === id ? { ...l, ...data } : l)) }));
  const lines = result?.lines || [];
  const isWarn = (l) => l.include && (l.kind === "unclear" || l.balance_ok === false || !l.transaction_date);
  const included = lines.filter((l) => l.include && l.transaction_date && (l.amount_in || l.amount_out));
  const unclear = lines.filter(isWarn);

  const doImport = async () => {
    if (included.length === 0) return;
    if (unclear.length > 0 && !window.confirm(`読み取りが怪しい行が ${unclear.length} 行あります（黄色の行）。このまま取り込みますか？`)) return;
    setSaving(true);
    try {
      const label = result.account_label ? `${BANK_LABELS[bank]} ${result.account_label}` : "";
      const rows = await rowsFromPassbook(bank, included.map((l) => ({ transaction_date: l.transaction_date, payee_raw: l.payee_raw, amount_in: l.amount_in, amount_out: l.amount_out, balance: l.balance || null })), label);
      const existing = await db.entities.BankTransaction.whereIn("source_hash", rows.map((r) => r.source_hash));
      const known = new Set(existing.map((r) => r.source_hash));
      const fresh = rows.filter((r) => !known.has(r.source_hash)).map((r) => ({ ...r, imported_by: userId || null }));
      if (fresh.length > 0) await db.entities.BankTransaction.createMany(fresh);
      toast.success(`${BANK_LABELS[bank]}の明細を取り込みました（新規 ${fresh.length}件・取込済み ${rows.length - fresh.length}件）`);
      onDone();
      onOpenChange(false);
      setList([]); setResult(null);
    } catch (e) { toast.error("取り込めませんでした: " + e.message); }
    finally { setSaving(false); }
  };

  const numCell = (l, key, abs = true) => (
    <Input value={l[key] || ""} onChange={(e) => patch(l.id, { [key]: abs ? Math.abs(toInt(e.target.value)) : toInt(e.target.value) })} inputMode="numeric" className="h-7 text-xs text-right tabular-nums" aria-label={key === "amount_out" ? "出金" : key === "amount_in" ? "入金" : "残高"} />
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!reading && !saving) onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5" /> 通帳の画像から取り込む</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm min-w-0">
          <p className="text-xs text-muted-foreground">CSV が出せない口座（大東銀行など）は、通帳のページを撮影・スキャンした画像を入れてください。AI が日付・摘要・出金・入金・残高を読み取ります。残高のつながりが合わない行は黄色になるので、通帳と見比べて直してから取り込んでください。</p>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">銀行</Label>
            <select value={bank} onChange={(e) => setBank(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="銀行">
              {BANK_CODES.map((b) => <option key={b} value={b}>{BANK_LABELS[b]}</option>)}
            </select>
            <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={() => inputRef.current?.click()} disabled={reading}><ImagePlus className="w-4 h-4" /> 通帳の写真を選ぶ</Button>
            <Button type="button" size="sm" className="h-9 gap-1" onClick={read} disabled={files.length === 0 || reading}>{reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {reading ? "読み取り中…" : "読み取る"}</Button>
            <span className="text-[11px] text-muted-foreground">最大 {MAX_FILES} 枚。文字がはっきり写るように、ページ全体を正面から</span>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative rounded border bg-muted/30 p-1">
                  {previews[i] ? <img src={previews[i]} alt={f.name} className="h-24 w-auto object-contain" /> : <div className="h-24 w-20 flex items-center justify-center text-[10px] text-muted-foreground">{f.name}</div>}
                  <button type="button" onClick={() => setList(files.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 rounded-full bg-background border p-0.5" aria-label="外す"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs border-b bg-muted/40">
                <span className="font-semibold">読み取った行 {lines.length}</span>
                <span>取り込む {included.length} 行</span>
                {result.bank_name && <span className="text-muted-foreground">{result.bank_name} {result.account_label}</span>}
                {unclear.length > 0 && <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 確認が必要な行 {unclear.length}</span>}
                {result.notes && <span className="text-amber-700">{result.notes}</span>}
              </div>
              <div className="max-h-[45vh] overflow-auto">
                <table className="w-full text-xs table-fixed">
                  <thead className="sticky top-0 bg-slate-800 text-white">
                    <tr><th className="w-8"></th><th className="text-left px-2 py-1.5 w-32">日付</th><th className="text-left px-2 py-1.5">摘要</th><th className="text-right px-2 py-1.5 w-28">出金</th><th className="text-right px-2 py-1.5 w-28">入金</th><th className="text-right px-2 py-1.5 w-32">残高</th><th className="w-20 px-1 py-1.5 text-left">状態</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className={`border-t ${!l.include ? "opacity-50" : isWarn(l) ? "bg-amber-50" : ""}`}>
                        <td className="px-2 py-1 text-center"><input type="checkbox" checked={l.include} onChange={(e) => patch(l.id, { include: e.target.checked })} aria-label="取り込む" /></td>
                        <td className="px-2 py-1"><Input type="date" value={l.transaction_date} onChange={(e) => patch(l.id, { transaction_date: e.target.value })} className="h-7 text-xs px-1" aria-label="日付" /></td>
                        <td className="px-2 py-1"><Input value={l.payee_raw} onChange={(e) => patch(l.id, { payee_raw: e.target.value })} className="h-7 text-xs" aria-label="摘要" /></td>
                        <td className="px-2 py-1">{numCell(l, "amount_out")}</td>
                        <td className="px-2 py-1">{numCell(l, "amount_in")}</td>
                        <td className="px-2 py-1">{numCell(l, "balance", false)}</td>
                        <td className="px-1 py-1 text-[10px]">{l.kind === "carryover" ? "繰越" : l.kind === "unclear" ? <span className="text-amber-700">不鮮明</span> : l.balance_ok === false ? <span className="text-amber-700">残高不一致</span> : l.balance_ok ? <span className="text-emerald-700">OK</span> : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">繰越の行は残高の確認用で、明細としては取り込みません。取り込む行の合計: 入金 {yen(included.reduce((s, l) => s + l.amount_in, 0))} ／ 出金 {yen(included.reduce((s, l) => s + l.amount_out, 0))}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reading || saving}>キャンセル</Button>
          <Button onClick={doImport} disabled={included.length === 0 || reading || saving} className="gap-1.5">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {included.length} 行を取り込む</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
