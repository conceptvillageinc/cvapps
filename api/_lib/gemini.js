// ============================================================================
// Gemini API（文字起こし用）
//
// API キーは Vercel の環境変数 GEMINI_API_KEY（Google AI Studio で発行）。
// 音声は 15MB までなら本文に直接（inline）、それより大きければ Files API に
// いったん置いてから使う。
// ============================================================================

const API = 'https://generativelanguage.googleapis.com';
// モデルは世代交代が早い。環境変数で指定できるほか、「もう使えない」と言われたら
// エラー文に書かれた推奨モデルや下の候補で自動的にやり直す。
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MODEL_CANDIDATES = [GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3-flash', 'gemini-2.5-flash'];
const INLINE_LIMIT = 15 * 1024 * 1024;

export function isGeminiConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

function key() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY が未設定です。Vercel の環境変数に登録してください');
  return k;
}

/** 大きい音声を Files API にアップロードして file_uri を得る（処理後は自動で消える: 48 時間） */
async function uploadFile(bytes, mimeType, displayName) {
  const start = await fetch(`${API}/upload/v1beta/files?key=${key()}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) throw new Error(`Gemini へのアップロードを開始できませんでした (${start.status})`);
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini のアップロード先が取得できませんでした');

  const fin = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: Buffer.from(bytes),
  });
  const data = await fin.json().catch(() => ({}));
  if (!fin.ok || !data.file?.uri) throw new Error(`Gemini へのアップロードに失敗しました (${fin.status})`);

  // 処理が終わるまで待つ（動画・長い音声は ACTIVE になるまで少しかかる）
  let file = data.file;
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${API}/v1beta/${file.name}?key=${key()}`);
    file = await res.json();
  }
  if (file.state === 'FAILED') throw new Error('Gemini が音声を処理できませんでした');
  return { uri: file.uri, mimeType: file.mimeType || mimeType, name: file.name };
}

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number', description: '発話の開始秒（音声の先頭を 0）' },
          end: { type: 'number', description: '発話の終了秒' },
          speaker: { type: 'string', description: '話者の仮名（話者A / 話者B …）' },
          text: { type: 'string', description: '発話内容（日本語。フィラーは省く）' },
        },
        required: ['start', 'end', 'speaker', 'text'],
      },
    },
  },
  required: ['segments'],
};

/**
 * 音声 1 本を文字起こしする。
 * @param {ArrayBuffer|Buffer} bytes
 * @param {string} mimeType   audio/webm, audio/mp4, audio/mpeg, audio/wav など
 * @param {{ hint?: string, knownSpeakers?: string[] }} [opts]
 * @returns {Promise<Array<{start:number,end:number,speaker:string,text:string}>>}
 */
export async function transcribeAudio(bytes, mimeType, opts = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const audioPart = buf.byteLength <= INLINE_LIMIT
    ? { inline_data: { mime_type: mimeType, data: buf.toString('base64') } }
    : { file_data: (({ uri, mimeType: mt }) => ({ file_uri: uri, mime_type: mt }))(await uploadFile(buf, mimeType, 'meeting-audio')) };

  const prompt = [
    'これは日本語のビジネス打ち合わせの録音です。全文を文字起こしして、発話ごとに開始秒・終了秒・話者・内容を JSON で返してください。',
    '話者は声で区別し「話者A」「話者B」のように付けてください（名前が分かる場合はその名前）。',
    '「えー」「あの」などのフィラーは省き、固有名詞・金額・日付・数量・サイズはそのまま正確に残してください。',
    '聞き取れない箇所は「（聞き取れず）」と書いてください。要約はせず、発話をすべて書き起こしてください。',
    opts.knownSpeakers?.length ? `出席者: ${opts.knownSpeakers.join('、')}` : '',
    opts.hint ? `補足: ${opts.hint}` : '',
  ].filter(Boolean).join('\n');

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [audioPart, { text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: TRANSCRIPT_SCHEMA,
      maxOutputTokens: 65536,
    },
  });

  // 使えないモデルなら、エラー文の推奨モデル → 候補の順にやり直す
  const tried = new Set();
  const queue = [...MODEL_CANDIDATES];
  let data = null;
  let res = null;
  while (queue.length > 0) {
    const model = queue.shift();
    if (tried.has(model)) continue;
    tried.add(model);
    res = await fetch(`${API}/v1beta/models/${model}:generateContent?key=${key()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    data = await res.json().catch(() => ({}));
    if (res.ok) break;
    const msg = data.error?.message || String(res.status);
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('Gemini の API キーが無効です。Vercel の GEMINI_API_KEY を確認してください');
    if (res.status === 429) throw new Error('Gemini の利用上限に達しました。しばらくしてからもう一度お試しください');
    const unavailable = res.status === 404 || /no longer available|not found|not supported|deprecated/i.test(msg);
    if (!unavailable) throw new Error(`文字起こしに失敗しました: ${msg}`);
    const suggested = msg.match(/models\/([A-Za-z0-9._-]+)/g)?.map((m) => m.replace('models/', '')).find((m) => !tried.has(m));
    if (suggested) queue.unshift(suggested);
    console.warn(`[gemini] ${model} は使えません（${msg.slice(0, 120)}）。次の候補を試します`);
  }
  if (!res || !res.ok) {
    throw new Error(`文字起こしに失敗しました: 使えるモデルがありません（${data?.error?.message || ''}）。Vercel の環境変数 GEMINI_MODEL に使えるモデル名を設定してください`);
  }
  const cand = data.candidates?.[0];
  const finish = cand?.finishReason || '';
  const text = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
  const segments = parseTranscriptJson(text);
  if (segments && segments.length > 0 && finish !== 'MAX_TOKENS') return segments;
  // 中身が無いときは、理由が分かるように返答の要点をログに残す
  const why = describeEmpty(data, finish, text);
  console.warn(`[gemini] 文字起こしが空か読めません: ${why}`);

  // JSON が壊れている（長い録音で出力が途中で切れた、余計な文が混ざった等）。
  // JSON より短く済む行形式でもう一度お願いして、そちらを使う。
  const plain = await transcribePlain(audioPart, prompt, key(), model_used(res));
  if (plain.rows.length > 0) return plain.rows;
  if (segments && segments.length > 0) return segments; // 途中まででも残す
  const err = new Error(`文字起こしの結果を読み取れませんでした（1回目: ${why} / 2回目: ${plain.why}）`);
  err.code = 'TRANSCRIPT_EMPTY';
  throw err;
}

/** 空の返答の理由を短く言葉にする（安全性ブロック・候補なし・空文字など） */
function describeEmpty(data, finish, text) {
  const block = data?.promptFeedback?.blockReason;
  if (block) return `安全性の判定でブロック: ${block}`;
  if (!Array.isArray(data?.candidates) || data.candidates.length === 0) return `候補なし（${JSON.stringify(data || {}).slice(0, 160)}）`;
  if (finish && finish !== 'STOP') return `finishReason=${finish}`;
  if (!text.trim()) return `返答が空（finishReason=${finish || '-'}, 出力トークン ${data?.usageMetadata?.candidatesTokenCount ?? '-'}）`;
  return `JSON として読めない（先頭: ${text.slice(0, 80).replace(/\s+/g, ' ')}）`;
}

function model_used(res) {
  const m = String(res?.url || '').match(/models\/([A-Za-z0-9._-]+):/);
  return m ? m[1] : GEMINI_MODEL;
}

/** JSON を読む。途中で切れていたら、最後の完全な発話までを拾う */
export function parseTranscriptJson(text) {
  const clean = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const toRows = (parsed) => (parsed?.segments || [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, speaker: String(s.speaker || '話者'), text: s.text.trim() }));
  try { return toRows(JSON.parse(clean)); } catch { /* 続きで修復を試す */ }
  const i = clean.indexOf('[');
  const j = clean.lastIndexOf('}');
  if (i < 0 || j < 0) return null;
  try { return toRows({ segments: JSON.parse(clean.slice(i, j + 1) + ']') }); } catch { return null; }
}

/** 行形式（[開始秒-終了秒] 話者: 内容）で文字起こしする。JSON より崩れにくい */
async function transcribePlain(audioPart, basePrompt, apiKey, model) {
  const prompt = basePrompt +
    '\n\n出力は JSON ではなく、1 発話につき 1 行で、次の形だけで書いてください（前置きや説明は不要）:\n[開始秒-終了秒] 話者: 発話内容\n例: [12.5-18.0] 話者A: 来月の納品は10日でお願いします';
  const res = await fetch(`${API}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [audioPart, { text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 65536 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`文字起こしに失敗しました: ${data.error?.message || res.status}`);
  const finish = data.candidates?.[0]?.finishReason || '';
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*\[?\s*(\d+(?:\.\d+)?)\s*[-–〜~]\s*(\d+(?:\.\d+)?)\s*\]?\s*([^:：]{1,20})[:：]\s*(.+)$/);
    if (m) rows.push({ start: Number(m[1]), end: Number(m[2]), speaker: m[3].trim(), text: m[4].trim() });
  }
  if (finish === 'MAX_TOKENS' && rows.length > 0) {
    rows.push({ start: rows[rows.length - 1].end, end: rows[rows.length - 1].end, speaker: 'システム', text: '（この断片の後半は長すぎて文字起こしを取得できませんでした）' });
  }
  const why = rows.length > 0 ? 'ok' : describeEmpty(data, finish, text);
  if (rows.length === 0) console.warn(`[gemini] 行形式でも空: ${why}`);
  return { rows, why };
}
