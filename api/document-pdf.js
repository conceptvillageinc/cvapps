import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { renderDocumentPdf } from './_lib/pdf.js';

// ============================================================================
// POST /api/document-pdf  { type: 'delivery' | 'invoice', id }
//
// 納品書・請求書のPDFを生成して返す。会社情報と印影は system_settings から。
// 印影は非公開バケットにあり、service_role で読む（URLは外に出さない）。
// ============================================================================

export async function loadDocumentPdf(admin, type, id) {
  const table = type === 'invoice' ? 'invoices' : 'delivery_notes';
  const { data: doc, error } = await admin.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) { const e = new Error('帳票が見つかりません'); e.status = 404; throw e; }

  const { data: row } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'company_info').maybeSingle();
  let company = {};
  try { company = row ? JSON.parse(row.setting_value) : {}; } catch { company = {}; }
  company = { name: '株式会社コンセプト・ヴィレッジ', locations: [], bank_accounts: [], ...company };

  let stamp = null;
  if (company.stamp_path) {
    const { data: file } = await admin.storage.from('uploads').download(company.stamp_path);
    if (file) stamp = Buffer.from(await file.arrayBuffer());
  }

  const buffer = await renderDocumentPdf({ type, doc, company, stamp });
  const number = type === 'invoice' ? doc.invoice_number : doc.delivery_number;
  const filename = `${type === 'invoice' ? '請求書' : '納品書'}_${number}_${doc.client_name}.pdf`;
  return { buffer, filename, doc };
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;

  const { type, id } = req.body || {};
  if (!['delivery', 'invoice'].includes(type) || !id) {
    res.status(400).json({ error: 'type と id を指定してください' });
    return;
  }

  try {
    const { buffer, filename } = await loadDocumentPdf(adminClient(), type, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.status(200).send(buffer);
  } catch (err) {
    console.error('[api/document-pdf]', err);
    res.status(err.status || 500).json({ error: err.message || 'PDFの生成に失敗しました' });
  }
}
