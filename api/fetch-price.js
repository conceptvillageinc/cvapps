import { requireMember, requirePost } from './_lib/guard.js';
import { claude, MODEL, normalizeSchema, textOf } from './_lib/claude.js';

// ============================================================================
// POST /api/fetch-price
//
// 印刷会社の価格ページを取得し、枚数×納期の価格表をAIで抽出する。
// Base44 の fetchPriceFromUrl の移植。
// ============================================================================

const FETCH_TIMEOUT_MS = 20000;
const SLICE_LEN = 60000;

// ブラウザからの通常アクセスに見えるヘッダ。
// これが無いとボット対策で弾く印刷会社サイトが多い。
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const PRICE_GRID_SCHEMA = {
  type: 'object',
  properties: {
    spec_summary: { type: 'string' },
    price_grid: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quantity: { type: 'number' },
          cells: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                price: { type: 'number' },
              },
            },
          },
        },
      },
    },
    notes: { type: 'string' },
  },
};

/**
 * 取得先URLの検証。
 *
 * この関数はユーザーが入力したURLをサーバーが代わりに取得する作りなので、
 * 社内ネットワークやクラウドのメタデータサーバーを踏ませる余地を残さない。
 * 元の Base44 版には無かったが、サーバー側に置く以上は必要。
 */
function assertSafeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URLの形式が正しくありません');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http または https のURLを指定してください');
  }

  const host = url.hostname.toLowerCase();

  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) && isPrivateIPv4(host) ||
    host === '::1' ||
    host.startsWith('[');

  if (isPrivate) {
    throw new Error('社外の印刷会社サイトのURLを指定してください');
  }

  return url.toString();
}

function isPrivateIPv4(host) {
  const [a, b] = host.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // クラウドのメタデータサーバー
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&yen;/g, '¥')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function fetchWithRetry(url, attempts = 2) {
  let lastStatus = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, res };
      lastStatus = res.status;
      // 一時的なブロック・エラーは少し待って再試行
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      lastStatus = e.name === 'TimeoutError' ? 'タイムアウト' : e.message;
    }
  }

  return { ok: false, status: lastStatus };
}

/** ナビゲーションなどのノイズを避け、価格表本体らしき位置から切り出す。 */
function slicePriceSection(fullText) {
  const markers = ['納期と部数を選択', '出荷予定日', '価格表', '部数', '納期タイプ', '枚数'];

  let startIdx = -1;
  for (const m of markers) {
    const idx = fullText.indexOf(m);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) startIdx = idx;
  }

  if (startIdx === -1) return fullText.slice(0, SLICE_LEN);

  const from = Math.max(0, startIdx - 500);
  return fullText.slice(from, from + SLICE_LEN);
}

function buildPrompt(url, specSummary, pageText) {
  return `以下は印刷会社の価格ページ（${url}）から取得した本文テキストです。

【価格表（マス目）の抽出】
このページには「枚数（部数）× 納期」の組み合わせで価格が並んだ表があります。この表は通常10行〜20行程度（10部、20部、30部…と枚数が増えていく行）あります（大きなページでは数十行に及ぶこともあります）。
重要: 最初の数行だけで止めず、ページ本文に登場する枚数パターンを最後の行まで漏れなくすべてprice_gridの行にしてください。商品名・ナビゲーションなどのテキストに惑わされず、数字＋単位（部・枚）の組み合わせを全て拾ってください。
各枚数について、記載されている全ての納期パターン（7日、5日、4日、3日、2日、1日、当日など、ページの表記のまま）とその価格をcellsに入れてください。
金額にカンマ区切り（例: 2,120）があっても、数値のみの普通の数字（2120）として返してください。「@」で始まる単価表記（1枚あたりの単価）は無視し、合計金額の方を使ってください。

【仕様の抽出】
現在の仕様の候補は「${specSummary || '不明'}」です。ページ内に紙質・厚さ（連量）・印刷面（両面/片面）などの記載があれば、それらを結合して分かりやすい仕様の要約文字列にしてspec_summaryとして返してください（例:「両面印刷・上質紙・110kg」）。読み取れない場合は空文字で構いません。

---ページ本文---
${pageText}
---ここまで---`;
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;

  const user = await requireMember(req, res);
  if (!user) return;

  const { url: rawUrl, spec_summary: specSummary } = req.body || {};

  if (!rawUrl) {
    res.status(400).json({ error: 'URLが指定されていません' });
    return;
  }

  let url;
  try {
    url = assertSafeUrl(rawUrl);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  try {
    const fetched = await fetchWithRetry(url);
    if (!fetched.ok) {
      // 取得できないのは異常ではなく日常的に起きるので、200 で理由を返して
      // 画面側が「スクショで更新」へ誘導できるようにする
      res.status(200).json({
        error: `ページの取得に失敗しました（${fetched.status}）。先方のボット対策でブロックされている可能性があります。スクショでの更新をお試しください。`,
      });
      return;
    }

    const pageText = slicePriceSection(stripHtml(await fetched.res.text()));

    if (!pageText || pageText.length < 20) {
      res.status(200).json({ error: 'ページから本文を取得できませんでした' });
      return;
    }

    const message = await claude().messages.create({
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: 'user', content: buildPrompt(url, specSummary, pageText) }],
      output_config: {
        format: { type: 'json_schema', schema: normalizeSchema(PRICE_GRID_SCHEMA) },
      },
    });

    if (message.stop_reason === 'refusal') {
      res.status(200).json({ error: 'このページの内容はAIが回答を控えました' });
      return;
    }

    try {
      res.status(200).json(JSON.parse(textOf(message)));
    } catch {
      res.status(200).json({ error: '価格表を読み取れませんでした。スクショでの更新をお試しください。' });
    }
  } catch (err) {
    console.error('[api/fetch-price]', err);
    res.status(500).json({ error: err.message || '価格の取得に失敗しました' });
  }
}
