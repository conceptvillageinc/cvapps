import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Send, CheckCircle2, AlertTriangle, ChevronDown, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { companyInfoFromSettings } from "@/lib/documents";
import { documentFilename } from "@/lib/docFilename";
import { useAuth } from "@/lib/AuthContext";
import { invoiceGroupTemplate, clientForDoc, mailAddressesFor } from "@/components/documents/DocumentEmailDialog";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;

/**
 * 請求書一覧で選んだ請求書を、まとめてメールで送る。
 *   同じクライアント宛ての請求書は 1 通のメールにまとめ、PDF を複数添付する（クライアントごとに 1 通）。
 *   送付先（差出人・To・CC）をクライアントごとに 1 行ずつ出し、「すべて確認しました」にチェックしないと送れない。
 *   件名・本文はひな形（1 通ずつ直したいときは、請求書の画面の「メール送付」から）。
 */
export default function BulkInvoiceMailDialog({ open, onOpenChange, invoices, onDone }) {
  const qc = useQueryClient();
  const { settings } = useSystemSettings();
  const { user } = useAuth();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => db.entities.Client.list("-name"), enabled: open });
  const [include, setInclude] = useState(new Set()); // 送る請求書の id
  const [checked, setChecked] = useState(false);
  const [withStamp, setWithStamp] = useState(true);
  const [status, setStatus] = useState({}); // クライアントのキー → { state, message }
  const [sending, setSending] = useState(false);
  const [openBody, setOpenBody] = useState(null);

  // クライアントごとにまとめる（並びは請求書番号順）
  const groups = useMemo(() => {
    const m = new Map();
    for (const inv of [...invoices].sort((a, b) => String(a.invoice_number || "").localeCompare(String(b.invoice_number || "")))) {
      const client = clientForDoc(inv, clients);
      const key = client?.id || `name:${inv.client_name}`;
      if (!m.has(key)) m.set(key, { key, client, name: client?.name || inv.client_name, all: [] });
      m.get(key).all.push(inv);
    }
    return [...m.values()].map((g) => {
      const invs = g.all.filter((i) => include.has(i.id));
      return { ...g, invs, addresses: mailAddressesFor("invoice", g.client, user), tpl: invs.length ? invoiceGroupTemplate(invs, company, user) : null };
    });
  }, [invoices, clients, include, user, company]);

  useEffect(() => { if (open) { setChecked(false); setStatus({}); setOpenBody(null); } }, [open]);
  // アドレスが入っているクライアントの請求書だけ、最初から送る対象にする
  useEffect(() => {
    if (!open) return;
    setInclude(new Set(invoices.filter((inv) => clientForDoc(inv, clients)?.email).map((i) => i.id)));
  }, [open, invoices, clients]);

  const targets = groups.filter((g) => g.addresses.to && g.invs.length && status[g.key]?.state !== "sent");
  const missing = groups.filter((g) => !g.addresses.to);
  const mails = targets.length;
  const files = targets.reduce((n, g) => n + g.invs.length, 0);
  const sentAny = Object.values(status).some((s) => s.state === "sent");

  const sendAll = async () => {
    setSending(true);
    let ok = 0, ng = 0;
    for (const g of targets) {
      setStatus((s) => ({ ...s, [g.key]: { state: "sending" } }));
      try {
        await db.functions.invoke("sendDocumentEmail", { type: "invoice", ids: g.invs.map((i) => i.id), subject: g.tpl.subject, body: g.tpl.body, stamp: withStamp });
        setStatus((s) => ({ ...s, [g.key]: { state: "sent" } }));
        ok += 1;
      } catch (err) {
        setStatus((s) => ({ ...s, [g.key]: { state: "failed", message: err?.message || "送信できませんでした" } }));
        ng += 1;
      }
    }
    setSending(false);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["emailLogs"] });
    if (ng) toast.error(`${ok} 通送信しました。${ng} 通は送れませんでした（理由は一覧に出ています）`);
    else { toast.success(`${ok} 通のメールで請求書を送りました`); onDone?.(); }
  };

  const toggleInv = (id) => setInclude((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (g, on) => setInclude((s) => { const n = new Set(s); for (const i of g.all) { if (on) n.add(i.id); else n.delete(i.id); } return n; });

  return (
    <Dialog open={open} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <DialogContent className="max-w-5xl [&>*]:min-w-0" data-testid="bulk-invoice-mail">
        <DialogHeader>
          <DialogTitle>選んだ請求書をメールで送る（請求書 {invoices.length} 件）</DialogTitle>
          <DialogDescription className="text-xs">
            同じクライアント宛ての請求書は 1 通のメールにまとめ、PDF をまとめて付けます（クライアントごとに 1 通）。差出人は {groups[0]?.addresses.from}、送付確認用に CC にも入ります。
            件名・本文はひな形です（1 通ずつ直したいときは、請求書の画面の「メール送付」から送ってください）
          </DialogDescription>
        </DialogHeader>
        {missing.length > 0 && (
          <p className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{missing.map((g) => g.name).join("・")} はメールアドレスが未登録のため送れません（クライアント一覧で登録してください）
          </p>
        )}
        <div className="max-h-[55vh] overflow-y-auto rounded-md border divide-y">
          {groups.map((g) => {
            const st = status[g.key];
            const on = g.invs.length > 0;
            return (
              <div key={g.key} className={`px-3 py-2.5 ${g.addresses.to ? "" : "bg-amber-50/50"}`} data-testid="bulk-mail-group">
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={on} disabled={!g.addresses.to || sending || st?.state === "sent"} onChange={(e) => toggleGroup(g, e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" aria-label={`${g.name} に送る`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-sm font-semibold">{g.name}</span>
                      <span className="text-[11px] text-muted-foreground">請求書 {g.invs.length} 件を 1 通で{g.invs.length > 1 ? "（PDF をまとめて添付）" : ""}</span>
                      {on && <button type="button" onClick={() => setOpenBody(openBody === g.key ? null : g.key)} className="inline-flex items-center text-[11px] text-primary hover:underline">件名・本文<ChevronDown className="h-3 w-3" /></button>}
                      <span className="ml-auto">
                        {st?.state === "sending" && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />送信中</span>}
                        {st?.state === "sent" && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700" data-testid="bulk-mail-sent"><CheckCircle2 className="h-3.5 w-3.5" />送信済</span>}
                        {st?.state === "failed" && <span className="text-xs text-rose-600">失敗：{st.message}</span>}
                      </span>
                    </div>
                    <div className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">宛先（To）</span>
                      <span className="font-mono text-[13px] font-semibold text-slate-900 break-all" data-testid="bulk-mail-to">{g.addresses.to || <span className="font-sans text-amber-700">未登録</span>}</span>
                      <span className="text-muted-foreground">CC</span>
                      <span className="font-mono text-slate-600 break-all">{g.addresses.cc.join(", ")}</span>
                      <span className="text-muted-foreground">添付</span>
                      <span className="space-y-0.5">
                        {g.all.map((inv) => (
                          <label key={inv.id} className={`flex items-center gap-2 ${include.has(inv.id) ? "" : "text-muted-foreground line-through"}`}>
                            <input type="checkbox" checked={include.has(inv.id)} disabled={!g.addresses.to || sending || st?.state === "sent"} onChange={() => toggleInv(inv.id)} className="h-3.5 w-3.5 accent-primary" aria-label={`${inv.invoice_number} を付ける`} />
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{documentFilename("invoice", inv)}</span>
                            <span className="ml-auto shrink-0 tabular-nums">{yen(inv.total)}<span className="ml-1 text-[10px] text-muted-foreground">税込・期日 {inv.due_date || "—"}</span></span>
                          </label>
                        ))}
                      </span>
                    </div>
                    {openBody === g.key && g.tpl && (
                      <div className="rounded border bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold">件名：{g.tpl.subject}</p>
                        <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-700">{g.tpl.body}</pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={withStamp} onChange={(e) => setWithStamp(e.target.checked)} />PDF に電子印鑑を入れる</label>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <label className={`flex items-center gap-2 text-sm cursor-pointer ${mails ? "" : "opacity-40"}`}>
            <input type="checkbox" checked={checked} disabled={!mails || sending} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-primary" data-testid="bulk-mail-confirm" />
            上の送付先（宛先・CC）をすべて確認しました
          </label>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>{sentAny ? "閉じる" : "キャンセル"}</Button>
            <Button onClick={sendAll} disabled={sending || !checked || mails === 0} className="gap-1.5" data-testid="bulk-mail-send">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {mails} 通を送信（請求書 {files} 件）
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
