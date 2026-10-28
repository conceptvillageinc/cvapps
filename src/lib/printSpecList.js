// ============================================================================
// 印刷仕様の一覧（価格調べ。print_spec_lists）の共通部分。見積の print_specs（printSpecs.js）とは別物（画面とサーバーの両方で使う）
//   1. 議事録から印刷物を書き出す（AI）… 品目・印刷物種別・サイズ・用紙・色数・加工・数量・単位・納期・備考・根拠
//   2. 過不足を直して確定 → 仕入（税抜）・URL を入れる
//   3. 社内見積（原価計算表）の形にする … 掛け率は印刷物種別で決まる（名前に「ラベル」「シール」→ 1.3、「パッケージ」→ 1.3、それ以外 1.35。値付けルール）
//      売価単価 = 仕入単価 × 掛け率 を 1 円単位で切り上げ（原価計算表の M 列と同じ）、売価計 = 売価単価 × 数量
// ============================================================================
import { markupKindOf } from "./markupKinds.js";

/** 仕様の列（一覧表の並び）。required は空なら「未確認」 */
export const SPEC_FIELDS = [
  { key: "name", label: "品目", minWidth: 220, required: true },
  { key: "size", label: "サイズ", minWidth: 150, required: true },
  { key: "paper", label: "用紙", minWidth: 120, required: true },
  { key: "colors", label: "色数", minWidth: 100, required: true },
  { key: "finishing", label: "加工", minWidth: 110 },
  { key: "quantity", label: "数量", minWidth: 76, required: true, numeric: true },
  { key: "unit", label: "単位", minWidth: 52 },
  { key: "due", label: "納期", minWidth: 120 },
  { key: "notes", label: "備考", minWidth: 170 },
];

const num = (v) => { const n = Number(String(v ?? "").replace(/[,，¥￥\s円]/g, "")); return Number.isFinite(n) ? n : 0; };
const str = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const newSpecId = () => `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** 空の行 */
export function blankSpec(patch = {}) {
  return { id: newSpecId(), name: "", print_type: "", size: "", paper: "", colors: "", finishing: "", quantity: "", unit: "枚", due: "", notes: "", basis: "", cost_total: "", price_url: "", price_note: "", screenshot_path: "", vendor: "グラフィック", ...patch };
}

/** 空になっている必須の項目 */
export function missingFields(it) {
  return SPEC_FIELDS.filter((f) => f.required && (f.numeric ? !(num(it[f.key]) > 0) : !str(it[f.key]))).map((f) => f.key);
}

/** 印刷物種別 → 掛け率（値付けルール。名前に「パッケージ」などが入れば package） */
export function markupForType(rules, printType) {
  return markupKindOf(rules, printType).rate;
}
/** 原価計算表のどの見出しの下に書くか（パッケージ・ラベルの見出しの下なら true） */
export const isPackageType = (printType, rules) => markupKindOf(rules, printType).kind !== "other";

/** 浮動小数点の誤差を除いて切り上げ（12000 × 1.35 が 16201 にならないように） */
// 単価は小数第一位まで（3.679 → 3.7）。金額は 1 円未満を四捨五入
const ceilClean = (v) => Math.ceil(Number((Number(v) * 10).toFixed(6))) / 10;

/**
 * 1 行の金額（社内見積の形）。
 *   仕入は合計（税抜）で入れ、単価 = 合計 ÷ 数量（小数 2 桁。原価計算表の H 列と同じ）。
 */
export function specAmounts(it, rules) {
  const qty = num(it.quantity);
  const costTotal = num(it.cost_total);
  const costUnit = qty > 0 && costTotal > 0 ? Math.round((costTotal / qty) * 100) / 100 : 0;
  const markup = markupForType(rules, it.print_type);
  const sellUnit = costUnit > 0 ? ceilClean(costUnit * markup) : 0;
  const sellTotal = Math.round(Number((sellUnit * qty).toFixed(6)));
  return { qty, costTotal, costUnit, costCalc: Math.round(costUnit * qty), markup, sellUnit, sellTotal, gross: sellTotal - Math.round(costUnit * qty) };
}

/** 備考（原価計算表の G 列）: 仕様をまとめた 1 行 ＋ 価格の条件 */
export function specMemo(it) {
  const spec = [it.size, it.paper, it.colors, it.finishing, it.due ? `納期 ${it.due}` : ""].map(str).filter(Boolean).join("／");
  return [spec, str(it.price_note), str(it.notes)].filter(Boolean).join("　");
}

export function specTotals(items, rules) {
  let cost = 0; let sell = 0;
  for (const it of items) { const a = specAmounts(it, rules); cost += a.costCalc; sell += a.sellTotal; }
  return { cost, sell, gross: sell - cost, margin: sell > 0 ? (sell - cost) / sell : null };
}

/** 原価計算表に書く行（サーバーへ渡す形） */
export function costSheetRows(items, rules, { author = "", date = "" } = {}) {
  return items.map((it) => {
    const a = specAmounts(it, rules);
    return {
      group: isPackageType(it.print_type) ? "package" : "other",
      date, author,
      name: str(it.name),
      memo: specMemo(it),
      cost_unit: a.costUnit || "",
      qty: a.qty || "",
      unit: str(it.unit) || "枚",
      markup: a.markup,
      vendor: str(it.vendor) || (it.price_url ? "グラフィック" : ""),
      url: str(it.price_url),
    };
  });
}

/** 新しい見積の明細にする */
export function specsToLineItems(items, rules, from = "印刷仕様の一覧") {
  const uid = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return items.map((it) => {
    const a = specAmounts(it, rules);
    const spec = [it.size, it.paper, it.colors, it.finishing].map(str).filter(Boolean).join("／");
    return {
      id: uid(),
      row_type: "item",
      category: "印刷費",
      print_type: it.print_type || "",
      name: spec ? `${str(it.name)}（${spec}）` : str(it.name),
      quantity: a.qty || 1,
      unit: str(it.unit) || "枚",
      unit_price: a.sellUnit,
      amount: a.sellTotal,
      tax_rate: 10,
      cost_price: a.costUnit || null,
      source_type: it.price_url ? "vendor_quote" : "manual",
      source_ref: it.price_url ? str(it.vendor) || "グラフィック" : "",
      source_url: str(it.price_url) || null,
      screenshot_path: it.screenshot_path || null,
      screenshot_paths: it.screenshot_path ? [it.screenshot_path] : [],
      notes: [missingFields(it).length ? "【要確認】" : "", str(it.price_note), str(it.notes)].filter(Boolean).join(" "),
      copied_from: from,
    };
  });
}

/** スプレッドシートに書き出す行（原価計算表と同じ並び） */
export function specSheetRows(list, rules, { author = "", date = "" } = {}) {
  const t = specTotals(list.items, rules);
  const rows = [
    [`印刷仕様の一覧　${list.title || ""}`],
    [`${list.client_name ? `${list.client_name}　` : ""}作成 ${date}${author ? `（${author}）` : ""}`],
    [],
    ["区分", "項目", "備考", "金額・単価（仕入）", "数量", "単位", "仕入計", "掛け率", "売価単価", "売価計", "粗利", "印刷物種別", "仕入先", "URL"],
  ];
  for (const it of list.items) {
    const a = specAmounts(it, rules);
    rows.push([isPackageType(it.print_type) ? "パッケージ（1.3掛）" : "パッケージ以外", str(it.name), specMemo(it), a.costUnit || "", a.qty || "", str(it.unit), a.costCalc || "", a.markup, a.sellUnit || "", a.sellTotal || "", a.gross || "", it.print_type || "", str(it.vendor), str(it.price_url)]);
  }
  rows.push([]);
  rows.push(["", "合計（税別）", "", "", "", "", t.cost, "", "", t.sell, t.gross]);
  return rows;
}

/** 記入者の名字（「寺山美奈」→「寺山」。空白があれば前の部分） */
export function familyName(fullName) {
  const s = str(fullName);
  if (!s) return "";
  if (/\s/.test(s)) return s.split(/\s+/)[0];
  return /^[一-鿿々]{3,}$/.test(s) ? s.slice(0, 2) : s.slice(0, 2);
}

/** 原価計算表の記入日時（261012 の形） */
export function entryDate(ymd) {
  const s = String(ymd || "").replace(/-/g, "");
  return /^\d{8}$/.test(s) ? Number(s.slice(2)) : "";
}

// ----------------------------------------------------------------------------
// 議事録から書き出す（AI）
// ----------------------------------------------------------------------------
export const SPEC_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "一覧の件名（例「天然とらふぐ贅沢セット 掛け紙・ラベル・リーフレット」）" },
    items: {
      type: "array",
      description: "見積に入れる印刷物。1 行 = 印刷物 1 つ（種類違い・サイズ違いは別の行）",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "品目（商品名＋印刷物。例「天然とらふぐ贅沢セット 掛け紙」）" },
          print_type: { type: "string", description: "印刷物種別（候補の一覧から 1 つ。合うものが無ければ空）" },
          size: { type: "string", description: "仕上がりサイズ（例「W350×H263mm」「A5 二つ折り」）。決まっていなければ空" },
          paper: { type: "string", description: "用紙（例「コート110kg」「ユポタック」）。決まっていなければ空" },
          colors: { type: "string", description: "色数（例「4/0色」「両面フルカラー」）。決まっていなければ空" },
          finishing: { type: "string", description: "加工（折り・PP・型抜き・のり付けなど）。無ければ空" },
          quantity: { type: "number", description: "数量。決まっていなければ 0" },
          quantities: { type: "array", items: { type: "number" }, description: "数量のパターンが複数話に出ていれば全部（例: 1000 と 3000 で見積を取る）。1 つなら空" },
          unit: { type: "string", description: "単位（枚・部・冊・個 など）" },
          due: { type: "string", description: "納期（例「10/13〜10/16 納品」）。決まっていなければ空" },
          notes: { type: "string", description: "補足（昨年と同じ仕様・未決の点など）。無ければ空" },
          basis: { type: "string", description: "根拠になった議事録・文字起こしの発言（短く引用）" },
        },
        required: ["name", "quantity"],
      },
    },
    notes: { type: "string", description: "一覧に入れなかったが確認が必要なこと（1 行 1 項目）。無ければ空" },
  },
  required: ["items"],
};

/** 議事録 → AI への依頼文 */
export function specExtractPrompt(meeting, printTypes = []) {
  const s = meeting?.summary || {};
  const lines = (arr) => (Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? x : x?.text || x?.title || JSON.stringify(x))).join("\n") : "");
  const checks = (meeting?.checkpoints || []).map((c) => `- ${c.label || c.key}: ${c.status || ""} ${c.note || c.quote || ""}`).join("\n");
  const transcript = (meeting?.transcript || []).map((t) => t.text).join("\n").slice(0, 60000);
  return `次の打ち合わせの議事録から、見積に入れる「印刷物」を 1 つずつ書き出して JSON で返してください。

【書き出し方】
- 1 行 = 印刷物 1 つです。同じ商品でも、種類・サイズが違えば別の行にします（例: てっさ用ラベルと鍋ちり用ラベル）。
- デザイン費・撮影費・ディレクション費など、印刷でないものは入れません。
- サイズ・用紙・色数・数量・納期は、議事録に出てきたものだけを入れます。決まっていないものは空（数量は 0）にし、推測で埋めないでください。
- 印刷物種別は次の候補から 1 つ選びます: ${printTypes.join("、") || "（候補なし）"}。ラベル・シールのように商品パッケージに貼る印刷物は名前に「パッケージ」が入る種別にします。
- basis には、その行の根拠になった発言を短く引用します。

【打ち合わせ】${meeting?.title || ""}（${meeting?.held_at || ""}${meeting?.client_name ? `・${meeting.client_name}` : ""}）

【概要】
${s.overview || ""}

【打ち合わせメモ】
${s.notes || ""}

【決定事項】
${lines(s.decisions)}

【保留・次回までの確認事項】
${lines(s.open_items)}

【確認事項（仕様）】
${checks}

【文字起こし（抜粋）】
${transcript}`;
}

/** AI の結果 → 一覧の行 */
export function specsFromResult(res, printTypes = []) {
  const list = Array.isArray(res?.items) ? res.items : [];
  return list.filter((v) => str(v?.name)).map((v) => blankSpec({
    name: str(v.name),
    print_type: printTypes.includes(str(v.print_type)) ? str(v.print_type) : "",
    size: str(v.size), paper: str(v.paper), colors: str(v.colors), finishing: str(v.finishing),
    quantity: num(v.quantity) > 0 ? num(v.quantity) : "",
    quantities: (() => { const qs = [...new Set([num(v.quantity), ...(Array.isArray(v.quantities) ? v.quantities.map(num) : [])].filter((n) => n > 0))]; return qs.length > 1 ? qs : []; })(),
    unit: str(v.unit) || "枚",
    due: str(v.due), notes: str(v.notes), basis: str(v.basis),
  }));
}

// ----------------------------------------------------------------------------
// 価格のスクリーンショットから仕入を読む（AI）
// ----------------------------------------------------------------------------
export const PRICE_SHOT_SCHEMA = {
  type: "object",
  properties: {
    total_ex_tax: { type: "number", description: "指定の数量の価格（税抜・円・加工・オプション代金を含む・送料別）。読めなければ 0" },
    total_inc_tax: { type: "number", description: "同じ価格の税込（円）。無ければ 0" },
    condition: { type: "string", description: "その価格の条件（商品名・サイズ・用紙・色数・数量・納期（営業日））を短く" },
    note: { type: "string", description: "指定の数量が表に無い、税込しか無いなど確かめてほしいこと。無ければ空" },
  },
};
export function priceShotPrompt(it) {
  return `添付はネット印刷の価格ページのスクリーンショットです。次の印刷物の価格を読み取ってください。
品目: ${it.name}
仕様: ${[it.size, it.paper, it.colors, it.finishing].filter(Boolean).join("／")}
数量: ${it.quantity || "（未定）"}${it.unit || ""}
納期: ${it.due || "（未定）"}
- 指定の数量の価格を読みます。表に複数の納期があれば、納期に間に合う中で一番安いものを選びます。
- 税抜で返します（税込しか無ければ ÷1.1 して円未満を切り捨て、note にその旨を書きます）。
- 「印刷代金」とは別に「加工・オプション代金」（PP加工・袋入れ・セット作業など）があり「小計」が書かれている場合は、オプションを含めた小計を価格にします（送料・決済手数料は含めない）。condition に「印刷代金〇円＋加工・オプション〇円」と内訳を書きます。`;
}

// ---------------------------------------------------------------------------
// 印刷枚数の複数パターン（同じ仕様で 1,000 枚・3,000 枚・5,000 枚 のように見積を取る）
//   item.quantities = [1000, 3000, 5000]（先頭が item.quantity）
//   仕入はパターンごとに item.prices["3000"] = { cost_total, price_url, ... } に持つ
//   ②仕入・③社内見積・出力では、パターンを 1 行ずつに広げて扱う（expandPatterns）
// ---------------------------------------------------------------------------
export const PRICE_KEYS = ["cost_total", "price_url", "price_note", "screenshot_path", "needs_check", "checked_at", "vendor", "lookup_log"];
const pick = (it, keys) => Object.fromEntries(keys.filter((k) => it[k] !== undefined).map((k) => [k, it[k]]));

/** 印刷枚数のパターン（重なりなし・0 より大きいものだけ。並びは入れた順） */
export function quantitiesOf(it) {
  const qs = Array.isArray(it?.quantities) && it.quantities.length ? it.quantities : [it?.quantity];
  return [...new Set(qs.map(num).filter((n) => n > 0))];
}

/** パターンを 1 行ずつに広げる（パターンが 1 つなら、そのまま） */
export function expandPatterns(items) {
  return (items || []).flatMap((it) => {
    const qs = quantitiesOf(it);
    if (qs.length <= 1) return [it];
    return qs.map((q, i) => {
      const price = it.prices?.[String(q)] ?? (q === num(it.quantity) ? pick(it, PRICE_KEYS) : {});
      return {
        ...it, cost_total: "", price_url: "", price_note: "", screenshot_path: "", needs_check: false, checked_at: null, lookup_log: null,
        ...price,
        id: i === 0 ? it.id : `${it.id}::${q}`,
        parent_id: it.id,
        quantity: q,
        pattern: i + 1,
        patterns: qs.length,
        name: `${str(it.name)}（${q.toLocaleString()}${it.unit || ""}）`,
        base_name: it.name,
      };
    });
  });
}

/**
 * 広げた行の仕入を、元の印刷物に書き戻す（パターンが 1 つなら、その印刷物の値をそのまま直す）
 * @returns {object[]} 新しい items
 */
export function applyPricePatch(items, row, patch) {
  if (!row?.parent_id) return items.map((it) => (it.id === row?.id ? { ...it, ...patch } : it));
  return items.map((it) => {
    if (it.id !== row.parent_id) return it;
    const key = String(row.quantity);
    const cur = it.prices?.[key] ?? (row.quantity === num(it.quantity) ? pick(it, PRICE_KEYS) : {});
    return { ...it, prices: { ...(it.prices || {}), [key]: { ...cur, ...patch } } };
  });
}
