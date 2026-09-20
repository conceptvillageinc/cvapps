import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Send, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { companyInfoFromSettings } from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

function defaultTemplate(type, doc, company) {
  const label = type === "invoice" ? "御請求書" : "納品書";
  const number = type === "invoice" ? doc.invoice_number : doc.delivery_number;
  const subject = `【${label}】${doc.title || number}（${company.name}）`;
  const lines = [
    `${doc.client_name} ${doc.client_honorific || "御中"}`,
    "",
    "いつもお世話になっております。",
    `${company.name}${company.representative ? `の${company.representative}` : ""}です。`,
    "",
    `${label}をお送りいたします。PDFを添付しておりますのでご確認ください。`,
    "",
    `　${label}番号: ${number}`,
    `　件名: ${doc.title || ""}`,
    type === "invoice"
      ? `　請求金額: ${yen(doc.total)}（税込）\n　入金期日: ${doc.due_date || ""}`
      : `　納品日: ${doc.delivery_date || ""}`,
    "",
    type === "invoice" ? "お手数ですが、期日までにお振込みをお願いいたします。" : "内容にお気づきの点がございましたらお知らせください。",
    "",
    "今後ともよろしくお願いいたします。",
    "",
    "――――――――――――――――",
    company.name,
    company.representative || "",
    ...(company.locations || []).slice(0, 1).map((l) => `〒${l.postal} ${l.address}`),
    company.tel ? `tel ${company.tel}` : "",
  ];
  return { subject, body: lines.join("\n") };
}

/**
 * 納品書・請求書をPDF添付でクライアントへ送るダイアログ。
 * 宛先はクライアント一覧のメールアドレス（画面からは変更できない）。
 */
export default function DocumentEmailDialog({ open, onOpenChange, type, doc, onSent }) {
  const queryClient = useQueryClient();
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
    enabled: open,
  });
  const client = clients.find((c) => (doc.client_id && c.id === doc.client_id) || c.name === doc.client_name);

  useEffect(() => {
    if (!open) return;
    const t = defaultTemplate(type, doc, company);
    setSubject(t.subject);
    setBody(t.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc.id, settings.length]);

  const send = async () => {
    setSending(true);
    try {
      const { data } = await db.functions.invoke("sendDocumentEmail", { type, id: doc.id, subject, body });
      toast.success(`${doc.client_name}（${data.recipient_email}）へ送信しました`);
      queryClient.invalidateQueries({ queryKey: ["emailLogs", type, doc.id] });
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("送信できませんでした: " + err.message);
      queryClient.invalidateQueries({ queryKey: ["emailLogs", type, doc.id] });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{type === "invoice" ? "請求書" : "納品書"}をメールで送る</DialogTitle>
          <DialogDescription className="text-xs">差出人はログイン中のご自身のアドレスです。送信控えは Gmail の「送信済み」に残ります</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground w-12">宛先</span>
              <span className="font-medium">{doc.client_name}</span>
              {client?.email ? <span className="text-muted-foreground">{client.email}</span> : <span className="text-amber-700">メールアドレスが未登録です（クライアント一覧で登録してください）</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-12">添付</span>
              <Badge variant="outline" className="text-[10px] font-normal gap-1"><Paperclip className="w-3 h-3" /> {type === "invoice" ? "請求書" : "納品書"}_{type === "invoice" ? doc.invoice_number : doc.delivery_number}.pdf</Badge>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">件名</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">本文</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="text-sm font-mono" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={send} disabled={sending || !client?.email || !subject.trim() || !body.trim()} className="gap-1.5">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} 送信
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
