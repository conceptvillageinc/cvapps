import { useMemo, useRef, useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileUp, Loader2, Upload, CheckCircle2, AlertTriangle, FileText, X } from "lucide-react";
import {
  PAY_ENTITIES, BILL_TO, extractInvoices, invoicesToRows, mergePayableRow, monthLabel, nextMonth, thisMonth, toAmount,
} from "@/lib/payables";

const MAX_FILES = 30;
const MAX_BYTES = 20 * 1024 * 1024;
const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/**
 * 請求書を読み込む
 *   スキャンした請求書（PDF／画像、1 ファイルに複数通でも可）を 1 ファイルずつ AI に読ませ、
 *   支払い先・宛先（どの会社宛か）・金額・振込先・支払期限を取り出す。確認・修正してから
 *   「支払い先ごとに 1 行」にまとめて、その月の支払い一覧に入れる。
 */
export default function InvoiceImportDialog({ open, onOpenChange, month, existing, payees, onDone }) {
  const [payMonth, setPayMonth] = useState(month || nextMonth(thisMonth()));
  const [files, setFiles] = useState([]); // { name, size, status: wait|busy|done|error, count, error, notes }
  const [invoices, setInvoices] = useState([]);
  const [reading, setReading] = useState(false);
  const [mode, setMode] = useState("append"); // append | replace
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const payeeNames = useMemo(() => payees.map((p) => p.name), [payees]);

  // ダイアログを開くたびに支払月は画面の月に合わせる
  const [lastMonth, setLastMonth] = useState(month);
  if (month !== lastMonth) { setLastMonth(month); setPayMonth(month); }

  const read = async (list) => {
    const picked = Array.from(list || []).filter((f) => f.type === "application/pdf" || f.type.startsWith("image/"));
    if (picked.length === 0) { toast.error("PDF または画像（JPG・PNG）を選んでください"); return; }
    if (files.length + picked.length > MAX_FILES) { toast.error(`一度に読み込めるのは ${MAX_FILES} ファイルまでです`); return; }
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) { toast.error(`「${tooBig.name}」は 20MB を超えています。分けてスキャンしてください`); return; }
    const start = files.length;
    setFiles((cur) => [...cur, ...picked.map((f) => ({ name: f.name, size: f.size, status: "wait", count: 0 }))]);
    setReading(true);
    try {
      for (const [i, f] of picked.entries()) {
        const idx = start + i;
        setFiles((cur) => cur.map((x, j) => (j === idx ? { ...x, status: "busy" } : x)));
        try {
          const r = await extractInvoices(f, { db });
          setInvoices((cur) => [...cur, ...r.invoices]);
          setFiles((cur) => cur.map((x, j) => (j === idx ? { ...x, status: "done", count: r.invoices.length, notes: r.notes } : x)));
        } catch (e) {
          setFiles((cur) => cur.map((x, j) => (j === idx ? { ...x, status: "error", error: e?.message || String(e) } : x)));
        }
      }
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const patch = (id, data) => setInvoices((cur) => cur.map((v) => (v.id === id ? { ...v, ...data } : v)));
  const removeInv = (id) => setInvoices((cur) => cur.filter((v) => v.id !== id));

  const rows = useMemo(() => invoicesToRows(invoices), [invoices]);
  const included = invoices.filter((v) => v.include);
  const problems = included.filter((v) => !v.payee_name || !v.amount || !v.bill_to);

  const reset = () => { setFiles([]); setInvoices([]); };

  const doImport = async () => {
    if (rows.length === 0) return;
    if (problems.length > 0 && !window.confirm(`会社名・金額・宛先が空の請求書が ${problems.length} 件あります。このまま取り込みますか？（宛先が空の分は CV の金額になります）`)) return;
    setSaving(true);
    try {
      // 1) 支払い先マスタ: 無ければ作る。振込先が空なら請求書の振込先で埋める
      const byName = new Map(payees.map((p) => [p.name, p]));
      let order = payees.length;
      for (const r of rows) {
        const ex = byName.get(r.payee_name);
        if (!ex) {
          const created = await db.entities.Payee.create({ name: r.payee_name, bank_info: r.bank_info || null, sort_order: order++ });
          byName.set(r.payee_name, created);
        } else if (r.bank_info && !ex.bank_info) {
          await db.entities.Payee.update(ex.id, { bank_info: r.bank_info });
          byName.set(r.payee_name, { ...ex, bank_info: r.bank_info });
        }
      }
      // 2) その月の一覧
      const sameMonth = payMonth === month ? existing : await db.entities.Payable.filter({ pay_month: payMonth }, "sort_order");
      if (mode === "replace") for (const x of sameMonth) await db.entities.Payable.delete(x.id);
      const current = mode === "replace" ? [] : sameMonth;
      const curByName = new Map(current.map((x) => [x.payee_name, x]));
      let created = 0; let merged = 0;
      for (const [i, r] of rows.entries()) {
        const p = byName.get(r.payee_name);
        const ex = curByName.get(r.payee_name);
        if (ex) {
          const m = mergePayableRow(ex, r);
          await db.entities.Payable.update(ex.id, {
            bank_info: m.bank_info, due_date: m.due_date, file_paths: m.file_paths, invoices: m.invoices, memo: m.memo,
            ...Object.fromEntries(PAY_ENTITIES.map((e) => [e.key, m[e.key]])),
          });
          merged++;
        } else {
          await db.entities.Payable.create({
            pay_month: payMonth, payee_id: p?.id || null, payee_name: r.payee_name, bank_info: r.bank_info || p?.bank_info || null,
            amount_coolagri: r.amount_coolagri, amount_cvdigital: r.amount_cvdigital, amount_cv: r.amount_cv,
            paid: false, memo: r.memo || null, due_date: r.due_date || null, file_paths: r.file_paths, invoices: r.invoices,
            sort_order: current.length + i,
          });
          created++;
        }
      }
      toast.success(`${monthLabel(payMonth)}に ${created} 件を追加${merged ? `、${merged} 件に足し込み` : ""}ました（請求書 ${included.length} 通）`);
      onDone(payMonth);
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error("取り込めませんでした: " + e.message);
      onDone();
    } finally { setSaving(false); }
  };

  const total = included.reduce((s, v) => s + (v.amount || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!reading && !saving) onOpenChange(v); }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> 請求書を読み込む</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm min-w-0">
          <p className="text-xs text-muted-foreground">
            スキャンした請求書の PDF（1 ファイルに何通入っていても可）や写真を入れると、AI が支払い先・宛先（Cool Agri／CV digital／CV のどの会社宛か）・金額（税込）・振込先・支払期限を読み取ります。内容を確認・修正してから取り込んでください。
          </p>

          <div
            className={`rounded-lg border border-dashed p-4 transition-colors ${over ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!reading) read(e.dataTransfer.files); }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" className="h-9 gap-1.5" disabled={reading || saving} onClick={() => inputRef.current?.click()}>
                {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} {reading ? "読み取り中…" : "請求書の PDF・画像を選ぶ"}
              </Button>
              <span className="text-xs text-muted-foreground">ここにドロップもできます。1 ファイル 20MB まで、1 通あたり 10 秒ほどかかります</span>
              <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => read(e.target.files)} />
            </div>
            {files.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {f.status === "busy" ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> : f.status === "done" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : f.status === "error" ? <AlertTriangle className="w-3.5 h-3.5 text-red-600" /> : <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="font-medium truncate max-w-[320px]">{f.name}</span>
                    <span className="text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    {f.status === "done" && <span className="text-emerald-700">請求書 {f.count} 通</span>}
                    {f.status === "done" && f.count === 0 && <span className="text-amber-700">請求書が見つかりませんでした</span>}
                    {f.status === "error" && <span className="text-red-700">{f.error}</span>}
                    {f.notes && <span className="text-amber-700">{f.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {invoices.length > 0 && (
            <div className="rounded-lg border min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs border-b bg-muted/40">
                <span className="font-semibold">読み取った請求書 {invoices.length} 通</span>
                <span>取り込む {included.length} 通 ／ 合計 {yen(total)}</span>
                {problems.length > 0 && <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 会社名・金額・宛先を確認してください（{problems.length} 件）</span>}
                <div className="flex-1" />
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={reset} disabled={reading || saving}>すべて消す</Button>
              </div>
              <div className="max-h-[40vh] overflow-auto">
                <table className="w-full table-fixed text-xs">
                  <thead className="sticky top-0 bg-slate-800 text-white">
                    <tr>
                      <th className="px-2 py-1.5 w-8"></th>
                      <th className="text-left px-2 py-1.5 w-44">支払い先（発行元）</th>
                      <th className="text-left px-2 py-1.5 w-28">宛先（支払元）</th>
                      <th className="text-right px-2 py-1.5 w-24">金額（税込）</th>
                      <th className="text-left px-2 py-1.5 w-[8.5rem]">請求日</th>
                      <th className="text-left px-2 py-1.5 w-[8.5rem]">支払期限</th>
                      <th className="text-left px-2 py-1.5">件名・No.</th>
                      <th className="text-left px-2 py-1.5">振込先</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((v) => {
                      const bad = v.include && (!v.payee_name || !v.amount || !v.bill_to);
                      return (
                        <tr key={v.id} className={`border-t ${!v.include ? "opacity-50" : bad ? "bg-amber-50" : ""}`}>
                          <td className="px-2 py-1 text-center"><input type="checkbox" checked={v.include} onChange={(e) => patch(v.id, { include: e.target.checked })} aria-label="取り込む" /></td>
                          <td className="px-2 py-1">
                            <Input list="inv-payee-names" value={v.payee_name} onChange={(e) => patch(v.id, { payee_name: e.target.value })} className="h-7 text-xs" placeholder="会社名" aria-label="支払い先" />
                            <span className="block text-[10px] text-muted-foreground truncate max-w-[220px]">{v.file_name}{v.pages ? ` p.${v.pages}` : ""}</span>
                          </td>
                          <td className="px-2 py-1">
                            <select value={v.bill_to} onChange={(e) => patch(v.id, { bill_to: e.target.value })} className={`h-7 w-full rounded-md border bg-background px-1 text-xs ${!v.bill_to ? "border-amber-400" : ""}`} aria-label="宛先">
                              <option value="">（不明）</option>
                              {BILL_TO.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
                            </select>
                            {v.bill_to_text && <span className="block text-[10px] text-muted-foreground truncate max-w-[120px]" title={v.bill_to_text}>{v.bill_to_text}</span>}
                          </td>
                          <td className="px-2 py-1"><Input value={v.amount ? String(v.amount) : ""} onChange={(e) => patch(v.id, { amount: Math.round(toAmount(e.target.value)) })} inputMode="numeric" className="h-7 text-xs text-right tabular-nums" placeholder="0" aria-label="金額" /></td>
                          <td className="px-2 py-1"><Input type="date" value={v.invoice_date} onChange={(e) => patch(v.id, { invoice_date: e.target.value })} className="h-7 text-xs px-1" aria-label="請求日" /></td>
                          <td className="px-2 py-1"><Input type="date" value={v.due_date} onChange={(e) => patch(v.id, { due_date: e.target.value })} className="h-7 text-xs px-1" aria-label="支払期限" /></td>
                          <td className="px-2 py-1">
                            <Input value={v.subject} onChange={(e) => patch(v.id, { subject: e.target.value })} className="h-7 text-xs" placeholder="件名" aria-label="件名" />
                            <Input value={v.invoice_no} onChange={(e) => patch(v.id, { invoice_no: e.target.value })} className="h-6 text-[10px] mt-0.5" placeholder="請求書 No." aria-label="請求書番号" />
                          </td>
                          <td className="px-2 py-1"><Input value={v.bank_info} onChange={(e) => patch(v.id, { bank_info: e.target.value })} className="h-7 text-xs" placeholder="銀行　支店　種別　口座番号" aria-label="振込先" /></td>
                          <td className="px-1 py-1"><Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => removeInv(v.id)} aria-label="この請求書を外す"><X className="w-3.5 h-3.5" /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <datalist id="inv-payee-names">{payeeNames.map((n) => <option key={n} value={n} />)}</datalist>
              </div>

              <div className="border-t px-3 py-2 space-y-2">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold">一覧に入れる形（支払い先ごとに 1 行、{rows.length} 行）</span>
                  <Label className="text-xs">支払月</Label>
                  <Input type="month" value={payMonth} onChange={(e) => e.target.value && setPayMonth(e.target.value)} className="h-7 w-36 text-xs" aria-label="支払月" />
                  <span className="text-muted-foreground">{monthLabel(payMonth)}（届いた月の翌月末が目安）</span>
                  <div className="flex-1" />
                  <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="inv-mode" checked={mode === "append"} onChange={() => setMode("append")} /> 今の一覧に追加（同じ支払い先は金額を足す）</label>
                  <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="inv-mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> この月の一覧を置き換える</label>
                </div>
                <div className="max-h-40 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-muted/60"><th className="text-left px-2 py-1">会社名</th><th className="text-left px-2 py-1">振込先</th>{PAY_ENTITIES.map((e) => <th key={e.key} className="text-right px-2 py-1">{e.label}</th>)}<th className="text-left px-2 py-1 w-24">支払期限</th><th className="text-left px-2 py-1">メモ（内訳）</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.payee_name} className="border-t">
                          <td className="px-2 py-1 font-medium">{r.payee_name}{payeeNames.includes(r.payee_name) ? "" : <span className="ml-1 text-[10px] text-amber-700">新規</span>}</td>
                          <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">{r.bank_info || payees.find((p) => p.name === r.payee_name)?.bank_info || <span className="opacity-50">（未登録）</span>}</td>
                          {PAY_ENTITIES.map((e) => <td key={e.key} className="px-2 py-1 text-right tabular-nums">{r[e.key] ? r[e.key].toLocaleString() : ""}</td>)}
                          <td className="px-2 py-1">{r.due_date || ""}</td>
                          <td className="px-2 py-1 text-muted-foreground truncate max-w-[260px]" title={r.memo}>{r.memo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reading || saving}>キャンセル</Button>
          <Button onClick={doImport} disabled={rows.length === 0 || reading || saving} className="gap-1.5">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {rows.length} 行を{monthLabel(payMonth)}に取り込む</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
