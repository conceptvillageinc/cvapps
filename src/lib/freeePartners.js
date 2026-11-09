// ============================================================================
// freee の取引先一覧 CSV から、クライアント一覧の郵便番号・住所・メール（To・CC）を補う
//   freee 会計・freee 販売の取引先 CSV は書き出し方で列名が少し違うので、見出しの文字から列を当てる。
//   クライアント名（法人格・空白・全角半角の違いは無視）で突き合わせ、空の欄だけを埋める（入っている値は上書きしない）。
//   CSV はブラウザの中で読むだけで保存しない（口座などの列があっても読まない）。
//   メール: 見出しに「メール／mail」がある列から読む。見出しに CC があれば CC、それ以外は To の候補
//          （「請求」「送付」「To」の入った列を先に見る）。1 つの欄に複数あれば、2 つ目からは CC に回す（CC は最大 2 件）
// ============================================================================
import { normalizeClientName } from "@/components/clients/ClientCombobox";
import { normalizePostalCode, isValidPostalCode } from "@/lib/postalCode";
import { toHalfWidth } from "@/lib/halfWidth";

const SKIP = /送付|請求書|振込|口座|銀行|メール|担当|部署|敬称|電話|FAX|ファックス|備考|メモ|コード|ID/i;
const findCols = (header, re, extraSkip = null) => header
  .map((h, i) => ({ h: String(h || "").trim(), i }))
  .filter(({ h }) => re.test(h) && !SKIP.test(h) && !(extraSkip && extraSkip.test(h)))
  .map(({ i }) => i);

/** 欄の中のメールアドレス（全角は半角に。複数なら全部） */
export function emailsIn(v) {
  const t = toHalfWidth(String(v || "")).replace(/＠/g, "@");
  return [...new Set((t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((x) => x.toLowerCase()))];
}

/**
 * CSV（2 次元配列）から取引先を読む。
 * @returns {{ partners: Array<{ names: string[], kana: string, postal: string, address: string }>, error?: string }}
 */
export function readFreeePartners(rows) {
  if (!rows || rows.length < 2) return { partners: [], error: "CSV に行がありません" };
  // 見出しの行（「郵便番号」か「メール」がある行）を探す
  const hi = rows.slice(0, 5).findIndex((r) => r.some((c) => /郵便番号|メール/.test(String(c || ""))));
  if (hi < 0) return { partners: [], error: "「郵便番号」「メールアドレス」の列が見つかりません。freee の取引先一覧を CSV で書き出したファイルを選んでください" };
  const header = rows[hi].map((h) => String(h || "").trim());
  const nameCols = findCols(header, /^(名前|取引先名|正式名称|顧客名|会社名|名称|取引先|屋号)/, /カナ|かな/);
  const kanaCols = findCols(header, /カナ|ふりがな|フリガナ/);
  const postalCols = findCols(header, /郵便番号/);
  const addrCols = findCols(header, /都道府県|市区町村|番地|住所|建物|所在地/);
  if (nameCols.length === 0) return { partners: [], error: "取引先名の列が見つかりません（「名前（通称）」「正式名称」「取引先名」など）" };
  // メールの列（To の候補は「請求」「送付」「To」の入った列を先に）
  const mailCols = header.map((h, i) => ({ h, i })).filter(({ h }) => /メール|mail/i.test(h));
  const ccCols = mailCols.filter(({ h }) => /cc/i.test(h)).map(({ i }) => i);
  const toCols = mailCols.filter(({ h }) => !/cc|bcc/i.test(h))
    .sort((a, b) => Number(/請求|送付|to\b|（to）|\(to\)/i.test(b.h)) - Number(/請求|送付|to\b|（to）|\(to\)/i.test(a.h)))
    .map(({ i }) => i);
  const partners = [];
  for (const r of rows.slice(hi + 1)) {
    const names = nameCols.map((i) => String(r[i] || "").trim()).filter(Boolean);
    if (names.length === 0) continue;
    const postal = postalCols.map((i) => normalizePostalCode(r[i])).find((p) => isValidPostalCode(p)) || "";
    const parts = addrCols.map((i) => ({ h: header[i], v: String(r[i] || "").trim() })).filter((x) => x.v);
    // 都道府県・市区町村・番地はつなげ、建物名の前だけ空白を入れる
    const address = toHalfWidth(parts.map((x, k) => (k > 0 && /建物/.test(x.h) ? ` ${x.v}` : x.v)).join("").trim()); // 英数字は半角に
    const toList = toCols.flatMap((i) => emailsIn(r[i]));
    const ccList = [...toList.slice(1), ...ccCols.flatMap((i) => emailsIn(r[i]))];
    const email = toList[0] || ccList.shift() || "";
    const cc = [...new Set(ccList)].filter((x) => x !== email).slice(0, 2);
    partners.push({ names, kana: kanaCols.map((i) => String(r[i] || "").trim()).find(Boolean) || "", postal, address, email, cc });
  }
  return { partners };
}

/**
 * クライアントと取引先を突き合わせ、埋める内容を作る。
 * @returns {{ proposals: Array<{ client, partnerName, postal: string|null, address: string|null, email: string|null, cc: string[]|null }>, unmatched: number }}
 *   postal / address / email / cc は埋める値（埋めない欄は null）。メールも空の欄だけ（To が入っていれば To は変えない。CC は 1 件も無いときだけ）
 */
export function matchPartners(clients, partners) {
  const byName = new Map();
  for (const p of partners) {
    for (const n of [...p.names, p.kana]) {
      const k = normalizeClientName(n);
      if (k && !byName.has(k)) byName.set(k, p);
      // 同じ名前の取引先が複数あるときは、郵便番号・メールのある方を使う
      else if (k && ((!byName.get(k).postal && p.postal) || (!byName.get(k).email && p.email))) byName.set(k, { ...byName.get(k), ...Object.fromEntries(Object.entries(p).filter(([, v]) => (Array.isArray(v) ? v.length : v))) });
    }
  }
  const proposals = [];
  let unmatched = 0;
  for (const c of clients) {
    const needPostal = !isValidPostalCode(c.postal_code);
    const needAddress = !String(c.address || "").trim();
    const needEmail = !String(c.email || "").trim();
    const needCc = !(Array.isArray(c.cc_emails) && c.cc_emails.some((x) => String(x || "").trim()));
    if (!needPostal && !needAddress && !needEmail && !needCc) continue;
    const p = byName.get(normalizeClientName(c.name)) || (c.name_kana ? byName.get(normalizeClientName(c.name_kana)) : null);
    if (!p) { unmatched += 1; continue; }
    const postal = needPostal && p.postal ? p.postal : null;
    const address = needAddress && p.address ? p.address : null;
    const email = needEmail && p.email ? p.email : null;
    const cc = needCc && p.cc?.length ? p.cc.filter((x) => x !== (email || c.email)) : null;
    if (!postal && !address && !email && !cc?.length) continue;
    proposals.push({ client: c, partnerName: p.names[0], postal, address, email, cc: cc?.length ? cc : null });
  }
  return { proposals, unmatched };
}
