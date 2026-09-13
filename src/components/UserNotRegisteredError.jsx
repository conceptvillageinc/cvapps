import React from "react";
import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthLayout from "@/components/AuthLayout";
import { useAuth } from "@/lib/AuthContext";

// Googleログインは通ったが public.users に行がない状態。
// 許可ドメイン内でも、まだ利用者として登録されていない場合にここへ来る。
export default function UserNotRegisteredError() {
  const { authError, logout } = useAuth();
  const email = authError?.email;

  return (
    <AuthLayout
      icon={ShieldAlert}
      title="利用者として登録されていません"
      subtitle="このアカウントではアプリを利用できません"
      footer="株式会社コンセプト・ヴィレッジのアカウント（@concept-village.co.jp）が必要です"
    >
      <ul className="text-sm text-muted-foreground space-y-2 mb-6 list-disc list-inside">
        <li>別のアカウントでログインしていないかご確認ください</li>
        <li>正しいアカウントの場合は、管理者に利用登録をご依頼ください</li>
      </ul>

      {email && (
        <div className="mb-6 p-3 rounded-lg bg-muted text-sm text-muted-foreground">
          現在のアカウント: {email}
        </div>
      )}

      <Button className="w-full h-12" variant="outline" onClick={() => logout()}>
        <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
        別のアカウントでログイン
      </Button>
    </AuthLayout>
  );
}
