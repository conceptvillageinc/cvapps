import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { companyInfoFromSettings } from "@/lib/documents";
import { defaultSignature, greetingLine, senderSignature } from "@/lib/senderProfile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserCircle, Save, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

/**
 * 自分の設定（ログインユーザーごと）
 * - 氏名
 * - メールの名乗りに使う名前（苗字）
 * - メール署名
 * 見積依頼メール・見積書／請求書送付メールの文面に使う。
 */
export default function MyProfile() {
  const { user, checkUserAuth } = useAuth();
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);

  const [form, setForm] = useState({ full_name: "", short_name: "", email_signature: "" });
  useEffect(() => {
    if (!user) return;
    setForm({
      full_name: user.full_name && !String(user.full_name).includes("@") ? user.full_name : "",
      short_name: user.short_name || "",
      email_signature: user.email_signature || "",
    });
  }, [user]);

  const save = useMutation({
    mutationFn: () => db.entities.User.update(user.id, {
      full_name: form.full_name.trim() || null,
      short_name: form.short_name.trim() || null,
      email_signature: form.email_signature.trim() || null,
    }),
    onSuccess: async () => {
      await checkUserAuth({ silent: true });
      toast.success("保存しました。次に生成するメールから反映されます");
    },
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });

  const preview = { ...user, ...form };
  const greeting = greetingLine(preview, company);
  const signature = senderSignature(preview, company);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <UserCircle className="w-6 h-6" /> 自分の設定
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{user?.email}　メールの名乗りと署名はユーザーごとに持ちます</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">名前</CardTitle>
          <CardDescription className="text-xs">氏名は画面の表示と既定の署名に、苗字はメールの名乗りに使います</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">氏名</Label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="例: 馬場 大治" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">メールの名乗りに使う名前（苗字）</Label>
            <Input value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} placeholder="例: 馬場" className="h-9" />
            <p className="text-[10px] text-muted-foreground">空欄なら氏名の最初の語（スペースの前）を使います</p>
          </div>
          <div className="sm:col-span-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">名乗りの例：</span> いつも大変お世話になっております。<br />
            <span className="font-medium">{greeting}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">メール署名</CardTitle>
          <CardDescription className="text-xs">見積依頼メール（印刷所宛）と見積書・納品書・請求書の送付メール（クライアント宛）の末尾に、この通り入ります</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={form.email_signature}
            onChange={(e) => setForm({ ...form, email_signature: e.target.value })}
            placeholder={defaultSignature(preview, company)}
            rows={7}
            className="text-sm font-mono"
          />
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setForm({ ...form, email_signature: defaultSignature(preview, company) })}>
              <RotateCcw className="w-3.5 h-3.5" /> 既定の署名を入れる
            </Button>
            <p className="text-[10px] text-muted-foreground">空欄のときは、会社名・氏名・メールアドレス・電話番号から自動で作ります</p>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap font-mono">{signature}</div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending || !user} className="gap-1.5">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存
        </Button>
      </div>
    </div>
  );
}
