import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { sendMail, isMailConfigured } from './_lib/gmail.js';

// ============================================================================
// POST /api/send-estimate-email
//
// 印刷会社へ見積依頼メールを送り、送信記録（email_logs）を残す。
//
// 宛先アドレスは画面から受け取らず、会社名から印刷所マスタを引いて決める。
// 画面から任意のアドレスを渡せる作りにすると、ログインできる人なら誰でも
// 会社のメールアドレスから好きな相手に送信できてしまうため。
// ============================================================================

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;

  const user = await requireMember(req, res);
  if (!user) return;

  const {
    estimate_id: estimateId,
    recipient_company: company,
    subject,
    body,
    spec_label: specLabel,
  } = req.body || {};

  if (!estimateId || !company || !subject || !body) {
    res.status(400).json({ error: '送信に必要な項目が足りません' });
    return;
  }

  if (!isMailConfigured()) {
    res.status(503).json({
      error: 'メール送信が設定されていません。管理者にご連絡ください（docs/gmail-setup.md）',
    });
    return;
  }

  try {
    const admin = adminClient();

    const { data: vendor } = await admin
      .from('print_vendors')
      .select('name, email')
      .eq('name', company)
      .maybeSingle();

    if (!vendor) {
      res.status(404).json({ error: `「${company}」が印刷所情報に登録されていません` });
      return;
    }

    if (!vendor.email) {
      res.status(400).json({
        error: `「${company}」のメールアドレスが未登録です。印刷所情報で登録してください`,
      });
      return;
    }

    let sendError = null;
    try {
      await sendMail({
        // 操作した本人のアドレスから送る。返信は本人に直接届く。
        sendAs: user.email,
        to: vendor.email,
        subject,
        body,
        fromName: '株式会社コンセプト・ヴィレッジ',
      });
    } catch (err) {
      sendError = err;
    }

    // 送れても送れなくても記録を残す。「送ったつもり」を防ぐため、
    // 失敗は failed として残し、画面の履歴でも区別できるようにする。
    const { data: log } = await admin
      .from('email_logs')
      .insert({
        estimate_id: estimateId,
        recipient_company: company,
        recipient_email: vendor.email,
        subject,
        body,
        status: sendError ? 'failed' : 'sent',
        sent_at: sendError ? null : new Date().toISOString(),
        // どの印刷仕様の依頼かを履歴に残す（表示用の文字列。無くてもよい）
        spec_label: typeof specLabel === 'string' ? specLabel.slice(0, 200) : null,
      })
      .select()
      .single();

    if (sendError) {
      console.error('[api/send-estimate-email]', sendError);
      res.status(502).json({ error: sendError.message, log });
      return;
    }

    res.status(200).json({ log, recipient_email: vendor.email });
  } catch (err) {
    console.error('[api/send-estimate-email]', err);
    res.status(500).json({ error: err.message || 'メールの送信に失敗しました' });
  }
}
