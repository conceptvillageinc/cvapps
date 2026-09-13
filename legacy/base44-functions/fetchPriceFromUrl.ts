import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 指定URLの印刷価格ページを実際に取得（fetch）し、その本文をAIに渡して
// 縦=枚数・横=納期の価格表（マス目）全体と、仕様（紙質・厚さ・面など）を抽出する。

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&yen;/g, "¥")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="126", "Not.A/Brand";v="24", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

async function fetchWithRetry(url, attempts = 2) {
  let lastStatus = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      if (res.ok) return { ok: true, res };
      lastStatus = res.status;
      // 502/503/520系（一時的なブロック・エラー）は少し待って再試行
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    } catch (e) {
      lastStatus = e.message;
    }
  }
  return { ok: false, status: lastStatus };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { url, spec_summary } = body;

    if (!url) {
      return Response.json({ error: 'urlが必要です' }, { status: 400 });
    }

    let pageText;
    try {
      const result = await fetchWithRetry(url, 2);
      if (!result.ok) {
        return Response.json({ error: `ページの取得に失敗しました（${result.status}）。先方のボット対策にブロックされている可能性があります。スクショでの更新をお試しください。` }, { status: 200 });
      }
      const html = await result.res.text();
      const fullText = stripHtml(html);

      // ナビゲーションメニューなどのノイズが前方に大量にあるページが多いため、
      // 価格表本体らしきマーカーを探してその付近から切り出す。
      // 見つからなければ先頭からのフォールバック。
      const markers = ["納期と部数を選択", "出荷予定日", "価格表", "部数", "納期タイプ", "枚数"];
      let startIdx = -1;
      for (const m of markers) {
        const idx = fullText.indexOf(m);
        if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
          startIdx = idx;
        }
      }
      const SLICE_LEN = 60000;
      if (startIdx !== -1) {
        const from = Math.max(0, startIdx - 500);
        pageText = fullText.slice(from, from + SLICE_LEN);
      } else {
        pageText = fullText.slice(0, SLICE_LEN);
      }
    } catch (fetchErr) {
      return Response.json({ error: `ページの取得に失敗しました: ${fetchErr.message}` }, { status: 200 });
    }

    if (!pageText || pageText.length < 20) {
      return Response.json({ error: 'ページから本文を取得できませんでした' }, { status: 200 });
    }

    const prompt = `以下は印刷会社の価格ページ（${url}）から取得した本文テキストです。

【価格表（マス目）の抽出】
このページには「枚数（部数）× 納期」の組み合わせで価格が並んだ表があります。この表は通常10行〜20行程度（10部、20部、30部…と枚数が増えていく行）あります（大きなページでは数十行に及ぶこともあります）。
重要: 最初の数行だけで止めず、ページ本文に登場する枚数パターンを最後の行まで漏れなくすべてprice_gridの行にしてください。商品名・ナビゲーションなどのテキストに惑わされず、数字＋単位（部・枚）の組み合わせを全て拾ってください。
各枚数について、記載されている全ての納期パターン（7日、5日、4日、3日、2日、1日、当日など、ページの表記のまま）とその価格をcellsに入れてください。
金額にカンマ区切り（例: 2,120）があっても、数値のみの普通の数字（2120）として返してください。「@」で始まる単価表記（1枚あたりの単価）は無視し、合計金額の方を使ってください。

【仕様の抽出】
現在の仕様の候補は「${spec_summary || "不明"}」です。ページ内に紙質・厚さ（連量）・印刷面（両面/片面）などの記載があれば、それらを結合して分かりやすい仕様の要約文字列にしてspec_summaryとして返してください（例:「両面印刷・上質紙・110kg」）。読み取れない場合は空文字で構いません。

---ページ本文---
${pageText}
---ここまで---`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          spec_summary: { type: "string" },
          price_grid: {
            type: "array",
            items: {
              type: "object",
              properties: {
                quantity: { type: "number" },
                cells: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      price: { type: "number" },
                    },
                  },
                },
              },
            },
          },
          notes: { type: "string" },
        },
      },
    });

    return Response.json(result);

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
