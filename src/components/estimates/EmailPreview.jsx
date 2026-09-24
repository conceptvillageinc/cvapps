import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, Send, Loader2, Sparkles, Eye, Edit3, Printer } from "lucide-react";
import { specLabel, specMissing } from "@/lib/printSpecs";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { greetingLine, senderSignature } from "@/lib/senderProfile";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { companyInfoFromSettings } from "@/lib/documents";
import { toast } from "sonner";
import {
  defaultRecipients, recipientOptions, buildSpecText, buildEmailPrompt, EMAIL_SCHEMA,
} from "@/lib/estimateEmail";

export default function EmailPreview({ estimate, emailLogs = [], onEmailSent }) {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  const [generating, setGenerating] = useState(false);
  const [emails, setEmails] = useState([]);
  const [editingIdx, setEditingIdx] = useState(null);
  const [sendingIdx, setSendingIdx] = useState(null);
  const [selected, setSelected] = useState(null); // null = 既定値の適用前
  // 新形式: どの印刷仕様を依頼するか（既定は全部）
  const allSpecs = estimate.schema_version === 2 ? (estimate.print_specs || []) : [];
  const [specIds, setSpecIds] = useState(null);
  const selectedSpecs = allSpecs.filter(sp => specIds === null || specIds.includes(sp.id));
  const toggleSpec = (id) => setSpecIds(prev => {
    const cur = prev === null ? allSpecs.map(sp => sp.id) : prev;
    return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  });

  const { data: printVendors = [] } = useQuery({
    queryKey: ["printVendors"],
    queryFn: () => db.entities.PrintVendor.list("name"),
  });

  const options = useMemo(
    () => recipientOptions(printVendors, estimate, selectedSpecs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printVendors, estimate.schema_version, estimate.print_type, JSON.stringify(selectedSpecs.map(sp => sp.print_type))],
  );

  // 印刷物種別から宛先の既定値を決める（旧形式は見積の種別、新形式は選んだ印刷仕様の種別）。
  // 決め手が無い新形式は未選択から始める。
  useEffect(() => {
    if (selected !== null) return;
    const preset = defaultRecipients(estimate, selectedSpecs);
    if (preset.length > 0 || options.length > 0) setSelected(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, options, selected]);

  const vendors = selected || [];

  const vendorEmail = (name) =>
    printVendors.find(v => v.name === name)?.email || "";

  // 選んだ宛先のうち、メールアドレスが未登録の会社
  const missingEmail = vendors.filter(name => !vendorEmail(name));

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
    if (estimate.schema_version === 2 && allSpecs.length > 0 && selectedSpecs.length === 0) {
      toast.error("依頼する印刷仕様を1件以上選んでください");
      return;
    }
    setGenerating(true);
    try {
      const result = await db.integrations.Core.InvokeLLM({
        prompt: buildEmailPrompt(vendors, buildSpecText(estimate, selectedSpecs), { greeting: greetingLine(user, company), signature: senderSignature(user, company) }),
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
    setSendingIdx(idx);
    try {
      const { data } = await db.functions.invoke("sendEstimateEmail", {
        estimate_id: estimate.id,
        recipient_company: email.company_name,
        subject: email.subject,
        body: email.body,
        spec_label: selectedSpecs.map((sp, i) => specLabel(sp, i)).join(" / ") || null,
      });
      toast.success(`${email.company_name}（${data.recipient_email}）へ送信しました`);
      onEmailSent?.();
    } catch (err) {
      // 送信できなかった場合もサーバー側で failed として記録している。
      // 「送ったつもり」にならないよう、履歴を読み直す。
      toast.error("送信できませんでした: " + err.message);
      onEmailSent?.();
    } finally {
      setSendingIdx(null);
    }
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
        {/* 新形式: どの印刷仕様を依頼するか */}
        {estimate.schema_version === 2 && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> 依頼する印刷仕様</p>
            {allSpecs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                印刷仕様が未入力です。「印刷仕様」タブで種別・サイズ・枚数・希望納期を入力すると、その内容で依頼メールを作ります
                （未入力のままでも、見積書の明細から作ることはできます）。
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {allSpecs.map((sp, i) => {
                  const missing = specMissing(sp);
                  return (
                    <label key={sp.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox
                        checked={specIds === null || specIds.includes(sp.id)}
                        onCheckedChange={() => toggleSpec(sp.id)}
                      />
                      {specLabel(sp, i)}
                      {missing.length > 0 && <span className="text-[10px] text-amber-700">（{missing.join("・")}が未入力）</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

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

        {missingEmail.length > 0 && (
          <p className="text-xs text-amber-700">
            {missingEmail.join("・")} はメールアドレスが未登録のため送信できません。
            「印刷所情報」で登録してください。
          </p>
        )}

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
                <span className="text-xs text-muted-foreground">
                  {vendorEmail(email.company_name) || "メールアドレス未登録"}
                </span>
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
                  disabled={sendingIdx !== null}
                >
                  {sendingIdx === idx
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Send className="w-3 h-3" />}
                  送信
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
            {[...emailLogs].sort((a, b) => String(b.sent_at || b.created_date || "").localeCompare(String(a.sent_at || a.created_date || ""))).map(log => (
              <div key={log.id} className={`flex items-center gap-3 p-2.5 rounded-lg text-xs ${log.status === "sent" ? "bg-emerald-50 border border-emerald-100" : log.status === "failed" ? "bg-red-50 border border-red-100" : "bg-muted/30"}`}>
                <Badge
                  className={`text-[9px] ${log.status === "sent" ? "bg-emerald-600 text-white hover:bg-emerald-600" : log.status === "failed" ? "bg-red-600 text-white hover:bg-red-600" : "bg-muted text-muted-foreground hover:bg-muted"}`}
                >
                  {log.status === "sent" ? "送信済" : log.status === "failed" ? "送信失敗" : "下書き"}
                </Badge>
                <span className="font-medium">{log.recipient_company}</span>
                {log.spec_label && <Badge variant="outline" className="text-[9px] font-normal">{log.spec_label}</Badge>}
                {log.recipient_email && (
                  <span className="text-muted-foreground">{log.recipient_email}</span>
                )}
                <span className="text-muted-foreground">{log.subject}</span>
                {(log.sent_at || log.created_date) && (
                  <span className="text-muted-foreground ml-auto whitespace-nowrap">
                    {new Date(log.sent_at || log.created_date).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}
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
