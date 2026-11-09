import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { sendMail, isMailConfigured } from './_lib/gmail.js';
import { loadDocumentPdf } from './document-pdf.js';
import { documentMailSender } from '../src/lib/mailSenders.js';

// ============================================================================
// POST /api/send-document-email  { type: 'invoice'|'delivery'|'estimate'|'receipt', id, subject, body, stamp? }
//   請求書は ids: [...] で、同じクライアント宛ての請求書を 1 通のメールにまとめて送れる（PDF を複数添付・最大 20 件）
//
// 納品書・請求書・見積書のPDFを添付して、クライアントへメールを送る。
// 宛先はクライアントマスタのメールアドレス（サーバー側で解決）。
// 画面から任意のアドレスへは送れない（見積依頼メールと同じ方針）。
// 差出人は操作した本人。ただし請求書は会社の共通アドレス（info@）から送り、送付確認用に info@ も CC に入れる
// （src/lib/mailSenders.js。画面からは変えられない）。GMAIL_ALWAYS_CC が設定されていれば控えがCCされる。
// ============================================================================

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;

  const { type, id: idParam, ids, subject, body, stamp } = req.body || {};
  const idList = Array.isArray(ids) && ids.length ? [...new Set(ids.filter((x) => typeof x === 'string' && x))].slice(0, 20) : (idParam ? [idParam] : []);
  const id = idList[0];
  if (!['delivery', 'invoice', 'estimate', 'receipt', 'partner_order'].includes(type) || idList.length === 0 || !subject || !body) {
    res.status(400).json({ error: '送信に必要な項目が足りません' });
    return;
  }
  if (idList.length > 1 && type !== 'invoice') {
    res.status(400).json({ error: 'まとめて送れるのは請求書だけです' });
    return;
  }
  if (!isMailConfigured()) {
    res.status(503).json({ error: 'メール送信が設定されていません。管理者にご連絡ください（docs/gmail-setup.md）' });
    return;
  }

  try {
    const admin = adminClient();
    const loaded = [];
    for (const one of idList) loaded.push({ id: one, ...(await loadDocumentPdf(admin, type, one, { stamp: stamp !== false })) });
    const { doc } = loaded[0];
    const findClient = async (d) => {
      let c = null;
      if (d.client_id) ({ data: c } = await admin.from('clients').select('id, name, email, cc_emails').eq('id', d.client_id).maybeSingle());
      if (!c) ({ data: c } = await admin.from('clients').select('id, name, email, cc_emails').eq('name', d.client_name).order('created_at').limit(1).maybeSingle());
      return c;
    };

    // 宛先: クライアントマスタ（id があれば id、無ければ名前）から。
    // 発注書は連携先（クライアント一覧か印刷所情報）から
    let client = null;
    if (type === 'partner_order') {
      const table = doc.partner_type === 'print_vendor' ? 'print_vendors' : 'clients';
      const cols = doc.partner_type === 'print_vendor' ? 'id, name, email' : 'id, name, email, cc_emails';
      if (doc.partner_id) ({ data: client } = await admin.from(table).select(cols).eq('id', doc.partner_id).maybeSingle());
      if (!client) ({ data: client } = await admin.from(table).select(cols).eq('name', doc.partner_name).order('created_at').limit(1).maybeSingle());
      if (!client) { res.status(404).json({ error: `「${doc.partner_name}」が${doc.partner_type === 'print_vendor' ? '印刷所情報' : 'クライアント一覧'}に見つかりません` }); return; }
    } else if (doc.client_id) {
      ({ data: client } = await admin.from('clients').select('id, name, email, cc_emails').eq('id', doc.client_id).maybeSingle());
    }
    if (!client) {
      ({ data: client } = await admin.from('clients').select('id, name, email, cc_emails').eq('name', doc.client_name).order('created_at').limit(1).maybeSingle());
    }
    if (!client) {
      res.status(404).json({ error: `「${doc.client_name}」がクライアント一覧に登録されていません` });
      return;
    }
    if (!client.email) {
      res.status(400).json({ error: `「${client.name}」のメールアドレスが未登録です。クライアント一覧で登録してください` });
      return;
    }
    // まとめて送るときは、すべて同じクライアント宛てであること（別のクライアントの請求書を混ぜて送らない）
    for (const l of loaded.slice(1)) {
      const c = await findClient(l.doc);
      if (!c || c.id !== client.id) {
        res.status(400).json({ error: `同じクライアント宛ての請求書だけをまとめて送れます（${l.doc.invoice_number || l.id} は「${l.doc.client_name}」宛て）` });
        return;
      }
    }

    const fixed = documentMailSender(type);
    let sendError = null;
    try {
      await sendMail({
        sendAs: fixed.sendAs || user.email,
        to: client.email,
        // クライアント一覧の CC（最大2件）＋ 書類ごとに決めた CC（請求書は info@）。画面からは指定できない
        cc: [...(Array.isArray(client.cc_emails) ? client.cc_emails : []).filter((a) => typeof a === 'string' && a.includes('@')).slice(0, 2), ...fixed.cc].join(', '),
        keepSelfCc: fixed.cc.length > 0,
        subject,
        body,
        fromName: '株式会社コンセプト・ヴィレッジ',
        attachments: loaded.map((l) => ({ filename: l.filename, content: l.buffer, contentType: 'application/pdf' })),
      });
    } catch (err) {
      sendError = err;
    }

    // 送付履歴は書類ごとに 1 行（まとめて送った請求書は、それぞれの請求書の履歴に出る）
    const { data: logs } = await admin
      .from('email_logs')
      .insert(loaded.map((l) => ({
        // 見積書は見積の送信履歴（メール生成タブ）にも出す
        estimate_id: type === 'estimate' ? l.id : null,
        spec_label: type === 'estimate' ? '見積書PDFをクライアントへ送付' : null,
        document_type: type,
        document_id: l.id,
        recipient_company: client.name,
        recipient_email: client.email,
        subject,
        body,
        status: sendError ? 'failed' : 'sent',
        sent_at: sendError ? null : new Date().toISOString(),
      })))
      .select();
    const log = (logs || [])[0] || null;

    if (sendError) {
      console.error('[api/send-document-email]', sendError);
      res.status(502).json({ error: sendError.message, log });
      return;
    }

    // 請求書は送付済にする（下書きのときだけ。入金済などは触らない）
    if (type === 'invoice') {
      for (const l of loaded) {
        if (l.doc.status === 'draft') await admin.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', l.id);
      }
    }
    if (type === 'delivery' && doc.status === 'draft') {
      await admin.from('delivery_notes').update({ status: 'issued' }).eq('id', id);
    }
    if (type === 'receipt' && doc.status !== 'sent') {
      await admin.from('receipts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
    }
    if (type === 'partner_order' && (doc.status === 'draft' || doc.status === 'issued')) {
      await admin.from('partner_orders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
    }

    // 見積書は、送った版を「提出済」にし、同じ見積で前に提出済だった版を「失注」にする
    let submission = null;
    if (type === 'estimate') {
      try {
        const now = new Date().toISOString();
        const patch = { submission_status: 'submitted', is_final_submitted: true, submitted_at: now };
        const { error: upErr } = await admin.from('estimates').update(patch).eq('id', id);
        if (upErr) throw upErr;
        const groupId = doc.project_group_id || doc.id;
        const { data: lost } = await admin.from('estimates')
          .update({ submission_status: 'lost', is_final_submitted: false })
          .eq('project_group_id', groupId).neq('id', id).eq('submission_status', 'submitted')
          .select('id');
        submission = { patch, lost_count: (lost || []).length };
      } catch (err) {
        // 提出ステータスの列が無い（SQL 未実行）などでも、メールの送信は成功として返す
        console.warn('[api/send-document-email] submission status not updated:', err?.message || err);
      }
    }

    res.status(200).json({ log, logs, recipient_email: client.email, submission });
  } catch (err) {
    console.error('[api/send-document-email]', err);
    res.status(err.status || 500).json({ error: err.message || 'メールの送信に失敗しました' });
  }
}
