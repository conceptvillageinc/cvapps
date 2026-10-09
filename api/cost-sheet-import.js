import { costLineGroups, ordersFromCostSheets } from '../src/lib/costSheetOrders.js';
import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { getAccessToken } from './_lib/gmail.js';
import { readXlsx, colLetter } from './_lib/xlsx.js';
import { parseCostSheet, templateImageHashes, parseFileTitle, isEmptySheet } from './_lib/costSheet.js';

// ============================================================================
// POST /api/cost-sheet-import
//   { action: "list", folderUrl? }           … 原価計算表（スプレッドシート）を列挙する。URL が空なら 14期・13期のフォルダ両方。
//                                             フォルダやスプレッドシートの URL を貼れば、それだけ（複数可）。期はファイル名から読む
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
// 原価計算表のフォルダ（14期・13期）。期はファイル名（「【原価計算表】14期_…」）から読む
export const DEFAULT_FOLDER_IDS = ['1fwuM8jx7fORT7WNZduVYX2OvhIcwNuhv', '1JMFvvEkJxRdaUO70szntzFjpxHuLlBUg'];

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
    if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg) || data.error?.status === 'PERMISSION_DENIED' && /Drive API/i.test(msg)) {
      const project = /project[= ](\d+)/.exec(msg)?.[1];
      throw new Error(`Google Cloud で「Google Drive API」が有効になっていません。管理者が Google Cloud コンソールで有効にしてください${project ? `（https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${project}）` : ''}。有効にしてから数分後に、もう一度お試しください`);
    }
    throw new Error(res.status === 403 || res.status === 404 ? `ドライブのファイルを開けませんでした。ログイン中のアカウントで見られるか確認してください（${msg}）` : msg);
  }
  return res;
}

/**
 * スプレッドシートを読む。
 *   1) ドライブの書き出し（xlsx）… 10MB まで。画像も取れる
 *   2) スプレッドシートの書き出し口（docs.google.com の export）… 大きいファイルも書き出せることが多い。画像も取れる
 *   3) Sheets API の値だけ … 画像は取れないが、どんな大きさでも読める
 * @returns {{ wb: { sheets }, mode: 'xlsx' | 'xlsx-docs' | 'values' }}
 */
export async function loadWorkbook(token, spreadsheetId) {
  const tooLarge = (e) => /too large|exportSizeLimitExceeded|413/i.test(String(e?.message || e));
  try {
    const r = await gapi(token, `${DRIVE}/files/${spreadsheetId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`);
    return { wb: await readXlsx(Buffer.from(await r.arrayBuffer())), mode: 'xlsx' };
  } catch (e) {
    if (!tooLarge(e)) throw e;
  }
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (r.ok && /spreadsheetml|octet-stream|zip/.test(type)) {
      return { wb: await readXlsx(Buffer.from(await r.arrayBuffer())), mode: 'xlsx-docs' };
    }
    console.warn('[cost-sheet-import] docs export failed', r.status, type);
  } catch (e) {
    console.warn('[cost-sheet-import] docs export error', e?.message);
  }
  return { wb: await readValuesOnly(token, spreadsheetId), mode: 'values' };
}

/** Sheets API でタブごとの値（A〜T 列、計算済みの値）を読み、readXlsx と同じ形にする。画像は無し */
async function readValuesOnly(token, spreadsheetId) {
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const meta = await (await gapi(token, `${SHEETS}/${spreadsheetId}?fields=sheets.properties(sheetId,title,index)`)).json();
  const props = (meta.sheets || []).map((x) => x.properties).sort((a, b) => a.index - b.index);
  const sheets = [];
  for (let i = 0; i < props.length; i += 20) {
    const chunk = props.slice(i, i + 20);
    const ranges = chunk.map((p) => `ranges=${encodeURIComponent(`'${p.title.replace(/'/g, "''")}'!A1:T400`)}`).join('&');
    const data = await (await gapi(token, `${SHEETS}/${spreadsheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`)).json();
    (data.valueRanges || []).forEach((vr, k) => {
      const p = chunk[k];
      const cells = new Map();
      let maxRow = 0;
      (vr.values || []).forEach((row, r) => {
        (row || []).forEach((v, c) => {
          if (v === '' || v === null || v === undefined) return;
          cells.set(`${colLetter(c + 1)}${r + 1}`, v);
          if (r + 1 > maxRow) maxRow = r + 1;
        });
      });
      sheets.push({ name: p.title, sheetId: p.sheetId, cells, maxRow, images: [] });
    });
  }
  return { sheets };
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

/**
 * 最終納品チェック（T 列の ✓）が付いた印刷の行を、小見出しごとに 1 件の入稿記録にする（すでにある行は作らない）。作った件数を返す。
 *   同じクライアントの入稿記録と、入稿日・品名・金額が同じものは作らない（同じ内容のタブが 2 枚ある場合）。
 *   入稿記録の SQL（0031・0032）が未実行なら何もしない。
 */
async function addPrintOrders(admin, cs) {
  if (costLineGroups(cs).length === 0) return 0;
  const cols = 'estimate_line_id, items, client_id, client_name, ordered_on, name, amount';
  const queries = [admin.from('print_orders').select(cols).like('estimate_line_id', `costsheet:${cs.id}:%`)];
  if (cs.client_id) queries.push(admin.from('print_orders').select(cols).eq('client_id', cs.client_id));
  if (cs.client_name) queries.push(admin.from('print_orders').select(cols).eq('client_name', cs.client_name));
  const results = await Promise.all(queries);
  if (results.some((r) => r.error)) return 0;
  const rows = ordersFromCostSheets([cs], results.flatMap((r) => r.data || []));
  if (rows.length === 0) return 0;
  const { error: e2 } = await admin.from('print_orders').insert(rows);
  if (e2) { console.error('[cost-sheet-import] print_orders', e2.message); return 0; }
  return rows.length;
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
      // 対象: 貼られた URL（フォルダ・スプレッドシート、改行かカンマ区切りで複数可）。空なら登録済みのフォルダ全部
      const raw = [req.body?.folderUrl, ...(Array.isArray(req.body?.urls) ? req.body.urls : [])].filter(Boolean).join('\n');
      const parts = raw.split(/[\s,、]+/).map((x) => x.trim()).filter(Boolean);
      const folderIds = []; const sheetIds = [];
      for (const u of parts) {
        const sm = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(u);
        if (sm) { sheetIds.push(sm[1]); continue; }
        const fid = parseFolderUrl(u);
        if (fid) folderIds.push(fid);
      }
      if (folderIds.length === 0 && sheetIds.length === 0) folderIds.push(...DEFAULT_FOLDER_IDS);
      const files = [];
      for (const folderId of folderIds) {
        let pageToken = '';
        do {
          const q = encodeURIComponent(`'${folderId}' in parents and mimeType='${SHEET_MIME}' and trashed=false`);
          const r = await gapi(token, `${DRIVE}/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime,size)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`);
          const data = await r.json();
          files.push(...(data.files || []));
          pageToken = data.nextPageToken || '';
        } while (pageToken);
      }
      for (const id of sheetIds) {
        const r = await gapi(token, `${DRIVE}/files/${id}?fields=id,name,modifiedTime,size&supportsAllDrives=true`);
        files.push(await r.json());
      }
      // 同じファイルが重なったら 1 つに
      const seen = new Set();
      for (let i = files.length - 1; i >= 0; i--) { if (seen.has(files[i].id)) files.splice(i, 1); else seen.add(files[i].id); }
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
        .sort((a, b) => (parseInt(b.period, 10) || 0) - (parseInt(a.period, 10) || 0) || a.name.localeCompare(b.name, 'ja'));
      res.status(200).json({ folderIds, files: out });
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

      const { wb, mode } = await loadWorkbook(token, spreadsheetId);
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
        const { data: saved, error } = await admin.from('cost_sheets').upsert(row, { onConflict: 'spreadsheet_id,sheet_gid' }).select('id').single();
        if (error) throw new Error(`保存できませんでした（${sheet.name}）: ${error.message}`);
        const orders = await addPrintOrders(admin, { ...row, id: saved.id });
        results.push({ sheet: sheet.name, title: parsed.title, status: parsed.status, lines: parsed.lines.length, images: images.length, sell_total: parsed.sell_total, cost_total: parsed.cost_total, orders });
      }
      res.status(200).json({ orders: results.reduce((n, r) => n + (r.orders || 0), 0), file: fileMeta.name, mode, note: mode === 'values' ? 'ファイルが大きく画像付きで書き出せなかったため、数字と文字だけを取り込みました（スクショは入っていません）' : '', client_id: clientId, client_name: clientName, period: title.period, sheets: results, imported: results.filter((r) => !r.skipped).length, skipped: results.filter((r) => r.skipped).length });
      return;
    }

    res.status(400).json({ error: `不明な action: ${action}` });
  } catch (e) {
    console.error('[cost-sheet-import]', e);
    res.status(500).json({ error: e.message || '取り込みに失敗しました' });
  }
}
