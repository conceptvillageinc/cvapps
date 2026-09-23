import { requireMember, requirePost } from './_lib/guard.js';
import { getAccessToken } from './_lib/gmail.js';

// ============================================================================
// POST /api/read-sheet  { url }
//
// Google スプレッドシートの URL から、シート1枚分の値（2次元配列）を読む。
// 見積明細の「スプレッドシートから取込」で、コピペの代わりに URL を貼れるようにする。
//
// 操作した本人のアカウントとして読む（サービスアカウントの権限委任）。
// そのため、本人が開けるシート（CV 内で共有されているものなど）だけが読める。
// 必要なスコープ: https://www.googleapis.com/auth/spreadsheets（工程管理表の出力と同じ）
// ============================================================================

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const MAX_ROWS = 500;

/** URL から spreadsheetId と gid（シートのタブ）を取り出す */
export function parseSheetUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/(^|\.)docs\.google\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const gidMatch = (u.hash || '').match(/gid=(\d+)/) || u.search.match(/gid=(\d+)/);
  return { spreadsheetId: m[1], gid: gidMatch ? Number(gidMatch[1]) : null };
}

async function gapi(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `Google API エラー (${res.status})`;
    const e = new Error(res.status === 403 || res.status === 404
      ? `シートを開けませんでした。ログイン中のアカウントで閲覧できるように共有されているか確認してください（${msg}）`
      : msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;

  const parsed = parseSheetUrl(req.body?.url);
  if (!parsed) {
    res.status(400).json({ error: 'Google スプレッドシートの URL を貼ってください（https://docs.google.com/spreadsheets/d/…）' });
    return;
  }

  try {
    const token = await getAccessToken(user.email, SCOPES);
    const meta = await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${parsed.spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title,index)`);
    const sheets = meta.sheets || [];
    const target = (parsed.gid != null && sheets.find((s) => s.properties.sheetId === parsed.gid)) || sheets[0];
    if (!target) { res.status(404).json({ error: 'シートが見つかりません' }); return; }

    const range = `'${target.properties.title.replace(/'/g, "''")}'!A1:Z${MAX_ROWS}`;
    const values = await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${parsed.spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);

    res.status(200).json({
      title: meta.properties?.title || '',
      sheet_title: target.properties.title,
      rows: values.values || [],
      sheets: sheets.map((s) => ({ gid: s.properties.sheetId, title: s.properties.title })),
    });
  } catch (err) {
    console.error('[api/read-sheet]', err);
    res.status(err.status === 401 ? 500 : err.status || 500).json({ error: err.message || 'シートを読み込めませんでした' });
  }
}
