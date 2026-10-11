// ============================================================================
// 品目（作るもの）: ポスター・チラシ・のぼり … のまとまり。
//   新規見積作成の「作るもの」のチップと、「このクライアントで前に作ったもの」に使う。
//   品名にどの言葉が入っているかで品目に分ける（価格マスタ・入稿記録・過去見積の明細のどれも同じ分け方）。
//   一覧に無い言葉のチップは、言葉そのもので探す。
// ============================================================================
import { normSearch, matchesAll } from "@/lib/itemSearch";

/** 品目と、その品目とみなす言葉 */
export const PRINT_ITEMS = [
  { key: "ポスター", words: ["ポスター"] },
  { key: "チラシ", words: ["チラシ", "フライヤー"] },
  { key: "のぼり", words: ["のぼり", "幟"] },
  { key: "ラベル", words: ["ラベル"] },
  { key: "シール・ステッカー", words: ["シール", "ステッカー"] },
  { key: "名刺", words: ["名刺"] },
  { key: "ショップカード", words: ["ショップカード"] },
  { key: "パンフレット", words: ["パンフレット", "パンフ"] },
  { key: "リーフレット", words: ["リーフレット", "三つ折り", "二つ折り"] },
  { key: "冊子・カタログ", words: ["冊子", "カタログ", "ブック", "会社案内"] },
  { key: "POP", words: ["pop", "ポップ"] },
  { key: "パネル", words: ["パネル"] },
  { key: "看板・サイン", words: ["看板", "サイン", "横断幕", "懸垂幕", "垂れ幕"] },
  { key: "タペストリー", words: ["タペストリー"] },
  { key: "DM・はがき", words: ["dm", "ダイレクトメール", "はがき", "ハガキ", "葉書", "ポストカード"] },
  { key: "封筒", words: ["封筒"] },
  { key: "メニュー", words: ["メニュー"] },
  { key: "掛け紙・包装紙", words: ["掛け紙", "掛紙", "包装紙", "のし"] },
  { key: "パッケージ・箱", words: ["パッケージ", "化粧箱", "箱", "bag", "袋"] },
  { key: "ユニフォーム・ウェア", words: ["ユニフォーム", "tシャツ", "ポロシャツ", "ウェア", "エプロン"] },
  { key: "うちわ", words: ["うちわ"] },
  { key: "カレンダー", words: ["カレンダー"] },
];

const c = (s) => normSearch(s).replace(/\s+/g, "");
const isExtraName = (name) => /送料|配送|運賃|梱包|発送|袋入れ|袋詰|封入|手数料|割引/.test(String(name || ""));

/** 文に入っている品目（いくつか当たることもある） */
export function itemKeysOf(text) {
  const t = c(text);
  if (!t) return [];
  return PRINT_ITEMS.filter((it) => it.words.some((w) => t.includes(c(w)))).map((it) => it.key);
}

/** チップ（品目、または打った言葉）に当たるか */
export function matchesItem(chip, text) {
  const def = PRINT_ITEMS.find((it) => it.key === chip);
  if (def) return def.words.some((w) => c(text).includes(c(w)));
  return matchesAll(chip, text);
}

const sameClient = (a, b) => !!a && !!b && c(a) === c(b);
const ymd = (s) => String(s || "").slice(0, 10);
const usableLine = (li) => li && li.row_type !== "text" && li.row_type !== "subtotal" && li.source_type !== "rule" && String(li.name || "").trim() && !isExtraName(li.name);

/**
 * このクライアントで前に作ったもの（入稿記録と過去見積の明細を品目ごとに数える）。
 * @returns {Array<{ key, count, last }>} 回数の多い順
 */
export function clientItemHistory(clientName, { orders = [], estimates = [] } = {}) {
  if (!clientName) return [];
  const map = new Map();
  const add = (key, date, ref) => {
    const cur = map.get(key) || { key, count: 0, last: "", refs: new Set() };
    if (!cur.refs.has(ref)) { cur.refs.add(ref); cur.count += 1; }
    if (ymd(date) > cur.last) cur.last = ymd(date);
    map.set(key, cur);
  };
  for (const o of orders) {
    if (!sameClient(o.client_name, clientName)) continue;
    const names = Array.isArray(o.items) && o.items.length ? o.items.filter((it) => !it.extra).map((it) => it.name) : [o.name];
    for (const n of names) for (const k of itemKeysOf(n)) add(k, o.ordered_on, `o:${o.id}`);
  }
  for (const e of estimates) {
    if (!sameClient(e.client_name, clientName)) continue;
    for (const li of e.line_items || []) {
      if (!usableLine(li)) continue;
      for (const k of itemKeysOf(li.name)) add(k, e.estimate_date || e.created_date, `e:${e.id}`);
    }
  }
  return [...map.values()].map(({ key, count, last }) => ({ key, count, last })).sort((a, b) => (b.count - a.count) || b.last.localeCompare(a.last));
}

/**
 * チップ 1 つの候補（前回の入稿・価格マスタ・過去見積の明細）。このクライアントのものを先に。
 * @returns {Array<{ id, kind: "order"|"master"|"line", title, sub, date, client, sameClient, amount, quantity, unit, unit_price, cost_price, order?, itemIndex?, entry?, cell?, line?, estimate? }>}
 */
export function candidatesForItem(chip, clientName, { masters = [], orders = [], estimates = [] } = {}, { perKind = 3 } = {}) {
  // 前回の入稿（内訳のある記録は、当たる内訳の行ごと）
  const orderCands = [];
  for (const o of orders) {
    const items = Array.isArray(o.items) && o.items.length > 1 ? o.items : null;
    const rows = items ? items.map((it, i) => ({ it, i })).filter(({ it }) => !it.extra && matchesItem(chip, it.name)) : (matchesItem(chip, `${o.name}`) ? [{ it: o, i: 0 }] : []);
    for (const { it, i } of rows) {
      orderCands.push({
        id: `o:${o.id}:${i}`, kind: "order", order: o, itemIndex: items ? i : null,
        title: it.name, sub: o.vendor || "", date: ymd(o.ordered_on), client: o.client_name || "", sameClient: sameClient(o.client_name, clientName),
        quantity: it.quantity, unit: it.unit, amount: it.amount, unit_price: it.unit_price, cost_price: it.cost_price,
      });
    }
  }
  // 価格マスタ（見積に出すセルのうち、いちばん少ない数量・早い納期を代表に）
  const masterCands = masters
    .filter((m) => matchesItem(chip, `${m.category} ${m.spec_summary || ""}`))
    .map((m) => {
      const cells = (m.price_grid || []).flatMap((row) => (row.cells || []).filter((x) => x.selected && Number(x.price) > 0).map((x) => ({ quantity: row.quantity, label: x.label, price: x.price })));
      const cell = cells.sort((a, b) => (a.quantity - b.quantity))[0];
      return cell ? { id: `m:${m.id}`, kind: "master", entry: m, cell, cells, title: m.category, sub: [m.spec_summary, m.vendor_name].filter(Boolean).join("・"), date: ymd(m.last_updated), client: "", sameClient: false } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
  // 過去見積の明細（同じクライアント・品名・単価は新しい 1 件）
  const seen = new Set();
  const lineCands = [];
  for (const e of estimates) {
    for (const li of e.line_items || []) {
      if (!usableLine(li) || !(Number(li.amount) > 0) || !matchesItem(chip, li.name)) continue; // 金額 0 の行（入力途中）は出さない
      const k = `${c(e.client_name)}|${c(li.name)}|${Math.round(Number(li.unit_price) || 0)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      lineCands.push({
        id: `l:${e.id}:${li.id}`, kind: "line", line: li, estimate: e,
        title: li.name, sub: `${e.estimate_number || ""}${li.category ? `・${li.category}` : ""}`, date: ymd(e.estimate_date || e.created_date), client: e.client_name || "", sameClient: sameClient(e.client_name, clientName),
        quantity: li.quantity, unit: li.unit, unit_price: li.unit_price, amount: li.amount, cost_price: li.cost_price,
      });
    }
  }
  const byClientThenDate = (a, b) => (Number(b.sameClient) - Number(a.sameClient)) || b.date.localeCompare(a.date);
  return [
    ...orderCands.sort(byClientThenDate).slice(0, perKind),
    ...masterCands.slice(0, perKind),
    ...lineCands.sort(byClientThenDate).slice(0, perKind),
  ];
}
