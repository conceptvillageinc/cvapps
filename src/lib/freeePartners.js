// ============================================================================
// freee の取引先一覧 CSV から、クライアント一覧の郵便番号・住所を補う
//   freee 会計・freee 販売の取引先 CSV は書き出し方で列名が少し違うので、見出しの文字から列を当てる。
//   クライアント名（法人格・空白・全角半角の違いは無視）で突き合わせ、空の欄だけを埋める（入っている値は上書きしない）。
//   CSV はブラウザの中で読むだけで保存しない（口座などの列があっても読まない）。
// ============================================================================
import { normalizeClientName } from "@/components/clients/ClientCombobox";
import { normalizePostalCode, isValidPostalCode } from "@/lib/postalCode";
import { toHalfWidth } from "@/lib/halfWidth";

const SKIP = /送付|請求書|振込|口座|銀行|メール|担当|部署|敬称|電話|FAX|ファックス|備考|メモ|コード|ID/i;
const findCols = (header, re, extraSkip = null) => header
  .map((h, i) => ({ h: String(h || "").trim(), i }))
  .filter(({ h }) => re.test(h) && !SKIP.test(h) && !(extraSkip && extraSkip.test(h)))
  .map(({ i }) => i);

/**
 * CSV（2 次元配列）から取引先を読む。
 * @returns {{ partners: Array<{ names: string[], kana: string, postal: string, address: string }>, error?: string }}
 */
export function readFreeePartners(rows) {
  if (!rows || rows.length < 2) return { partners: [], error: "CSV に行がありません" };
  // 見出しの行（「郵便番号」がある行）を探す
  const hi = rows.slice(0, 5).findIndex((r) => r.some((c) => /郵便番号/.test(String(c || ""))));
  if (hi < 0) return { partners: [], error: "「郵便番号」の列が見つかりません。freee の取引先一覧を CSV で書き出したファイルを選んでください" };
  const header = rows[hi].map((h) => String(h || "").trim());
  const nameCols = findCols(header, /^(名前|取引先名|正式名称|顧客名|会社名|名称|取引先|屋号)/, /カナ|かな/);
  const kanaCols = findCols(header, /カナ|ふりがな|フリガナ/);
  const postalCols = findCols(header, /郵便番号/);
  const addrCols = findCols(header, /都道府県|市区町村|番地|住所|建物|所在地/);
  if (nameCols.length === 0) return { partners: [], error: "取引先名の列が見つかりません（「名前（通称）」「正式名称」「取引先名」など）" };
  const partners = [];
  for (const r of rows.slice(hi + 1)) {
    const names = nameCols.map((i) => String(r[i] || "").trim()).filter(Boolean);
    if (names.length === 0) continue;
    const postal = postalCols.map((i) => normalizePostalCode(r[i])).find((p) => isValidPostalCode(p)) || "";
    const parts = addrCols.map((i) => ({ h: header[i], v: String(r[i] || "").trim() })).filter((x) => x.v);
    // 都道府県・市区町村・番地はつなげ、建物名の前だけ空白を入れる
    const address = toHalfWidth(parts.map((x, k) => (k > 0 && /建物/.test(x.h) ? ` ${x.v}` : x.v)).join("").trim()); // 英数字は半角に
    partners.push({ names, kana: kanaCols.map((i) => String(r[i] || "").trim()).find(Boolean) || "", postal, address });
  }
  return { partners };
}

/**
 * クライアントと取引先を突き合わせ、埋める内容を作る。
 * @returns {{ proposals: Array<{ client, partnerName, postal: string|null, address: string|null }>, unmatched: number }}
 *   postal / address は埋める値（埋めない欄は null）
 */
export function matchPartners(clients, partners) {
  const byName = new Map();
  for (const p of partners) {
    for (const n of [...p.names, p.kana]) {
      const k = normalizeClientName(n);
      if (k && !byName.has(k)) byName.set(k, p);
      // 同じ名前の取引先が複数あるときは、郵便番号のある方を使う
      else if (k && !byName.get(k).postal && p.postal) byName.set(k, p);
    }
  }
  const proposals = [];
  let unmatched = 0;
  for (const c of clients) {
    const needPostal = !isValidPostalCode(c.postal_code);
    const needAddress = !String(c.address || "").trim();
    if (!needPostal && !needAddress) continue;
    const p = byName.get(normalizeClientName(c.name)) || (c.name_kana ? byName.get(normalizeClientName(c.name_kana)) : null);
    if (!p) { unmatched += 1; continue; }
    const postal = needPostal && p.postal ? p.postal : null;
    const address = needAddress && p.address ? p.address : null;
    if (!postal && !address) continue;
    proposals.push({ client: c, partnerName: p.names[0], postal, address });
  }
  return { proposals, unmatched };
}
