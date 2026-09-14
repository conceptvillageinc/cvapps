import { db } from "@/api/db";

// ============================================================================
// 仕入先の見積書・価格表（PDF／画像）の読み取り
//
// 旧形式の画面（VendorQuoteFileImporter）と新形式の画面（VendorQuoteImport）の
// 両方から使う。プロンプトとスキーマをここ1箇所に置き、読み取り精度の調整が
// 片方の画面にしか効かない状態を避ける。
// ============================================================================

// 日本の印刷会社の見積書は「商品名 × 印刷方式 × 数量」で単価・金額が枝分かれする
// 複雑な表形式が多いため、行単位（line_items）で抽出する。
export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    vendor_name: {
      type: "string",
      description: "この見積書・価格表を発行した会社名。レターヘッドのロゴ、社印、フッターの住所・電話番号の近くに記載されている社名を採用する。「◯◯様」「◯◯御中」と書かれている宛先（発注元＝コンセプト・ヴィレッジ等）は発行元ではないので除外する。",
    },
    delivery_date: {
      type: "string",
      description: "納期。日付がわかる場合はYYYY-MM-DD、日数のみの場合は「3営業日」等の文字列でよい。「別途お打合せ」等、記載がなければ空文字でよい。",
    },
    line_items: {
      type: "array",
      description: "見積書の明細行。商品名・印刷方式・数量ごとに単価や金額が分かれている場合は、それぞれを別の行として全て抽出する（結合しない）。",
      items: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "商品名・仕様（例:「たこ飯の素 オモテ 特色3色」のように、商品名と方式・面などを結合して分かりやすく）" },
          quantity: { type: "number", description: "数量（枚数など）。わかる場合のみ" },
          unit_price: { type: "number", description: "単価（1枚あたりなど）。わかる場合のみ" },
          amount: { type: "number", description: "その数量における合計金額・ケース単価。単価×数量が明示されていればそれを優先" },
        },
      },
    },
    notes: { type: "string", description: "送料・支払条件・見積有効期限など特記事項があれば簡潔に（50文字程度）" },
  },
};

export const EXTRACT_PROMPT = `添付した印刷会社・仕入先の見積書・価格表（PDFまたは画像）をよく読み取り、内容を正確にJSONで抽出してください。

【会社名の判別】
この書類を発行した側（レターヘッドのロゴ、社印、フッターの住所・電話番号の近くに記載されている社名）を vendor_name として採用してください。
「〜様」「〜御中」と書かれている宛先（発注元＝コンセプト・ヴィレッジ等）は発行元ではないので除外してください。

【明細行の抽出】
商品名・印刷方式（例：特色3色/デジタル印刷）・面（オモテ/ウラ）・数量ごとに単価や金額が分かれている場合は、結合せずそれぞれを別の行として全て抽出してください（表のセルが結合されて空白に見える場合は、直前の商品名・方式を引き継ぐこと）。
item_name には商品名と方式・面などを結合して分かりやすく記載してください（例：「たこ飯の素 オモテ 特色3色の場合」）。
金額にカンマ区切り（例: 27,900.00）があっても、数値のみの普通の数字（27900）として返してください。
「ケース単価」など合計金額に相当する列があれば amount に、単枚の単価は unit_price に入れてください。

【その他】
納期は日付が分かれば YYYY-MM-DD、「別途お打合せ」のように日付不明ならそのままの文字列で返してください。
送料・支払条件・見積有効期限など特記事項があれば notes に簡潔にまとめてください。
読み取れない項目は無理に埋めず空欄・0などにしてください。`;

/** ファイルを保管してAIに読み取らせる。返り値は EXTRACT_SCHEMA の形。 */
export async function extractVendorQuote(file) {
  const { file_url } = await db.integrations.Core.UploadFile({ file });
  const result = await db.integrations.Core.InvokeLLM({
    prompt: EXTRACT_PROMPT,
    file_urls: [file_url],
    response_json_schema: EXTRACT_SCHEMA,
  });
  return { result, fileUrl: file_url };
}

/** 抽出した1行から、仕入単価（＝原価）を求める。 */
export function costPerUnit(item) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unit_price) || 0;
  const amount = Number(item.amount) || 0;

  if (unitPrice > 0) return unitPrice;
  if (amount > 0 && quantity > 0) return amount / quantity;
  return amount;
}

/** 明細の表示名。抽出結果には会社名が入らないので、ここで付けて出所を残す。 */
export function lineName(item, vendorName) {
  const base = item.item_name?.trim() || "（商品名不明）";
  return vendorName ? `${base}（${vendorName}）` : base;
}
