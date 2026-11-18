import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Vercel Functions 共通の入口処理
//
// ここを通さずに外部APIを呼ぶ関数を作らないこと。
// ANTHROPIC_API_KEY などの秘密鍵をサーバーに置く以上、
// 「ログイン済みの社内メンバーからの呼び出しか」を必ず確認する必要がある。
// これが無いと、URLを知った第三者に鍵を使われて課金だけされる。
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** RLS を無視して読み書きできる管理者クライアント。サーバー内でのみ使う。 */
export function adminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      'サーバー側の環境変数が未設定です（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）。' +
      'Vercel の Environment Variables を確認してください（VITE_ は付けないこと）。'
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * 呼び出した人の権限で読み書きするクライアント（RLS が効く）。
 * AI チャットが CVアプリの情報を読むときに使う（見られない情報は、その人のチャットからも見えない）。
 */
export function userClient(accessToken) {
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !key) throw new Error('サーバー側の環境変数が未設定です（SUPABASE_URL と公開キー）');
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Authorization ヘッダーのトークン */
export const bearerToken = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : null; };

/**
 * 呼び出し元がこのアプリの利用者かを確認する。
 * 通れば user を返し、通らなければレスポンスを返し終えて null を返す。
 */
export async function requireMember(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'ログインが必要です' });
    return null;
  }

  const admin = adminClient();

  // トークンが本物か（Supabase が発行し、失効していないか）を確認する
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'ログイン状態を確認できませんでした。再度ログインしてください' });
    return null;
  }

  // 認証が通っていても、利用者として登録されていなければ拒否する
  const { data: profile } = await admin
    .from('users')
    .select('id, role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    res.status(403).json({ error: 'このアプリの利用者として登録されていません' });
    return null;
  }

  return { id: user.id, email: user.email, role: profile.role, full_name: profile.full_name || '' };
}

/** POST 以外を弾く。 */
export function requirePost(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'POST のみ受け付けます' });
    return false;
  }
  return true;
}
