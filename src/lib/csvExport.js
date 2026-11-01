// ============================================================================
// 一覧の CSV 出力（案件・見積・納品書・請求書・クライアント）
//
//   ・いま画面に出ている行（期・絞り込み・検索・並び順そのまま）を書き出す
//   ・UTF-8（BOM 付き）。Excel で開いても文字化けしない
//   ・金額は「¥」「,」を付けない数字。日付は YYYY-MM-DD
//   ・ブラウザの中で作ってダウンロードするだけ（どこにも送らない）
//
// 列は { label, value: (row) => 値 } の配列で決める。
// 見積・納品書・請求書は「1行＝1書類」と「1行＝1明細」の 2 種類を出す（docLineRows / lineColumns）。
// ============================================================================
import { db } from "@/api/db";
import { downloadText } from "@/lib/mfExport";
import { todayString } from "@/lib/fiscal";

/** 1 マス（カンマ・改行・" を含むときは " で囲む） */
export function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV の文字列（BOM 付き・改行は CRLF） */
export function buildCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** 「案件一覧_20261102.csv」のようなファイル名 */
export const csvFilename = (name) => `${name}_${todayString().replace(/-/g, "")}.csv`;

/** 書き出してダウンロードする */
export function exportCsv(name, columns, rows) {
  downloadText(buildCsv(columns, rows), csvFilename(name));
}

// ---------------------------------------------------------------------------
// 値の形をそろえる
// ---------------------------------------------------------------------------
/** 金額（四捨五入した数字。空なら空） */
export const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "" : Math.round(Number(v)));
/** 単価・数量（小数をそのまま。空なら空） */
export const dec = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "" : Number(v));
/** 日付（YYYY-MM-DD。日時なら日付だけ） */
export const day = (v) => (v ? String(v).slice(0, 10) : "");
/** 複数行の文字を 1 行に（Excel で行が崩れないように） */
export const oneLine = (v) => (v ? String(v).replace(/\r?\n/g, " ").trim() : "");
/** はい／いいえ */
export const mark = (b) => (b ? "○" : "");

// ---------------------------------------------------------------------------
// 明細（1行＝1明細）
// ---------------------------------------------------------------------------
/** 書類の明細を 1 行ずつに（見出し・小計の行は除く）。{ doc, li, no } の配列 */
export function docLineRows(docs) {
  return (docs || []).flatMap((doc) =>
    (doc.line_items || [])
      .filter((li) => li && li.row_type !== "text" && li.row_type !== "subtotal")
      .map((li, i) => ({ doc, li, no: i + 1 })));
}

/** 明細の列（書類の列の頭 headColumns に、明細の列を足す） */
export function lineColumns(headColumns, { cost = false, extra = [] } = {}) {
  return [
    ...headColumns.map((c) => ({ label: c.label, value: (r) => c.value(r.doc) })),
    { label: "行", value: (r) => r.no },
    { label: "区分", value: (r) => r.li.category || "" },
    { label: "品名", value: (r) => oneLine(r.li.name) },
    { label: "数量", value: (r) => dec(r.li.quantity) },
    { label: "単位", value: (r) => r.li.unit || "" },
    { label: "単価", value: (r) => dec(r.li.unit_price) },
    { label: "金額", value: (r) => num(r.li.amount) },
    { label: "税率", value: (r) => (r.li.tax_rate === null || r.li.tax_rate === undefined || r.li.tax_rate === "" ? "" : `${r.li.tax_rate}%`) },
    ...(cost ? [
      { label: "原価単価", value: (r) => dec(r.li.cost_price) },
      { label: "原価", value: (r) => (r.li.cost_price === null || r.li.cost_price === undefined || r.li.cost_price === "" ? "" : num(Number(r.li.cost_price) * (Number(r.li.quantity) || 0))) },
    ] : []),
    { label: "売上カテゴリー", value: (r) => r.li.sales_category || "" },
    ...extra,
  ];
}

// ---------------------------------------------------------------------------
// ほかの表の番号（納品書の元の見積番号・請求書番号など）。書き出すときにだけ読む
// ---------------------------------------------------------------------------
/** id → 行（entity は db.entities のキー。ids は重なり・空を除いて 150 件ずつ読む） */
export async function rowsById(entity, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const out = {};
  for (let i = 0; i < list.length; i += 150) {
    const rows = await db.entities[entity].whereIn("id", list.slice(i, i + 150));
    for (const r of rows) out[r.id] = r;
  }
  return out;
}
