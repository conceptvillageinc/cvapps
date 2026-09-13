import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mail, Send, Loader2, Sparkles, Eye, Edit3 } from "lucide-react";
import { db } from "@/api/db";
import { toast } from "sonner";
import { EMAIL_VENDOR_MAP } from "@/lib/constants";

export default function EmailPreview({ estimate, emailLogs = [], onEmailSent }) {
  const [generating, setGenerating] = useState(false);
  const [emails, setEmails] = useState([]);
  const [editingIdx, setEditingIdx] = useState(null);

  const vendors = EMAIL_VENDOR_MAP[estimate.print_type] || [];

  const generateEmails = async () => {
    if (vendors.length === 0) return;
    setGenerating(true);

    const specText = `印刷物種別: ${estimate.print_type}\nサイズ: ${estimate.size || "未指定"}\n用途: ${estimate.usage || "未指定"}\n紙質: ${estimate.paper_type || "未指定"}\n印刷枚数: ${(estimate.quantities || []).map(q => q.toLocaleString() + "枚").join(", ") || "未指定"}\n印刷色数: ${estimate.color_count || "未指定"}\n希望納期: ${estimate.desired_delivery_date || "未指定"}`;

    const result = await db.integrations.Core.InvokeLLM({
      prompt: `以下の印刷仕様に基づいて、印刷会社への見積依頼メールを生成してください。
丁寧なビジネスメールの形式で、以下の情報を含めてください：
- 件名
- 挨拶
- 見積依頼の趣旨
- 印刷仕様の詳細
- 希望納期（必ず強調して記載）
- 返信期限の目安（希望納期の1週間前程度）
- 締めの挨拶

送信先の会社名リスト: ${vendors.join(", ")}

印刷仕様:
${specText}

差出人: 株式会社コンセプト・ヴィレッジ

各社宛にカスタマイズしたメールをJSON配列で返してください。`,
      response_json_schema: {
        type: "object",
        properties: {
          emails: {
            type: "array",
            items: {
              type: "object",
              properties: {
                company_name: { type: "string" },
                subject: { type: "string" },
                body: { type: "string" },
              }
            }
          }
        }
      }
    });

    setEmails(result.emails || []);
    setGenerating(false);
  };

  const sendEmail = async (email, idx) => {
    await db.entities.EmailLog.create({
      estimate_id: estimate.id,
      recipient_company: email.company_name,
      subject: email.subject,
      body: email.body,
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    toast.success(`${email.company_name}への見積依頼メールを記録しました`);
    onEmailSent?.();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="w-4 h-4" /> 見積依頼メール
          </CardTitle>
          {vendors.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={generateEmails}
              disabled={generating}
              className="gap-1.5 text-xs"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              AIでメール生成
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {vendors.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            この印刷物種別にはメール依頼先がありません（ネット印刷対象）
          </p>
        ) : emails.length === 0 && emailLogs.length === 0 ? (
          <div className="text-center py-6">
            <Mail className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              「AIでメール生成」をクリックすると、{vendors.join("・")}宛の見積依頼メールを自動生成します
            </p>
          </div>
        ) : null}

        {/* Generated emails */}
        {emails.map((email, idx) => (
          <div key={idx} className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{email.company_name}</Badge>
                <span className="text-xs text-muted-foreground">{email.subject}</span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
                >
                  {editingIdx === idx ? <Eye className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                  {editingIdx === idx ? "プレビュー" : "編集"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => sendEmail(email, idx)}
                >
                  <Send className="w-3 h-3" /> 送信記録
                </Button>
              </div>
            </div>
            <div className="p-4">
              {editingIdx === idx ? (
                <div className="space-y-2">
                  <Input
                    value={email.subject}
                    onChange={e => {
                      const updated = [...emails];
                      updated[idx] = { ...updated[idx], subject: e.target.value };
                      setEmails(updated);
                    }}
                    className="text-sm"
                  />
                  <Textarea
                    value={email.body}
                    onChange={e => {
                      const updated = [...emails];
                      updated[idx] = { ...updated[idx], body: e.target.value };
                      setEmails(updated);
                    }}
                    rows={10}
                    className="text-sm font-mono"
                  />
                </div>
              ) : (
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {email.body}
                </pre>
              )}
            </div>
          </div>
        ))}

        {/* Sent emails history */}
        {emailLogs.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">送信履歴</p>
            {emailLogs.map(log => (
              <div key={log.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 text-xs">
                <Badge variant="secondary" className="text-[9px]">
                  {log.status === "sent" ? "送信済" : log.status}
                </Badge>
                <span className="font-medium">{log.recipient_company}</span>
                <span className="text-muted-foreground">{log.subject}</span>
                {log.sent_at && (
                  <span className="text-muted-foreground ml-auto">
                    {new Date(log.sent_at).toLocaleDateString("ja-JP")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
