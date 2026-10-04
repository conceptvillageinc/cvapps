import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BookOpen, Loader2, Upload, AlertTriangle, ImagePlus, X } from "lucide-react";
import { BANK_LABELS, BANK_CODES, rowsFromPassbook, rowsFromBalances, bankCodeOf } from "@/lib/bankImport";
import { readPassbook } from "@/lib/passbook";
import { saveBankRows, importResultText } from "@/lib/bankImportActions";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const MAX_FILES = 5;
const toInt = (v) => Math.round(Number(String(v).replace(/[,\s]/g, "")) || 0);

/**
 * 通帳の画像や、ネットバンキングの画面（入出金明細・残高照会）のスクリーンショットから取り込む
 *   画像を AI に読ませ、行ごとに確認・修正してから bank_transactions に入れる。
 *   残高照会の画面は明細が無いので、口座ごとの残高を「残高照会」の行（入出金 0 円・照合対象外）として入れ、
 *   資金繰り表の残高の起点に使う。
 *   同じ行（銀行・日付・摘要・金額・残高が同じ）は二重に入らない。
 *   scope: payments=入金確認から（全画面で使う） / cashplan=資金繰り表から（資金繰り表だけで使う）
 */
export default function PassbookImportDialog({ open, onOpenChange, userId, onDone, scope = "payments" }) {
  const [bank, setBank] = useState("daito");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState(null); // { bank_name, account_label, lines, balances, screen_kind, notes }
  const [accountLabel, setAccountLabel] = useState(""); // 明細の行に付ける口座（支店・科目・番号）
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
      if (r.lines.length === 0 && r.balances.length === 0) toast.error("明細の行も残高も読み取れませんでした。ページ全体が写るように撮り直してください");
      if (r.lines.length === 0 && r.balances.length > 0) toast.message(`残高照会の画面として読み取りました（${r.balances.length} 口座）`);
      const guessed = bankCodeOf(r.bank_name || r.balances[0]?.bank_name, "");
      if (guessed) setBank(guessed);
      setAccountLabel(r.account_label || "");
      setResult(r);
    } catch (e) { toast.error("読み取れませんでした: " + (e?.message || e)); }
    finally { setReading(false); }
  };

  const patch = (id, data) => setResult((r) => ({ ...r, lines: r.lines.map((l) => (l.id === id ? { ...l, ...data } : l)) }));
  const patchBal = (id, data) => setResult((r) => ({ ...r, balances: r.balances.map((b) => (b.id === id ? { ...b, ...data } : b)) }));
  const lines = result?.lines || [];
  const balances = result?.balances || [];
  const includedBalances = balances.filter((b) => b.include && b.as_of && b.balance);
  const balanceWarn = balances.filter((b) => b.include && (!b.as_of || !b.balance));
  const isWarn = (l) => l.include && (l.kind === "unclear" || l.balance_ok === false || !l.transaction_date);
  const included = lines.filter((l) => l.include && l.transaction_date && (l.amount_in || l.amount_out));
  const unclear = lines.filter(isWarn);
  // 資金繰り表からの取り込みは「最新の残高」だけを記録する（途中の入出金の行は入れない）
  const balanceOnly = scope === "cashplan";
  const latestLine = useMemo(() => {
    let best = null;
    for (const l of lines) { if (l.transaction_date && l.balance && (!best || l.transaction_date >= best.transaction_date)) best = l; }
    return best;
  }, [lines]);
  const latestWarn = latestLine ? (latestLine.kind === "unclear" || latestLine.balance_ok === false) : false;
  const canSave = balanceOnly ? includedBalances.length > 0 || !!latestLine : included.length > 0 || includedBalances.length > 0;

  const doImport = async () => {
    if (!canSave) return;
    if (balanceOnly) {
      if (latestWarn && !window.confirm("最新の残高の行の読み取りが怪しいです（黄色の行）。この残高で保存しますか？")) return;
    } else if (unclear.length > 0 && !window.confirm(`読み取りが怪しい行が ${unclear.length} 行あります（黄色の行）。このまま取り込みますか？`)) return;
    setSaving(true);
    try {
      const label = accountLabel.trim() ? `${BANK_LABELS[bank]} ${accountLabel.trim()}` : "";
      const rows = !balanceOnly && included.length > 0 ? await rowsFromPassbook(bank, included.map((l) => ({ transaction_date: l.transaction_date, payee_raw: l.payee_raw, amount_in: l.amount_in, amount_out: l.amount_out, balance: l.balance || null })), label) : [];
      const balEntries = includedBalances.map((b) => ({ bank: bankCodeOf(b.bank_name, bank), account_label: b.account_label, as_of: b.as_of, balance: b.balance }));
      if (balanceOnly && latestLine) balEntries.push({ bank, account_label: accountLabel.trim(), as_of: latestLine.transaction_date, balance: latestLine.balance, memo: "通帳・明細の画面の最新の行から（その時点の残高）" });
      const balRows = await rowsFromBalances(balEntries);
      const r = await saveBankRows([...rows, ...balRows], { userId, scope });
      toast.success(importResultText(BANK_LABELS[bank], r));
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
        <DialogHeader><DialogTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5" /> 通帳・ネットバンキングの画面の画像から取り込む</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm min-w-0">
          <p className="text-xs text-muted-foreground">通帳のページを撮影・スキャンした画像（大東銀行など CSV が出せない口座）か、ネットバンキングの「入出金明細」「残高照会」の画面のスクリーンショットを入れてください。AI が日付・摘要・出金・入金・残高を読み取ります。残高照会の画面は明細が無いので、口座ごとの残高をその日の残高として取り込みます（資金繰り表の起点になります）。残高のつながりが合わない行は黄色になるので、見比べて直してから取り込んでください。</p>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">銀行</Label>
            <select value={bank} onChange={(e) => setBank(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="銀行">
              {BANK_CODES.map((b) => <option key={b} value={b}>{BANK_LABELS[b]}</option>)}
            </select>
            <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={() => inputRef.current?.click()} disabled={reading}><ImagePlus className="w-4 h-4" /> 画像を選ぶ</Button>
            <Button type="button" size="sm" className="h-9 gap-1" onClick={read} disabled={files.length === 0 || reading}>{reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {reading ? "インポート中…" : "インポート"}</Button>
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

          {result && (lines.length > 0 || balances.length === 0) && (
            <div className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs border-b bg-muted/40">
                <span className="font-semibold">読み取った行 {lines.length}</span>
                {balanceOnly ? (
                  <span className={latestLine ? "" : "text-amber-700"}>{latestLine ? `最新の残高 ${yen(latestLine.balance)}（${latestLine.transaction_date}）だけを記録` : "残高が読めた行がありません"}</span>
                ) : (
                  <span>取り込む {included.length} 行</span>
                )}
                <span className="flex items-center gap-1 text-muted-foreground">口座 <Input value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} placeholder="支店名 科目 口座番号" className="h-6 w-56 text-[11px]" aria-label="口座" title="明細の行に付ける口座。口座番号が入っていると、資金繰り表で同じ口座の CSV と一つにまとまります" /></span>
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
                        <td className="px-2 py-1 text-center">{!balanceOnly && <input type="checkbox" checked={l.include} onChange={(e) => patch(l.id, { include: e.target.checked })} aria-label="取り込む" />}</td>
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
              {balanceOnly ? (
                <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">資金繰り表では、いちばん新しい行の残高だけをこの口座の残高として記録します。途中の入金・出金の行は記録しません（明細として残したいときは入金確認から取り込んでください）。行は残高のつながりの確認用です</p>
              ) : (
                <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">繰越の行は残高の確認用で、明細としては取り込みません。取り込む行の合計: 入金 {yen(included.reduce((s, l) => s + l.amount_in, 0))} ／ 出金 {yen(included.reduce((s, l) => s + l.amount_out, 0))}</p>
              )}
            </div>
          )}
          {result && balances.length > 0 && (
            <div className="rounded-lg border" data-testid="balances">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs border-b bg-muted/40">
                <span className="font-semibold">口座残高（残高照会の画面） {balances.length} 口座</span>
                <span>取り込む {includedBalances.length} 口座</span>
                {balanceWarn.length > 0 && <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 日付か残高が読めていない口座 {balanceWarn.length}</span>}
              </div>
              <table className="w-full text-xs table-fixed">
                <thead className="bg-slate-800 text-white">
                  <tr><th className="w-8"></th><th className="text-left px-2 py-1.5 w-28">銀行</th><th className="text-left px-2 py-1.5">口座（支店・科目・番号）</th><th className="text-right px-2 py-1.5 w-36">現在の残高</th><th className="text-left px-2 py-1.5 w-36">時点</th></tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.id} className={`border-t ${!b.include ? "opacity-50" : (!b.as_of || !b.balance) ? "bg-amber-50" : ""}`}>
                      <td className="px-2 py-1 text-center"><input type="checkbox" checked={b.include} onChange={(e) => patchBal(b.id, { include: e.target.checked })} aria-label="この口座を取り込む" /></td>
                      <td className="px-2 py-1">
                        <select value={bankCodeOf(b.bank_name, bank)} onChange={(e) => patchBal(b.id, { bank_name: BANK_LABELS[e.target.value] })} className="h-7 w-full rounded-md border bg-background px-1 text-xs" aria-label="口座の銀行">
                          {[...BANK_CODES, "other"].map((c) => <option key={c} value={c}>{BANK_LABELS[c]}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1"><Input value={b.account_label} onChange={(e) => patchBal(b.id, { account_label: e.target.value })} className="h-7 text-xs" aria-label="口座" /></td>
                      <td className="px-2 py-1"><Input value={b.balance || ""} onChange={(e) => patchBal(b.id, { balance: toInt(e.target.value) })} inputMode="numeric" className="h-7 text-xs text-right tabular-nums" aria-label="現在の残高" /></td>
                      <td className="px-2 py-1"><Input type="date" value={b.as_of} onChange={(e) => patchBal(b.id, { as_of: e.target.value })} className="h-7 text-xs px-1" aria-label="時点" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">口座ごとの残高を「残高照会」の行（入出金 0 円・照合の対象外）として入れます。合計 {yen(includedBalances.reduce((s, b) => s + b.balance, 0))}。同じ口座の明細 CSV を取り込んでいる場合は、口座番号が同じなら新しい日付の方が残高の起点になります</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reading || saving}>キャンセル</Button>
          <Button onClick={doImport} disabled={!canSave || reading || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {balanceOnly
              ? `残高 ${includedBalances.length + (latestLine ? 1 : 0)} 口座を保存`
              : included.length > 0 && includedBalances.length > 0 ? `${included.length} 行と残高 ${includedBalances.length} 口座を保存` : includedBalances.length > 0 ? `残高 ${includedBalances.length} 口座を保存` : `${included.length} 行を保存`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
