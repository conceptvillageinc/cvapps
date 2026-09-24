import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { vendorRequestStatus } from "@/lib/vendorRequest";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Printer, Mail, Inbox, Check, Loader2, RefreshCw, FileUp, MessageSquareReply, Undo2 } from "lucide-react";
import { toast } from "sonner";
import PrintSpecsPanel from "@/components/estimates/PrintSpecsPanel";
import EmailPreview from "@/components/estimates/EmailPreview";
import VendorQuoteImport from "@/components/estimates/VendorQuoteImport";

const fmt = (d) => (d ? new Date(d).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "");

/** 上部のステップ表示（1 仕様 / 2 送信 / 3 返答の取り込み） */
function ToolSteps({ status, current, onPick }) {
  const steps = [
    { n: 1, label: "印刷仕様を入力", note: status.specs > 0 ? `${status.specs}件` : "未入力", done: status.specs > 0 },
    { n: 2, label: "送信先を選んでメールを送る", note: status.sent > 0 ? `${status.sent}社に送信` : "未送信", done: status.sent > 0 },
    { n: 3, label: "返答を明細に取り込む", note: status.imported > 0 ? `${status.imported}社 取り込み済み` : status.replied > 0 ? `${status.replied}社 返答あり` : "返答待ち", done: status.imported > 0 },
  ];
  return (
    <div className="flex items-center rounded-lg border bg-muted/30 px-3 py-2">
      {steps.map((s, i) => {
        const active = s.n === current;
        return (
          <div key={s.n} className="flex items-center flex-1 min-w-0">
            {i > 0 && <div className={`h-0.5 w-6 shrink-0 ${steps[i - 1].done ? "bg-primary" : "bg-border"}`} />}
            <button type="button" onClick={() => onPick(s.n)} className={`flex items-center gap-2 min-w-0 ${i > 0 ? "pl-2" : ""} text-left`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${s.done && !active ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {s.done && !active ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <div className="min-w-0">
                <p className={`text-xs truncate ${active ? "font-semibold" : "text-muted-foreground"}`}>{s.n}. {s.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{s.note}</p>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 印刷所に見積を依頼するツール（右からせり出すパネル）。
 * 1 印刷仕様 → 2 送信先・メール → 3 返答の確認と明細への取り込み。
 *
 * props: open, onOpenChange, estimate, onUpdate（見積の部分更新）, onAddItems（明細を追加）, emailLogs, initialStep
 */
export default function VendorRequestTool({ open, onOpenChange, estimate, onUpdate, onAddItems, emailLogs = [], initialStep }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(null);
  const [importFor, setImportFor] = useState(null); // 会社名
  const [checking, setChecking] = useState(false);
  const [noteFor, setNoteFor] = useState(null); // 返答ありを付ける会社名
  const [note, setNote] = useState("");

  const { data: printVendors = [] } = useQuery({ queryKey: ["printVendors"], queryFn: () => db.entities.PrintVendor.list("name") });
  const status = useMemo(() => vendorRequestStatus(estimate, emailLogs), [estimate, emailLogs]);
  const current = step || initialStep || status.step || 1;
  const refreshLogs = () => queryClient.invalidateQueries({ queryKey: ["emailLogs", estimate.id] });

  // 受信を確認（Gmail のスレッドを読む。本人が送ったメールだけ）
  const checkReplies = async () => {
    setChecking(true);
    try {
      const { data } = await db.functions.invoke("checkEmailReplies", { estimate_id: estimate.id });
      refreshLogs();
      if (data.error) toast.error(data.error);
      else if (data.checked === 0) toast.info(data.skipped_others > 0 ? "あなたが送ったメールがありません（他の人が送ったメールはその人が確認します）" : "確認できる送信メールがありません");
      else if (data.found > 0) toast.success(`${data.found}社から返信が届いています`);
      else toast.info(`確認しました（${data.checked}社）。新しい返信はまだありません`);
    } catch (err) {
      toast.error("受信を確認できませんでした: " + err.message);
    } finally {
      setChecking(false);
    }
  };

  // 手動で「返答あり」を付ける／外す
  const markReplied = async (vendor, on) => {
    const log = vendor.lastLog;
    if (!log) return;
    try {
      await db.entities.EmailLog.update(log.id, on
        ? { replied_at: new Date().toISOString(), replied_by: user?.full_name || user?.email || "", reply_note: note.trim() || null }
        : { replied_at: null, replied_by: null, reply_note: null });
      refreshLogs();
      setNoteFor(null); setNote("");
      toast.success(on ? `${vendor.name} を「返答あり」にしました` : `${vendor.name} の「返答あり」を外しました`);
    } catch (err) {
      toast.error("記録できませんでした: " + err.message);
    }
  };

  const vendorEmail = (name) => printVendors.find((v) => v.name === name)?.email || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-auto right-0 top-0 h-screen max-h-screen w-full max-w-[920px] translate-x-0 translate-y-0 rounded-none sm:rounded-none p-0 gap-0 flex flex-col data-[state=open]:animate-none data-[state=closed]:animate-none">
        <div className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-bold flex items-center gap-2"><Printer className="w-4 h-4" /> 印刷所に見積を依頼する</DialogTitle>
          <DialogDescription className="text-[11px] mt-0.5">
            {estimate.estimate_number}　{estimate.estimate_title || estimate.print_type || ""}　・　{estimate.client_name}
          </DialogDescription>
        </div>
        <div className="px-6 py-3 border-b bg-muted/20">
          <ToolSteps status={status} current={current} onPick={setStep} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {current === 1 && (
            <PrintSpecsPanel estimate={estimate} onUpdate={onUpdate} onGoToEmail={() => setStep(2)} />
          )}

          {current === 2 && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                差出人はログイン中の本人（{user?.email}）です。送信したメールは本人の Gmail の「送信済み」に残り、返信も本人に届きます。
              </p>
              <EmailPreview estimate={estimate} emailLogs={emailLogs} onEmailSent={refreshLogs} />
              {status.sent > 0 && (
                <div className="flex justify-end">
                  <Button size="sm" className="gap-1.5 text-xs" onClick={() => setStep(3)}><Inbox className="w-3.5 h-3.5" /> 次へ：返答を確認する</Button>
                </div>
              )}
            </div>
          )}

          {current === 3 && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">返答を明細に取り込む</p>
                  <p className="text-[11px] text-muted-foreground">届いた見積書（PDF・画像）を読み取って、原価付きの明細にします。メール以外（電話・FAX）でもらった見積書もここから読み込めます</p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0" onClick={checkReplies} disabled={checking || status.sent === 0}>
                  {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Gmail の受信を確認
                </Button>
              </div>

              {status.vendors.length === 0 ? (
                <div className="text-center py-10 rounded-lg border bg-muted/20">
                  <Mail className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">まだ依頼メールを送っていません。先に「2. 送信先を選んでメールを送る」で依頼してください</p>
                  <Button variant="outline" size="sm" className="mt-3 text-xs gap-1" onClick={() => setImportFor("")}><FileUp className="w-3.5 h-3.5" /> メール以外でもらった見積書を読み込む</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {status.vendors.map((v) => (
                    <div key={v.name} className="rounded-lg border p-3 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{v.name}</span>
                        <Badge className={`text-[10px] ${v.state.cls} hover:${v.state.cls}`}>{v.state.label}</Badge>
                        {v.lastSentAt && <span className="text-[11px] text-muted-foreground">送信 {fmt(v.lastSentAt)}{v.sentCount > 1 ? `（${v.sentCount}回）` : ""}</span>}
                        {vendorEmail(v.name) && <span className="text-[11px] text-muted-foreground">{vendorEmail(v.name)}</span>}
                        <div className="ml-auto flex items-center gap-1.5">
                          {!v.imported && v.state.key !== "not_sent" && (
                            v.manualReply
                              ? <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 text-muted-foreground" onClick={() => markReplied(v, false)}><Undo2 className="w-3 h-3" /> 返答ありを外す</Button>
                              : <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => { setNoteFor(v.name); setNote(""); }}><MessageSquareReply className="w-3 h-3" /> 返答ありにする</Button>
                          )}
                          <Button size="sm" variant={v.imported ? "outline" : "default"} className="h-7 text-[11px] gap-1" onClick={() => setImportFor(v.name)}>
                            <FileUp className="w-3 h-3" /> {v.imported ? "もう一度読み込む" : "届いた見積書を読み込む"}
                          </Button>
                        </div>
                      </div>
                      {v.autoReply && (
                        <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                          Gmail で返信を検知 {fmt(v.autoReply.at)}　{v.autoReply.from}
                          {v.autoReply.snippet && <span className="block text-muted-foreground truncate">{v.autoReply.snippet}</span>}
                        </p>
                      )}
                      {v.manualReply && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          返答あり（{v.manualReply.by} が {fmt(v.manualReply.at)} に記録）{v.manualReply.note ? `　${v.manualReply.note}` : ""}
                        </p>
                      )}
                      {!v.autoReply && !v.manualReply && v.state.key === "waiting" && (
                        <p className="text-[11px] text-muted-foreground">
                          {v.checkedAt ? `最終確認 ${fmt(v.checkedAt)}・返信なし` : "まだ受信を確認していません"}
                        </p>
                      )}
                      {noteFor === v.name && (
                        <div className="flex items-center gap-2 pt-1">
                          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（例: 電話で回答あり、金額は後日）" className="h-8 text-xs" />
                          <Button size="sm" className="h-8 text-xs" onClick={() => markReplied(v, true)}>記録</Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setNoteFor(null)}>やめる</Button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setImportFor("")}><FileUp className="w-3.5 h-3.5" /> 上記以外の会社の見積書を読み込む</Button>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                「Gmail の受信を確認」は、あなたが送ったメールのスレッドだけを読み、返信の有無・差出人・冒頭の一文を記録します（本文は保存しません）。他の人が送ったメールは、その人がログインして確認します。
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-between bg-background">
          <span className="text-[11px] text-muted-foreground">仕様 {status.specs}件 ・ 送信 {status.sent}社 ・ 返答 {status.replied}社 ・ 取り込み {status.imported}社</span>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>閉じて見積書に戻る</Button>
        </div>

        {/* 届いた見積書の読み込み（仕入先見積の取り込み） */}
        <Dialog open={importFor !== null} onOpenChange={(o) => !o && setImportFor(null)}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogTitle>{importFor ? `${importFor} の見積書を読み込む` : "届いた見積書を読み込む"}</DialogTitle>
            <DialogDescription className="text-xs">読み取った明細は見積書に追加され、原価と仕入先が記録されます</DialogDescription>
            <VendorQuoteImport
              defaultVendor={importFor || ""}
              onAdd={(items) => { onAddItems(items); setImportFor(null); }}
              onClose={() => setImportFor(null)}
            />
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
