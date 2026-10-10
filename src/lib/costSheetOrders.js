// ============================================================================
// 社内見積（原価計算表）の「最終納品チェック」（T 列の ✓）が付いた行・黄色で塗った行（入稿したしるし）のうち、
//   印刷の行を入稿記録にする。過去に入稿したものに ✓ や黄色を付けていたため、取り込み済みの社内見積から入稿記録を作り直す。
//   同じタブの同じ小見出し（例: ユニフォーム（ポロシャツ）ブラック）の ✓ の行は 1 件にまとめ、
//   サイズなどの行と送料・袋入れは内訳（items）に残す。数量は本体の行だけを足す。
//   入稿記録の estimate_line_id に「costsheet:社内見積の id:g先頭の行番号」を入れて、同じ行を二重に作らない
//   （まとめる前に 1 行ずつ作った記録は「costsheet:社内見積の id:行番号」）。
//   画面（システム設定の取り込み）とサーバー（api/cost-sheet-import.js の取り込み時）の両方で使うので、
//   @ の別名を使わない（Node からも読めるように）。
// ============================================================================

export const COST_LINE_PREFIX = "costsheet:";
export const COST_SHEET_ORDER_AUTHOR = "社内見積の取り込み";

/** 入稿記録の estimate_line_id に入れる、社内見積の行（まとめたときは g + 先頭の行番号）の目印 */
export const costLineKey = (sheetId, row) => `${COST_LINE_PREFIX}${sheetId}:${row}`;

/** 目印から { sheetId, row, grouped } を読む（社内見積から作った入稿記録でなければ null） */
export function parseCostLineKey(key) {
  const m = /^costsheet:([^:]+):(g?)(\d+)$/.exec(String(key || ""));
  return m ? { sheetId: m[1], row: Number(m[3]), grouped: m[2] === "g" } : null;
}

/** 入稿記録が社内見積のどの行から作られたか（行番号の一覧。社内見積から作ったものでなければ空） */
export function costRowsOfOrder(o) {
  const k = parseCostLineKey(o?.estimate_line_id);
  if (!k) return { sheetId: null, rows: [] };
  const rows = Array.isArray(o.items) && o.items.length ? o.items.map((it) => Number(it.row)).filter(Number.isFinite) : [k.row];
  return { sheetId: k.sheetId, rows };
}

const PRINT_RE = /印刷|プリント|出力|製本|加工|ラベル|シール|のぼり|パネル|看板|パッケージ|封筒|名刺|ポスター|チラシ|リーフレット|パンフ/;
// 送料・袋入れなど、本体と一緒に入れるが数量には足さない行
const EXTRA_RE = /送料|配送|運賃|梱包|発送|袋入れ|袋詰|封入|手数料|代引/;

/** 送料・袋入れなどの付帯の行か */
export const isExtraCostLine = (l) => EXTRA_RE.test(String(l?.name || ""));

/**
 * 入稿した行か: 最終納品チェック（✓）があるか、行が黄色で塗られている（入稿したしるし）。
 *   失注のタブの黄色は、提案した行の印のことがあるので入れない。
 */
export const isOrderedCostLine = (cs, l) => !!l && (!!l.final || (!!l.yellow && cs?.status !== "lost"));

/** 入稿記録の本体にする行か: 入稿した行（✓ か黄色）で、印刷の区分（または入稿先 URL のある行）。割引・送料などは除く */
export function isPrintCostLine(l) {
  if (!l || !(l.final || l.yellow)) return false;
  const text = `${l.group || ""} ${l.section || ""} ${l.name || ""}`;
  if (/割引/.test(text)) return false;
  if (isExtraCostLine(l)) return false;
  if (/デザイン|設計|ディレクション|撮影|コピーライト/.test(`${l.group || ""} ${l.section || ""}`) && !l.url) return false;
  return PRINT_RE.test(text) || !!l.url;
}

const round2 = (n) => Math.round(n * 100) / 100;
const lineAmount = (l) => Math.round(Number(l.adjusted || 0) || Number(l.sell_total || 0));
const groupName = (g) => String(g || "").replace(/^【(.+?)】\s*/, "$1 ").trim();
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const oneLine = (t) => String(t || "").replace(/\s+/g, " ").trim();
// テンプレートの区分の札（B 列の縦書き「パッケージ」「その他制作物」など）。品名には使わない
const isGenericSection = (t) => /^(パッケ[ーｰ|｜I1l－-]?ジ|その他(の)?制作物|その他|制作物|印刷物|印刷費|パッケージ以外(の制作物)?)$/.test(String(t || "").replace(/\s+/g, ""));

/**
 * 社内見積 1 枚の ✓ の行を、入稿記録 1 件ずつのまとまりに分ける。
 *   同じ大見出し・小見出しの行を 1 つに。本体の行が無い小見出し（送料だけなど）は、同じ大見出しの直前のまとまりに足す。
 * @param {object} cs
 * @param {Set<number>} [skipRows]  すでに入稿記録にした行（入れない）
 * @returns {Array<{ group, section, main: object[], extra: object[] }>}
 */
export function costLineGroups(cs, skipRows = new Set()) {
  const buckets = [];
  const byKey = new Map();
  for (const l of cs.lines || []) {
    if (!isOrderedCostLine(cs, l) || skipRows.has(l.row)) continue;
    const isMain = isPrintCostLine(l);
    const isExtra = !isMain && isExtraCostLine(l);
    if (!isMain && !isExtra) continue;
    const k = `${l.group || ""}\u0000${l.section || ""}`;
    if (!byKey.has(k)) { const b = { group: l.group || "", section: l.section || "", main: [], extra: [] }; byKey.set(k, b); buckets.push(b); }
    byKey.get(k)[isMain ? "main" : "extra"].push(l);
  }
  const out = [];
  for (const b of buckets) {
    if (b.main.length > 0) { out.push(b); continue; }
    // 送料だけの小見出し → 同じ大見出しの直前のまとまり（無ければこのタブの直前のまとまり）に足す
    const host = [...out].reverse().find((o) => o.group === b.group) || out[out.length - 1];
    if (host) host.extra.push(...b.extra);
  }
  for (const o of out) o.extra.sort((a, b) => a.row - b.row);
  return out;
}

/**
 * まとまり 1 つから、入稿記録の行を作る。
 *   入稿日は、タブ名の日付（提出・入稿の日）→ 行の記入日 → 最終記入日 → 取り込んだ日 の順で使う（目安）。
 */
export function orderFromCostGroup(cs, g) {
  const all = [...g.main, ...g.extra].sort((a, b) => a.row - b.row);
  // 「〃」は上の行と同じ品名
  let prevName = "";
  const items = all.map((l) => {
    const name = !l.name || l.name === "〃" ? prevName || oneLine(g.section) || groupName(g.group) : oneLine(l.name);
    prevName = name;
    const qty = Number(l.qty) || null;
    const amount = lineAmount(l);
    const costTotal = Number(l.cost_total) || 0;
    return {
      row: l.row,
      name,
      quantity: qty,
      unit: String(l.unit || "").replace(/／.*$/, ""),
      unit_price: amount && qty ? round2(amount / qty) : null,
      amount: amount || 0,
      cost_price: costTotal ? round2(costTotal / (qty || 1)) : (Number(l.cost_unit) || null),
      vendor: l.vendor || "",
      source_url: l.url || "",
      extra: g.extra.includes(l),
    };
  });
  const mains = items.filter((it) => !it.extra);
  const units = uniq(mains.map((it) => it.unit));
  const qty = units.length <= 1 ? mains.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : 0;
  const amount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const cost = items.reduce((s, it) => s + (Number(it.cost_price) || 0) * (Number(it.quantity) || 1), 0);
  // 品名: 小見出し（例: ユニフォーム（ポロシャツ）ブラック）。小見出しがテンプレートの区分の札だけなら、本体の先頭の品名（複数なら「ほか」）
  const section = isGenericSection(g.section) ? "" : oneLine(g.section);
  const mainNames = uniq(mains.map((it) => oneLine(it.name)));
  let name;
  if (section) {
    // 本体が 1 行だけで、品名が小見出しと違えば「小見出し／品名」
    name = mainNames.length === 1 && mainNames[0] !== section && !section.includes(mainNames[0]) ? `${section}／${mainNames[0]}` : section;
  } else {
    name = mainNames.length > 1 ? `${mainNames[0]} ほか` : mainNames[0] || oneLine(groupName(g.group));
  }
  const first = all[0];
  const rows = new Set(all.map((l) => l.row));
  const shot = (cs.images || []).find((im) => rows.has(im.near_row))?.path || null;
  const day = (v) => (v ? String(v).slice(0, 10) : "");
  const orderedOn = day(cs.sheet_date) || day(first.entered_on) || day(cs.last_entry_date) || day(cs.imported_at) || new Date().toISOString().slice(0, 10);
  const groupText = `${String(g.group || "").replace(/パッケージ以外/g, "")} ${section} ${name}`;
  const single = items.length === 1;
  return {
    estimate_id: null,
    estimate_number: "",
    estimate_line_id: costLineKey(cs.id, `g${first.row}`),
    project_id: null,
    client_id: cs.client_id || null,
    client_name: cs.client_name || "",
    ordered_on: orderedOn,
    name,
    // 「パッケージ以外の制作物」の区分は紙のもの
    category: /パッケージ|ラベル|のぼり|パネル|シール|看板/.test(groupText) ? "印刷費（紙以外）" : "印刷費（紙）",
    quantity: qty || (single ? 1 : null),
    unit: qty ? (units[0] || "式") : "式",
    unit_price: single ? items[0].unit_price : null, // まとめたものは内訳ごとに単価がある
    amount: amount || null,
    cost_price: single ? items[0].cost_price : (cost && qty ? round2(cost / qty) : null),
    vendor: uniq(mains.map((it) => it.vendor)).join("・"),
    source_url: mains.find((it) => it.source_url)?.source_url || "",
    screenshot_path: shot,
    memo: [`社内見積「${[cs.period, cs.title].filter(Boolean).join(" ")}」の${all.some((l) => l.final) ? (all.some((l) => !l.final && l.yellow) ? "最終納品チェック・黄色の行" : "最終納品チェック") : "黄色で塗った行"}から（入稿日は目安）`, ...uniq(all.map((l) => l.memo))].join("\n"),
    items,
    created_by: null,
    created_by_name: COST_SHEET_ORDER_AUTHOR,
  };
}

const editedAfterCreate = (o) => !!(o.updated_at && o.created_at && new Date(o.updated_at) - new Date(o.created_at) > 5000);
const rowsSig = (o) => `${o.estimate_line_id}|${costRowsOfOrder(o).rows.slice().sort((a, b) => a - b).join(",")}|${Math.round(Number(o.amount) || 0)}`;

const dupKey = (o) => [o.client_id || o.client_name || "", String(o.ordered_on || "").slice(0, 10), String(o.name || "").replace(/\s+/g, ""), Math.round(Number(o.amount) || 0)].join("|");

/**
 * 社内見積の一覧から、まだ無い入稿記録を作る分を返す。
 *   別のタブ（同じ内容の ✓ 付きタブが 2 枚ある場合など）から、同じクライアント・入稿日・品名・金額のものは 1 件だけにする。
 * @param {object[]} sheets    cost_sheets の行
 * @param {object[]} existing  すでにある入稿記録（estimate_line_id・items・client・ordered_on・name・amount があればよい）
 */
export function ordersFromCostSheets(sheets, existing = []) {
  const covered = new Map(); // sheetId → Set<row>
  const seen = new Set();
  for (const o of existing || []) {
    const { sheetId, rows } = costRowsOfOrder(o);
    if (sheetId) { if (!covered.has(sheetId)) covered.set(sheetId, new Set()); rows.forEach((r) => covered.get(sheetId).add(r)); }
    seen.add(dupKey(o));
  }
  const out = [];
  for (const cs of sheets || []) {
    for (const g of costLineGroups(cs, covered.get(String(cs.id)) || new Set())) {
      const o = orderFromCostGroup(cs, g);
      const k = dupKey(o);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(o);
    }
  }
  return out;
}

/**
 * 社内見積から作る入稿記録の作り直しの計画。
 *   社内見積の取り込みで自動で作った記録（編集していないもの）は、今の ✓・黄色でまとめ直す。
 *   中身が変わらないものはそのまま、変わったものは消して作り直す。手で登録した記録・あとで編集した記録は残し、その行はまとめに入れない。
 * @param {object[]} sheets  対象の社内見積
 * @param {object[]} orders  入稿記録（対象の社内見積の分と、同じクライアントの分。created_at・updated_at も使う）
 * @returns {{ create: object[], remove: object[], unchanged: number, kept: number }}
 */
export function planCostSheetOrders(sheets, orders) {
  const ids = new Set((sheets || []).map((cs) => String(cs.id)));
  const auto = (orders || []).filter((o) => o.created_by_name === COST_SHEET_ORDER_AUTHOR && ids.has(costRowsOfOrder(o).sheetId || ""));
  const redo = auto.filter((o) => !editedAfterCreate(o));
  const redoIds = new Set(redo.map((o) => o.id));
  const fresh = ordersFromCostSheets(sheets, (orders || []).filter((o) => !redoIds.has(o.id)));
  const bySig = new Map(redo.map((o) => [rowsSig(o), o]));
  const create = [];
  const same = new Set();
  for (const o of fresh) {
    const hit = bySig.get(rowsSig(o));
    if (hit && !same.has(hit.id)) same.add(hit.id);
    else create.push(o);
  }
  return { create, remove: redo.filter((o) => !same.has(o.id)), unchanged: same.size, kept: auto.length - redo.length };
}
