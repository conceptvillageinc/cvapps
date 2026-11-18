import { getAccessToken } from './gmail.js';
import { extractText } from './docText.js';

// ============================================================================
// AI チャットから、会社の Google ワークスペース（Drive・Gmail）を読む道具
//
//   ・質問した本人の @concept-village.co.jp のアカウントとして読む（ドメイン全体の委任）。
//     本人が見られる Drive のファイル・本人の Gmail だけ。ほかの社員のメールは読まない。
//   ・@concept-village.co.jp 以外のアドレス（個人の Gmail など）でログインしている人には、道具そのものを渡さない。
//     アドレスはサーバーで確かめたログイン情報のものだけを使う（画面から送られた値は使わない）。
//   ・読むだけ（ファイルの変更・メールの送信はしない）。
//   必要なスコープ（設定済み）: https://www.googleapis.com/auth/drive（バックアップと同じ）・gmail.readonly（返信チェックと同じ）
// ============================================================================

export const COMPANY_DOMAIN = 'concept-village.co.jp';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_CHARS = 60000;
const MAX_DOWNLOAD = 15 * 1024 * 1024;

/** 会社のアカウントか（このときだけ Google の道具を使える） */
export function isCompanyAccount(email) {
  return new RegExp(`^[^@\\s]+@${COMPANY_DOMAIN.replace(/\./g, '\\.')}$`, 'i').test(String(email || '').trim());
}

export const GOOGLE_TOOLS = [
  {
    name: 'search_drive',
    description: '質問した人の Google ドライブ（共有ドライブ・共有されたファイルを含む）を、ファイル名と本文で検索する。中身を読むときは read_drive_file を使う。',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        keyword: { type: 'string', description: '探す言葉（ファイル名・本文に含まれる言葉）' },
        kind: { type: 'string', enum: ['any', 'document', 'spreadsheet', 'presentation', 'pdf', 'folder'], description: 'ファイルの種類。絞らないなら any' },
        limit: { type: 'integer', description: '最大件数（1〜30）' },
      },
      required: ['keyword', 'kind', 'limit'],
    },
  },
  {
    name: 'read_drive_file',
    description: 'Google ドライブのファイルの中身を読む（Google ドキュメント・スプレッドシート・スライド・PDF・画像・Word・Excel・PowerPoint・テキスト）。file_id は search_drive の結果か、docs.google.com / drive.google.com の URL の中の ID。',
    input_schema: { type: 'object', additionalProperties: false, properties: { file_id: { type: 'string', description: 'ファイルの ID、または URL' } }, required: ['file_id'] },
  },
  {
    name: 'search_gmail',
    description: '質問した人の Gmail を検索する。query は Gmail の検索窓と同じ書き方（例: from:momiji.co.jp after:2026/10/01 見積）。本文を読むときは read_gmail を使う。',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Gmail の検索条件' },
        limit: { type: 'integer', description: '最大件数（1〜25）' },
      },
      required: ['query', 'limit'],
    },
  },
  {
    name: 'read_gmail',
    description: 'Gmail のメール 1 通の本文を読む。message_id は search_gmail の結果のもの。',
    input_schema: { type: 'object', additionalProperties: false, properties: { message_id: { type: 'string' } }, required: ['message_id'] },
  },
].map((t) => ({ ...t, strict: true }));

export const GOOGLE_TOOL_NAMES = new Set(GOOGLE_TOOLS.map((t) => t.name));

export function googleToolLabel(name, input = {}) {
  switch (name) {
    case 'search_drive': return `Google ドライブを検索（${input.keyword || ''}）`;
    case 'read_drive_file': return 'Google ドライブのファイルを確認';
    case 'search_gmail': return `Gmail を検索（${input.query || ''}）`;
    case 'read_gmail': return 'Gmail のメールを確認';
    default: return name;
  }
}

const clip = (s, max = MAX_CHARS) => { const t = String(s || '').trim(); return t.length > max ? `${t.slice(0, max)}\n…（長いため以降は省略）` : t; };
const qEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const fileIdOf = (v) => {
  const s = String(v || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : s.replace(/[^a-zA-Z0-9_-]/g, '');
};

async function gfetch(token, url, { raw = false } = {}) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('見つからないか、見る権限がありません');
    if (res.status === 401 || res.status === 403) throw new Error(`Google に読む許可がありません（${body.error?.message || res.status}）`);
    throw new Error(body.error?.message || `Google の読み込みに失敗しました（${res.status}）`);
  }
  return raw ? res : res.json();
}

const KIND_Q = {
  document: "mimeType = 'application/vnd.google-apps.document'",
  spreadsheet: "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')",
  presentation: "(mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation')",
  pdf: "mimeType = 'application/pdf'",
  folder: "mimeType = 'application/vnd.google-apps.folder'",
};
const KIND_LABEL = {
  'application/vnd.google-apps.document': 'Google ドキュメント',
  'application/vnd.google-apps.spreadsheet': 'Google スプレッドシート',
  'application/vnd.google-apps.presentation': 'Google スライド',
  'application/vnd.google-apps.folder': 'フォルダ',
  'application/pdf': 'PDF',
};

/**
 * Google の道具を実行する。email は質問した本人（サーバーで確かめたもの）。
 * 返り値は JSON にできる値。ファイルの中身を Claude にそのまま渡すときは { blocks: [...] }。
 */
export async function runGoogleTool(email, name, input = {}) {
  if (!isCompanyAccount(email)) return { error: `Google の情報は @${COMPANY_DOMAIN} のアカウントでログインしている人だけが読めます` };
  const limit = (v, max) => Math.max(1, Math.min(max, Number(v) || 10));

  if (name === 'search_drive' || name === 'read_drive_file') {
    const token = await getAccessToken(email, DRIVE_SCOPE);
    if (name === 'search_drive') {
      const k = qEscape(input.keyword);
      const parts = ['trashed = false'];
      if (k) parts.push(`(name contains '${k}' or fullText contains '${k}')`);
      if (KIND_Q[input.kind]) parts.push(KIND_Q[input.kind]);
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.search = new URLSearchParams({
        q: parts.join(' and '), pageSize: String(limit(input.limit, 30)), corpora: 'allDrives', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true',
        fields: 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress),webViewLink,size)',
      }).toString();
      const data = await gfetch(token, url);
      return { count: (data.files || []).length, files: (data.files || []).map((f) => ({
        file_id: f.id, 名前: f.name, 種類: KIND_LABEL[f.mimeType] || f.mimeType, 更新日時: f.modifiedTime,
        持ち主: (f.owners || []).map((o) => o.displayName || o.emailAddress).join('、') || '共有ドライブ', URL: f.webViewLink,
      })) };
    }
    const id = fileIdOf(input.file_id);
    if (!id) return { error: 'ファイルの ID が分かりません' };
    const meta = await gfetch(token, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size,modifiedTime,webViewLink&supportsAllDrives=true`);
    const head = `【Google ドライブ: ${meta.name}（${KIND_LABEL[meta.mimeType] || meta.mimeType}・更新 ${meta.modifiedTime}）】\n${meta.webViewLink || ''}`;
    const exportAs = async (mime) => gfetch(token, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(mime)}`, { raw: true });
    if (meta.mimeType === 'application/vnd.google-apps.document' || meta.mimeType === 'application/vnd.google-apps.presentation') {
      return { blocks: [{ type: 'text', text: `${head}\n${clip(await (await exportAs('text/plain')).text())}` }] };
    }
    if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      // すべてのシートを読むため Excel 形式で受け取って本文にする
      const bytes = await (await exportAs('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).arrayBuffer();
      return { blocks: [{ type: 'text', text: `${head}\n${await extractText(bytes, { name: 'sheet.xlsx' })}` }] };
    }
    if (meta.mimeType?.startsWith('application/vnd.google-apps.')) return { error: `この種類（${meta.mimeType}）は読めません` };
    if (Number(meta.size) > MAX_DOWNLOAD) return { error: `ファイルが大きすぎます（${Math.round(Number(meta.size) / 1024 / 1024)}MB。15MB まで）` };
    const bytes = await (await gfetch(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { raw: true })).arrayBuffer();
    const data = Buffer.from(bytes).toString('base64');
    if (meta.mimeType === 'application/pdf') {
      return { blocks: [{ type: 'text', text: head }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }] };
    }
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(meta.mimeType)) {
      return { blocks: [{ type: 'text', text: head }, { type: 'image', source: { type: 'base64', media_type: meta.mimeType, data } }] };
    }
    return { blocks: [{ type: 'text', text: `${head}\n${await extractText(bytes, { type: meta.mimeType, name: meta.name })}` }] };
  }

  if (name === 'search_gmail' || name === 'read_gmail') {
    const token = await getAccessToken(email, GMAIL_SCOPE);
    const base = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(email)}`;
    if (name === 'search_gmail') {
      const list = await gfetch(token, `${base}/messages?${new URLSearchParams({ q: String(input.query || ''), maxResults: String(limit(input.limit, 25)) })}`);
      const ids = (list.messages || []).map((m) => m.id);
      const metas = await Promise.all(ids.map((id) => gfetch(token, `${base}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null)));
      return { count: ids.length, messages: metas.filter(Boolean).map((m) => {
        const h = headerMap(m.payload);
        return { message_id: m.id, 日時: h.date, 差出人: h.from, 宛先: h.to, 件名: h.subject, 抜粋: m.snippet };
      }) };
    }
    const id = String(input.message_id || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!id) return { error: 'メールの ID が分かりません' };
    const m = await gfetch(token, `${base}/messages/${id}?format=full`);
    const h = headerMap(m.payload);
    const body = mailBody(m.payload);
    const files = attachmentNames(m.payload);
    return { 日時: h.date, 差出人: h.from, 宛先: h.to, CC: h.cc || '', 件名: h.subject, 本文: clip(body || m.snippet || '', 30000), 添付ファイル: files };
  }
  throw new Error(`不明な道具です: ${name}`);
}

function headerMap(payload) {
  const out = {};
  for (const x of payload?.headers || []) out[String(x.name).toLowerCase()] = x.value;
  return out;
}

/** 本文（text/plain を優先。無ければ HTML をテキストにする）。日本語のメール（ISO-2022-JP など）は文字コードを読み分ける */
function mailBody(payload) {
  const plain = []; const html = [];
  const walk = (p) => {
    if (!p) return;
    if (p.filename) return; // 添付ファイル
    if (p.body?.data && /^text\/plain/i.test(p.mimeType)) plain.push(decodePart(p));
    else if (p.body?.data && /^text\/html/i.test(p.mimeType)) html.push(decodePart(p));
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain.join('\n\n');
  return html.join('\n\n')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n');
}

function decodePart(p) {
  const bytes = Buffer.from(String(p.body.data).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const ct = (p.headers || []).find((x) => /^content-type$/i.test(x.name))?.value || '';
  const charset = (ct.match(/charset="?([^";\s]+)"?/i)?.[1] || 'utf-8').toLowerCase();
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

function attachmentNames(payload) {
  const out = [];
  const walk = (p) => { if (!p) return; if (p.filename) out.push(p.filename); (p.parts || []).forEach(walk); };
  walk(payload);
  return out;
}
