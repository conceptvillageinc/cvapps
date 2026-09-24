// ============================================================================
// スプレッドシート（Google スプレッドシート / Excel）から見積明細を読み取る。
//
// 入力は「シートからコピーして貼り付けたテキスト（タブ区切り）」または CSV。
// 列は見出し行から自動で判定する（項目/名称, 数量, 単位, 単価, 金額, 仕入合計/仕入単価, 備考, 大カテゴリ）。
// 見出し行が無い場合は 名称/数量/単位/単価/金額 の並びとみなす。
//
// 行の種類:
//   item     数量または単価がある行 → 明細
//   heading  名称だけの行（「デザイン費関連」「▼以下、下層ページ」など）→ テキスト行（見出し）
//   skip     小計・合計・消費税・空行
// ============================================================================

const HEADER_KEYS = {
  category: ["大カテゴリ", "カテゴリ", "区分", "分類"],
  name: ["項目", "名称", "内容", "品名", "摘要", "件名"],
  quantity: ["数量", "個数", "枚数"],
  unit: ["単位"],
  unit_price: ["単価", "単価（税別）", "単価(税別)", "単価\n（税別）"],
  amount: ["金額", "金額（税別）", "金額(税別)", "小計", "明細金額"],
  // 仕入は「合計」で書く（決定事項）。単価で書きたい場合は「仕入単価」「原価単価」
  cost_total: ["仕入合計", "仕入金額", "原価合計", "原価", "仕入", "仕入額", "仕入合計（税別）", "仕入金額（税別）"],
  cost: ["仕入単価", "原価単価", "仕入単価（税別）", "原価単価（税別）"],
  notes: ["備考", "メモ", "注記"],
  no: ["no", "no.", "番号", "#"],
};

const norm = (s) => String(s ?? "").replace(/\s+/g, "").replace(/[（(]税別[)）]/g, "").toLowerCase();

function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(norm);
    const hasName = cells.some((c) => HEADER_KEYS.name.map(norm).includes(c));
    const hasQty = cells.some((c) => HEADER_KEYS.quantity.map(norm).includes(c));
    const hasPrice = cells.some((c) => HEADER_KEYS.unit_price.map(norm).includes(c) || HEADER_KEYS.amount.map(norm).includes(c));
    if (hasName && (hasQty || hasPrice)) {
      const map = {};
      cells.forEach((c, col) => {
        for (const [key, names] of Object.entries(HEADER_KEYS)) {
          if (names.map(norm).includes(c) && map[key] === undefined) map[key] = col;
        }
      });
      // 「項目」の左に大カテゴリ列（見出し無し）がある形式（例: B列=カテゴリ, C列=項目）
      if (map.category === undefined && map.name > 0 && !Object.values(map).includes(map.name - 1)) {
        const left = map.name - 1;
        const leftHasText = rows.slice(i + 1, i + 40).some((r) => String(r[left] ?? "").trim() && !/^\d+(\.\d+)?$/.test(String(r[left]).trim()));
        if (leftHasText) map.category = left;
      }
      return { headerRow: i, map };
    }
  }
  return null;
}

const toNum = (v) => {
  const s = String(v ?? "").replace(/[,¥￥円\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const SKIP_RE = /^(小計|合計|総計|消費税|税込|税別|合計（税|合計\(税)/;
const HEADING_HINT_RE = /^[▼■◆●◎【]|以下、|関連$/;

// 名称のインデント（全角スペース・「・」）を数えて階層にする
function splitIndent(raw) {
  const s = String(raw ?? "");
  const m = s.match(/^([\s　]*)([・･]?)([\s\S]*)$/);
  const level = Math.min(3, Math.floor((m[1] || "").replace(/ /g, "").length) + (m[2] ? 1 : 0));
  return { level, name: (m[3] || "").trim() };
}

/**
 * テキスト（TSV または CSV）を2次元配列にする。
 * Google スプレッドシートからコピーすると、改行やタブを含むセルは "..." で囲まれるので、
 * 引用符の中の改行・区切り文字は1つのセルとして扱う。
 */
export function parseTable(text) {
  const t = text.replace(/^\uFEFF/, "");
  const delim = t.includes("\t") ? "\t" : ",";
  const rows = []; let row = []; let field = ""; let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === "") inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// カテゴリ名から明細の大カテゴリを推定する
export function guessCategory(text) {
  const s = String(text ?? "");
  if (/デザイン/.test(s)) return "デザイン費";
  if (/システム|開発|要件定義|API|DB|データベース/.test(s)) return "システム構築費";
  if (/構築|コーディング|CMS|実装|フロントエンド|移行/.test(s)) return "web構築費";
  if (/印刷/.test(s)) return /パッケージ|ラベル|のぼり|パネル/.test(s) ? "印刷費（紙以外）" : "印刷費（紙）";
  return "自由入力";
}

/**
 * @returns {{ rows: Array<{kind:'item'|'heading'|'skip', level, category, name, quantity, unit, unit_price, amount, cost_price, notes, raw}>, header: object|null, warnings: string[] }}
 */
export function parseSheetItems(text) {
  const table = parseTable(text).map((r) => r.map((c) => (c ?? "").toString()));
  const warnings = [];
  const detected = detectHeader(table);
  let map; let start;
  if (detected) { map = detected.map; start = detected.headerRow + 1; }
  else {
    // 見出し無し: 名称, 数量, 単位, 単価, 金額 の順とみなす
    map = { name: 0, quantity: 1, unit: 2, unit_price: 3, amount: 4 };
    start = 0;
    warnings.push("見出し行が見つからなかったため、列を「名称・数量・単位・単価・金額」の順とみなしました");
  }

  const rows = [];
  let currentCategory = "";
  for (let i = start; i < table.length; i++) {
    const r = table[i];
    const get = (k) => (map[k] !== undefined ? r[map[k]] : "");
    const catCell = String(get("category") ?? "").trim();
    const rawName = String(get("name") ?? "");
    const nameOnly = rawName.trim();
    const qty = toNum(get("quantity"));
    const price = toNum(get("unit_price"));
    const amount = toNum(get("amount"));
    const costUnit = toNum(get("cost"));
    const costTotal = toNum(get("cost_total"));
    const unit = String(get("unit") ?? "").trim();
    const notes = String(get("notes") ?? "").trim();

    // カテゴリ列に値があれば、その行から下のカテゴリになる
    if (catCell && !/^\d+(\.\d+)?$/.test(catCell)) currentCategory = catCell.replace(/\s+/g, " ");

    // 名称が無く、カテゴリ列だけの行（例: 「1.0 | 企画・設計業務」）は見出し
    const label = nameOnly || (catCell && !/^\d+(\.\d+)?$/.test(catCell) ? catCell : "");
    if (!label && qty === null && price === null && amount === null) continue;
    if (SKIP_RE.test(nameOnly) || SKIP_RE.test(String(get("unit_price") ?? "").trim()) || (!nameOnly && amount !== null && qty === null && price === null)) {
      rows.push({ kind: "skip", name: nameOnly || "小計/合計", raw: r });
      continue;
    }
    const { level, name } = splitIndent(rawName);
    const isItem = qty !== null || price !== null || amount !== null;
    if (!isItem) {
      // 見出し（「▼以下、下層ページ」は説明行なのでスキップ）
      if (/^[▼■]?以下/.test(name) || /▼以下/.test(name)) { rows.push({ kind: "skip", name, raw: r }); continue; }
      if (!catCell) currentCategory = currentCategory || name;
      rows.push({ kind: "heading", level, name: label, category: guessCategory(label), raw: r });
      // 見出し自体がカテゴリ名なら以降の明細のカテゴリにする
      if (!catCell) currentCategory = label;
      continue;
    }
    const q = qty ?? 1;
    const up = price ?? (amount !== null && q ? Math.round(amount / q) : 0);
    const amt = amount ?? Math.round(q * up);
    // 原価は単価で持つ（仕入合計 ÷ 数量）
    const cost = costUnit ?? (costTotal !== null && q ? Math.round((costTotal / q) * 100) / 100 : null);
    const pctMatch = (nameOnly || label).match(/(\d+(?:\.\d+)?)\s*[%％]/);
    rows.push({
      kind: "item", level,
      category: guessCategory(currentCategory || label),
      group: currentCategory,
      name: name || label,
      quantity: q, unit: unit || "式", unit_price: up, amount: amt,
      cost_price: cost, notes,
      percent: pctMatch ? Number(pctMatch[1]) : null,
      raw: r,
    });
  }
  const items = rows.filter((r) => r.kind === "item");
  if (items.length === 0) warnings.push("明細として読み取れる行がありませんでした（数量または単価のある行が対象です）");
  return { rows, header: map, warnings };
}

/** テンプレートCSV（UTF-8 BOM付き） */
export function templateCsv() {
  const lines = [
    ["大カテゴリ", "名称", "数量", "単位", "単価（税別）", "仕入合計（税別）", "備考"],
    ["デザイン費", "トップページデザイン", "1", "ページ", "150000", "60000", "外注A社"],
    ["デザイン費", "下層ページデザイン（ベース）", "1", "ページ", "80000", "", ""],
    ["web構築費", "トップページ構築", "1", "ページ", "200000", "120000", "外注B社"],
    ["web構築費", "下層ページ構築（各ページ展開）", "20", "ページ", "5000", "60000", "20ページ分の仕入合計"],
    ["自由入力", "運用保守", "4", "ヶ月", "30000", "", "アクセス解析レポート含む"],
  ];
  return "﻿" + lines.map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
}
