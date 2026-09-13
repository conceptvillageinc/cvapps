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

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      await db.auth.loginWithProvider("google", "/");
    } catch (err) {
      setError(err.message || "ログインに失敗しました");
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="CV見積アプリ"
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
        onClick={handleGoogle}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        ) : (
          <GoogleIcon className="w-5 h-5 mr-2" />
        )}
        Googleでログイン
      </Button>
    </AuthLayout>
  );
}
