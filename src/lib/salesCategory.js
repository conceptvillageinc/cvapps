// ============================================================================
// 売上カテゴリー（freee 販売の「会計計上部門」にあたるもの）
//   見積・納品書・請求書の明細 1 行ごとに付ける。手で選んだもの（sales_category）があればそれ、
//   無ければ区分（category）と品名から自動で振り分ける。
//   売上粗利管理表で、請求書の明細をカテゴリーごとに毎月・年間で集計する。
//   対象は 2026-10-01 以降の請求書（freee 販売から取り込んだ過去分は対象外）。
// ============================================================================

export const SALES_CATEGORIES = [
  { key: "coordinate", label: "コーディネート・プロデュース・コンサルティング", short: "コーディネート", color: "#6d5bd0" },
  { key: "design", label: "デザイン", short: "デザイン", color: "#2a78d6" },
  { key: "print", label: "印刷", short: "印刷", color: "#1baf7a" },
  { key: "shooting", label: "撮影", short: "撮影", color: "#eb6834" },
  { key: "build", label: "構築", short: "構築", color: "#0e9bb5" },
  { key: "writing", label: "ライティング・他", short: "ライティング・他", color: "#eda100" },
  { key: "cv_discount", label: "CV割引", short: "CV割引", color: "#d64545" },
];
export const SALES_CATEGORY_KEYS = SALES_CATEGORIES.map((c) => c.key);
export const salesCategoryDef = (key) => SALES_CATEGORIES.find((c) => c.key === key) || null;

/** 売上カテゴリーで集計を始める日（今期＝15期の期首） */
export const SALES_CATEGORY_FROM = "2026-10-01";

const has = (re, s) => re.test(s);

/**
 * 区分と品名から売上カテゴリーを推定する。見出し・小計の行は null。
 *   ① 割引 → CV割引
 *   ② 見積の区分（ディレクション費・デザイン費・印刷費・構築費・撮影費 など）
 *      ※ freee でも区分（品目）に合わせて付けていたため、区分があれば品名より優先する
 *        （例: デザイン費の「動画編集費」はデザイン）
 *   ③ 品名の語（ディレクション・撮影・ライティング・デザイン・構築・印刷の順に見る）
 *   ④ どれにも当たらなければ「ライティング・他」
 */
export function classifySalesCategory(li) {
  if (!li || li.row_type === "text" || li.row_type === "subtotal") return null;
  const cat = String(li.category || "");
  const name = `${li.name || ""} ${li.memo || ""}`;
  const all = `${cat} ${name}`;

  // ① 割引（自動計算の割引行・マイナスの行・割引／値引の語）
  if (li.rule === "discount" || cat === "割引" || has(/割引|値引|ディスカウント|DRAW\s*UP|Draw\s*up|ドローアップ/i, all) || Number(li.amount) < 0) return "cv_discount";

  // ② 見積の区分
  if (li.rule === "direction_fee" || li.rule === "concept_fee" || /ディレクション|コンセプト設計|プロデュース|コンサル|コーディネート/.test(cat)) return "coordinate";
  if (/デザイン費/.test(cat)) return "design";
  if (/印刷費/.test(cat)) return "print";
  if (/構築費/.test(cat)) return "build";
  if (/撮影|動画|映像/.test(cat)) return "shooting";
  if (/ライティング|原稿|取材/.test(cat)) return "writing";

  // ③ 品名の語
  if (has(/ディレクション|進行管理|プロデュース|コンサル|コーディネート|コンセプト|ブランディング|戦略|監修|マーケティング|ワークショップ|伴走/, name)) return "coordinate";
  if (has(/撮影|写真|動画|映像|カメラ|ドローン|ロケ|スタジオ|モデル|ムービー|空撮/, name)) return "shooting";
  if (has(/ライティング|原稿|執筆|取材|インタビュー|ナレーション|翻訳|記事|コピーライト|校閲|文字起こし/, name)) return "writing";
  if (has(/デザイン|イラスト|ロゴ|DTP|レイアウト|版下|作図|トレース|パッケージ|キャラクター/, name)) return "design";
  if (has(/構築|コーディング|システム|開発|サイト|ホームページ|HP|WEB|Web|web|LP|サーバ|ドメイン|CMS|WordPress|実装|保守|アプリ/, name)) return "build";
  if (has(/印刷|製本|加工|出力|刷り|プリント|ラベル|シール|封入|封筒|名刺|チラシ|パンフ|ポスター|リーフレット|送料|配送/, name)) return "print";

  // ④ その他
  return "writing";
}

/** 明細の売上カテゴリー（手で選んだもの → 自動）。見出し・小計の行は null */
export function salesCategoryOf(li) {
  if (!li || li.row_type === "text" || li.row_type === "subtotal") return null;
  return SALES_CATEGORY_KEYS.includes(li.sales_category) ? li.sales_category : classifySalesCategory(li);
}

/** 売上カテゴリーを集計に含める請求書か（今期以降・freee 取込分を除く・取消を除く） */
export function invoiceInSalesCategoryScope(inv) {
  return !!inv && inv.status !== "cancelled" && !inv.legacy_id && String(inv.invoice_date || "") >= SALES_CATEGORY_FROM;
}

/**
 * 請求書の明細を売上カテゴリー × 月で集計する（税別）。
 * @param {object[]} invoices
 * @param {{ key: string }[]} months  fiscalMonths の戻り値
 * @param {object[]} [estimates]  見積（カテゴリーを持たない請求書の明細を、写し元の見積の明細から振り分けるのに使う）
 * @returns {{ rows: { key, label, color, sales: number[], gross: number[], cost: number[], hasCost: boolean[] }[], totalSales: number[] }}
 */
export function salesByCategory(invoices, months, estimates = []) {
  // 見積の明細（id → 明細）。カテゴリーを引き継ぐ前に作った請求書の明細は、写し元の見積の明細で振り分ける
  const estLine = new Map();
  for (const e of estimates || []) for (const li of e.line_items || []) if (li?.id) estLine.set(li.id, li);
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const blank = () => Array(months.length).fill(0);
  const rows = SALES_CATEGORIES.map((c) => ({ ...c, sales: blank(), cost: blank(), gross: blank(), lines: blank() }));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const totalSales = blank();
  for (const inv of invoices || []) {
    if (!invoiceInSalesCategoryScope(inv)) continue;
    const i = idx.get(String(inv.invoice_date).slice(0, 7));
    if (i === undefined) continue;
    for (const li of inv.line_items || []) {
      const src = !SALES_CATEGORY_KEYS.includes(li.sales_category) && li.source_line_id ? estLine.get(li.source_line_id) : null;
      const key = src ? salesCategoryOf(src) : salesCategoryOf(li);
      if (!key) continue;
      const amount = Number(li.amount) || 0;
      const qty = Number(li.quantity) || 1;
      const cost = li.cost_price != null && li.cost_price !== "" ? Number(li.cost_price) * qty : 0;
      const r = byKey.get(key);
      r.sales[i] += amount; r.cost[i] += cost; r.gross[i] += amount - cost; r.lines[i] += 1;
      totalSales[i] += amount;
    }
  }
  return { rows, totalSales };
}
