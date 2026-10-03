import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { renderDocumentPdf } from './_lib/pdf.js';
import { renderEstimatePdf, estimateFilename } from './_lib/estimatePdf.js';
import { renderPurchaseOrderPdf, purchaseOrderFilename } from './_lib/purchaseOrderPdf.js';
import { renderReceiptPdf } from './_lib/receiptPdf.js';
import { documentFilename } from '../src/lib/docFilename.js';

// ============================================================================
// POST /api/document-pdf  { type: 'delivery' | 'invoice' | 'estimate' | 'purchase_order' | 'receipt', id, stamp?: boolean, layout?: 'a5' | 'a4' }
//
// 納品書・請求書・見積書・発注書（見積から作るクライアント記入用の雛形）のPDFを生成して返す。会社情報と印影は system_settings から。
// 印影は非公開バケットにあり、service_role で読む（URLは外に出さない）。
// stamp: false を渡すと印影を押さない（郵送・持参で押印する場合）。既定は押す。
// ============================================================================

const TYPES = ['delivery', 'invoice', 'estimate', 'purchase_order', 'receipt'];

async function loadCompany(admin) {
  const { data: row } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'company_info').maybeSingle();
  let company = {};
  try { company = row ? JSON.parse(row.setting_value) : {}; } catch { company = {}; }
  return { name: '株式会社コンセプト・ヴィレッジ', locations: [], bank_accounts: [], ...company };
}

async function loadImage(admin, storagePath) {
  if (!storagePath) return null;
  const { data: file } = await admin.storage.from('uploads').download(storagePath);
  return file ? Buffer.from(await file.arrayBuffer()) : null;
}
const loadStamp = (admin, company) => loadImage(admin, company.stamp_path);
const loadLogo = (admin, company) => loadImage(admin, company.logo_path);

export async function loadDocumentPdf(admin, type, id, { stamp: withStamp = true, layout = 'a5' } = {}) {
  const company = await loadCompany(admin);
  const stamp = withStamp ? await loadStamp(admin, company) : null;
  const logo = await loadLogo(admin, company);

  if (type === 'estimate' || type === 'purchase_order') {
    const { data: est, error } = await admin.from('estimates').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!est) { const e = new Error('見積が見つかりません'); e.status = 404; throw e; }
    let client = null;
    if (est.client_name) {
      ({ data: client } = await admin.from('clients').select('id, name, postal_code, address, email, contact_person, phone').eq('name', est.client_name).order('created_at').limit(1).maybeSingle());
    }
    if (type === 'purchase_order') {
      // 発注書はクライアントが記入する書類なので印影は押さない
      const buffer = await renderPurchaseOrderPdf({ estimate: est, client, company });
      return { buffer, filename: purchaseOrderFilename(est), doc: est, client };
    }
    const buffer = await renderEstimatePdf({ estimate: est, client, company, stamp, logo });
    return { buffer, filename: estimateFilename(est), doc: est, client };
  }

  if (type === 'receipt') {
    const { data: receipt, error } = await admin.from('receipts').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!receipt) { const e = new Error('領収書が見つかりません'); e.status = 404; throw e; }
    const buffer = await renderReceiptPdf({ receipt, company, stamp, logo, layout: layout === 'a4' ? 'a4' : 'a5' });
    return { buffer, filename: documentFilename('receipt', receipt), doc: receipt };
  }

  const table = type === 'invoice' ? 'invoices' : 'delivery_notes';
  const { data: doc, error } = await admin.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) { const e = new Error('帳票が見つかりません'); e.status = 404; throw e; }

  const buffer = await renderDocumentPdf({ type, doc, company, stamp, logo });
  const filename = documentFilename(type, doc);
  return { buffer, filename, doc };
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;

  const { type, id, stamp, layout } = req.body || {};
  if (!TYPES.includes(type) || !id) {
    res.status(400).json({ error: 'type と id を指定してください' });
    return;
  }

  try {
    const { buffer, filename } = await loadDocumentPdf(adminClient(), type, id, { stamp: stamp !== false, layout });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.status(200).send(buffer);
  } catch (err) {
    console.error('[api/document-pdf]', err);
    res.status(err.status || 500).json({ error: err.message || 'PDFの生成に失敗しました' });
  }
}
