import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CreditCard, FileUp, Download, Trash2, Loader2, Upload, AlertTriangle } from "lucide-react";
import { BILL_TO } from "@/lib/payables";
import { CARD_FIELDS, cardCsvToGrid, guessCardMapping, rowsFromGrid, sumCharges, downloadChargesCsv } from "@/lib/cardCharges";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const entityLabel = (code) => BILL_TO.find((b) => b.code === code)?.label || code;

/**
 * カード利用明細（月ごと）
 *   マネーフォワード ビジネスカードなどの利用明細 CSV を取り込む。列は見出しから自動で当て、
 *   合わなければ手で選べる。同じ明細（利用日・利用先・金額・利用者が同じ）は二重に入らない。
 */
export default function CardChargesTab({ month }) {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["cardCharges", month],
    queryFn: () => db.entities.CardCharge.filter({ charge_month: month }, "charged_at"),
    retry: false,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cardCharges"] });
  const remove = useMutation({
    mutationFn: (id) => db.entities.CardCharge.delete(id),
    onSuccess: () => { invalidate(); toast.success("明細を削除しました"); },
    onError: (e) => toast.error("削除できませんでした: " + e.message),
  });
  const removeMonth = useMutation({
    mutationFn: async () => { for (const r of rows) await db.entities.CardCharge.delete(r.id); },
    onSuccess: () => { invalidate(); toast.success("この月の明細を消しました"); },
    onError: (e) => { invalidate(); toast.error("削除できませんでした: " + e.message); },
  });
  const sorted = useMemo(() => [...rows].sort((a, b) => String(a.charged_at).localeCompare(String(b.charged_at)) || String(a.merchant).localeCompare(String(b.merchant), "ja")), [rows]);
  const totals = useMemo(() => sumCharges(sorted), [sorted]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">利用日がこの月の明細。売上粗利管理表の「実績 その他原価」（税抜）に入ります</span>
        <div className="flex-1" />
        <Button size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}><FileUp className="w-4 h-4" /> 利用明細 CSV を取り込む</Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadChargesCsv(sorted, month)} disabled={sorted.length === 0}><Download className="w-4 h-4" /> CSV出力</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {BILL_TO.map((b) => (
          <Card key={b.code}><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{b.label} のカード（税込）</p><p className="text-lg font-bold tabular-nums">{yen(totals.byEntity[b.code])}</p></CardContent></Card>
        ))}
        <Card className="border-primary/40"><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">合計（税込）</p><p className="text-lg font-bold tabular-nums text-primary">{yen(totals.total)}</p><p className="text-[10px] text-muted-foreground">税抜 {yen(totals.total_ex_tax)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">明細</p><p className="text-lg font-bold tabular-nums">{totals.count}<span className="text-xs font-medium ml-0.5">件</span></p>
          <p className="text-[10px] text-muted-foreground truncate">{[...totals.byHolder.entries()].slice(0, 3).map(([h, a]) => `${h} ${yen(a)}`).join("・")}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-14 text-sm text-muted-foreground">
              <p>この月のカード利用明細はまだありません。</p>
              <p className="text-xs mt-1">マネーフォワード ビジネスカードの管理画面から利用明細を CSV で書き出し、「利用明細 CSV を取り込む」で読み込んでください。</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
                  <th className="text-left px-3 py-2 w-28">利用日</th>
                  <th className="text-left px-3 py-2">利用先</th>
                  <th className="text-right px-3 py-2 w-32">金額（税込）</th>
                  <th className="text-left px-3 py-2 w-40">利用者・カード</th>
                  <th className="text-left px-3 py-2 w-24">会社</th>
                  <th className="text-left px-3 py-2">メモ</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5 tabular-nums text-xs">{String(r.charged_at).replace(/-/g, "/")}</td>
                    <td className="px-3 py-1.5">{r.merchant}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${Number(r.amount) < 0 ? "text-emerald-700" : ""}`}>{yen(r.amount)}</td>
                    <td className="px-3 py-1.5 text-xs">{r.holder || ""}{r.card_label ? <span className="block text-[10px] text-muted-foreground">{r.card_label}</span> : null}</td>
                    <td className="px-3 py-1.5 text-xs">{entityLabel(r.entity)}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.memo || ""}</td>
                    <td className="px-1 py-1.5"><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(r.id)} aria-label="削除"><Trash2 className="w-3.5 h-3.5" /></Button></td>
                  </tr>
                ))}
                <tr className="bg-blue-50/60 font-medium">
                  <td className="px-3 py-2" colSpan={2}>合計（{totals.count} 件）</td>
                  <td className="px-3 py-2 text-right tabular-nums">{yen(totals.total)}<span className="block text-[10px] text-muted-foreground font-normal">税抜 {yen(totals.total_ex_tax)}</span></td>
                  <td colSpan={4} className="px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { if (window.confirm(`${month} のカード利用明細 ${rows.length} 件をすべて削除します。よろしいですか？`)) removeMonth.mutate(); }} disabled={removeMonth.isPending}>この月の明細をすべて消す</Button>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <CardImportDialog open={importOpen} onOpenChange={setImportOpen} month={month} onDone={invalidate} />
    </div>
  );
}

/** 利用明細 CSV の取り込み（列の対応を確認して取り込む） */
function CardImportDialog({ open, onOpenChange, month, onDone }) {
  const [grid, setGrid] = useState(null);
  const [fileName, setFileName] = useState("");
  const [headerIndex, setHeaderIndex] = useState(-1);
  const [mapping, setMapping] = useState({});
  const [entity, setEntity] = useState("cv");
  const [cardLabel, setCardLabel] = useState("");
  const [onlyMonth, setOnlyMonth] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const g = await cardCsvToGrid(f);
      const guess = guessCardMapping(g);
      setGrid(g); setFileName(f.name); setHeaderIndex(guess.headerIndex); setMapping(guess.mapping);
      if (guess.headerIndex < 0) toast.error("見出し行が見つかりません。1 行目を見出しとして列を選んでください");
    } catch (err) { toast.error("読み込めませんでした: " + err.message); }
    finally { e.target.value = ""; }
  };
  const header = useMemo(() => (grid && headerIndex >= 0 ? grid[headerIndex].map((c) => String(c ?? "").trim()) : (grid?.[0] || []).map((_, i) => `${i + 1} 列目`)), [grid, headerIndex]);
  const hIdx = headerIndex >= 0 ? headerIndex : -1;
  const parsed = useMemo(() => (grid ? rowsFromGrid(grid, hIdx, mapping, entity, cardLabel) : { rows: [], skipped: [] }), [grid, hIdx, mapping, entity, cardLabel]);
  const rows = useMemo(() => (onlyMonth ? parsed.rows.filter((r) => r.charge_month === month) : parsed.rows), [parsed, onlyMonth, month]);
  const months = useMemo(() => [...new Set(rows.map((r) => r.charge_month))].sort(), [rows]);
  const ok = mapping.charged_at !== undefined && mapping.amount !== undefined;
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const doImport = async () => {
    if (!ok || rows.length === 0) return;
    setSaving(true);
    try {
      // 既に入っている明細（同じ月）を調べて、同じものは飛ばす
      const existing = [];
      for (const m of months) existing.push(...await db.entities.CardCharge.filter({ charge_month: m }));
      const have = new Set(existing.map((r) => r.fingerprint));
      let added = 0; let dup = 0;
      for (const r of rows) {
        if (have.has(r.fingerprint)) { dup++; continue; }
        await db.entities.CardCharge.create(r);
        have.add(r.fingerprint); added++;
      }
      toast.success(`${added} 件を取り込みました${dup ? `（重複 ${dup} 件は飛ばしました）` : ""}`);
      onDone(); onOpenChange(false); setGrid(null); setFileName("");
    } catch (e) { toast.error("取り込めませんでした: " + e.message); onDone(); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5" /> カード利用明細 CSV を取り込む</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm min-w-0">
          <p className="text-xs text-muted-foreground">マネーフォワード ビジネスカードの管理画面で利用明細を CSV に書き出して選んでください（文字コードは自動判定）。列は見出しから自動で当てます。合っていなければ下で選び直せます。</p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv,.tsv,.txt" className="hidden" onChange={pick} />
            <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => fileRef.current?.click()}><FileUp className="w-3.5 h-3.5" /> CSV ファイルを選ぶ</Button>
            {fileName && <span className="text-xs">{fileName}（{grid?.length || 0} 行）</span>}
            <div className="flex-1" />
            <Label className="text-xs">どの会社のカード</Label>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="会社">
              {BILL_TO.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
            </select>
            <Input value={cardLabel} onChange={(e) => setCardLabel(e.target.value)} placeholder="カードの名前（任意）" className="h-9 w-44" />
          </div>

          {grid && (
            <>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold">列の対応</span>
                  <Label className="text-xs">見出し行</Label>
                  <select value={headerIndex} onChange={(e) => setHeaderIndex(Number(e.target.value))} className="h-7 rounded-md border bg-background px-1 text-xs" aria-label="見出し行">
                    <option value={-1}>（見出し無し）</option>
                    {grid.slice(0, 15).map((r, i) => <option key={i} value={i}>{i + 1} 行目: {r.slice(0, 4).map((c) => String(c ?? "")).join(" / ").slice(0, 40)}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {CARD_FIELDS.map((f) => (
                    <div key={f.key} className="space-y-0.5">
                      <Label className="text-[11px]">{f.label}{(f.key === "charged_at" || f.key === "amount") && <span className="text-destructive"> *</span>}</Label>
                      <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })} className="h-8 w-full rounded-md border bg-background px-1 text-xs" aria-label={`${f.label}の列`}>
                        <option value="">（使わない）</option>
                        {header.map((h, i) => <option key={i} value={i}>{h || `${i + 1} 列目`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {!ok && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 利用日と金額の列を選んでください</p>}
              </div>

              <div className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs border-b bg-muted/40">
                  <span className="font-semibold">読み取り結果 {rows.length} 件 ／ 合計 {yen(total)}</span>
                  {months.length > 0 && <span className="text-muted-foreground">利用月: {months.join("・")}</span>}
                  {parsed.skipped.length > 0 && <span className="text-amber-700">日付か金額が無い行を {parsed.skipped.length} 行飛ばしました</span>}
                  <div className="flex-1" />
                  <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={onlyMonth} onChange={(e) => setOnlyMonth(e.target.checked)} /> {month} の明細だけ取り込む</label>
                </div>
                <div className="max-h-60 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60"><tr><th className="text-left px-2 py-1 w-24">利用日</th><th className="text-left px-2 py-1">利用先</th><th className="text-right px-2 py-1 w-28">金額</th><th className="text-left px-2 py-1 w-32">利用者</th><th className="text-left px-2 py-1">メモ</th></tr></thead>
                    <tbody>
                      {rows.slice(0, 300).map((r, i) => (
                        <tr key={i} className="border-t"><td className="px-2 py-1 tabular-nums">{r.charged_at}</td><td className="px-2 py-1">{r.merchant}</td><td className="px-2 py-1 text-right tabular-nums">{r.amount.toLocaleString()}</td><td className="px-2 py-1">{r.holder || ""}</td><td className="px-2 py-1 text-muted-foreground">{r.memo || ""}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={doImport} disabled={!ok || rows.length === 0 || saving} className="gap-1.5">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {rows.length} 件を取り込む</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
