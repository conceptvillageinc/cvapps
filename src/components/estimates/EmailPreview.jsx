import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, Send, Loader2, Sparkles, Eye, Edit3 } from "lucide-react";
import { db } from "@/api/db";
import { toast } from "sonner";
import {
  defaultRecipients, recipientOptions, buildSpecText, buildEmailPrompt, EMAIL_SCHEMA,
} from "@/lib/estimateEmail";

export default function EmailPreview({ estimate, emailLogs = [], onEmailSent }) {
  const [generating, setGenerating] = useState(false);
  const [emails, setEmails] = useState([]);
  const [editingIdx, setEditingIdx] = useState(null);
  const [selected, setSelected] = useState(null); // null = 既定値の適用前

  const { data: printVendors = [] } = useQuery({
    queryKey: ["printVendors"],
    queryFn: () => db.entities.PrintVendor.list("name"),
  });

  const options = useMemo(
    () => recipientOptions(printVendors, estimate),
    [printVendors, estimate],
  );

  // 旧形式は印刷物種別から宛先が決まるので、それを初期選択にする。
  // 新形式は決め手が無いので未選択から始める。
  useEffect(() => {
    if (selected !== null) return;
    const preset = defaultRecipients(estimate);
    if (preset.length > 0 || options.length > 0) setSelected(preset);
  }, [estimate, options, selected]);

  const vendors = selected || [];

  const toggleVendor = (name) => {
    setSelected(prev => {
      const current = prev || [];
      return current.includes(name)
        ? current.filter(v => v !== name)
        : [...current, name];
    });
  };

  const generateEmails = async () => {
    if (vendors.length === 0) {
      toast.error("送信先を1社以上選んでください");
      return;
    }
    setGenerating(true);
    try {
      const result = await db.integrations.Core.InvokeLLM({
        prompt: buildEmailPrompt(vendors, buildSpecText(estimate)),
        response_json_schema: EMAIL_SCHEMA,
      });
      const generated = result?.emails || [];
      if (generated.length === 0) {
        toast.error("メールを生成できませんでした。もう一度お試しください");
      } else {
        setEmails(generated);
      }
    } catch (err) {
      // 以前は失敗しても画面に何も出ず、押しても無反応に見えていた
      toast.error("メールの生成に失敗しました: " + err.message);
    } finally {
      setGenerating(false);
    }
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
          <Button
            variant="outline"
            size="sm"
            onClick={generateEmails}
            disabled={generating || vendors.length === 0}
            className="gap-1.5 text-xs"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AIでメール生成
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 送信先の選択。印刷所情報に登録された「メール依頼先」から選ぶ */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">送信先を選ぶ</p>
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              メール依頼先が登録されていません。「印刷所情報」で種別を「メール」にした取引先を追加してください。
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {options.map(name => (
                <label key={name} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={vendors.includes(name)}
                    onCheckedChange={() => toggleVendor(name)}
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
        </div>

        {emails.length === 0 && emailLogs.length === 0 && (
          <div className="text-center py-6">
            <Mail className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {vendors.length === 0
                ? "送信先を選んでから「AIでメール生成」をクリックしてください"
                : `「AIでメール生成」をクリックすると、${vendors.join("・")}宛の見積依頼メールを自動生成します`}
            </p>
          </div>
        )}

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
