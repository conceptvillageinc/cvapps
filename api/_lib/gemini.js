// ============================================================================
// Gemini API（文字起こし用）
//
// API キーは Vercel の環境変数 GEMINI_API_KEY（Google AI Studio で発行）。
// 音声は 15MB までなら本文に直接（inline）、それより大きければ Files API に
// いったん置いてから使う。
// ============================================================================

const API = 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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

  const res = await fetch(`${API}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [audioPart, { text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: TRANSCRIPT_SCHEMA,
        maxOutputTokens: 65536,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || String(res.status);
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('Gemini の API キーが無効です。Vercel の GEMINI_API_KEY を確認してください');
    if (res.status === 429) throw new Error('Gemini の利用上限に達しました。しばらくしてからもう一度お試しください');
    throw new Error(`文字起こしに失敗しました: ${msg}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('文字起こしの結果を読み取れませんでした'); }
  return (parsed.segments || [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, speaker: String(s.speaker || '話者'), text: s.text.trim() }));
}
