import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ].filter(Boolean).join(' / ');

  throw new Error(
    `Supabase の接続情報が設定されていません（未設定: ${missing}）。\n` +
    '・Vercel の場合: Settings → Environment Variables に上記を追加し、' +
    'Production / Preview / Development すべてにチェックを入れて保存したうえで、' +
    'Deployments から Redeploy してください（環境変数はビルド時に埋め込まれるため、' +
    '追加しただけでは既存のデプロイに反映されません）。\n' +
    '・ローカルの場合: .env.example を .env.local にコピーして値を設定してください。'
  );
}

// publishable key（旧 anon key）はブラウザに載せる前提の公開鍵。
// 実際のアクセス制御は Postgres 側の RLS が担う。
// service_role key は絶対にここで使わないこと（サーバー側専用）。
export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
