// ============================================================================
// 社内見積（原価計算表）の「最終納品チェック」（T 列の ✓）が付いた印刷の行を、入稿記録にする。
//   過去に入稿したものに ✓ を付けていたため、取り込み済みの社内見積から入稿記録を作り直す。
//   入稿記録の estimate_line_id に「costsheet:社内見積の id:行番号」を入れて、同じ行を二重に作らない。
//   画面（システム設定の取り込み）とサーバー（api/cost-sheet-import.js の取り込み時）の両方で使うので、
//   @ の別名を使わない（Node からも読めるように）。
// ============================================================================

export const COST_LINE_PREFIX = "costsheet:";

/** 入稿記録の estimate_line_id に入れる、社内見積の行の目印 */
export const costLineKey = (sheetId, row) => `${COST_LINE_PREFIX}${sheetId}:${row}`;

/** 目印から { sheetId, row } を読む（社内見積から作った入稿記録でなければ null） */
export function parseCostLineKey(key) {
  const m = /^costsheet:([^:]+):(\d+)$/.exec(String(key || ""));
  return m ? { sheetId: m[1], row: Number(m[2]) } : null;
}

const PRINT_RE = /印刷|プリント|出力|製本|加工|ラベル|シール|のぼり|パネル|看板|パッケージ|封筒|名刺|ポスター|チラシ|リーフレット|パンフ/;

/** 入稿記録にする行か: 最終納品チェックがあり、印刷の区分（または入稿先 URL のある行）。割引・送料は除く */
export function isPrintCostLine(l) {
  if (!l || !l.final) return false;
  const text = `${l.group || ""} ${l.section || ""} ${l.name || ""}`;
  if (/割引/.test(text)) return false;
  if (/送料|配送|運賃|梱包|発送/.test(l.name || "")) return false; // 印刷の区分にある送料などは入稿記録にしない
  if (/デザイン|設計|ディレクション|撮影|コピーライト/.test(`${l.group || ""} ${l.section || ""}`) && !l.url) return false;
  return PRINT_RE.test(text) || !!l.url;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 社内見積の 1 行から、入稿記録の行を作る。
 *   入稿日は、タブ名の日付（提出・入稿の日）→ 行の記入日 → 最終記入日 → 取り込んだ日 の順で使う（目安）。
 * @param {object} cs  cost_sheets の 1 行
 * @param {object} l   cs.lines の 1 行
 */
export function orderFromCostLine(cs, l) {
  const qty = Number(l.qty) > 0 ? Number(l.qty) : 1;
  const amount = Math.round(Number(l.adjusted || 0) || Number(l.sell_total || 0));
  const costTotal = Number(l.cost_total) || 0;
  const group = `${l.group || ""} ${l.section || ""}`;
  const name = l.name === "〃" || !l.name
    ? `${l.section || String(l.group || "").replace(/^【(.+?)】\s*/, "$1 ")}${l.qty ? ` ${Number(l.qty).toLocaleString()}${l.unit || ""}` : ""}`.trim()
    : l.name;
  const shot = (cs.images || []).find((im) => im.near_row === l.row)?.path || null;
  const day = (v) => (v ? String(v).slice(0, 10) : "");
  const orderedOn = day(cs.sheet_date) || day(l.entered_on) || day(cs.last_entry_date) || day(cs.imported_at) || new Date().toISOString().slice(0, 10);
  return {
    estimate_id: null,
    estimate_number: "",
    estimate_line_id: costLineKey(cs.id, l.row),
    project_id: null,
    client_id: cs.client_id || null,
    client_name: cs.client_name || "",
    ordered_on: orderedOn,
    name,
    // 「パッケージ以外の制作物」の区分は紙のもの
    category: /パッケージ|ラベル|のぼり|パネル|シール|看板/.test(`${group.replace(/パッケージ以外/g, "")} ${name}`) ? "印刷費（紙以外）" : "印刷費（紙）",
    quantity: qty,
    unit: (l.unit || "式").replace(/／.*$/, "") || "式",
    unit_price: amount ? round2(amount / qty) : null,
    amount: amount || null,
    cost_price: costTotal ? round2(costTotal / qty) : (Number(l.cost_unit) || null),
    vendor: l.vendor || "",
    source_url: l.url || "",
    screenshot_path: shot,
    memo: [`社内見積「${[cs.period, cs.title].filter(Boolean).join(" ")}」の最終納品チェックから（入稿日は目安）`, l.memo].filter(Boolean).join("\n"),
    created_by: null,
    created_by_name: "社内見積の取り込み",
  };
}

/**
 * 社内見積の一覧から、まだ無い入稿記録を作る分を返す。
 * @param {object[]} sheets       cost_sheets の行
 * @param {Set<string>} existing  すでにある入稿記録の estimate_line_id
 */
export function ordersFromCostSheets(sheets, existing = new Set()) {
  const out = [];
  for (const cs of sheets || []) {
    for (const l of cs.lines || []) {
      if (!isPrintCostLine(l)) continue;
      const key = costLineKey(cs.id, l.row);
      if (existing.has(key)) continue;
      out.push(orderFromCostLine(cs, l));
    }
  }
  return out;
}
