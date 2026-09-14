import { requireMember, requirePost, adminClient } from './_lib/guard.js';

// ============================================================================
// POST /api/invite
//
// 管理者がメンバーを招待する。
// 招待された人が初めてGoogleでログインした時点で、DBのトリガーが照合して
// 利用者として登録する（supabase/migrations/0003_invitations.sql）。
//
// 権限の確認をサーバー側で行うのが要点。画面側でボタンを隠すだけだと、
// APIを直接叩かれれば誰でも自分を管理者に招待できてしまう。
// ============================================================================

const ALLOWED_DOMAIN = 'concept-village.co.jp';

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;

  const user = await requireMember(req, res);
  if (!user) return;

  if (user.role !== 'admin') {
    res.status(403).json({ error: 'メンバーを招待できるのは管理者のみです' });
    return;
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = req.body?.role === 'admin' ? 'admin' : 'user';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
    return;
  }

  if (email.split('@')[1] !== ALLOWED_DOMAIN) {
    res.status(400).json({ error: `@${ALLOWED_DOMAIN} のアドレスのみ招待できます` });
    return;
  }

  try {
    const admin = adminClient();

    // すでに利用者なら招待は不要
    const { data: existing } = await admin
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'この方はすでに利用者として登録されています' });
      return;
    }

    // 同じ相手を2回招待しても壊れないようにする（権限だけ更新する）
    const { data, error } = await admin
      .from('invitations')
      .upsert(
        { email, role, invited_by: user.id, accepted_at: null },
        { onConflict: 'email' },
      )
      .select()
      .single();

    if (error) throw new Error(error.message);

    res.status(200).json({ invitation: data });
  } catch (err) {
    console.error('[api/invite]', err);
    res.status(500).json({ error: err.message || '招待の登録に失敗しました' });
  }
}
