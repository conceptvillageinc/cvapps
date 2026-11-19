import { waitUntil } from '@vercel/functions';
import { requireMember, requirePost, adminClient, userClient, bearerToken } from './_lib/guard.js';
// Claude の SDK・資料を読む部品・CVアプリの情報を読む道具は、回答を作るとき（返事をしたあと）に読み込む。
// 送信してから画面に返事をするまでを短くするため（サーバーが止まっていたあとの最初の 1 回が特に速くなる）
import { DESIGN_TOOLS, DESIGN_TOOL_NAMES, designRules, startDesign, applyDesignTool, designLabel, finishDesign, renderBoards } from './_lib/aiDesign.js';
import crypto from 'node:crypto';

const lazy = () => Promise.all([import('./_lib/claude.js'), import('./_lib/docText.js'), import('./_lib/aiChatTools.js'), import('./_lib/googleTools.js')])
  .then(([c, d, t, g]) => ({ ...c, ...d, ...t, ...g }));

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
const MAX_TOOL_ROUNDS_DESIGN = 16;     // デザイン作成はボードを 1 枚ずつ作るので、やり取りの回数を多めに
const CONTINUE_AFTER_MS = Number(process.env.AI_CHAT_CONTINUE_AFTER_MS) || 200_000; // デザイン作成で、この時間を過ぎたら続きを別の呼び出しにする（1 回 5 分まで。試験のときだけ環境変数で短くする）
const NO_DESIGN_RULE = `
【デザイン作成はオフです】商品画像・バナー・チラシなどのデザインを頼まれたら、構成と文案を文章で作り、最後に「入力欄の「デザイン作成」をオンにして送ると、デザインのボードを作って右側に表示できます」とひとこと案内してください。`;
const CONTINUE_RULE = `
【続きの作業です】前の回答は時間の都合で途中まで作って止まりました。【今のデザイン】に、すでに作ったボードがあります。同じ依頼の残りのボードだけを作り、最後に set_design_info で名前と付せんを決めてください。回答の本文には、全体（前の分も含む）のボード一覧と確認点を書いてください。`;
const MAX_FILES = 5;
const MAX_BYTES = 20 * 1024 * 1024;

const SYSTEM = `あなたは株式会社コンセプト・ヴィレッジの社内アプリ「CV AX KIT（CVアプリ）」の中で使われるアシスタントです。
デザイン・印刷・ブランディングの会社の社員が、案件・見積・請求などの仕事の相談をします。

- 日本語で、要点を先に、簡潔に答えてください。表にすると分かりやすいものは Markdown の表で。
- CVアプリの情報（案件・見積・納品書・請求書・発注書・領収書・クライアント・売上粗利管理表）が必要なときは、用意された道具で読んでから答えてください。推測で数字を作らないでください。
- 道具で見つからない・見る権限がないと返ってきたときは、そのとおり伝えてください（権限のない情報を推測で補わないでください）。
- 金額は「税抜」「税込」を明記してください。案件・見積・書類は番号（例 P-2611-009、CV-2611-027）も添えてください。
- 下書き（提案書・メール文など）を頼まれたら、本文をそのまま使える形で書いてください。チャットの「下書き」欄の中身が渡されたときは、それを直す依頼として扱ってください。
- このチャットは複数の社員で共有されていることがあります。発言の頭の（名前）で、誰の質問かが分かります。
- Google ドライブ・Gmail の道具があるときは、質問した人の会社のアカウントとして読めます。CVアプリに無い資料・メールのやり取りが必要なときに使ってください。読んだファイル・メールは、名前・件名・日付を添えて答えてください。`;

const jstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  const { action } = req.body || {};
  try {
    if (action === 'send') return await send(req, res, user);
    if (action === 'save_to_drive') return await saveToDrive(req, res, user);
    if (action === 'render_design') return await renderDesign(req, res, user);
    if (action === 'continue') return await continueAnswer(req, res, user);
    res.status(400).json({ error: '不明な操作です' });
  } catch (err) {
    console.error('ai-chat failed', err);
    res.status(500).json({ error: err?.message || 'AI チャットの処理に失敗しました' });
  }
}

async function send(req, res, user) {
  const { chat_id: chatId, message, attachments, web: webRaw, slides: slidesRaw, effort: effortRaw } = req.body || {};
  const web = webRaw === true; // 入力欄の「Web 検索」をオンにして送ったときだけ、Web を調べる
  const design = req.body?.design === true; // 「デザイン作成」をオンにして送ったときだけ、デザインのボードを作る
  const slides = slidesRaw === true && !design; // 「スライド作成」をオンにして送ったときだけ、PowerPoint を作る（デザイン作成と同時には使わない）
  const effort = EFFORTS.includes(effortRaw) ? effortRaw : 'medium'; // 速さ優先（low）／標準（medium）／じっくり（high）
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
    admin.from('ai_chat_messages').select('role, author_name, content, attachments, status, used_data')
      .eq('chat_id', chatId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
  ]);
  if (!member || !['owner', 'editor'].includes(member.role)) { res.status(403).json({ error: 'このチャットに書き込む権限がありません' }); return; }
  if (!chat) { res.status(404).json({ error: 'チャットが見つかりません' }); return; }

  // 質問と回答の行（作成中）を 1 回で保存する（回答が質問のあとに並ぶよう、時刻を 1 ミリ秒ずらす）
  const now = Date.now();
  const { data: rows, error: e1 } = await admin.from('ai_chat_messages').insert([
    // 2 行で入れる項目をそろえる（片方にしかない項目は、もう片方で空になり保存できないため）
    { chat_id: chatId, role: 'user', author_id: user.id, author_name: name, content: text, attachments: files, status: 'done', used_data: [...(web ? [{ kind: 'web_on' }] : []), ...(slides ? [{ kind: 'slides_on' }] : []), ...(design ? [{ kind: 'design_on' }] : [])], usage: null, created_at: new Date(now).toISOString() },
    { chat_id: chatId, role: 'assistant', author_id: user.id, author_name: 'Claude', content: '', attachments: [], status: 'pending', used_data: [], usage: { effort }, created_at: new Date(now + 1).toISOString() },
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
    answer({ admin, token: bearerToken(req), user, name, chat, text, files, web, slides, design, effort, history: (history || []).reverse(), pendingId: pending.id }),
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
async function attachmentBlocks(admin, files, { fileBlock, extractText, isNativeFile, pdfBlocks }) {
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
        // PDF はページ数が多ければ文字だけにする（そのまま渡すと上限の 100 万トークンを超えることがある）
        if (type === 'application/pdf') content.push(...await pdfBlocks(bytes, `【添付資料: ${f.name}】`));
        else { content.push({ type: 'text', text: `【添付資料: ${f.name}】` }); content.push(fileBlock({ bytes, contentType: type })); }
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
async function createMessage(claude, params, extraBetas = []) {
  // まず古い道具の結果の自動片付けを付けて送る。この機能が使えない組み合わせのときは、外して送り直す
  try {
    return await createMessageRaw(claude, { ...params, context_management: CONTEXT_MANAGEMENT }, [...extraBetas, CONTEXT_BETA]);
  } catch (err) {
    if (err?.status === 400 && /context.?management|clear_tool_uses/i.test(String(err?.message || ''))) return createMessageRaw(claude, params, extraBetas);
    throw err;
  }
}

async function createMessageRaw(claude, params, extraBetas = []) {
  try {
    return await claude().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01', ...extraBetas], fallbacks: 'default' });
  } catch (err) {
    if (err?.status === 400 && /fallback/i.test(String(err?.message || ''))) {
      return extraBetas.length ? claude().beta.messages.create({ ...params, betas: extraBetas }) : claude().messages.create(params);
    }
    throw err;
  }
}

const EFFORTS = ['low', 'medium', 'high'];

// ---------------------------------------------------------------------------
// 資料メモ: Gmail・Google ドライブ・CVアプリなどを読んだ回答では、読んだ内容の要点を Claude に「資料メモ」として書いてもらい、
//   回答の used_data に { kind: 'notes', text } として保存する。2 回目以降の回答は資料メモをもとに答え、読み直しは 2 回までにする
//   （チャットの最初に情報をしっかり読み、あとは読み直さずに精度を保ったまま速く・安く答えるため）
// ---------------------------------------------------------------------------
const NOTES_OPEN = '<<<資料メモ';
const NOTES_CLOSE = '資料メモ>>>';
const NOTES_MAX = 12000;      // 1 回の資料メモの上限（文字）
const NOTES_TOTAL_MAX = 24000; // 次の回答に渡す資料メモの合計の上限（文字。新しいものを優先）
const LATER_READ_MAX = 2;      // 資料メモがあるチャットで、1 回の回答で新しく読む回数の上限
const NOTES_RULE = `
【資料メモ】
- 道具（案件・見積・書類・クライアント・売上粗利管理表・Google ドライブ・Gmail・ブラウザ）で何かを読んだときは、回答の本文のあとに、次の形で「資料メモ」を付けてください。アプリが保存し、このチャットの次の回答で使います（画面には出ません）。
${NOTES_OPEN}
- 読んだ内容のうち、今後の回答に必要な事実・数字・日付・固有名詞・条件を箇条書きで（出典: ファイル名・メールの件名と日付・案件番号など を添える）
- 推測は書かない。12,000 字以内
${NOTES_CLOSE}
- 道具で何も読まなかったときは、資料メモは付けないでください。`;
const laterRule = (notes) => `
【このチャットの資料メモ（これまでに読んだ資料の要点）】
${notes}

【2 回目以降の回答の決まり】
- 上の資料メモと会話の内容をもとに答えてください。Gmail・Google ドライブ・CVアプリ・ブラウザの道具で読み直すのは、新しく調べるよう頼まれたときや、資料メモに無い情報がどうしても必要なときだけにしてください（1 回の回答で ${LATER_READ_MAX} 回まで）。`;

// 1 回の回答で、道具（Drive・Gmail・案件など）から読み込める量のめやす（文字数。日本語はほぼ 1 文字 1 トークン）
const READ_BUDGET = 350_000;
/** 道具の結果の大きさ（おおよその文字数）。画像は 2,000、PDF はファイルの大きさから見積もる */
function contentSize(content) {
  if (typeof content === 'string') return content.length;
  return (content || []).reduce((sum, b) => sum + (b.type === 'text' ? (b.text || '').length
    : b.type === 'image' ? 2000
    : b.type === 'document' ? Math.max(3000, Math.round((b.source?.data?.length || 0) / 20))
    : 0), 0);
}

// 長くなった会話の、古い道具の結果を Anthropic 側で自動で片付ける（context editing）。
//   入力が 40 万トークンを超えたら、直近 4 回分を残して古い道具の結果を消す
const CONTEXT_BETA = 'context-management-2025-06-27';
const CONTEXT_MANAGEMENT = {
  edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 400000 }, keep: { type: 'tool_uses', value: 4 }, clear_at_least: { type: 'input_tokens', value: 50000 } }],
};

// ---------------------------------------------------------------------------
// スライド作成（Anthropic の PowerPoint スキル。Claude が作業用の場所で .pptx を作る）
//   できたファイル（.pptx・.pdf・各ページの画像）は Files API から受け取り、Storage の
//   ai-chats/{チャット}/decks/{回答}/ に置く。回答の used_data に { kind: 'deck', ... } として残す。
// ---------------------------------------------------------------------------
const SLIDE_BETAS = ['code-execution-2025-08-25'];
const SLIDE_RULES = `
【スライド作成がオンです】
- 依頼に沿って PowerPoint（.pptx）を作ってください。pptx スキルを使い、16:9 で、見出し・本文・数字・表・グラフを読みやすく配置してください。
- 会社の資料なので、右上か下に「concept-village inc.」と入れてください。添付に .pptx があれば、そのデザイン（色・フォント・配置）に合わせてください。
- できあがったら、次の 3 種類を /mnt/user-data/outputs/ に保存してください（プレビューに使います）。
  1. 資料本体: 「資料名.pptx」
  2. 同じ内容の PDF: LibreOffice（soffice --headless --convert-to pdf）で書き出した「資料名.pdf」
  3. 各ページの画像: PDF から幅 1600px の PNG を作り「page-01.png」「page-02.png」…
- 書き出した画像を見て、文字のはみ出し・重なりがあれば直してから保存してください。
- 回答の本文には、ファイルの置き場所やコードは書かず、資料の構成（各ページの見出し）と、確認が必要な点だけを短く書いてください。
- 前の回答で作った資料を直す依頼のときは、直した版を新しく作ってください（ファイル名は同じでかまいません）。`;

/** 返ってきた中身から、作られたファイルの ID を全部拾う（入れ子の file_id） */
function collectFileIds(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => collectFileIds(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.file_id === 'string') out.add(node.file_id);
    Object.values(node).forEach((v) => collectFileIds(v, out));
  }
  return out;
}

/** 作られたファイルを Files API から受け取り、Storage に置く。{ title, pptx, pdf, pages } */
async function storeDeckFiles({ admin, claude, fileIds, chatId, messageId }) {
  const saved = [];
  for (const id of fileIds) {
    try {
      const meta = await claude().beta.files.retrieveMetadata(id, { betas: ['files-api-2025-04-14'] });
      const name = String(meta?.filename || id).split('/').pop();
      if (!/\.(pptx|pdf|png)$/i.test(name)) continue;
      const resp = await claude().beta.files.download(id, { betas: ['files-api-2025-04-14'] });
      const bytes = Buffer.from(await resp.arrayBuffer());
      const ext = name.split('.').pop().toLowerCase();
      const path = `ai-chats/${chatId}/decks/${messageId}/${Date.now()}-${saved.length}.${ext}`;
      const type = ext === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : ext === 'pdf' ? 'application/pdf' : 'image/png';
      const { error } = await admin.storage.from('uploads').upload(path, bytes, { contentType: type, upsert: true });
      if (error) throw error;
      saved.push({ name, ext, path, size: bytes.length });
    } catch (e) {
      console.error('deck file failed', id, e?.message);
    }
  }
  const pptx = saved.filter((f) => f.ext === 'pptx').pop();
  if (!pptx) return null;
  const pdf = saved.filter((f) => f.ext === 'pdf').pop() || null;
  const pages = saved.filter((f) => f.ext === 'png').sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map((f) => f.path);
  return { kind: 'deck', title: pptx.name.replace(/\.pptx$/i, ''), pptx: { path: pptx.path, name: pptx.name, size: pptx.size }, pdf: pdf ? { path: pdf.path } : null, pages };
}

/** デザインのボードを PNG で書き出す（board_id があればその 1 枚、無ければ全部を ZIP）。{ url } */
async function renderDesign(req, res, user) {
  const { message_id: messageId, board_id: boardId, format: formatRaw } = req.body || {};
  const format = formatRaw === 'pdf' ? 'pdf' : 'png'; // png: 画像 / pdf: ベクター（Illustrator 用）
  const admin = adminClient();
  const { data: msg } = await admin.from('ai_chat_messages').select('chat_id, used_data').eq('id', messageId).maybeSingle();
  if (!msg) { res.status(404).json({ error: 'デザインが見つかりません' }); return; }
  const { data: member } = await admin.from('ai_chat_members').select('role').eq('chat_id', msg.chat_id).eq('user_id', user.id).maybeSingle();
  if (!member) { res.status(403).json({ error: 'このチャットのメンバーではありません' }); return; }
  const design = (msg.used_data || []).find((u) => u.kind === 'design');
  const boards = (design?.boards || []).filter((b) => !boardId || b.id === boardId);
  if (!boards.length) { res.status(404).json({ error: 'ボードが見つかりません' }); return; }
  const assetUrls = {};
  for (const a of design.assets || []) {
    const { data } = await admin.storage.from('uploads').createSignedUrl(a.path, 600);
    if (data?.signedUrl) assetUrls[a.id] = data.signedUrl;
  }
  const out = await renderBoards(boards, assetUrls, format);
  const safe = (t) => String(t || 'デザイン').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const fileName = out.ext === 'zip' ? `${safe(design.title)}_${format.toUpperCase()}.zip` : out.name;
  const path = `ai-chats/${msg.chat_id}/designs/${messageId}/${Date.now()}.${out.ext}`;
  const contentType = { png: 'image/png', pdf: 'application/pdf', zip: 'application/zip' }[out.ext];
  const { error } = await admin.storage.from('uploads').upload(path, out.file, { contentType, upsert: true });
  if (error) throw new Error(`書き出したファイルを保存できませんでした: ${error.message}`);
  const { data: signed } = await admin.storage.from('uploads').createSignedUrl(path, 600, { download: fileName });
  res.status(200).json({ url: signed?.signedUrl, name: fileName });
}

/** 時間切れで止まったデザイン作成の続きを作る（質問した本人の画面が呼ぶ。同時に 2 つ動かないよう、印を消せた 1 回だけが続ける） */
async function continueAnswer(req, res, user) {
  const { message_id: messageId } = req.body || {};
  const admin = adminClient();
  const { data: msg } = await admin.from('ai_chat_messages').select('*').eq('id', messageId).maybeSingle();
  if (!msg || msg.role !== 'assistant') { res.status(404).json({ error: '回答が見つかりません' }); return; }
  if (msg.author_id !== user.id) { res.status(403).json({ error: '続きは、質問した本人の画面から作ります' }); return; }
  const marker = (msg.used_data || []).find((u) => u.kind === 'continue');
  if (msg.status !== 'pending' || !marker) { res.status(200).json({ ok: false }); return; }
  const rest = msg.used_data.filter((u) => u.kind !== 'continue');
  const { data: took } = await admin.from('ai_chat_messages').update({ used_data: rest, content: '（デザインの続きを作っています…）' })
    .eq('id', messageId).filter('used_data', 'cs', JSON.stringify([{ kind: 'continue', token: marker.token }])).select('id');
  if (!took?.length) { res.status(200).json({ ok: false }); return; }
  const [{ data: chat }, { data: before }] = await Promise.all([
    admin.from('ai_chats').select('*').eq('id', msg.chat_id).maybeSingle(),
    admin.from('ai_chat_messages').select('role, author_id, author_name, content, attachments, status, used_data, created_at')
      .eq('chat_id', msg.chat_id).lt('created_at', msg.created_at).order('created_at', { ascending: false }).limit(HISTORY_LIMIT + 1),
  ]);
  const question = (before || []).find((m) => m.role === 'user');
  if (!chat || !question) { await admin.from('ai_chat_messages').update({ status: 'error', content: '続きを作れませんでした（元の質問が見つかりません）' }).eq('id', messageId); res.status(200).json({ ok: false }); return; }
  const history = (before || []).filter((m) => m !== question).reverse();
  const flags = new Set((question.used_data || []).map((u) => u.kind));
  res.status(202).json({ ok: true });
  waitUntil(answer({
    admin, token: bearerToken(req), user, name: question.author_name || user.email, chat, text: question.content || '', files: question.attachments || [],
    web: flags.has('web_on'), slides: false, design: true, effort: msg.usage?.effort || 'medium', history, pendingId: messageId,
    continuation: { design: rest.find((u) => u.kind === 'design') || null },
  }));
}

/** Google ドライブに保存（本人の会社アカウントの Drive に、Google スライドとして）。{ url } を返す */
async function saveToDrive(req, res, user) {
  const { message_id: messageId } = req.body || {};
  const admin = adminClient();
  const { data: msg } = await admin.from('ai_chat_messages').select('chat_id, used_data').eq('id', messageId).maybeSingle();
  if (!msg) { res.status(404).json({ error: '資料が見つかりません' }); return; }
  const { data: member } = await admin.from('ai_chat_members').select('role').eq('chat_id', msg.chat_id).eq('user_id', user.id).maybeSingle();
  if (!member) { res.status(403).json({ error: 'このチャットのメンバーではありません' }); return; }
  const deck = (msg.used_data || []).find((u) => u.kind === 'deck');
  if (!deck?.pptx?.path) { res.status(404).json({ error: 'この回答には資料がありません' }); return; }
  const { isCompanyAccount, uploadToDriveAsSlides } = await import('./_lib/googleTools.js');
  if (!isCompanyAccount(user.email)) { res.status(403).json({ error: 'Google ドライブへの保存は、会社のアカウントでログインしている人だけが使えます' }); return; }
  const { data: blob, error } = await admin.storage.from('uploads').download(deck.pptx.path);
  if (error || !blob) { res.status(500).json({ error: '資料のファイルを読み込めませんでした' }); return; }
  const out = await uploadToDriveAsSlides(user.email, { name: deck.title || '資料', bytes: Buffer.from(await blob.arrayBuffer()) });
  res.status(200).json({ url: out.url });
}

// Web 検索・Web ページの読み込み（Anthropic のサーバーで動く道具）。1 回の質問で使う回数の上限
const WEB_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
];
const WEB_RULES = `
【Web 検索がオンです】
- Web の情報が必要なときは web_search・web_fetch を使ってください。URL が貼られていたら web_fetch で読んでください。
- 検索の言葉に、社内の情報（見積・請求の金額、粗利、社内メモ、メールの本文、個人の名前・連絡先）を入れないでください。会社名・商品名・業界の言葉など、公開されている言葉だけで検索してください。
- Web で調べた内容は、どのページの情報かが分かるように書いてください（引用元はアプリが番号付きで表示します）。
- web_fetch で読めなかったとき（読み込みを断られた・中身が空・「読み込み中」しか無い）や、web_fetch が無いときは、browse_page でブラウザで開いて読んでください。`;

// ブラウザで開いて読む道具（Claude の web_fetch で読めないページ用。サーバーのヘッドレス Chrome で開く）
//   開けるのは、質問に書かれた URL か、この回答の検索結果に出てきた URL だけ（読んだページの指示で、ほかの URL に情報を送らないため）
const BROWSE_TOOL = {
  name: 'browse_page',
  description: 'Web ページをブラウザで開いて、表示された本文とスクリーンショットを読む。web_fetch で読めなかったとき（読み込みを断られた・中身が空・開いたあとに中身を組み立てるページ）に使う。開けるのは、質問に書かれた URL か、検索結果に出てきた URL だけ。',
  input_schema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', description: '開く URL（http/https）' } }, required: ['url'] },
};
const BROWSE_MAX = 3; // 1 回の回答でブラウザで開くのは 3 ページまで
/** URL を比べやすい形に（# 以降を外し、末尾の / をそろえる） */
const normUrl = (u) => {
  try {
    const x = new URL(String(u).trim());
    x.hash = '';
    x.hostname = x.hostname.toLowerCase();
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');
    return x.toString();
  } catch { return ''; }
};
const URL_RE = /https?:\/\/[^\s<>"'）」』】、。]+/g;
const NO_SLIDE_RULE = `
【スライド作成はオフです】スライド・企画書・提案書・PowerPoint を頼まれたら、ページごとの見出しと本文（箇条書き）を文章で作ってください。最後に「入力欄の「スライド作成」をオンにして送ると、PowerPoint で作って右側にプレビューを出せます」とひとこと案内してください。`;
const NO_WEB_RULE = `
【Web 検索はオフです】Web の最新情報が必要な質問には、入力欄の「Web 検索」をオンにして送り直すよう、ひとこと案内してください。`;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const safeUrl = (u) => String(u || '').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');

async function answer({ admin, token, user, name, chat, text, files, web, slides = false, design = false, effort = 'medium', history, pendingId, continuation = null }) {
  const startedAt = Date.now();
  const used = [];
  const sources = []; // 参照した Web ページ（回答の下に番号付きで出す）
  const sourceNo = (url, title) => {
    let i = sources.findIndex((x) => x.url === url);
    if (i < 0) { sources.push({ url, title: String(title || '').trim() || hostOf(url) }); i = sources.length - 1; }
    return i + 1;
  };
  let deck = null; // スライド作成で作った資料
  let memoNote = null; // この回答で作った資料メモ
  let designState = null; // デザイン作成の作業中のデザイン
  const usedData = () => [...[...new Set(used)].map((l) => ({ label: l })), ...sources.map((x) => ({ kind: 'source', url: x.url, title: x.title })), ...(deck ? [deck] : []), ...(memoNote ? [memoNote] : []), ...(designState?.boards.length ? [finishDesign(designState)] : [])];
  const setProgress = (label) => admin.from('ai_chat_messages').update({ used_data: usedData(), content: label ? `（${label}）` : '' }).eq('id', pendingId);
  /** Web の道具を使った跡（検索の言葉・読んだページ）を拾う */
  const webNotes = [];
  const fetched = []; // web_fetch で読んだページ（引用されていなくても、参照したページに出す）
  const allowedUrls = new Set(); // browse_page で開いてよい URL（質問の中の URL・検索結果の URL）
  const allowUrl = (u) => { const n = normUrl(u); if (n) allowedUrls.add(n); };
  const collectWeb = (blocks) => {
    for (const b of blocks || []) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((r) => r?.url && allowUrl(r.url));
      if (b.type === 'web_fetch_tool_result' && b.content?.url) allowUrl(b.content.url);
      if (b.type === 'text') (b.citations || []).forEach((c) => c?.url && allowUrl(c.url));
      if (b.type === 'server_tool_use' && b.name === 'web_search') used.push(`Web を検索（${b.input?.query || ''}）`);
      if (b.type === 'server_tool_use' && b.name === 'web_fetch') used.push(`Web ページを確認（${hostOf(b.input?.url || '')}）`);
      if (b.type === 'web_fetch_tool_result' && b.content?.url && b.content?.type !== 'web_fetch_tool_result_error') fetched.push({ url: b.content.url, title: b.content?.content?.title });
      const err = b.content?.error_code;
      if (/_tool_result$/.test(b.type || '') && /^web_/.test(b.type) && err) webNotes.push(err === 'url_not_accessible' || err === 'url_not_allowed' ? 'Web ページを読めませんでした' : `Web 検索でエラー（${err}）`);
    }
  };
  /** 回答の文に、引用元の番号（[1] など）を付ける */
  //   Web の道具を使う前の「調べます」などの前置きは除き、最後に道具を使ったあとの文だけにする
  const renderText = (blocks) => {
    const all = blocks || [];
    let lastTool = -1;
    all.forEach((b, i) => { if (/tool_result$/.test(b.type || '') || b.type === 'server_tool_use') lastTool = i; });
    const after = all.slice(lastTool + 1).filter((b) => b.type === 'text');
    const textBlocks = after.length ? after : all.filter((b) => b.type === 'text');
    const out = textBlocks.map((b) => {
    const nums = [...new Set((b.citations || []).filter((c) => /^https?:\/\//.test(c.url || '')).map((c) => sourceNo(c.url, c.title)))];
    return b.text + nums.map((n) => `[${n}](${safeUrl(sources[n - 1].url)})`).join('');
    }).join('');
    fetched.forEach((f) => sourceNo(f.url, f.title)); // 引用されていない読んだページは、番号の後ろに足す
    return out;
  };
  try {
    const lib = await lazy();
    const { claude, TOOLS, runTool, toolLabel, GOOGLE_TOOLS, GOOGLE_TOOL_NAMES, runGoogleTool, googleToolLabel, isCompanyAccount } = lib;
    // Google（Drive・Gmail）は、会社のアカウント（@concept-village.co.jp）でログインしている人の質問のときだけ使える
    const google = isCompanyAccount(user.email);
    const ownTools = google ? [...TOOLS, ...GOOGLE_TOOLS] : TOOLS;
    // Web 検索をオンにしたときだけ、Web の道具を足す（引用元を出すため、自前の道具の strict は外す）
    // スライド作成のときは PowerPoint を作る道具（code_execution）を足す。Web 検索も一緒のときは、動的フィルタの無い版の Web の道具にする
    //   （code_execution と動的フィルタ付きの Web の道具を一緒にすると、作業場所が 2 つになって迷うため）
    //   スライド作成と一緒のときは Web ページの読み込みに browse_page を使う（古い版の web_fetch は別の申請が要るため入れない）
    const webTools = slides
      ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }, BROWSE_TOOL]
      : [...WEB_TOOLS, BROWSE_TOOL];
    // 質問（これまでの質問も含む）に書かれた URL は、ブラウザで開いてよい
    for (const m of [...history.filter((h) => h.role === 'user'), { content: text }]) (String(m.content || '').match(URL_RE) || []).forEach(allowUrl);
    let browsed = 0;
    const tools = [
      ...((web || slides) ? ownTools.map(({ strict, ...t }) => t) : ownTools),
      ...(web ? webTools : []),
      ...(slides ? [{ type: 'code_execution_20260521', name: 'code_execution' }] : []),
      ...(design ? DESIGN_TOOLS : []),
    ];
    // デザイン作成: 前のデザイン（続きのときは作りかけ）と、使える画像（チャットに添付した画像）
    let designRuleText = '';
    if (design) {
      const prior = continuation?.design || [...history].reverse().map((m) => (m.used_data || []).find((u) => u.kind === 'design')).find(Boolean) || null;
      const assets = [...(prior?.assets || [])];
      for (const f of files.filter((x) => /^image\//.test(x.type || '') || /\.(png|jpe?g|webp|gif)$/i.test(x.name || ''))) {
        if (!assets.some((a) => a.path === f.path)) assets.push({ id: `A${assets.length + 1}`, path: f.path, name: f.name });
      }
      designState = startDesign(prior, assets);
      designRuleText = designRules(prior, assets);
    }
    const db = userClient(token);
    const { content: fileContent, notes } = await attachmentBlocks(admin, files, lib);
    // スライド作成のときは、添付の PowerPoint・Excel・Word を作業場所にも置く（デザインを合わせる・表の数字を使うため）
    if (slides) {
      const { toFile } = await import('@anthropic-ai/sdk');
      for (const f of files.filter((x) => /\.(pptx|xlsx|docx)$/i.test(x.name || ''))) {
        try {
          const { data: blob } = await admin.storage.from('uploads').download(f.path);
          if (!blob) continue;
          const up = await claude().beta.files.upload({ file: await toFile(Buffer.from(await blob.arrayBuffer()), f.name) }, { betas: ['files-api-2025-04-14'] });
          fileContent.push({ type: 'container_upload', file_id: up.id });
        } catch (e) {
          notes.push(`「${f.name}」を作業場所に置けませんでした: ${e.message}`);
        }
      }
      // 前に作った資料（いちばん新しいもの）も置く。「3 枚目を短く」などの直しに使う
      const prev = [...history].reverse().map((m) => (m.used_data || []).find((u) => u.kind === 'deck')).find(Boolean);
      if (prev?.pptx?.path) {
        try {
          const { data: blob } = await admin.storage.from('uploads').download(prev.pptx.path);
          if (blob) {
            const up = await claude().beta.files.upload({ file: await toFile(Buffer.from(await blob.arrayBuffer()), prev.pptx.name || 'deck.pptx') }, { betas: ['files-api-2025-04-14'] });
            fileContent.push({ type: 'text', text: `【前の回答で作った資料: ${prev.pptx.name}（直す依頼のときはこれをもとにしてください）】` });
            fileContent.push({ type: 'container_upload', file_id: up.id });
          }
        } catch (e) { console.error('prev deck upload failed', e?.message); }
      }
    }
    const userContent = [
      ...fileContent,
      { type: 'text', text: `（${name}）${text || '添付資料を読んで要点をまとめてください。'}${notes.length ? `\n\n（読めなかった添付: ${notes.join(' / ')}）` : ''}` },
    ];
    const messages = historyMessages(history);
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') last.content.push(...userContent);
    else messages.push({ role: 'user', content: userContent });

    // これまでの回答で作った資料メモ（新しいものを優先して上限まで）
    const priorNotes = (() => {
      const all = history.flatMap((m) => (m.used_data || []).filter((u) => u.kind === 'notes' && u.text).map((u) => u.text));
      let out = '';
      for (const t of all.reverse()) { if ((out + t).length > NOTES_TOTAL_MAX) break; out = `${t}\n\n${out}`; }
      return out.trim();
    })();
    let laterReads = 0; // 資料メモがあるとき、この回答で新しく読んだ回数
    const overLaterLimit = () => priorNotes && laterReads >= LATER_READ_MAX;
    const system = [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `今日（日本時間）: ${jstNow()}\n質問した人: ${name}（${user.email}）\nチャットの名前: ${chat.title}\nGoogle ワークスペース（Drive・Gmail）: ${google ? '読める（質問した人のアカウントとして）' : '読めない（会社のアカウントではないため）'}${web ? WEB_RULES : NO_WEB_RULE}${slides ? SLIDE_RULES : NO_SLIDE_RULE}${design ? designRuleText : NO_DESIGN_RULE}${continuation ? CONTINUE_RULE : ''}${priorNotes ? laterRule(priorNotes) : ''}${NOTES_RULE}${chat.draft_text?.trim() ? `\n\n【このチャットの「下書き」欄の今の中身】\n${chat.draft_text.slice(0, 30000)}` : ''}` },
    ];

    let readSize = 0; // この回答で道具から読み込んだ量（おおよその文字数）
    let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    let final = null;
    let turn = []; // 今の回答の中身（Web の道具が長くかかって一度止まったときは、続きとつなぐ）
    if (slides) await setProgress('スライドを作っています（数分かかります）…');
    else if (web) await setProgress('考えています（Web も調べます）…');
    let containerId = null; // スライド作成の作業場所（続きの呼び出しでも同じ場所を使う）
    const fileIds = new Set();
    const maxRounds = design ? MAX_TOOL_ROUNDS_DESIGN : MAX_TOOL_ROUNDS;
    for (let round = 0; round <= maxRounds; round++) {
      // デザイン作成で時間が足りなくなったら、ここまでを保存して、続きを別の呼び出しで作る（1 回の呼び出しは 5 分まで）
      if (design && round > 0 && Date.now() - startedAt > CONTINUE_AFTER_MS) {
        await admin.from('ai_chat_messages').update({ content: '（デザインの続きを作っています…）', used_data: [...usedData(), { kind: 'continue', token: crypto.randomUUID(), at: new Date().toISOString() }] }).eq('id', pendingId);
        return;
      }
      const resp = await createMessage(claude, {
        model: MODEL, max_tokens: 16000, system, messages, tools,
        thinking: { type: 'adaptive' }, output_config: { effort },
        ...(slides ? { container: { ...(containerId ? { id: containerId } : {}), skills: [{ type: 'anthropic', skill_id: 'pptx', version: 'latest' }] } } : {}),
      }, slides ? SLIDE_BETAS : []);
      if (resp.container?.id) containerId = resp.container.id;
      if (slides) {
        collectFileIds(resp.content, fileIds);
        // 作業の様子（コードを動かした回数）を出す
        const runs = resp.content.filter((b) => b.type === 'server_tool_use' && /code_execution/.test(b.name || '')).length;
        if (runs) { used.push('PowerPoint を作成'); await setProgress(`スライドを作っています（作業 ${round + 1} 回目）…`); }
      }
      usage = {
        input_tokens: usage.input_tokens + (resp.usage?.input_tokens || 0),
        output_tokens: usage.output_tokens + (resp.usage?.output_tokens || 0),
        cache_read_input_tokens: usage.cache_read_input_tokens + (resp.usage?.cache_read_input_tokens || 0),
        web_search_requests: (usage.web_search_requests || 0) + (resp.usage?.server_tool_use?.web_search_requests || 0),
      };
      if (resp.stop_reason === 'refusal') throw new Error('この質問には AI が回答を控えました。文面を変えてお試しください');
      collectWeb(resp.content);
      turn.push(...resp.content);
      if (resp.stop_reason === 'pause_turn' && round < MAX_TOOL_ROUNDS) {
        // Web の道具が長くかかって一度止まった。そのまま送り返すと続きから再開する
        messages.push({ role: 'assistant', content: resp.content });
        await setProgress(used.length ? `${used[used.length - 1]}しています…` : '調べています…');
        continue;
      }
      if (resp.stop_reason !== 'tool_use' || round === maxRounds) { final = resp; break; }
      turn = [];
      // 道具を使う（同じ回答の中の道具はまとめて実行し、結果を 1 つのメッセージで返す）
      messages.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        if (DESIGN_TOOL_NAMES.has(block.name)) {
          const out = design && designState ? applyDesignTool(designState, block.name, block.input || {}) : { error: 'デザイン作成がオフです' };
          if (out.ok) { used.push(block.name === 'put_board' ? 'デザインを作成' : designLabel(block.name, block.input)); await setProgress(`${designLabel(block.name, block.input)}しています…（${designState.boards.length} 枚）`); }
          results.push({ type: 'tool_result', tool_use_id: block.id, ...(out.error ? { is_error: true, content: out.error } : { content: out.message }) });
          continue;
        }
        if (block.name === 'browse_page') {
          const target = normUrl(block.input?.url);

          if (!web) { results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'Web 検索がオフのため、ページを開けません' }); continue; }
          if (!target || !allowedUrls.has(target)) { results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: '開けるのは、質問に書かれた URL か、検索結果に出てきた URL だけです' }); continue; }
          if (overLaterLimit()) { results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `このチャットでは、資料メモをもとに答えてください（新しく読むのは 1 回の回答で ${LATER_READ_MAX} 回までです）` }); continue; }
          if (browsed >= BROWSE_MAX) { results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `ブラウザで開けるのは 1 回の回答で ${BROWSE_MAX} ページまでです` }); continue; }
          browsed += 1;
          laterReads += 1;
          used.push(`ブラウザでページを確認（${hostOf(target)}）`);
          await setProgress('ブラウザでページを開いています…');
          try {
            const { browsePage } = await import('./_lib/browser.js');
            const page = await browsePage(target);
            sourceNo(page.url || target, page.title);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: [
              { type: 'text', text: `【ブラウザで開いたページ】${page.title || ''}\n${page.url || target}（HTTP ${page.status || '不明'}）\n\n${page.text || '（本文の文字はありませんでした。スクリーンショットを見てください）'}` },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: page.jpeg.toString('base64') } },
            ] });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `ページを開けませんでした: ${e?.message || e}` });
          }
          continue;
        }
        const isGoogle = GOOGLE_TOOL_NAMES.has(block.name);
        const label = isGoogle ? googleToolLabel(block.name, block.input) : toolLabel(block.name, block.input);
        if (overLaterLimit()) { results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `このチャットでは、資料メモをもとに答えてください（新しく読むのは 1 回の回答で ${LATER_READ_MAX} 回までです）` }); continue; }
        laterReads += 1;
        used.push(label);
        await setProgress(`${label}しています…`);
        try {
          const out = isGoogle
            ? (google ? await runGoogleTool(user.email, block.name, block.input || {}) : { error: 'Google の情報は会社のアカウントの人だけが読めます' })
            : await runTool(db, block.name, block.input || {});
          // ファイルの中身（PDF・画像など）は、そのまま Claude に渡す
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out?.blocks ? out.blocks : JSON.stringify(out).slice(0, 60000) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `読み込みに失敗しました: ${e?.message || e}` });
        }
      }
      // 1 回の回答で読み込む量に上限を設ける（上限 100 万トークンを超えて答えられなくなるのを防ぐ）
      for (const r of results) {
        const size = contentSize(r.content);
        if (readSize + size > READ_BUDGET) {
          r.content = `この回答で読み込める量の上限に達したため、この結果は読み込みませんでした（約 ${Math.round(size / 1000)} 千字分）。ここまでに読んだ内容で答えるか、資料を絞って調べ直してください。`;
          r.is_error = true;
        } else readSize += size;
      }
      messages.push({ role: 'user', content: results });
    }
    if (slides && fileIds.size) {
      await setProgress('できた資料を保存しています…');
      deck = await storeDeckFiles({ admin, claude, fileIds: [...fileIds], chatId: chat.id, messageId: pendingId });
    }
    if (slides && !deck) webNotes.push('PowerPoint のファイルを受け取れませんでした。もう一度お試しください');
    // 回答の最後の資料メモを取り出して保存する（画面に出す本文からは外す）
    let replyText = renderText(turn);
    const memoAt = replyText.lastIndexOf(NOTES_OPEN);
    if (memoAt >= 0) {
      const closeAt = replyText.indexOf(NOTES_CLOSE, memoAt);
      const memo = replyText.slice(memoAt + NOTES_OPEN.length, closeAt >= 0 ? closeAt : undefined).replace(/\[(\d+)\]\((https?:[^)]+)\)/g, '（$2）').trim();
      replyText = (replyText.slice(0, memoAt) + (closeAt >= 0 ? replyText.slice(closeAt + NOTES_CLOSE.length) : '')).trim();
      if (memo) { memoNote = { kind: 'notes', text: memo.slice(0, NOTES_MAX), at: new Date().toISOString() }; used.push('資料メモに保存'); }
    }
    const reply = replyText.trim()
      || (final?.stop_reason === 'max_tokens' ? '回答が長くなりすぎて途中で止まりました。質問を分けてお試しください。' : '回答を作れませんでした。もう一度お試しください。');
    await admin.from('ai_chat_messages').update({
      content: reply + (notes.length ? `\n\n（読めなかった添付: ${notes.join(' / ')}）` : '') + (webNotes.length ? `\n\n（${[...new Set(webNotes)].join(' / ')}）` : ''),
      status: 'done', usage: { ...usage, model: final?.model || MODEL, effort, web_search_requests: usage.web_search_requests || 0 }, used_data: usedData(),
    }).eq('id', pendingId);
    await admin.from('ai_chats').update({ last_message_at: new Date().toISOString() }).eq('id', chat.id);
  } catch (err) {
    console.error('ai-chat answer failed', err);
    await admin.from('ai_chat_messages').update({
      status: 'error', content: /prompt is too long|too many tokens/i.test(String(err?.message || ''))
        ? '読み込んだ資料と会話が長くなりすぎて、回答を作れませんでした（Claude が一度に読める量の上限を超えました）。\n読む資料を絞って頼み直すか、「新しいチャット」で必要な内容だけを伝えて頼み直してください。'
        : `回答を作れませんでした：${String(err?.message || err).slice(0, 300)}\nお手数ですが、もう一度送ってください。`,
      used_data: usedData(),
    }).eq('id', pendingId);
  }
}
