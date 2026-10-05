import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { getAccessToken } from './_lib/gmail.js';
import { readXlsx } from './_lib/xlsx.js';
import { parseCostSheet, templateImageHashes, parseFileTitle, isEmptySheet } from './_lib/costSheet.js';

// ============================================================================
// POST /api/cost-sheet-import
//   { action: "list", folderUrl }            … フォルダの中の原価計算表（スプレッドシート）を列挙する
//   { action: "import", spreadsheetId, clientId?, clientName? } … 1 ファイルを xlsx に書き出して読み、タブごとに cost_sheets へ入れる
//
// 読み取りは操作した本人のアカウント権限（サービスアカウントの権限委任）。本人が開けるファイルだけ読める。
// 必要なスコープ: https://www.googleapis.com/auth/drive（バックアップと同じ）
// 画像（原価の根拠のスクショ）は Storage の uploads/cost-sheets/<spreadsheetId>/<gid>/ に置く。
// ============================================================================

export const config = { maxDuration: 300 };

const SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function parseFolderUrl(raw) {
  const s = String(raw || '').trim();
  const m = /\/folders\/([a-zA-Z0-9_-]+)/.exec(s) || /^([a-zA-Z0-9_-]{20,})$/.exec(s);
  return m ? m[1] : null;
}

async function gapi(token, url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || `Google API エラー (${res.status})`;
    throw new Error(res.status === 403 || res.status === 404 ? `ドライブのファイルを開けませんでした。ログイン中のアカウントで見られるか確認してください（${msg}）` : msg);
  }
  return res;
}

/** クライアント名の表記揺れをそろえる（クライアント一覧との突き合わせ用） */
function normName(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '')
    .replace(/株式会社|有限会社|合同会社|合資会社|一般社団法人|社会福祉法人|医療法人|学校法人|\(株\)|\(有\)|㈱|㈲|（株）|（有）|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ/g, '');
}

function matchClient(name, clients) {
  const n = normName(name);
  if (!n) return null;
  return clients.find((c) => normName(c.name) === n) || clients.find((c) => normName(c.name).includes(n) || n.includes(normName(c.name))) || null;
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  const admin = adminClient();
  const action = req.body?.action || 'list';

  try {
    const token = await getAccessToken(user.email, SCOPE);
    const { data: clients = [] } = await admin.from('clients').select('id, name');

    if (action === 'list') {
      const folderId = parseFolderUrl(req.body?.folderUrl);
      if (!folderId) { res.status(400).json({ error: 'Google ドライブのフォルダの URL を貼ってください（https://drive.google.com/drive/folders/…）' }); return; }
      const files = [];
      let pageToken = '';
      do {
        const q = encodeURIComponent(`'${folderId}' in parents and mimeType='${SHEET_MIME}' and trashed=false`);
        const r = await gapi(token, `${DRIVE}/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime,size)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`);
        const data = await r.json();
        files.push(...(data.files || []));
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      const { data: existing = [] } = await admin.from('cost_sheets').select('spreadsheet_id, imported_at').in('spreadsheet_id', files.map((f) => f.id));
      const importedAt = new Map();
      for (const e of existing) if (!importedAt.has(e.spreadsheet_id) || e.imported_at > importedAt.get(e.spreadsheet_id)) importedAt.set(e.spreadsheet_id, e.imported_at);
      const out = files
        .filter((f) => !/^00_テンプレ|テンプレ/.test(f.name))
        .map((f) => {
          const meta = parseFileTitle(f.name);
          const c = matchClient(meta.client_name, clients);
          return { id: f.id, name: f.name, modifiedTime: f.modifiedTime, period: meta.period, client_name: meta.client_name, client_id: c?.id || null, matched_name: c?.name || null, imported_at: importedAt.get(f.id) || null };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      res.status(200).json({ folderId, files: out });
      return;
    }

    if (action === 'import') {
      const spreadsheetId = String(req.body?.spreadsheetId || '').trim();
      if (!spreadsheetId) { res.status(400).json({ error: 'spreadsheetId がありません' }); return; }
      const metaRes = await gapi(token, `${DRIVE}/files/${spreadsheetId}?fields=id,name,modifiedTime&supportsAllDrives=true`);
      const fileMeta = await metaRes.json();
      const title = parseFileTitle(fileMeta.name);
      const clientId = req.body?.clientId || matchClient(title.client_name, clients)?.id || null;
      const clientRow = clientId ? clients.find((c) => c.id === clientId) : null;
      const clientName = clientRow?.name || req.body?.clientName || title.client_name;

      const xres = await gapi(token, `${DRIVE}/files/${spreadsheetId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`);
      const buf = Buffer.from(await xres.arrayBuffer());
      const wb = await readXlsx(buf);
      const tpl = templateImageHashes(wb.sheets);
      const results = [];
      for (const sheet of wb.sheets) {
        const parsed = parseCostSheet(sheet, { templateHashes: tpl });
        if (isEmptySheet(parsed)) { results.push({ sheet: sheet.name, skipped: true }); continue; }
        const dir = `cost-sheets/${spreadsheetId}/${sheet.sheetId}`;
        const images = [];
        for (let i = 0; i < parsed.images.length; i++) {
          const im = parsed.images[i];
          const path = `${dir}/${i + 1}-${im.sha.slice(0, 8)}.${im.ext === 'jpeg' ? 'jpg' : im.ext}`;
          const { error } = await admin.storage.from('uploads').upload(path, im.data, { contentType: `image/${im.ext === 'jpg' ? 'jpeg' : im.ext}`, upsert: true });
          if (error) throw new Error(`画像を保存できませんでした: ${error.message}`);
          images.push({ path, row: im.row, col: im.col, group: im.group, section: im.section, near_row: im.near_row, width: im.width, height: im.height });
        }
        const row = {
          client_id: clientId, client_name: clientName, period: title.period,
          title: parsed.title, status: parsed.status, sheet_date: parsed.sheet_date || null,
          spreadsheet_id: spreadsheetId, sheet_gid: sheet.sheetId, sheet_title: sheet.name, file_title: fileMeta.name,
          sheet_url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheet.sheetId}`,
          sell_total: parsed.sell_total, cost_total: parsed.cost_total, gross: parsed.gross, margin: parsed.margin,
          authors: parsed.authors, last_entry_date: parsed.last_entry_date || null,
          lines: parsed.lines, images, imported_at: new Date().toISOString(), imported_by: user.id,
        };
        const { error } = await admin.from('cost_sheets').upsert(row, { onConflict: 'spreadsheet_id,sheet_gid' });
        if (error) throw new Error(`保存できませんでした（${sheet.name}）: ${error.message}`);
        results.push({ sheet: sheet.name, title: parsed.title, status: parsed.status, lines: parsed.lines.length, images: images.length, sell_total: parsed.sell_total, cost_total: parsed.cost_total });
      }
      res.status(200).json({ file: fileMeta.name, client_id: clientId, client_name: clientName, period: title.period, sheets: results, imported: results.filter((r) => !r.skipped).length, skipped: results.filter((r) => r.skipped).length });
      return;
    }

    res.status(400).json({ error: `不明な action: ${action}` });
  } catch (e) {
    console.error('[cost-sheet-import]', e);
    res.status(500).json({ error: e.message || '取り込みに失敗しました' });
  }
}
