import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { claude, MODEL, normalizeSchema, textOf, fileBlock } from './_lib/claude.js';

// ============================================================================
// POST /api/llm
//
// Base44 の integrations.Core.InvokeLLM を置き換える。
// 呼び出し形は画面側のまま:
//   { prompt, file_urls?, response_json_schema? }
//
// file_urls には UploadFile が返した Storage 上のパスを渡す。
// ファイルの実体はここ（サーバー側）で service_role を使って読む。
// 署名付きURLをブラウザに出して回さないのは、URLが漏れた時点で
// 仕入先の見積書が誰でも読める状態になるため。
// ============================================================================

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // Claude のリクエスト上限に対する安全側の値

async function loadFile(admin, path) {
  if (typeof path !== 'string' || !path || path.includes('..')) {
    throw new Error('ファイルの指定が不正です');
  }

  const { data, error } = await admin.storage.from('uploads').download(path);
  if (error || !data) {
    throw new Error(`ファイルを読み込めませんでした: ${error?.message || path}`);
  }

  return {
    bytes: await data.arrayBuffer(),
    contentType: data.type,
  };
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;

  const user = await requireMember(req, res);
  if (!user) return;

  const { prompt, file_urls: filePaths = [], response_json_schema: schema } = req.body || {};

  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'prompt が空です' });
    return;
  }

  if (!Array.isArray(filePaths) || filePaths.length > MAX_FILES) {
    res.status(400).json({ error: `添付できるファイルは ${MAX_FILES} 件までです` });
    return;
  }

  try {
    const content = [];

    if (filePaths.length > 0) {
      const admin = adminClient();
      let total = 0;

      for (const path of filePaths) {
        const file = await loadFile(admin, path);
        total += file.bytes.byteLength;
        if (total > MAX_TOTAL_BYTES) {
          res.status(413).json({ error: 'ファイルの合計サイズが大きすぎます（20MBまで）' });
          return;
        }
        content.push(fileBlock(file));
      }
    }

    // 添付は本文より前に置く（本文だけを先に読ませない）
    content.push({ type: 'text', text: prompt });

    const request = {
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: 'user', content }],
    };

    if (schema) {
      request.output_config = {
        format: { type: 'json_schema', schema: normalizeSchema(schema) },
      };
    }

    const message = await claude().messages.create(request);

    if (message.stop_reason === 'refusal') {
      res.status(422).json({ error: 'この内容はAIが回答を控えました。文面を変えてお試しください' });
      return;
    }

    const text = textOf(message);

    if (!schema) {
      res.status(200).json({ text });
      return;
    }

    try {
      res.status(200).json(JSON.parse(text));
    } catch {
      res.status(502).json({ error: 'AIの回答を読み取れませんでした。もう一度お試しください' });
    }
  } catch (err) {
    // APIキーやURLなど内部情報が画面に出ないよう、ログはサーバーに残して要約だけ返す
    console.error('[api/llm]', err);
    res.status(500).json({ error: err.message || 'AI呼び出しに失敗しました' });
  }
}
