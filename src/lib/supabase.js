import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Supabase の接続情報が設定されていません。' +
    '.env.example を .env.local にコピーし、VITE_SUPABASE_URL と ' +
    'VITE_SUPABASE_PUBLISHABLE_KEY を設定してください。'
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
