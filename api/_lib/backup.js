import JSZip from 'jszip';

// ============================================================================
// バックアップ: 全テーブルを JSON／CSV にして ZIP にし、Google ドライブの指定フォルダへ置く。
// Storage（uploads バケット）のファイルは、同じフォルダの files/ に 1 つずつ写す（前回までに
// 写したものは飛ばす）。週 1 回の cron と、システム設定の「今すぐ作る」から呼ばれる。
//
// ドライブの構成:
//   <指定フォルダ>/database/cvapp-db-YYYY-MM-DD.zip   … テーブルの中身（毎回 1 つ）
//   <指定フォルダ>/files/<Storage のパス>              … 音声・PDF・画像など（差分）
// 古い ZIP は、直近 8 週分と、各月の最初の 1 つ（12 か月分）を残して消す。
// ============================================================================

/** 復元するときの順番（親になる表が先）。restore-backup.mjs も同じ順で入れる */
export const TABLES = [
  'users', 'system_settings', 'clients', 'print_vendors', 'price_masters', 'design_fee_masters', 'faq_items',
  'invitations', 'recurring_project_templates', 'projects', 'project_tasks', 'estimates',
  'invoices', 'delivery_notes', 'receipts', 'meetings', 'meeting_segments', 'meeting_checklists',
  'email_logs', 'bank_transactions', 'fiscal_targets', 'payees', 'payables', 'card_charges', 'cash_plan_items',
];

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const KEEP_WEEKS = 8;
const KEEP_MONTHS = 12;

async function gapi(token, url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Google Drive API エラー (${res.status})`);
  return data;
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** フォルダ直下の、名前が一致するものを探す */
async function findChild(token, parentId, name, mimeType) {
  const parts = [`'${parentId}' in parents`, `name='${q(name)}'`, 'trashed=false'];
  if (mimeType) parts.push(`mimeType='${mimeType}'`);
  const data = await gapi(token, `${DRIVE}/files?q=${encodeURIComponent(parts.join(' and '))}&fields=files(id,name,createdTime,size)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return (data.files || [])[0] || null;
}

async function ensureFolder(token, parentId, name) {
  const found = await findChild(token, parentId, name, 'application/vnd.google-apps.folder');
  if (found) return found.id;
  const created = await gapi(token, `${DRIVE}/files?supportsAllDrives=true`, { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) });
  return created.id;
}

/** フォルダの中のファイル名を全部（ページをまたいで）集める */
async function listNames(token, folderId) {
  const names = new Map();
  let pageToken = '';
  do {
    const url = `${DRIVE}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,createdTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = await gapi(token, url);
    for (const f of data.files || []) names.set(f.name, f);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return names;
}

/** 1 ファイルを置く（再開可能アップロード。大きい音声でも 1 回の PUT で送る） */
async function uploadFile(token, folderId, name, bytes, contentType) {
  const init = await fetch(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': contentType || 'application/octet-stream', 'X-Upload-Content-Length': String(bytes.byteLength) },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!init.ok) { const d = await init.json().catch(() => ({})); throw new Error(d.error?.message || `アップロードを開始できませんでした (${init.status})`); }
  const location = init.headers.get('location');
  if (!location) throw new Error('アップロード先が取得できませんでした');
  const put = await fetch(location, { method: 'PUT', headers: { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(bytes.byteLength) }, body: Buffer.from(bytes) });
  if (!put.ok) throw new Error(`アップロードに失敗しました (${put.status})`);
  return put.json().catch(() => ({}));
}

/** 表の中身を全部読む（1000 行ずつ） */
async function dumpTable(admin, table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').order('created_at', { ascending: true, nullsFirst: true }).range(from, from + 999);
    if (error) {
      // created_at が無い表は id 順
      const alt = await admin.from(table).select('*').range(from, from + 999);
      if (alt.error) throw new Error(`${table}: ${alt.error.message}`);
      rows.push(...(alt.data || []));
      if ((alt.data || []).length < 1000) break;
      continue;
    }
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function toCsv(rows) {
  if (rows.length === 0) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Storage のファイルを全部列挙する（サブフォルダも） */
async function listStorage(admin, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from('uploads').list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Storage の一覧に失敗しました: ${error.message}`);
    for (const e of data || []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null || e.id === undefined) out.push(...await listStorage(admin, path)); // フォルダ
      else out.push({ path, size: e.metadata?.size || 0, mimetype: e.metadata?.mimetype || '' });
    }
    if ((data || []).length < 1000) break;
  }
  return out;
}

/** 古い ZIP を消す。直近 8 週分と、各月の最初の 1 つ（12 か月分）は残す */
async function prune(token, dbFolderId, today) {
  const files = [...(await listNames(token, dbFolderId)).values()].filter((f) => /^cvapp-db-\d{4}-\d{2}-\d{2}\.zip$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const dayOf = (f) => f.name.slice(9, 19);
  const monthsSeen = new Set();
  const keepMonthly = new Set();
  for (const f of files) { const m = dayOf(f).slice(0, 7); if (!monthsSeen.has(m)) { monthsSeen.add(m); keepMonthly.add(f.name); } }
  const weekCut = new Date(today); weekCut.setDate(weekCut.getDate() - KEEP_WEEKS * 7);
  const monthCut = new Date(today); monthCut.setMonth(monthCut.getMonth() - KEEP_MONTHS);
  let removed = 0;
  for (const f of files) {
    const d = new Date(dayOf(f));
    if (d >= weekCut) continue;
    if (keepMonthly.has(f.name) && d >= monthCut) continue;
    await gapi(token, `${DRIVE}/files/${f.id}?supportsAllDrives=true`, { method: 'DELETE' });
    removed++;
  }
  return removed;
}

/**
 * バックアップを 1 回実行する。
 * @param {object} o
 * @param {object} o.admin        service_role の Supabase クライアント
 * @param {string} o.token        Google のアクセストークン（フォルダの持ち主として）
 * @param {string} o.folderId     ドライブの保存先フォルダ
 * @param {number} [o.budgetMs]   ファイルの写しに使える時間（超えたら残りは次回）
 */
export async function runBackup({ admin, token, folderId, budgetMs = 220_000 }) {
  const started = Date.now();
  const today = new Date();
  const stamp = today.toISOString().slice(0, 10);
  const summary = { at: today.toISOString(), stamp, tables: {}, rows: 0, zip_bytes: 0, files_total: 0, files_uploaded: 0, files_skipped: 0, files_remaining: 0, pruned: 0, errors: [] };

  // 1) テーブル → ZIP
  const zip = new JSZip();
  for (const t of TABLES) {
    try {
      const rows = await dumpTable(admin, t);
      summary.tables[t] = rows.length;
      summary.rows += rows.length;
      zip.file(`tables/${t}.json`, JSON.stringify(rows, null, 1));
      zip.file(`tables/${t}.csv`, toCsv(rows));
    } catch (e) {
      summary.errors.push(`${t}: ${e.message}`);
    }
  }
  let storageList = [];
  try { storageList = await listStorage(admin); summary.files_total = storageList.length; }
  catch (e) { summary.errors.push(e.message); }
  zip.file('files/index.json', JSON.stringify(storageList, null, 1));
  zip.file('README.txt', [
    `CV AX KIT バックアップ ${summary.at}`, '',
    'tables/<表>.json … 表の中身（復元用）。tables/<表>.csv … 同じ内容を表計算で見る用。',
    'files/index.json … Storage（uploads）のファイル一覧。実体は同じドライブの files/ フォルダにあります。',
    '復元の手順は、アプリのリポジトリの docs/backup-restore.md を見てください。',
    `表の順番（親→子）: ${TABLES.join(', ')}`,
  ].join('\n'));
  const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  summary.zip_bytes = zipBytes.byteLength;

  // 2) ドライブへ
  const dbFolder = await ensureFolder(token, folderId, 'database');
  const filesFolder = await ensureFolder(token, folderId, 'files');
  const zipName = `cvapp-db-${stamp}.zip`;
  const existing = await findChild(token, dbFolder, zipName);
  if (existing) await gapi(token, `${DRIVE}/files/${existing.id}?supportsAllDrives=true`, { method: 'DELETE' }); // 同じ日に 2 回なら置き換え
  await uploadFile(token, dbFolder, zipName, zipBytes, 'application/zip');
  try { summary.pruned = await prune(token, dbFolder, today); } catch (e) { summary.errors.push(`古い ZIP の整理: ${e.message}`); }

  // 3) Storage のファイルを差分で写す（名前はパスの / を __ にする）
  const have = await listNames(token, filesFolder);
  const driveName = (p) => p.replace(/\//g, '__');
  const todo = storageList.filter((f) => !have.has(driveName(f.path)));
  summary.files_skipped = storageList.length - todo.length;
  for (const f of todo) {
    if (Date.now() - started > budgetMs) break;
    try {
      const { data, error } = await admin.storage.from('uploads').download(f.path);
      if (error || !data) throw new Error(error?.message || 'download failed');
      await uploadFile(token, filesFolder, driveName(f.path), Buffer.from(await data.arrayBuffer()), f.mimetype || data.type);
      summary.files_uploaded++;
    } catch (e) {
      summary.errors.push(`${f.path}: ${e.message}`);
      if (summary.errors.length > 20) break;
    }
  }
  summary.files_remaining = todo.length - summary.files_uploaded;
  summary.seconds = Math.round((Date.now() - started) / 1000);
  return summary;
}
