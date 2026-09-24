import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { findReplies, isMailConfigured } from './_lib/gmail.js';

// ============================================================================
// POST /api/check-email-replies  { estimate_id }
//
// 見積依頼メール（email_logs）のうち、まだ返信を検知していないものについて、
// 送った本人の Gmail のスレッドを読んで返信が付いているかを確認し、
// reply_detected_at / reply_from / reply_snippet を記録する。
//
// 読むのは「ログイン中の本人が送ったメール」だけ。他の人が送ったメールは
// その人がログインして確認する（他人の受信箱を読まないため）。
// ============================================================================

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;

  const { estimate_id: estimateId } = req.body || {};
  if (!estimateId) {
    res.status(400).json({ error: 'estimate_id を指定してください' });
    return;
  }
  if (!isMailConfigured()) {
    res.status(503).json({ error: 'メール連携が設定されていません（docs/gmail-setup.md）' });
    return;
  }

  try {
    const admin = adminClient();
    const { data: logs, error } = await admin
      .from('email_logs')
      .select('id, recipient_company, recipient_email, sender_email, gmail_thread_id, sent_at, reply_detected_at')
      .eq('estimate_id', estimateId)
      .eq('status', 'sent')
      .not('gmail_thread_id', 'is', null);
    if (error) throw new Error(error.message);

    const me = String(user.email || '').toLowerCase();
    const mine = (logs || []).filter((l) => String(l.sender_email || '').toLowerCase() === me);
    const others = (logs || []).length - mine.length;
    const now = new Date().toISOString();
    const results = [];
    let firstError = null;

    for (const log of mine) {
      if (log.reply_detected_at) { results.push({ id: log.id, company: log.recipient_company, replied: true, cached: true }); continue; }
      try {
        const replies = await findReplies(me, log.gmail_thread_id);
        // 送信後に届いたもののうち、最初の返信を記録する
        const after = replies.filter((r) => !log.sent_at || !r.date || r.date >= log.sent_at);
        const first = after[0] || replies[0] || null;
        const patch = { reply_checked_at: now };
        if (first) {
          patch.reply_detected_at = first.date || now;
          patch.reply_from = first.from.slice(0, 200);
          patch.reply_snippet = first.snippet.slice(0, 500);
        }
        await admin.from('email_logs').update(patch).eq('id', log.id);
        results.push({ id: log.id, company: log.recipient_company, replied: !!first, from: first?.from || null });
      } catch (err) {
        if (!firstError) firstError = err;
        results.push({ id: log.id, company: log.recipient_company, error: err.message });
      }
    }

    res.status(200).json({
      checked: mine.length,
      skipped_others: others,
      found: results.filter((r) => r.replied && !r.cached).length,
      results,
      error: firstError ? firstError.message : null,
    });
  } catch (err) {
    console.error('[api/check-email-replies]', err);
    res.status(500).json({ error: err.message || '受信の確認に失敗しました' });
  }
}
