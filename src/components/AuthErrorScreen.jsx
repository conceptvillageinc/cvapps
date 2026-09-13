import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthLayout from "@/components/AuthLayout";

// 401/403 以外で認証確認に失敗したときの画面。
// 通信エラーや設定不備がここに来る。原因を隠さず出すこと（白画面を作らない）。
export default function AuthErrorScreen({ message, onRetry }) {
  return (
    <AuthLayout
      icon={AlertTriangle}
      title="接続できませんでした"
      subtitle="ログイン状態を確認できませんでした"
      footer="解消しない場合は、下のメッセージを添えて管理者にご連絡ください"
    >
      <div className="mb-6 p-3 rounded-lg bg-muted text-sm text-muted-foreground break-words">
        {message || "原因不明のエラーが発生しました"}
      </div>
      <Button className="w-full h-12" variant="outline" onClick={onRetry}>
        <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
        再試行
      </Button>
    </AuthLayout>
  );
}
