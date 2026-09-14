import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { sendMail, isMailConfigured } from './_lib/gmail.js';

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

function inviteBody(appUrl, inviterName) {
  return `CV見積アプリへご招待します。

下記のURLを開き、会社のGoogleアカウント（@${ALLOWED_DOMAIN}）でログインしてください。
ログインした時点で利用開始となります。パスワードの設定は不要です。

${appUrl}

招待者: ${inviterName}

※このメールに心当たりがない場合は破棄してください。
`;
}

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

    // 招待自体は登録できているので、メールが送れなくても失敗にはしない。
    // ここで 500 を返すと、管理者には「招待できなかった」と見えるのに
    // 招待レコードは残っている、という食い違いが起きる。
    let mail = { sent: false, reason: 'メール送信が未設定です' };

    if (isMailConfigured()) {
      const appUrl = req.headers.origin || `https://${req.headers.host}`;
      try {
        await sendMail({
          sendAs: user.email,
          to: email,
          subject: 'CV見積アプリへの招待',
          body: inviteBody(appUrl, user.email),
          fromName: 'CV見積アプリ',
        });
        mail = { sent: true };
      } catch (mailErr) {
        console.error('[api/invite] メール送信失敗', mailErr);
        mail = { sent: false, reason: mailErr.message };
      }
    }

    res.status(200).json({ invitation: data, mail });
  } catch (err) {
    console.error('[api/invite]', err);
    res.status(500).json({ error: err.message || '招待の登録に失敗しました' });
  }
}
