import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { HandCoins, Upload, Download, Plus, Trash2, Loader2, Link2, ClipboardPaste, FileUp, Users, ListChecks, ArrowUp, ArrowDown, FileText, Paperclip, CreditCard } from "lucide-react";
import InvoiceImportDialog from "@/components/payables/InvoiceImportDialog";
import CardChargesTab from "@/components/payables/CardChargesTab";
import { useSystemSettings } from "@/lib/useSystemSettings";
import {
  PAY_ENTITIES, parsePayableSheet, rowTotal, sumPayables, downloadPayablesCsv, thisMonth, monthLabel, textToGrid, toAmount, rowsToInvoices, downloadInvoicesCsv,
} from "@/lib/payables";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/**
 * 支払い先まとめ
 *   月末に受領した請求書をスキャンして読み込み、「翌月末に支払う一覧」（支払い先ごとに 1 行、
 *   CV／cv digital／Cool Agri の 3 社それぞれの振込金額）にまとめる。CSV に出力できる。
 *   既存のスプレッドシートから入れ直すための取り込みも残してある。
 */
export default function Payables() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState("list"); // list | card | payees
  const [importOpen, setImportOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["payables", month],
    queryFn: () => db.entities.Payable.filter({ pay_month: month }, "sort_order"),
    retry: false,
  });
  const { data: payees = [] } = useQuery({ queryKey: ["payees"], queryFn: () => db.entities.Payee.list("sort_order"), retry: false });

  const invalidate = (toMonth) => {
    queryClient.invalidateQueries({ queryKey: ["payables"] }); queryClient.invalidateQueries({ queryKey: ["payees"] });
    if (typeof toMonth === "string" && /^\d{4}-\d{2}$/.test(toMonth)) setMonth(toMonth);
  };

  const update = useMutation({
    mutationFn: ({ id, data }) => db.entities.Payable.update(id, data),
    // 画面はすぐ書き換え（済チェック・金額）、保存に失敗したら元に戻す
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["payables", month] });
      const prev = queryClient.getQueryData(["payables", month]);
      queryClient.setQueryData(["payables", month], (cur) => (cur || []).map((r) => (r.id === id ? { ...r, ...data } : r)));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(["payables", month], ctx.prev); toast.error("保存できませんでした: " + e.message); },
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id) => db.entities.Payable.delete(id),
    onSuccess: () => { invalidate(); toast.success("行を削除しました"); },
    onError: (e) => toast.error("削除できませんでした: " + e.message),
  });

  const sorted = useMemo(() => [...rows].sort((a, b) => (a.sort_order - b.sort_order) || String(a.payee_name).localeCompare(String(b.payee_name), "ja")), [rows]);
  const totals = useMemo(() => sumPayables(sorted), [sorted]);
  const invoiceList = useMemo(() => rowsToInvoices(sorted), [sorted]);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><HandCoins className="w-6 h-6" /> 支払い先まとめ</h1>
          <p className="text-sm text-muted-foreground mt-0.5">届いた請求書をスキャンして読み込み、翌月末に支払う一覧（支払い先ごと・会社別の振込金額）にまとめます。カードの利用明細も月ごとに保持し、どちらも売上粗利管理表の実績に入ります</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={tab === "list" ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setTab("list")}><ListChecks className="w-4 h-4" /> 支払い一覧</Button>
          <Button variant={tab === "card" ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setTab("card")}><CreditCard className="w-4 h-4" /> カード利用明細</Button>
          <Button variant={tab === "payees" ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setTab("payees")}><Users className="w-4 h-4" /> 支払い先マスタ（{payees.length}）</Button>
        </div>
      </div>

      {tab === "payees" ? (
        <PayeeMaster payees={payees} onChanged={invalidate} />
      ) : tab === "card" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">利用月</Label>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-40" />
          </div>
          <CardChargesTab month={month} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">支払月（月末払）</Label>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-40" />
            <span className="text-xs text-muted-foreground">{monthLabel(month)}</span>
            <CostMonthSetting />
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" /> 行を追加</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4" /> シートから取込</Button>
            <Button size="sm" className="gap-1.5" onClick={() => setInvoiceOpen(true)}><FileText className="w-4 h-4" /> 請求書を読み込む</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadPayablesCsv(sorted, month)} disabled={sorted.length === 0}><Download className="w-4 h-4" /> CSV出力</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadInvoicesCsv(invoiceList, month)} disabled={invoiceList.length === 0} title="読み取った請求書 1 通ごとの一覧"><Download className="w-4 h-4" /> 請求書ごとのCSV（{invoiceList.length}）</Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {PAY_ENTITIES.map((e) => (
              <Card key={e.key}><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{e.label} 振込金額（税込）</p><p className="text-lg font-bold tabular-nums">{yen(totals[e.key])}</p></CardContent></Card>
            ))}
            <Card className="border-primary/40"><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">合計（税込）</p><p className="text-lg font-bold tabular-nums text-primary">{yen(totals.total)}</p><p className="text-[10px] text-muted-foreground">税抜 {yen(totals.total_ex_tax)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">支払い先</p><p className="text-lg font-bold tabular-nums">{totals.count}<span className="text-xs font-medium ml-0.5">件</span></p><p className="text-[10px] text-muted-foreground">未払い {totals.unpaid} 件</p></CardContent></Card>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : sorted.length === 0 ? (
                <div className="text-center py-14 text-sm text-muted-foreground">
                  <p>{monthLabel(month)}の支払いはまだありません。</p>
                  <p className="text-xs mt-1">「請求書を読み込む」でスキャンした請求書の PDF を読み込むか、「行を追加」で手で入れてください。</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800 text-white text-xs">
                      <th className="text-left px-3 py-2 w-10">済</th>
                      <th className="text-left px-3 py-2">会社名</th>
                      <th className="text-left px-3 py-2">振込先情報</th>
                      {PAY_ENTITIES.map((e) => <th key={e.key} className="text-right px-3 py-2 w-32">{e.label}</th>)}
                      <th className="text-right px-3 py-2 w-32">合計（税込）</th>
                      <th className="text-left px-3 py-2 w-56">メモ</th>
                      <th className="text-left px-3 py-2 w-16">請求書</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <PayableRow key={r.id} row={r} onChange={(data) => update.mutate({ id: r.id, data })} onRemove={() => { if (window.confirm(`「${r.payee_name}」の行を削除します。よろしいですか？`)) remove.mutate(r.id); }} />
                    ))}
                    <tr className="bg-blue-50/60 font-medium">
                      <td className="px-3 py-2" colSpan={3}>合計（{totals.count} 件）</td>
                      {PAY_ENTITIES.map((e) => <td key={e.key} className="px-3 py-2 text-right tabular-nums">{yen(totals[e.key])}</td>)}
                      <td className="px-3 py-2 text-right tabular-nums">{yen(totals.total)}<span className="block text-[10px] text-muted-foreground font-normal">税抜 {yen(totals.total_ex_tax)}</span></td>
                      <td colSpan={3}></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground">金額は税込です。欄を書き換えて枠の外をクリックすると保存されます。「済」にチェックすると支払済み。クリップのアイコンで読み込んだ請求書を開けます。</p>
        </>
      )}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} month={month} existing={rows} payees={payees} onDone={invalidate} />
      <InvoiceImportDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} month={month} existing={rows} payees={payees} onDone={invalidate} />
      <AddRowDialog open={addOpen} onOpenChange={setAddOpen} month={month} payees={payees} nextOrder={sorted.length} onDone={invalidate} />
    </div>
  );
}

/** 1 行（金額・メモはその場で編集、枠の外で保存） */
function PayableRow({ row, onChange, onRemove }) {
  const [draft, setDraft] = useState(null); // { key, value }
  const commit = (key, value) => {
    const next = key === "memo" || key === "bank_info" ? value : Math.round(toAmount(value));
    if (next !== row[key]) onChange({ [key]: next });
    setDraft(null);
  };
  const cell = (key, isNum) => {
    const editing = draft?.key === key;
    const value = editing ? draft.value : (isNum ? (row[key] ? String(row[key]) : "") : (row[key] || ""));
    return (
      <Input
        value={value}
        onFocus={() => setDraft({ key, value: isNum ? (row[key] ? String(row[key]) : "") : (row[key] || "") })}
        onChange={(e) => setDraft({ key, value: e.target.value })}
        onBlur={(e) => commit(key, e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        inputMode={isNum ? "numeric" : undefined}
        placeholder={isNum ? "0" : ""}
        className={`h-8 text-xs ${isNum ? "text-right tabular-nums" : ""}`}
        aria-label={`${row.payee_name} ${key}`}
      />
    );
  };
  const total = rowTotal(row);
  return (
    <tr className={`border-b hover:bg-muted/30 ${row.paid ? "bg-emerald-50/50" : ""}`}>
      <td className="px-3 py-1.5"><input type="checkbox" checked={!!row.paid} onChange={(e) => onChange({ paid: e.target.checked })} className="w-4 h-4" aria-label={`${row.payee_name} 支払済`} /></td>
      <td className={`px-3 py-1.5 font-medium ${row.paid ? "line-through text-muted-foreground" : ""}`}>
        {row.payee_name}
        {row.due_date && <span className="block text-[10px] font-normal text-muted-foreground">期限 {row.due_date.replace(/-/g, "/")}</span>}
      </td>
      <td className="px-3 py-1.5">{cell("bank_info", false)}</td>
      {PAY_ENTITIES.map((e) => <td key={e.key} className="px-3 py-1.5">{cell(e.key, true)}</td>)}
      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{total ? yen(total) : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-1.5">{cell("memo", false)}</td>
      <td className="px-3 py-1.5"><AttachmentLinks paths={row.file_paths} name={row.payee_name} /></td>
      <td className="px-1 py-1.5"><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="削除"><Trash2 className="w-3.5 h-3.5" /></Button></td>
    </tr>
  );
}

/** 売上粗利管理表の「実績 調達（仕入）」に、支払月をどの月として数えるか */
function CostMonthSetting() {
  const { settings, payablesMonthMode } = useSystemSettings();
  const queryClient = useQueryClient();
  const row = settings.find((x) => x.setting_key === "payables_cost_month");
  const save = useMutation({
    mutationFn: async (value) => {
      const data = { setting_key: "payables_cost_month", setting_value: value, description: "支払い先まとめを売上粗利管理表のどの月に数えるか（prev=支払月の前月 / same=支払月）" };
      if (row) await db.entities.SystemSettings.update(row.id, data); else await db.entities.SystemSettings.create(data);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["settings"] }); toast.success("売上粗利管理表への反映のしかたを保存しました"); },
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-2">
      売上粗利管理表の仕入に数える月:
      <select value={payablesMonthMode} onChange={(e) => save.mutate(e.target.value)} className="h-7 rounded-md border bg-background px-1 text-[11px] text-foreground" aria-label="仕入に数える月">
        <option value="prev">支払月の前月（請求月）</option>
        <option value="same">支払月</option>
      </select>
    </label>
  );
}

/** 読み込んだ請求書（Storage の非公開ファイル）を署名付き URL で開く */
function AttachmentLinks({ paths, name }) {
  const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (list.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const openFile = async (p) => {
    try { const url = await db.storage.signedUrl(p); if (url) window.open(url, "_blank", "noopener"); }
    catch (e) { toast.error("請求書を開けませんでした: " + e.message); }
  };
  return (
    <div className="flex items-center gap-0.5">
      {list.map((p, i) => (
        <Button key={p} variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => openFile(p)} aria-label={`${name} の請求書 ${i + 1}`} title={`請求書 ${i + 1} を開く`}><Paperclip className="w-3.5 h-3.5" /></Button>
      ))}
      {list.length > 1 && <span className="text-[10px] text-muted-foreground">{list.length}</span>}
    </div>
  );
}

/** シートから取込（Google シートの URL／貼り付け／CSV ファイル） */
function ImportDialog({ open, onOpenChange, month, existing, payees, onDone }) {
  const [source, setSource] = useState("url"); // url | paste | file
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(null); // { rows, warnings, title }
  const [onlyAmount, setOnlyAmount] = useState(true);
  const [replace, setReplace] = useState(true);
  const fileRef = useRef(null);

  const runParse = (grid, title = "") => {
    const r = parsePayableSheet(grid);
    setParsed({ ...r, title });
    if (r.rows.length === 0) toast.error(r.warnings[0] || "読み取れる行がありません");
  };
  const fromUrl = async () => {
    if (!url.trim()) { toast.error("Google スプレッドシートの URL を貼ってください"); return; }
    setLoading(true);
    try {
      const { data } = await db.functions.invoke("readSheet", { url: url.trim() });
      runParse(data?.rows || [], `${data?.title || ""}／${data?.sheet_title || ""}`);
    } catch (e) { toast.error("読み込めませんでした: " + e.message); }
    finally { setLoading(false); }
  };
  const fromFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { toast.error("Excel ファイルは直接読めません。Google シートの URL を使うか、CSV で保存してください"); e.target.value = ""; return; }
    const t = await f.text();
    runParse(textToGrid(t.replace(/^﻿/, "")), f.name);
    e.target.value = "";
  };

  const rowsToImport = useMemo(() => (parsed ? parsed.rows.filter((r) => !onlyAmount || rowTotal(r) > 0) : []), [parsed, onlyAmount]);

  const [saving, setSaving] = useState(false);
  const doImport = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      // 1) 支払い先マスタ: 名前が無ければ作る。振込先情報が入っていれば更新
      const byName = new Map(payees.map((p) => [p.name, p]));
      let order = payees.length;
      for (const r of parsed.rows) {
        const ex = byName.get(r.payee_name);
        if (!ex) {
          const created = await db.entities.Payee.create({ name: r.payee_name, bank_info: r.bank_info || null, sort_order: order++ });
          byName.set(r.payee_name, created);
        } else if (r.bank_info && r.bank_info !== ex.bank_info) {
          await db.entities.Payee.update(ex.id, { bank_info: r.bank_info });
          byName.set(r.payee_name, { ...ex, bank_info: r.bank_info });
        }
      }
      // 2) この月の支払い一覧
      if (replace) for (const x of existing) await db.entities.Payable.delete(x.id);
      const current = replace ? [] : existing;
      const curByName = new Map(current.map((x) => [x.payee_name, x]));
      let n = 0;
      for (const [i, r] of rowsToImport.entries()) {
        const p = byName.get(r.payee_name);
        const data = {
          pay_month: month, payee_id: p?.id || null, payee_name: r.payee_name, bank_info: r.bank_info || p?.bank_info || null,
          amount_coolagri: r.amount_coolagri, amount_cvdigital: r.amount_cvdigital, amount_cv: r.amount_cv, paid: !!r.paid, memo: r.memo || null,
          sort_order: current.length + i,
        };
        const ex = curByName.get(r.payee_name);
        if (ex) await db.entities.Payable.update(ex.id, data); else await db.entities.Payable.create(data);
        n++;
      }
      toast.success(`${monthLabel(month)}に ${n} 件を取り込みました（支払い先マスタ ${byName.size} 件）`);
      onDone();
      onOpenChange(false);
      setParsed(null); setText(""); setUrl("");
    } catch (e) {
      toast.error("取り込めませんでした: " + e.message);
      onDone();
    } finally { setSaving(false); }
  };

  const tabBtn = (key, Icon, label) => (
    <button type="button" onClick={() => setSource(key)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border ${source === key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}><Icon className="w-3.5 h-3.5" /> {label}</button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>シートから取込（{monthLabel(month)}）</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">見出しに「会社名」「振込先情報」「CV／cv digital／Cool Agri 振込金額」がある表を読み取ります。金額の欄が「=55000+446490」のような式でも計算して取り込みます。</p>
          <div className="flex flex-wrap gap-2">
            {tabBtn("url", Link2, "Google シートの URL")}
            {tabBtn("paste", ClipboardPaste, "貼り付け")}
            {tabBtn("file", FileUp, "CSV ファイル")}
          </div>
          {source === "url" && (
            <div className="flex gap-2">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…（タブの gid 付きならそのタブ）" className="h-9" />
              <Button size="sm" className="h-9 gap-1" onClick={fromUrl} disabled={loading}>{loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} 読み込む</Button>
            </div>
          )}
          {source === "paste" && (
            <div className="space-y-2">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="シートの範囲（見出し行を含む）をコピーしてここに貼り付け" className="text-xs font-mono" />
              <Button size="sm" className="h-8" onClick={() => runParse(textToGrid(text), "貼り付け")} disabled={!text.trim()}>読み取る</Button>
            </div>
          )}
          {source === "file" && (
            <div>
              <input ref={fileRef} type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" className="hidden" onChange={fromFile} />
              <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => fileRef.current?.click()}><FileUp className="w-3.5 h-3.5" /> CSV ファイルを選ぶ</Button>
              <span className="ml-2 text-xs text-muted-foreground">Excel（.xlsx）は Google シートの URL か CSV で保存してから読み込んでください</span>
            </div>
          )}

          {parsed && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-semibold">読み取り結果</span>
                {parsed.title && <span className="text-muted-foreground">{parsed.title}</span>}
                <span>支払い先 {parsed.rows.length} 件 ／ 金額あり {parsed.rows.filter((r) => rowTotal(r) > 0).length} 件</span>
                {parsed.header?.labels?.length > 0 && <span className="text-muted-foreground">金額の列: {parsed.header.labels.join("・")}</span>}
                {parsed.warnings.map((w) => <span key={w} className="text-amber-700">{w}</span>)}
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={onlyAmount} onChange={(e) => setOnlyAmount(e.target.checked)} /> 金額が入っている行だけ一覧に入れる（支払い先マスタには全件を登録）</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> この月の今の一覧（{existing.length} 件）を置き換える</label>
              </div>
              <div className="max-h-64 overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead><tr className="bg-muted/60"><th className="text-left px-2 py-1">会社名</th><th className="text-left px-2 py-1">振込先</th>{PAY_ENTITIES.map((e) => <th key={e.key} className="text-right px-2 py-1">{e.label}</th>)}<th className="text-right px-2 py-1">合計</th></tr></thead>
                  <tbody>
                    {rowsToImport.slice(0, 200).map((r, i) => (
                      <tr key={i} className="border-t"><td className="px-2 py-1">{r.payee_name}</td><td className="px-2 py-1 text-muted-foreground truncate max-w-[220px]">{r.bank_info || <span className="opacity-50">（マスタの値を使う）</span>}</td>{PAY_ENTITIES.map((e) => <td key={e.key} className="px-2 py-1 text-right tabular-nums">{r[e.key] ? r[e.key].toLocaleString() : ""}</td>)}<td className="px-2 py-1 text-right tabular-nums font-medium">{rowTotal(r).toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={doImport} disabled={!parsed || rowsToImport.length === 0 || saving} className="gap-1.5">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {rowsToImport.length} 件を取り込む</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 行を追加（マスタから選ぶか、新しい支払い先を入れる） */
function AddRowDialog({ open, onOpenChange, month, payees, nextOrder, onDone }) {
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [amounts, setAmounts] = useState({});
  const [saving, setSaving] = useState(false);
  const picked = payees.find((p) => p.name === name.trim());
  const save = async () => {
    const n = name.trim();
    if (!n) { toast.error("会社名を入れてください"); return; }
    setSaving(true);
    try {
      let payee = picked;
      if (!payee) payee = await db.entities.Payee.create({ name: n, bank_info: bank || null, sort_order: payees.length });
      else if (bank && bank !== payee.bank_info) await db.entities.Payee.update(payee.id, { bank_info: bank });
      const data = { pay_month: month, payee_id: payee.id, payee_name: n, bank_info: bank || payee.bank_info || null, paid: false, sort_order: nextOrder };
      for (const e of PAY_ENTITIES) data[e.key] = Math.round(toAmount(amounts[e.key]));
      await db.entities.Payable.create(data);
      toast.success("行を追加しました");
      onDone(); onOpenChange(false); setName(""); setBank(""); setAmounts({});
    } catch (e) { toast.error("追加できませんでした: " + e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>行を追加（{monthLabel(month)}）</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">会社名</Label>
            <Input list="payee-names" value={name} onChange={(e) => { setName(e.target.value); const p = payees.find((x) => x.name === e.target.value); if (p) setBank(p.bank_info || ""); }} placeholder="支払い先マスタから選ぶか、新しい名前" className="h-9" />
            <datalist id="payee-names">{payees.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            {picked ? <p className="text-[11px] text-emerald-700">マスタの「{picked.name}」を使います</p> : name.trim() ? <p className="text-[11px] text-amber-700">新しい支払い先としてマスタに登録します</p> : null}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">振込先情報</Label>
            <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="例: 東邦銀行　○○支店　普通　1234567" className="h-9" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PAY_ENTITIES.map((e) => (
              <div key={e.key} className="space-y-1">
                <Label className="text-xs">{e.label}（税込）</Label>
                <Input value={amounts[e.key] || ""} onChange={(ev) => setAmounts({ ...amounts, [e.key]: ev.target.value })} inputMode="numeric" placeholder="0" className="h-9 text-right" />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={save} disabled={saving}>{saving ? "追加中..." : "追加"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 支払い先マスタ（会社名・振込先情報・並び） */
function PayeeMaster({ payees, onChanged }) {
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => { setBusy(true); try { await fn(); onChanged(); if (msg) toast.success(msg); } catch (e) { toast.error("保存できませんでした: " + e.message); } finally { setBusy(false); } };
  const add = () => { const n = name.trim(); if (!n) return; if (payees.some((p) => p.name === n)) { toast.error("同じ名前の支払い先があります"); return; } run(() => db.entities.Payee.create({ name: n, bank_info: bank || null, sort_order: payees.length }), `「${n}」を追加しました`).then(() => { setName(""); setBank(""); }); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= payees.length) return; const a = payees[i], b = payees[j]; run(async () => { await db.entities.Payee.update(a.id, { sort_order: j }); await db.entities.Payee.update(b.id, { sort_order: i }); }); };
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="会社名" className="h-9 w-56" />
          <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="振込先情報（銀行　支店　種別　口座番号）" className="h-9 flex-1 min-w-[260px]" />
          <Button type="submit" size="sm" className="h-9 gap-1" disabled={busy || !name.trim()}><Plus className="w-3.5 h-3.5" /> 追加</Button>
          <span className="text-[11px] text-muted-foreground">シートから取り込むと会社名は自動で登録されます</span>
        </form>
        {payees.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">まだ支払い先がありません</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-800 text-white text-xs"><th className="text-left px-3 py-2 w-10">順</th><th className="text-left px-3 py-2">会社名</th><th className="text-left px-3 py-2">振込先情報</th><th className="text-left px-3 py-2 w-56">メモ</th><th className="w-32"></th></tr></thead>
            <tbody>
              {payees.map((p, i) => (
                <PayeeRow key={p.id} payee={p} index={i} busy={busy}
                  onChange={(data) => run(() => db.entities.Payee.update(p.id, data))}
                  onRemove={() => { if (window.confirm(`「${p.name}」をマスタから削除します。各月の支払い一覧の行はそのまま残ります。よろしいですか？`)) run(() => db.entities.Payee.delete(p.id), "削除しました"); }}
                  onMove={(d) => move(i, d)} last={i === payees.length - 1} />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function PayeeRow({ payee, index, busy, onChange, onRemove, onMove, last }) {
  const [draft, setDraft] = useState(null);
  const field = (key, placeholder) => (
    <Input
      value={draft?.key === key ? draft.value : (payee[key] || "")}
      onFocus={() => setDraft({ key, value: payee[key] || "" })}
      onChange={(e) => setDraft({ key, value: e.target.value })}
      onBlur={(e) => { if ((e.target.value || "") !== (payee[key] || "")) onChange({ [key]: e.target.value || null }); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={placeholder} className="h-8 text-xs" aria-label={`${payee.name} ${key}`}
    />
  );
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{index + 1}</td>
      <td className="px-3 py-1.5">{field("name", "会社名")}</td>
      <td className="px-3 py-1.5">{field("bank_info", "振込先情報")}</td>
      <td className="px-3 py-1.5">{field("notes", "メモ")}</td>
      <td className="px-1 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMove(-1)} disabled={busy || index === 0} aria-label="上へ"><ArrowUp className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onMove(1)} disabled={busy || last} aria-label="下へ"><ArrowDown className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove} disabled={busy} aria-label="削除"><Trash2 className="w-3.5 h-3.5" /></Button>
        </div>
      </td>
    </tr>
  );
}
