import { waitUntil } from '@vercel/functions';
import { requireMember, requirePost, adminClient, userClient, bearerToken } from './_lib/guard.js';
// Claude の SDK・資料を読む部品・CVアプリの情報を読む道具は、回答を作るとき（返事をしたあと）に読み込む。
// 送信してから画面に返事をするまでを短くするため（サーバーが止まっていたあとの最初の 1 回が特に速くなる）
const lazy = () => Promise.all([import('./_lib/claude.js'), import('./_lib/docText.js'), import('./_lib/aiChatTools.js')])
  .then(([c, d, t]) => ({ ...c, ...d, ...t }));

// ============================================================================
// POST /api/ai-chat   AI チャット（Claude）
//
//   { action: 'send', chat_id, message, attachments: [{ path, name, type, size }] }
//       質問を保存して、回答の行（status: pending）を作ってすぐ返す（202）。
//       回答は裏で作る（waitUntil。画面を離れても止まらない）。画面は回答が届くまで読み直す。
//       CVアプリの情報（案件・見積・書類・クライアント・売上粗利管理表）は、Claude が道具を使って読む。
//       道具は「質問した人の権限」（RLS）で読むので、その人が見られない情報は読めない。
//       チャットの「下書き」欄の今の中身も一緒に渡す（下書きを直す依頼に使う）。
//
//   書き込めるのは、そのチャットの owner・editor だけ（ai_chat_members）。
// ============================================================================

const MODEL = 'claude-opus-5-5';
const HISTORY_LIMIT = 40;
const MAX_TOOL_ROUNDS = 8;
const MAX_FILES = 5;
const MAX_BYTES = 20 * 1024 * 1024;

const SYSTEM = `あなたは株式会社コンセプト・ヴィレッジの社内アプリ「CV AX KIT（CVアプリ）」の中で使われるアシスタントです。
デザイン・印刷・ブランディングの会社の社員が、案件・見積・請求などの仕事の相談をします。

- 日本語で、要点を先に、簡潔に答えてください。表にすると分かりやすいものは Markdown の表で。
- CVアプリの情報（案件・見積・納品書・請求書・発注書・領収書・クライアント・売上粗利管理表）が必要なときは、用意された道具で読んでから答えてください。推測で数字を作らないでください。
- 道具で見つからない・見る権限がないと返ってきたときは、そのとおり伝えてください（権限のない情報を推測で補わないでください）。
- 金額は「税抜」「税込」を明記してください。案件・見積・書類は番号（例 P-2611-009、CV-2611-027）も添えてください。
- 下書き（提案書・メール文など）を頼まれたら、本文をそのまま使える形で書いてください。チャットの「下書き」欄の中身が渡されたときは、それを直す依頼として扱ってください。
- このチャットは複数の社員で共有されていることがあります。発言の頭の（名前）で、誰の質問かが分かります。`;

const jstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  const { action } = req.body || {};
  try {
    if (action === 'send') return await send(req, res, user);
    res.status(400).json({ error: '不明な操作です' });
  } catch (err) {
    console.error('ai-chat failed', err);
    res.status(500).json({ error: err?.message || 'AI チャットの処理に失敗しました' });
  }
}

async function send(req, res, user) {
  const { chat_id: chatId, message, attachments } = req.body || {};
  const text = String(message || '').trim();
  const files = (Array.isArray(attachments) ? attachments : []).filter((f) => f && typeof f.path === 'string' && f.path.startsWith(`ai-chats/${chatId}/`)).slice(0, MAX_FILES);
  if (!chatId) { res.status(400).json({ error: 'チャットが指定されていません' }); return; }
  if (!text && !files.length) { res.status(400).json({ error: '質問を入力してください' }); return; }

  const admin = adminClient();
  const name = (user.full_name || '').trim() || user.email;
  // メンバーか・チャット・前のやり取り（新しい方から）を、同時に読む
  const [{ data: member }, { data: chat }, { data: history }] = await Promise.all([
    admin.from('ai_chat_members').select('role').eq('chat_id', chatId).eq('user_id', user.id).maybeSingle(),
    admin.from('ai_chats').select('*').eq('id', chatId).maybeSingle(),
    admin.from('ai_chat_messages').select('role, author_name, content, attachments, status')
      .eq('chat_id', chatId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
  ]);
  if (!member || !['owner', 'editor'].includes(member.role)) { res.status(403).json({ error: 'このチャットに書き込む権限がありません' }); return; }
  if (!chat) { res.status(404).json({ error: 'チャットが見つかりません' }); return; }

  // 質問と回答の行（作成中）を 1 回で保存する（回答が質問のあとに並ぶよう、時刻を 1 ミリ秒ずらす）
  const now = Date.now();
  const { data: rows, error: e1 } = await admin.from('ai_chat_messages').insert([
    // 2 行で入れる項目をそろえる（片方にしかない項目は、もう片方で空になり保存できないため）
    { chat_id: chatId, role: 'user', author_id: user.id, author_name: name, content: text, attachments: files, status: 'done', used_data: [], created_at: new Date(now).toISOString() },
    { chat_id: chatId, role: 'assistant', author_id: user.id, author_name: 'Claude', content: '', attachments: [], status: 'pending', used_data: [], created_at: new Date(now + 1).toISOString() },
  ], { defaultToNull: false }).select('id, role');
  if (e1) throw new Error(`質問を保存できませんでした: ${e1.message}`);
  const mine = rows.find((r) => r.role === 'user');
  const pending = rows.find((r) => r.role === 'assistant');

  res.status(202).json({ ok: true, message_id: mine.id, answer_id: pending.id });

  // 最初の質問なら、その文をチャットの名前にする（返事をしたあとで）
  const patch = { last_message_at: new Date(now).toISOString() };
  if (!(history || []).length && chat.title === '新しいチャット' && text) patch.title = text.replace(/\s+/g, ' ').slice(0, 40);
  waitUntil(Promise.all([
    admin.from('ai_chats').update(patch).eq('id', chatId),
    answer({ admin, token: bearerToken(req), user, name, chat, text, files, history: (history || []).reverse(), pendingId: pending.id }),
  ]));
}

/** 前のやり取りを Claude に渡す形に（同じ役が続くときはつなぐ） */
function historyMessages(history) {
  const out = [];
  for (const m of history) {
    if (m.role === 'assistant' && m.status !== 'done') continue;
    const files = (m.attachments || []).map((f) => f.name).filter(Boolean);
    const body = m.role === 'user'
      ? `（${m.author_name}）${m.content || ''}${files.length ? `\n（添付: ${files.join('、')}）` : ''}`
      : (m.content || '');
    if (!body.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push({ type: 'text', text: body });
    else out.push({ role: m.role, content: [{ type: 'text', text: body }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** 添付ファイルを読む（PDF・画像はそのまま、Word・Excel などは本文を取り出す） */
async function attachmentBlocks(admin, files, { fileBlock, extractText, isNativeFile }) {
  const content = [];
  const notes = [];
  let total = 0;
  for (const f of files) {
    const { data: blob, error } = await admin.storage.from('uploads').download(f.path);
    if (error || !blob) { notes.push(`「${f.name}」を読み込めませんでした`); continue; }
    const bytes = await blob.arrayBuffer();
    total += bytes.byteLength;
    if (total > MAX_BYTES) { notes.push(`「${f.name}」は合計サイズの上限（20MB）を超えるため読みませんでした`); continue; }
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
  return { content, notes };
}

/** 拒否のときに別のモデルで答え直す（server-side fallback）。使えない環境ではそのまま送り直す */
async function createMessage(claude, params) {
  try {
    return await claude().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    if (err?.status === 400 && /fallback/i.test(String(err?.message || ''))) return claude().messages.create(params);
    throw err;
  }
}

async function answer({ admin, token, user, name, chat, text, files, history, pendingId }) {
  const used = [];
  const setProgress = (label) => admin.from('ai_chat_messages').update({ used_data: used.map((l) => ({ label: l })), content: label ? `（${label}）` : '' }).eq('id', pendingId);
  try {
    const lib = await lazy();
    const { claude, TOOLS, runTool, toolLabel } = lib;
    const db = userClient(token);
    const { content: fileContent, notes } = await attachmentBlocks(admin, files, lib);
    const userContent = [
      ...fileContent,
      { type: 'text', text: `（${name}）${text || '添付資料を読んで要点をまとめてください。'}${notes.length ? `\n\n（読めなかった添付: ${notes.join(' / ')}）` : ''}` },
    ];
    const messages = historyMessages(history);
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') last.content.push(...userContent);
    else messages.push({ role: 'user', content: userContent });

    const system = [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `今日（日本時間）: ${jstNow()}\n質問した人: ${name}（${user.email}）\nチャットの名前: ${chat.title}${chat.draft_text?.trim() ? `\n\n【このチャットの「下書き」欄の今の中身】\n${chat.draft_text.slice(0, 30000)}` : ''}` },
    ];

    let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    let final = null;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const resp = await createMessage(claude, {
        model: MODEL, max_tokens: 16000, system, messages, tools: TOOLS,
        thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
      });
      usage = {
        input_tokens: usage.input_tokens + (resp.usage?.input_tokens || 0),
        output_tokens: usage.output_tokens + (resp.usage?.output_tokens || 0),
        cache_read_input_tokens: usage.cache_read_input_tokens + (resp.usage?.cache_read_input_tokens || 0),
      };
      if (resp.stop_reason === 'refusal') throw new Error('この質問には AI が回答を控えました。文面を変えてお試しください');
      if (resp.stop_reason !== 'tool_use' || round === MAX_TOOL_ROUNDS) { final = resp; break; }
      // 道具を使う（同じ回答の中の道具はまとめて実行し、結果を 1 つのメッセージで返す）
      messages.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        const label = toolLabel(block.name, block.input);
        used.push(label);
        await setProgress(`${label}しています…`);
        try {
          const out = await runTool(db, block.name, block.input || {});
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 60000) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `読み込みに失敗しました: ${e?.message || e}` });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    const reply = (final?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
      || (final?.stop_reason === 'max_tokens' ? '回答が長くなりすぎて途中で止まりました。質問を分けてお試しください。' : '回答を作れませんでした。もう一度お試しください。');
    await admin.from('ai_chat_messages').update({
      content: reply + (notes.length ? `\n\n（読めなかった添付: ${notes.join(' / ')}）` : ''),
      status: 'done', usage: { ...usage, model: final?.model || MODEL }, used_data: [...new Set(used)].map((l) => ({ label: l })),
    }).eq('id', pendingId);
    await admin.from('ai_chats').update({ last_message_at: new Date().toISOString() }).eq('id', chat.id);
  } catch (err) {
    console.error('ai-chat answer failed', err);
    await admin.from('ai_chat_messages').update({
      status: 'error', content: `回答を作れませんでした：${String(err?.message || err).slice(0, 300)}\nお手数ですが、もう一度送ってください。`,
      used_data: used.map((l) => ({ label: l })),
    }).eq('id', pendingId);
  }
}
