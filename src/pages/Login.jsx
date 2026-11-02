import { APP_FULL_NAME } from "@/lib/constants";
import React, { useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { LogIn, Loader2, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";

// ログインはGoogleアカウントのみ。
// 許可ドメイン（concept-village.co.jp）以外は Supabase 側のトリガーで弾かれる。
export default function Login() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGoogle = async (external = false) => {
    setError("");
    setLoading(true);
    try {
      await db.auth.loginWithProvider("google", "/", { external });
    } catch (err) {
      setError(err.message || "ログインに失敗しました");
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title={APP_FULL_NAME}
      subtitle="Googleアカウントでログインしてください"
      footer="株式会社コンセプト・ヴィレッジのアカウント（@concept-village.co.jp）でログインできます"
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Button
        className="w-full h-12 text-sm font-medium"
        variant="outline"
        onClick={() => handleGoogle(false)}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        ) : (
          <GoogleIcon className="w-5 h-5 mr-2" />
        )}
        Googleでログイン
      </Button>
      {/* 管理者が社外のアドレスとして特別に招待した方（Gmail など）はこちら */}
      <button type="button" onClick={() => handleGoogle(true)} disabled={loading} className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline" data-testid="login-external">
        社外の方（特別に招待された方）はこちら
      </button>
    </AuthLayout>
  );
}
