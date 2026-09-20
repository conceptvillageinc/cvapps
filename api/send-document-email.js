import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { sendMail, isMailConfigured } from './_lib/gmail.js';
import { loadDocumentPdf } from './document-pdf.js';

// ============================================================================
// POST /api/send-document-email  { type: 'invoice'|'delivery', id, subject, body }
//
// 納品書・請求書のPDFを添付して、クライアントへメールを送る。
// 宛先はクライアントマスタのメールアドレス（サーバー側で解決）。
// 画面から任意のアドレスへは送れない（見積依頼メールと同じ方針）。
// 差出人は操作した本人。GMAIL_ALWAYS_CC が設定されていれば控えがCCされる。
// ============================================================================

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;

  const { type, id, subject, body } = req.body || {};
  if (!['delivery', 'invoice'].includes(type) || !id || !subject || !body) {
    res.status(400).json({ error: '送信に必要な項目が足りません' });
    return;
  }
  if (!isMailConfigured()) {
    res.status(503).json({ error: 'メール送信が設定されていません。管理者にご連絡ください（docs/gmail-setup.md）' });
    return;
  }

  try {
    const admin = adminClient();
    const { buffer, filename, doc } = await loadDocumentPdf(admin, type, id);

    // 宛先: クライアントマスタ（id があれば id、無ければ名前）から
    let client = null;
    if (doc.client_id) {
      ({ data: client } = await admin.from('clients').select('id, name, email').eq('id', doc.client_id).maybeSingle());
    }
    if (!client) {
      ({ data: client } = await admin.from('clients').select('id, name, email').eq('name', doc.client_name).order('created_at').limit(1).maybeSingle());
    }
    if (!client) {
      res.status(404).json({ error: `「${doc.client_name}」がクライアント一覧に登録されていません` });
      return;
    }
    if (!client.email) {
      res.status(400).json({ error: `「${client.name}」のメールアドレスが未登録です。クライアント一覧で登録してください` });
      return;
    }

    let sendError = null;
    try {
      await sendMail({
        sendAs: user.email,
        to: client.email,
        subject,
        body,
        fromName: '株式会社コンセプト・ヴィレッジ',
        attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
      });
    } catch (err) {
      sendError = err;
    }

    const { data: log } = await admin
      .from('email_logs')
      .insert({
        estimate_id: null,
        document_type: type,
        document_id: id,
        recipient_company: client.name,
        recipient_email: client.email,
        subject,
        body,
        status: sendError ? 'failed' : 'sent',
        sent_at: sendError ? null : new Date().toISOString(),
      })
      .select()
      .single();

    if (sendError) {
      console.error('[api/send-document-email]', sendError);
      res.status(502).json({ error: sendError.message, log });
      return;
    }

    // 請求書は送付済にする（下書きのときだけ。入金済などは触らない）
    if (type === 'invoice' && doc.status === 'draft') {
      await admin.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
    }
    if (type === 'delivery' && doc.status === 'draft') {
      await admin.from('delivery_notes').update({ status: 'issued' }).eq('id', id);
    }

    res.status(200).json({ log, recipient_email: client.email });
  } catch (err) {
    console.error('[api/send-document-email]', err);
    res.status(err.status || 500).json({ error: err.message || 'メールの送信に失敗しました' });
  }
}
