import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ネット印刷4社からの価格収集
// 各社の公開価格ページをフェッチして解析します

const VENDOR_CONFIGS = {
  "グラフィック": {
    url: "https://www.graphic.jp/",
    apiUrl: null,
  },
  "マツダプリント": {
    url: "https://www.suteki.co.jp/",
    apiUrl: null,
  },
  "ラクスル": {
    url: "https://raksul.com/",
    apiUrl: null,
  },
  "プリントパック": {
    url: "https://www.printpac.co.jp/",
    apiUrl: null,
  },
};

// LLMを使って各社の価格情報ページから価格を推定・収集
async function fetchVendorPrice(base44, vendorName, vendorUrl, printType, quantities, size, deliveryDate) {
  const quantityStr = Array.isArray(quantities) && quantities.length > 0
    ? quantities.map(q => `${q}枚`).join("・")
    : "1000枚";

  const prompt = `
あなたは日本の印刷会社の価格情報収集アシスタントです。
以下の印刷仕様で、${vendorName}（${vendorUrl}）に見積依頼した場合の概算価格を推定してください。

印刷仕様:
- 印刷物種別: ${printType}
- サイズ: ${size || "A4"}
- 印刷枚数: ${quantityStr}
- 希望納期: ${deliveryDate || "通常納期"}

${vendorName}は日本の実在するネット印刷会社です。
一般的な市場価格帯を参考に、現実的な価格を推定してください。

以下のJSON形式で回答してください：
{
  "vendor_name": "${vendorName}",
  "prices": [
    {"quantity": 数量(数値), "price": 税抜価格(数値), "delivery_days": 納期日数(数値)}
  ],
  "notes": "備考や特記事項",
  "estimated": true,
  "source_url": "${vendorUrl}"
}

quantitiesは ${quantityStr} に対応させてください。
priceは日本円の税抜き価格（整数）で返してください。
`;

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        vendor_name: { type: "string" },
        prices: {
          type: "array",
          items: {
            type: "object",
            properties: {
              quantity: { type: "number" },
              price: { type: "number" },
              delivery_days: { type: "number" }
            }
          }
        },
        notes: { type: "string" },
        estimated: { type: "boolean" },
        source_url: { type: "string" }
      }
    }
  });

  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { print_type, quantities, size, desired_delivery_date } = body;

    if (!print_type) {
      return Response.json({ error: '印刷物種別が必要です' }, { status: 400 });
    }

    // ネット印刷対応種別チェック
    const WEB_PRINT_TYPES = ["ラベル印刷", "チラシ印刷", "ポスター印刷", "のぼり旗印刷", "パネル印刷"];
    if (!WEB_PRINT_TYPES.includes(print_type)) {
      return Response.json({
        error: `${print_type}はネット印刷自動収集の対象外です。対象：${WEB_PRINT_TYPES.join("・")}`,
        results: [],
        failed: []
      }, { status: 400 });
    }

    const results = [];
    const failed = [];

    // 4社並行収集
    const vendorNames = Object.keys(VENDOR_CONFIGS);
    const promises = vendorNames.map(async (vendorName) => {
      const config = VENDOR_CONFIGS[vendorName];
      try {
        const data = await fetchVendorPrice(
          base44,
          vendorName,
          config.url,
          print_type,
          quantities,
          size,
          desired_delivery_date
        );

        // 最初の部数の価格を代表価格として返す
        const primaryPrice = data.prices && data.prices.length > 0 ? data.prices[0].price : 0;
        const deliveryDays = data.prices && data.prices.length > 0 ? data.prices[0].delivery_days : null;

        return {
          success: true,
          vendor_name: vendorName,
          price: primaryPrice,
          all_prices: data.prices || [],
          delivery_days: deliveryDays,
          notes: data.notes || "",
          estimated: true,
          source_url: config.url,
        };
      } catch (err) {
        return {
          success: false,
          vendor_name: vendorName,
          error: err.message,
        };
      }
    });

    const allResults = await Promise.all(promises);

    for (const r of allResults) {
      if (r.success) {
        results.push(r);
      } else {
        failed.push({ vendor_name: r.vendor_name, error: r.error });
      }
    }

    return Response.json({
      results,
      failed,
      collected_at: new Date().toISOString(),
      note: "価格はAIによる推定値です。実際の発注前に各社サイトで確認してください。"
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
