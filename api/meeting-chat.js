import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { claude, MODEL, normalizeSchema, textOf, fileBlock } from './_lib/claude.js';
import { getAccessToken } from './_lib/gmail.js';
import { extractText, isNativeFile } from './_lib/docText.js';
import { CHAT_REPLY_SCHEMA, normalizeDraft, draftSheetRows, CHAT_MAX_FILES, CHAT_MAX_BYTES } from '../src/lib/meetingChat.js';
import { DESIGN_FEE_MASTER } from '../src/lib/designFeeData.js';
import { flattenDesignCatalog } from '../src/lib/designCatalog.js';

// ============================================================================
// POST /api/meeting-chat
//
// 議事録の「AI に依頼」。議事録ごとのやり取りは meeting_chat_messages に残し、全メンバーが読める。
//
//   { action: 'send', meeting_id, message, attachments: [{ path, name, type, size }] }
//       依頼を保存 → 議事録・文字起こし・添付資料・そのクライアントの社内見積と過去の見積・
//       価格マスタ・デザイン費マスタを Claude に渡して回答を作る → 回答を保存して返す。
//       見積の依頼なら回答に「たたき台」（draft）が付く。
//   { action: 'sheet', message_id }
//       回答のたたき台を Google スプレッドシートに出力する（依頼した本人のマイドライブ）。
// ============================================================================

const HISTORY_LIMIT = 20;
const TRANSCRIPT_CHARS = 150000;
const SHEET_SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'].join(' ');
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const fmtSec = (sec) => { const s = Math.max(0, Math.floor(Number(sec) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`;

async function authorName(admin, user) {
  const { data } = await admin.from('users').select('full_name, email').eq('id', user.id).maybeSingle();
  return data?.full_name || data?.email || user.email || '';
}

async function loadDesignCatalog(admin) {
  try {
    const { data } = await admin.from('design_fee_masters').select('id, category, name, detail, selling_price, amount, is_active, category_order, sort_order').order('category_order').order('sort_order');
    if (data && data.length) return flattenDesignCatalog(data);
  } catch { /* テーブルが無いときは固定一覧 */ }
  return flattenDesignCatalog(DESIGN_FEE_MASTER);
}

/** 議事録・社内の資料（このクライアントの実績・マスタ）を、AI に渡す文脈の文章にする */
async function buildContext(admin, meeting) {
  const s = meeting.summary || {};
  const transcript = (meeting.transcript || meeting.transcript_raw || []).map((t) => `[${fmtSec(t.start)}] ${t.speaker}: ${t.text}`).join('\n');
  const client = meeting.client_name && meeting.client_name !== 'CV自社' ? meeting.client_name : '';

  let project = null;
  if (meeting.project_id) ({ data: project } = await admin.from('projects').select('project_number, name, client_name, due_date').eq('id', meeting.project_id).maybeSingle());
  const clientName = client || project?.client_name || '';

  // このクライアントの社内見積（原価計算表）と過去の見積
  let costSheets = [];
  let estimates = [];
  if (clientName) {
    let q = admin.from('cost_sheets').select('period, title, status, sheet_date, sell_total, cost_total, lines').order('sheet_date', { ascending: false, nullsFirst: false }).limit(6);
    q = meeting.client_id ? q.or(`client_id.eq.${meeting.client_id},client_name.eq."${clientName.replace(/"/g, '')}"`) : q.eq('client_name', clientName);
    ({ data: costSheets } = await q);
    ({ data: estimates } = await admin.from('estimates').select('estimate_number, estimate_title, print_type, created_at, total_amount, line_items, status').eq('client_name', clientName).order('created_at', { ascending: false }).limit(8));
  }
  const { data: masters } = await admin.from('price_masters').select('category, vendor_name, spec_summary, price_grid, last_updated').order('last_updated', { ascending: false, nullsFirst: false }).limit(150);
  const catalog = await loadDesignCatalog(admin);

  const csText = (costSheets || []).map((cs) => {
    const lines = (cs.lines || []).filter((l) => Number(l.adjusted || l.sell_total || 0) !== 0).slice(0, 60)
      .map((l) => `  - ${l.group || ''}｜${l.name || l.section || ''}｜${l.qty || ''}${l.unit || ''}｜売価 ${yen(l.adjusted || l.sell_total)}｜原価 ${yen(l.cost_total)}${l.vendor ? `｜仕入先 ${l.vendor}` : ''}${l.final ? '｜最終納品' : ''}`);
    return `■ ${cs.period} ${cs.title}（${cs.status === 'lost' ? '失注' : cs.status === 'submitted' ? '入稿済' : '未確定'}・${cs.sheet_date || '日付なし'}・売価計 ${yen(cs.sell_total)}・原価計 ${yen(cs.cost_total)}）\n${lines.join('\n')}`;
  }).join('\n');
  const estText = (estimates || []).map((e) => {
    const lines = (e.line_items || []).filter((li) => li.row_type !== 'text' && li.row_type !== 'subtotal').slice(0, 40)
      .map((li) => `  - ${li.category || ''}｜${li.name || ''}｜${li.quantity || ''}${li.unit || ''} × ${yen(li.unit_price)}${li.cost_price ? `｜原価単価 ${yen(li.cost_price)}` : ''}`);
    return `■ ${e.estimate_number} ${e.estimate_title || e.print_type || ''}（${String(e.created_at || '').slice(0, 10)}・合計 ${yen(e.total_amount)}）\n${lines.join('\n')}`;
  }).join('\n');
  const masterText = (masters || []).map((m) => {
    const grid = (m.price_grid || []).slice(0, 8).map((r) => `${r.quantity}: ${(r.cells || []).filter((c) => Number(c.price) > 0).map((c) => `${c.label || ''} ${yen(c.price)}`).join(' / ')}`).join('；');
    return `- ${m.category}｜${m.vendor_name}｜${m.spec_summary || ''}｜${grid}${m.last_updated ? `（${m.last_updated} 時点）` : ''}`;
  }).join('\n');

  return `# 打ち合わせ
件名: ${meeting.title || '（未入力）'}
日付: ${meeting.held_at || '（未入力）'}
クライアント: ${meeting.client_name === 'CV自社' ? '（社内の打ち合わせ）' : meeting.client_name || '（未入力）'}
${project ? `案件: ${project.project_number} ${project.name}${project.due_date ? `（完了予定 ${project.due_date}）` : ''}\n` : ''}出席者: ${(meeting.participants || []).join('、') || '（未入力）'}

## 議事録
概要:
${s.overview || '（なし）'}

打ち合わせメモ:
${s.notes || '（なし）'}

決定事項:
${(s.decisions || []).map((d) => `- ${d}`).join('\n') || '（なし）'}

ToDo:
${(s.todos || []).map((t) => `- ${t.text}${t.owner ? `（担当 ${t.owner}）` : ''}${t.due ? `（期限 ${t.due}）` : ''}${t.done ? '［済］' : ''}`).join('\n') || '（なし）'}

保留・次回までの確認事項:
${(s.open_items || []).map((o) => `- ${o}`).join('\n') || '（なし）'}

見積条件（議事録から抜き出したもの）:
${meeting.estimate_conditions ? JSON.stringify(meeting.estimate_conditions) : '（なし）'}

## 文字起こし
${transcript ? transcript.slice(0, TRANSCRIPT_CHARS) : '（なし）'}

# 社内の資料（単価の根拠に使う）
## ${clientName || 'このクライアント'}の社内見積（原価計算表。新しい順）
${csText || '（なし）'}

## ${clientName || 'このクライアント'}の過去の見積（新しい順）
${estText || '（なし）'}

## 価格マスタ（印刷・仕入。区分｜仕入先｜仕様｜数量: 納期など 金額）
${masterText || '（なし）'}

## デザイン費マスタ（区分｜項目｜税別の売価）
${catalog.map((c) => `- ${c.category}｜${c.name}｜${yen(c.selling_price)}`).join('\n')}`;
}

const SYSTEM = `あなたは株式会社コンセプト・ヴィレッジ（デザイン・印刷の制作会社）の社内アシスタントです。
社員が議事録の画面から依頼を書き込みます。下の「打ち合わせ」と「社内の資料」、依頼に添付された資料をもとに、日本語で答えてください。

答え方:
- 依頼に沿って、そのまま使える形で答える（メール文面ならそのまま送れる文、提案書の骨子なら構成と要点）。
- 議事録・資料に無いことは推測と分かるように書く。固有名詞・金額・日付・数量は資料のとおりに書く。
- reply は見出し「## 」、箇条書き「- 」、強調 **…** だけを使い、表は使わない。

見積・金額の依頼のとき（それ以外は draft.items を空の配列にする）:
- draft.items に明細を 1 行ずつ入れる。単価は税別。reply には前提と要点だけを短く書き、明細を reply に重ねて書かない。
- 単価の根拠は次の順で探す: ① このクライアントの社内見積（原価計算表） ② 過去の見積 ③ 価格マスタ ④ デザイン費マスタ ⑤ 添付資料。
  見つかった根拠を basis_kind と basis に書く（例: 「14期 お中元チラシ の A4 チラシ 5,000部」）。
- 根拠が見つからない行は basis_kind を guess にし、basis に推測の理由を書き、needs_check を true にする。
- 印刷費は原価（cost_price）も入れる。社内見積や価格マスタの原価に掛け率を掛けて売価にする（社内見積の掛け率があればそれに合わせる）。
- 前提・含まれないもの・先方に確認が必要な点は draft.notes に 1 行ずつ書く。`;

/** 過去のやり取りを Claude の会話にする（同じ役が続くときはつなぐ） */
function historyMessages(rows) {
  const out = [];
  for (const m of rows) {
    let text = m.content || '';
    if (m.role === 'user' && (m.attachments || []).length) text += `\n（添付: ${m.attachments.map((a) => a.name).join('、')}）`;
    if (m.role === 'assistant' && m.draft?.items?.length) {
      text += `\n\n[見積のたたき台「${m.draft.title || ''}」]\n${m.draft.items.map((it) => `- ${it.group}｜${it.name}${it.spec ? `（${it.spec}）` : ''}｜${it.quantity}${it.unit} × ${yen(it.unit_price)}${it.cost_price ? `｜原価 ${yen(it.cost_price)}` : ''}｜${it.basis || ''}`).join('\n')}${m.draft.notes ? `\n前提: ${m.draft.notes}` : ''}`;
    }
    if (m.role === 'user' && m.author_name) text = `（${m.author_name} の依頼）\n${text}`;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content[0].text += `\n\n${text}`;
    else out.push({ role: m.role, content: [{ type: 'text', text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** 依頼文の中の Google ドキュメント／スライド／スプレッドシートの URL を読む */
async function readGoogleLinks(email, message) {
  const re = /https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]{20,})/g;
  const found = [...new Map([...String(message).matchAll(re)].map((m) => [m[2], m[1]])).entries()].slice(0, 3);
  if (found.length === 0) return { blocks: [], notes: [] };
  const blocks = [];
  const notes = [];
  let token;
  try { token = await getAccessToken(email, DRIVE_SCOPE); } catch (e) { return { blocks, notes: [`Google のファイルを読めませんでした（${e.message}）`] }; }
  for (const [id, kind] of found) {
    const mime = kind === 'spreadsheets' ? 'text/csv' : 'text/plain';
    try {
      const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(mime)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(res.status === 404 ? '見つからないか、権限がありません' : `(${res.status})`);
      const text = (await res.text()).slice(0, 60000);
      blocks.push({ type: 'text', text: `【添付資料: ${meta?.name || id}（Google ${kind === 'document' ? 'ドキュメント' : kind === 'presentation' ? 'スライド' : 'スプレッドシート'}）】\n${text}` });
    } catch (e) {
      notes.push(`Google のファイル（${id.slice(0, 8)}…）を読めませんでした: ${e.message}`);
    }
  }
  return { blocks, notes };
}

async function send(req, res, user) {
  const { meeting_id: meetingId, message, attachments = [] } = req.body || {};
  const text = String(message || '').trim();
  if (!meetingId) { res.status(400).json({ error: 'meeting_id を指定してください' }); return; }
  if (!text && attachments.length === 0) { res.status(400).json({ error: '依頼の内容を入力してください' }); return; }
  if (!Array.isArray(attachments) || attachments.length > CHAT_MAX_FILES) { res.status(400).json({ error: `添付は ${CHAT_MAX_FILES} 件までです` }); return; }
  for (const a of attachments) {
    if (typeof a?.path !== 'string' || a.path.includes('..') || !a.path.startsWith(`meetings/${meetingId}/`)) { res.status(400).json({ error: 'ファイルの指定が不正です' }); return; }
  }

  const admin = adminClient();
  const { data: meeting } = await admin.from('meetings').select('*').eq('id', meetingId).maybeSingle();
  if (!meeting) { res.status(404).json({ error: '議事録が見つかりません' }); return; }
  const name = await authorName(admin, user);
  const files = attachments.map((a) => ({ path: a.path, name: String(a.name || a.path.split('/').pop()).slice(0, 200), type: String(a.type || ''), size: Number(a.size) || 0 }));

  const { data: history } = await admin.from('meeting_chat_messages').select('*').eq('meeting_id', meetingId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT);
  const { data: mine, error: insErr } = await admin.from('meeting_chat_messages')
    .insert({ meeting_id: meetingId, role: 'user', content: text, attachments: files, author_id: user.id, author_name: name }).select().single();
  if (insErr) throw new Error(`依頼を保存できませんでした: ${insErr.message}`);

  try {
    // 添付（今回の依頼の分）。PDF・画像はそのまま、Word・Excel・PowerPoint・テキストは本文を取り出す
    const content = [];
    const notes = [];
    let total = 0;
    for (const f of files) {
      const { data: blob, error } = await admin.storage.from('uploads').download(f.path);
      if (error || !blob) { notes.push(`「${f.name}」を読み込めませんでした`); continue; }
      const bytes = await blob.arrayBuffer();
      total += bytes.byteLength;
      if (total > CHAT_MAX_BYTES) { notes.push(`「${f.name}」は合計サイズの上限（20MB）を超えるため読みませんでした`); continue; }
      try {
        if (isNativeFile(blob.type || f.type, f.name)) {
          const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.type);
          content.push({ type: 'text', text: `【添付資料: ${f.name}】` });
          content.push(fileBlock({ bytes, contentType: type }));
        } else {
          content.push({ type: 'text', text: `【添付資料: ${f.name}】\n${await extractText(bytes, { type: f.type, name: f.name })}` });
        }
      } catch (e) {
        notes.push(`「${f.name}」: ${e.message}`);
      }
    }
    const google = await readGoogleLinks(user.email, text);
    content.push(...google.blocks);
    notes.push(...google.notes);
    content.push({ type: 'text', text: `（${name} の依頼）\n${text || '添付資料を読んで要点をまとめてください。'}${notes.length ? `\n\n（読めなかった添付: ${notes.join(' / ')}）` : ''}` });

    const context = await buildContext(admin, meeting);
    const messages = [...historyMessages((history || []).reverse()), { role: 'user', content }];
    // 先頭が assistant になる・同じ役が続く場合に備えて、最後の user を前とつなぐ
    const merged = [];
    for (const m of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content.push(...m.content);
      else merged.push({ role: m.role, content: [...m.content] });
    }

    const answer = await claude().messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        { type: 'text', text: SYSTEM },
        // 議事録と社内の資料は同じ議事録で何度も使うので、キャッシュして 2 回目以降を安くする
        { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
      ],
      messages: merged,
      output_config: { format: { type: 'json_schema', schema: normalizeSchema(CHAT_REPLY_SCHEMA) } },
    });
    if (answer.stop_reason === 'refusal') throw new Error('この依頼は AI が回答を控えました。文面を変えてお試しください');
    let out;
    try { out = JSON.parse(textOf(answer)); } catch { throw new Error('AI の回答を読み取れませんでした。もう一度お試しください'); }
    const draft = normalizeDraft(out.draft);
    const reply = [String(out.reply || '').trim(), notes.length ? `\n（読めなかった添付: ${notes.join(' / ')}）` : ''].join('');

    const { data: saved, error: e2 } = await admin.from('meeting_chat_messages')
      .insert({ meeting_id: meetingId, role: 'assistant', content: reply, draft, reply_to: mine.id, author_id: user.id, author_name: name }).select().single();
    if (e2) throw new Error(`回答を保存できませんでした: ${e2.message}`);
    res.status(200).json({ request: mine, reply: saved });
  } catch (err) {
    // 回答が作れなかった依頼は消す（画面は入力欄に文面を戻す）。添付ファイルは画面側が消す
    await admin.from('meeting_chat_messages').delete().eq('id', mine.id);
    throw err;
  }
}

async function gapi(token, url, options = {}) {
  const r = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Google API エラー (${r.status})`);
  return data;
}

async function sheet(req, res, user) {
  const { message_id: messageId } = req.body || {};
  const admin = adminClient();
  const { data: msg } = await admin.from('meeting_chat_messages').select('*').eq('id', messageId).maybeSingle();
  if (!msg?.draft?.items?.length) { res.status(404).json({ error: '見積のたたき台が見つかりません' }); return; }
  const { data: meeting } = await admin.from('meetings').select('title, client_name').eq('id', msg.meeting_id).maybeSingle();

  const token = await getAccessToken(user.email, SHEET_SCOPES);
  const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const values = draftSheetRows(msg.draft, { meetingTitle: meeting?.title || '', clientName: meeting?.client_name || '', author: msg.author_name, date });
  const created = await gapi(token, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title: `見積たたき台_${meeting?.client_name || ''}_${msg.draft.title || meeting?.title || ''}_${date}`, locale: 'ja_JP' }, sheets: [{ properties: { title: 'たたき台', gridProperties: { frozenRowCount: 4 } } }] }),
  });
  const id = created.spreadsheetId;
  const gid = created.sheets?.[0]?.properties?.sheetId ?? 0;
  await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent('たたき台!A1')}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ range: 'たたき台!A1', majorDimension: 'ROWS', values }),
  });
  const n = msg.draft.items.length;
  await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat' } },
        { repeatCell: { range: { sheetId: gid, startRowIndex: 3, endRowIndex: 4 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.88, green: 0.95, blue: 0.94 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        { repeatCell: { range: { sheetId: gid, startRowIndex: 4, endRowIndex: 4 + n + 4, startColumnIndex: 5, endColumnIndex: 10 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } }, fields: 'userEnteredFormat.numberFormat' } },
        { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 320 }, fields: 'pixelSize' } },
      ],
    }),
  });
  await admin.from('meeting_chat_messages').update({ sheet_url: created.spreadsheetUrl }).eq('id', msg.id);
  res.status(200).json({ sheet_url: created.spreadsheetUrl });
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  try {
    const action = req.body?.action || 'send';
    if (action === 'send') await send(req, res, user);
    else if (action === 'sheet') await sheet(req, res, user);
    else res.status(400).json({ error: `不明な操作です: ${action}` });
  } catch (err) {
    console.error('[api/meeting-chat]', err);
    res.status(500).json({ error: err.message || 'AI への依頼に失敗しました' });
  }
}
