import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Upload, Loader2, Landmark, Check, X, Search, Sparkles, Link2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { decodeCsv, parseBankCsv, suggestInvoices, isConfident, BANK_LABELS } from "@/lib/bankImport";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/**
 * 入金確認: 銀行明細CSVを取り込み、請求書と照合して入金済にする。
 */
export default function Payments() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState("unmatched"); // unmatched | matched | ignored
  const [search, setSearch] = useState("");
  const [pickFor, setPickFor] = useState(null); // 手動で請求書を選ぶ対象の明細
  const [pickSearch, setPickSearch] = useState("");

  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["bankTransactions"],
    queryFn: () => db.entities.BankTransaction.list("-transaction_date", 1000),
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", "all"],
    queryFn: () => db.entities.Invoice.list("-invoice_date"),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });
  const invoiceById = useMemo(() => Object.fromEntries(invoices.map((i) => [i.id, i])), [invoices]);

  // 未照合の入金に候補を付ける
  const unmatched = useMemo(
    () => txs.filter((t) => t.match_status === "unmatched" && Number(t.amount_in) > 0)
      .map((t) => ({ tx: t, candidates: suggestInvoices(t, invoices, clients) })),
    [txs, invoices, clients],
  );
  const confidentCount = unmatched.filter((u) => isConfident(u.candidates)).length;

  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await decodeCsv(file);
      const { bank, rows } = await parseBankCsv(text);
      const hashes = rows.map((r) => r.source_hash);
      const existing = await db.entities.BankTransaction.whereIn("source_hash", hashes);
      const known = new Set(existing.map((r) => r.source_hash));
      const fresh = rows.filter((r) => !known.has(r.source_hash)).map((r) => ({ ...r, imported_by: user?.id || null }));
      if (fresh.length > 0) await db.entities.BankTransaction.createMany(fresh);
      queryClient.invalidateQueries({ queryKey: ["bankTransactions"] });
      toast.success(`${BANK_LABELS[bank] || bank}の明細を取り込みました（新規 ${fresh.length}件・取込済み ${rows.length - fresh.length}件）`);
    } catch (err) {
      toast.error("取込に失敗しました: " + err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // 明細を請求書の入金として記録する
  const match = useMutation({
    mutationFn: async ({ tx, invoice, by }) => {
      await db.entities.Invoice.update(invoice.id, { status: "paid", paid_at: tx.transaction_date, paid_amount: Number(tx.amount_in) });
      await db.entities.BankTransaction.update(tx.id, { match_status: "matched", invoice_id: invoice.id, matched_by: by });
      // 振込名義を学習する
      const client = (invoice.client_id && clients.find((c) => c.id === invoice.client_id)) || clients.find((c) => c.name === invoice.client_name);
      if (client && tx.payee_normalized) {
        const names = Array.isArray(client.bank_payee_names) ? client.bank_payee_names : [];
        if (!names.includes(tx.payee_normalized)) await db.entities.Client.update(client.id, { bank_payee_names: [...names, tx.payee_normalized] });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankTransactions"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (err) => toast.error("記録できませんでした: " + (err?.message || "不明なエラー")),
  });

  const setStatus = useMutation({
    mutationFn: async ({ tx, status }) => {
      if (tx.match_status === "matched" && tx.invoice_id) {
        // 紐付けを外すときは請求書を送付済に戻す
        await db.entities.Invoice.update(tx.invoice_id, { status: "sent", paid_at: null, paid_amount: null });
      }
      await db.entities.BankTransaction.update(tx.id, { match_status: status, invoice_id: null, matched_by: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bankTransactions"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => toast.error("更新できませんでした: " + (err?.message || "不明なエラー")),
  });

  const applyConfident = async () => {
    const targets = unmatched.filter((u) => isConfident(u.candidates));
    let done = 0;
    for (const u of targets) {
      try { await match.mutateAsync({ tx: u.tx, invoice: u.candidates[0].invoice, by: "auto" }); done++; } catch { /* 個別に表示済み */ }
    }
    toast.success(`${done}件を自動で入金済にしました`);
  };

  const q = search.trim().toLowerCase();
  const listFor = (status) => txs.filter((t) => t.match_status === status && (!q || `${t.payee_raw} ${t.transaction_date} ${t.amount_in}`.toLowerCase().includes(q)));

  const pickCandidates = useMemo(() => {
    if (!pickFor) return [];
    const s = pickSearch.trim().toLowerCase();
    return invoices
      .filter((i) => i.status === "sent" || i.status === "draft")
      .filter((i) => !s || `${i.invoice_number} ${i.client_name} ${i.title}`.toLowerCase().includes(s))
      .slice(0, 50);
  }, [pickFor, pickSearch, invoices]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Landmark className="w-5 h-5" /> 入金確認</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            銀行の入出金明細CSVを取り込み、請求書と照合します。未照合 {unmatched.length}件
            {confidentCount > 0 && <span className="text-emerald-700">（自動で確定できるもの {confidentCount}件）</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
          <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} 明細CSVを取り込む
          </Button>
          <Button className="gap-2" onClick={applyConfident} disabled={confidentCount === 0 || match.isPending}>
            <Sparkles className="w-4 h-4" /> 自動照合を適用（{confidentCount}）
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="振込名義・日付・金額で検索" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[["unmatched", `未照合 ${listFor("unmatched").length}`], ["matched", `照合済 ${listFor("matched").length}`], ["ignored", `対象外 ${listFor("ignored").length}`]].map(([k, label]) => (
            <Button key={k} size="sm" variant={tab === k ? "default" : "outline"} className="text-xs" onClick={() => setTab(k)}>{label}</Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : listFor(tab).length === 0 ? (
            <div className="text-center py-16">
              <Landmark className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{txs.length === 0 ? "明細がまだありません。「明細CSVを取り込む」から始めてください" : "該当する明細がありません"}</p>
            </div>
          ) : (
            <div className="divide-y">
              {listFor(tab).map((t) => {
                const u = unmatched.find((x) => x.tx.id === t.id);
                const inv = t.invoice_id ? invoiceById[t.invoice_id] : null;
                return (
                  <div key={t.id} className="p-3 flex flex-col lg:flex-row lg:items-center gap-3">
                    <div className="flex items-center gap-3 min-w-[320px]">
                      <Badge variant="outline" className="text-[10px] font-normal shrink-0">{BANK_LABELS[t.bank] || t.bank}</Badge>
                      <span className="text-xs text-muted-foreground w-20 shrink-0">{t.transaction_date}</span>
                      <span className="text-sm font-medium truncate" title={t.payee_raw}>{t.payee_raw || "（名義なし）"}</span>
                      <span className={`text-sm tabular-nums ml-auto ${Number(t.amount_in) > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                        {Number(t.amount_in) > 0 ? `+${yen(t.amount_in)}` : `-${yen(t.amount_out)}`}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-wrap items-center gap-2">
                      {tab === "unmatched" && u && u.candidates.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {u.candidates.slice(0, 3).map((c) => (
                            <button
                              key={c.invoice.id}
                              onClick={() => match.mutate({ tx: t, invoice: c.invoice, by: "manual" })}
                              className={`text-xs px-2 py-1 rounded border text-left hover:bg-primary/5 ${c.score >= 80 ? "border-emerald-300 bg-emerald-50" : ""}`}
                              title={c.reasons.join(" / ")}
                            >
                              <span className="font-mono text-muted-foreground">{c.invoice.invoice_number}</span> {c.invoice.client_name} <span className="tabular-nums">{yen(c.invoice.total)}</span>
                              <span className="text-[10px] text-muted-foreground ml-1">{c.reasons[0]}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {tab === "unmatched" && u && u.candidates.length === 0 && Number(t.amount_in) > 0 && (
                        <span className="text-xs text-muted-foreground">候補なし</span>
                      )}
                      {tab === "matched" && inv && (
                        <Link to={`/invoices/${inv.id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                          <Link2 className="w-3 h-3" /> {inv.invoice_number} {inv.client_name} {yen(inv.total)} {t.matched_by === "auto" && <Badge variant="outline" className="text-[9px] font-normal">自動</Badge>}
                        </Link>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {tab === "unmatched" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setPickFor(t); setPickSearch(""); }}><Check className="w-3 h-3" /> 請求書を選ぶ</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => setStatus.mutate({ tx: t, status: "ignored" })}><X className="w-3 h-3" /> 対象外</Button>
                        </>
                      )}
                      {tab !== "unmatched" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => setStatus.mutate({ tx: t, status: "unmatched" })}><Undo2 className="w-3 h-3" /> 未照合に戻す</Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">照合のしくみ</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>・金額が一致する未入金の請求書、振込名義とクライアントのフリガナが一致するものを候補に出します。振込手数料分（1,100円まで）の差額は許容します</p>
          <p>・一度「請求書を選ぶ」で照合すると、その振込名義をクライアントに覚え、次回から自動候補になります</p>
          <p>・「自動照合を適用」は、候補が1件だけで確度が高いものをまとめて入金済にします。不安なものは1件ずつ確認してください</p>
          <p>・仕入先への支払いや手数料など、請求書に関係ない明細は「対象外」にしてください（MF仕訳の対象からも外れます）</p>
        </CardContent>
      </Card>

      <Dialog open={!!pickFor} onOpenChange={(o) => !o && setPickFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>入金を記録する請求書を選ぶ</DialogTitle>
            <DialogDescription className="text-xs">
              {pickFor && <>{pickFor.transaction_date}　{pickFor.payee_raw}　<strong>{yen(pickFor.amount_in)}</strong></>}
            </DialogDescription>
          </DialogHeader>
          <Input value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} placeholder="請求番号・請求先・件名で検索" className="h-9" autoFocus />
          <div className="max-h-[50vh] overflow-y-auto divide-y border rounded-md">
            {pickCandidates.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">未入金の請求書がありません</p>}
            {pickCandidates.map((inv) => (
              <button key={inv.id} onClick={() => { match.mutate({ tx: pickFor, invoice: inv, by: "manual" }); setPickFor(null); }} className="w-full text-left px-3 py-2 text-xs hover:bg-muted/40 flex items-center gap-3">
                <span className="font-mono text-muted-foreground w-28 shrink-0">{inv.invoice_number}</span>
                <span className="text-muted-foreground w-20 shrink-0">{inv.invoice_date}</span>
                <span className="font-medium truncate">{inv.client_name}</span>
                <span className="truncate text-muted-foreground flex-1">{inv.title}</span>
                <span className={`tabular-nums ${pickFor && Number(inv.total) === Number(pickFor.amount_in) ? "text-emerald-700 font-medium" : ""}`}>{yen(inv.total)}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickFor(null)}>キャンセル</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
