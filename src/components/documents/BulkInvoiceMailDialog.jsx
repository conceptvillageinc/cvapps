import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Send, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { companyInfoFromSettings } from "@/lib/documents";
import { useAuth } from "@/lib/AuthContext";
import { defaultTemplate, clientForDoc, mailAddressesFor } from "@/components/documents/DocumentEmailDialog";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;

/**
 * 請求書一覧で選んだ請求書を、まとめてメールで送る（1 通ずつ別のメール。PDF はそれぞれの請求書）。
 *   送付先（差出人・To・CC）を 1 行ずつ出し、「すべて確認しました」にチェックしないと送れない。
 *   件名・本文はいつものひな形（1 通ずつ直したいときは、請求書の画面の「メール送付」から）。
 */
export default function BulkInvoiceMailDialog({ open, onOpenChange, invoices, onDone }) {
  const qc = useQueryClient();
  const { settings } = useSystemSettings();
  const { user } = useAuth();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => db.entities.Client.list("-name"), enabled: open });
  const rows = useMemo(() => invoices.map((inv) => {
    const client = clientForDoc(inv, clients);
    return { inv, client, addresses: mailAddressesFor("invoice", client, user), tpl: defaultTemplate("invoice", inv, company, user) };
  }), [invoices, clients, user, company]);
  const [include, setInclude] = useState(new Set());
  const [checked, setChecked] = useState(false);
  const [withStamp, setWithStamp] = useState(true);
  const [status, setStatus] = useState({}); // id → { state: "sending"|"sent"|"failed", message }
  const [sending, setSending] = useState(false);
  const [openBody, setOpenBody] = useState(null);
  useEffect(() => {
    if (!open) return;
    setChecked(false); setStatus({}); setOpenBody(null);
  }, [open]);
  // アドレスが入っている請求書だけ、最初から送る対象にする
  useEffect(() => { if (open) setInclude(new Set(rows.filter((r) => r.addresses.to).map((r) => r.inv.id))); }, [open, rows]);

  const targets = rows.filter((r) => include.has(r.inv.id) && r.addresses.to && status[r.inv.id]?.state !== "sent");
  const missing = rows.filter((r) => !r.addresses.to).length;
  const done = Object.values(status).filter((s) => s.state === "sent").length;
  const sameClient = rows.length !== new Set(rows.map((r) => r.client?.id || r.inv.client_name)).size;

  const sendAll = async () => {
    setSending(true);
    let ok = 0, ng = 0;
    for (const r of targets) {
      setStatus((s) => ({ ...s, [r.inv.id]: { state: "sending" } }));
      try {
        await db.functions.invoke("sendDocumentEmail", { type: "invoice", id: r.inv.id, subject: r.tpl.subject, body: r.tpl.body, stamp: withStamp });
        setStatus((s) => ({ ...s, [r.inv.id]: { state: "sent" } }));
        ok += 1;
      } catch (err) {
        setStatus((s) => ({ ...s, [r.inv.id]: { state: "failed", message: err?.message || "送信できませんでした" } }));
        ng += 1;
      }
    }
    setSending(false);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["emailLogs"] });
    if (ng) toast.error(`${ok} 件送信しました。${ng} 件は送れませんでした（理由は一覧に出ています）`);
    else { toast.success(`${ok} 件の請求書をメールで送りました`); onDone?.(); }
  };

  const toggle = (id) => setInclude((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Dialog open={open} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <DialogContent className="max-w-5xl [&>*]:min-w-0" data-testid="bulk-invoice-mail">
        <DialogHeader>
          <DialogTitle>選んだ請求書をメールで送る（{rows.length} 件）</DialogTitle>
          <DialogDescription className="text-xs">
            1 件ずつ別のメールで、それぞれの請求書の PDF を付けて送ります。差出人・CC は請求書の決まり（{rows[0]?.addresses.from}・CC に {rows[0]?.addresses.cc.slice(-1)[0]}）です。
            件名・本文はいつものひな形です（1 通ずつ直したいときは、請求書の画面の「メール送付」から送ってください）
          </DialogDescription>
        </DialogHeader>
        {missing > 0 && <p className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertTriangle className="h-3.5 w-3.5" />{missing} 件はクライアントのメールアドレスが未登録のため送れません（クライアント一覧で登録してください）</p>}
        {sameClient && <p className="text-[11px] text-muted-foreground">同じクライアントの請求書が複数あります。1 件ずつ別のメールになります</p>}
        <div className="max-h-[55vh] overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="w-8 px-2 py-1.5" />
                <th className="px-2 py-1.5 text-left font-medium">請求書</th>
                <th className="px-2 py-1.5 text-left font-medium">クライアント</th>
                <th className="px-2 py-1.5 text-left font-medium">宛先（To）</th>
                <th className="px-2 py-1.5 text-left font-medium">CC</th>
                <th className="px-2 py-1.5 text-right font-medium">請求金額（税込）</th>
                <th className="px-2 py-1.5 text-left font-medium w-28">送信</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const st = status[r.inv.id];
                return (
                  <tr key={r.inv.id} className={`align-top ${r.addresses.to ? "" : "bg-amber-50/50"}`} data-testid="bulk-mail-row">
                    <td className="px-2 py-2"><input type="checkbox" checked={include.has(r.inv.id)} disabled={!r.addresses.to || sending || st?.state === "sent"} onChange={() => toggle(r.inv.id)} className="h-4 w-4 accent-primary" aria-label={`${r.inv.invoice_number} を送る`} /></td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className="font-mono text-muted-foreground">{r.inv.invoice_number}</span>
                      <button type="button" onClick={() => setOpenBody(openBody === r.inv.id ? null : r.inv.id)} className="ml-1 inline-flex items-center text-[10px] text-primary hover:underline">本文<ChevronDown className="h-3 w-3" /></button>
                    </td>
                    <td className="px-2 py-2 font-medium">{r.inv.client_name}</td>
                    <td className="px-2 py-2 font-mono text-[12px] font-semibold text-slate-900 break-all" data-testid="bulk-mail-to">{r.addresses.to || <span className="font-sans font-medium text-amber-700">未登録</span>}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-slate-600 break-all">{r.addresses.cc.join(", ")}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{yen(r.inv.total)}</td>
                    <td className="px-2 py-2">
                      {st?.state === "sending" && <span className="inline-flex items-center gap-1 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />送信中</span>}
                      {st?.state === "sent" && <span className="inline-flex items-center gap-1 font-semibold text-emerald-700" data-testid="bulk-mail-sent"><CheckCircle2 className="h-3.5 w-3.5" />送信済</span>}
                      {st?.state === "failed" && <span className="text-rose-600" title={st.message}>失敗：{st.message}</span>}
                    </td>
                  </tr>
                );
              }).flatMap((tr, i) => (openBody === rows[i].inv.id ? [tr, (
                <tr key={`${rows[i].inv.id}-body`} className="bg-slate-50/60"><td /><td colSpan={6} className="px-2 py-2"><p className="text-[11px] font-semibold">件名：{rows[i].tpl.subject}</p><pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-700">{rows[i].tpl.body}</pre></td></tr>
              )] : [tr]))}
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={withStamp} onChange={(e) => setWithStamp(e.target.checked)} />PDF に電子印鑑を入れる</label>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <label className={`flex items-center gap-2 text-sm cursor-pointer ${targets.length ? "" : "opacity-40"}`}>
            <input type="checkbox" checked={checked} disabled={!targets.length || sending} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-primary" data-testid="bulk-mail-confirm" />
            上の送付先（宛先・CC）をすべて確認しました
          </label>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>{done ? "閉じる" : "キャンセル"}</Button>
            <Button onClick={sendAll} disabled={sending || !checked || targets.length === 0} className="gap-1.5" data-testid="bulk-mail-send">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {targets.length} 件を送信
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
