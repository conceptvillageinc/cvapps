import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Claude API 呼び出しの共通部分
// ============================================================================

export const MODEL = 'claude-opus-5';

let client;
export function claude() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY が未設定です。Vercel の Environment Variables に ' +
        '（VITE_ を付けずに）追加してください。'
      );
    }
    client = new Anthropic();
  }
  return client;
}

/**
 * 画面側が渡してくる JSON Schema を、構造化出力が受け付ける形に整える。
 *
 * 構造化出力は全オブジェクトに additionalProperties: false と required を要求するが、
 * 画面側のスキーマはどちらも書いていない。ここで機械的に補う。
 * 「読み取れなければ空文字や0でよい」という指示はプロンプト側に入っているので、
 * 全項目を required にしても抽出結果は落ちない。
 */
export function normalizeSchema(schema) {
  if (Array.isArray(schema)) return schema.map(normalizeSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out = { ...schema };

  if (out.properties && typeof out.properties === 'object') {
    const props = {};
    for (const [name, sub] of Object.entries(out.properties)) {
      props[name] = normalizeSchema(sub);
    }
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
    out.type = out.type || 'object';
  }

  if (out.items) out.items = normalizeSchema(out.items);
  if (out.anyOf) out.anyOf = normalizeSchema(out.anyOf);
  if (out.allOf) out.allOf = normalizeSchema(out.allOf);

  return out;
}

/** レスポンスから本文テキストを取り出す。 */
export function textOf(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/** 添付ファイルを Claude が読めるコンテンツブロックに変換する。 */
export function fileBlock({ bytes, contentType }) {
  const data = Buffer.from(bytes).toString('base64');

  if (contentType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    };
  }

  if (contentType?.startsWith('image/')) {
    // Claude が受け付ける画像形式に寄せる
    const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const mediaType = supported.includes(contentType) ? contentType : 'image/png';
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data },
    };
  }

  throw new Error(`対応していないファイル形式です: ${contentType || '不明'}（PDFまたは画像を選んでください）`);
}
