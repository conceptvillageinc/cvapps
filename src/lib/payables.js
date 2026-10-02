// 支払い先まとめ: スプレッドシートの読み取り・CSV 出力・集計
import { downloadText } from "@/lib/mfExport";

/** 支払元（振込金額の列） */
export const PAY_ENTITIES = [
  { key: "amount_coolagri", label: "Cool Agri", match: /cool\s*agri|クールアグリ/i },
  { key: "amount_cvdigital", label: "CV digital", match: /cv\s*digital|デジタル/i },
  { key: "amount_cv", label: "CV", match: /^cv\b|^cv\s*$|^CV\s*\n|cv\s*振込/i },
];

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[,¥￥円\s]/g, "");
  // 「=55000+446490」のような式（数字と + - * / ( ) . だけ）は計算する
  if (s.startsWith("=")) {
    const expr = s.slice(1);
    if (/^[\d+\-*/().]+$/.test(expr)) {
      try { const r = Function(`"use strict"; return (${expr});`)(); return Number.isFinite(r) ? r : 0; } catch { return 0; }
    }
    return 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
export const toAmount = num;

const PLACEHOLDER_BANK = /^(↓以下同様|・・・|…|同上|同じ|-|—)$/;
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * 2 次元配列（シートの値）から支払い行を取り出す。
 * 見出し行は「会社名」を含む行。列は見出しの文字で見分ける（Cool Agri／CV digital／CV／支払／会社名／振込先）。
 * 返り値: { rows: [{ payee_name, bank_info, amount_coolagri, amount_cvdigital, amount_cv, paid }], header, warnings }
 */
export function parsePayableSheet(values) {
  const grid = (values || []).map((r) => (Array.isArray(r) ? r : [r]));
  const hIdx = grid.findIndex((r) => r.some((c) => /会社名|支払先|支払い先/.test(String(c ?? ""))));
  if (hIdx < 0) return { rows: [], header: null, warnings: ["「会社名」の見出しが見つかりません"] };
  const header = grid[hIdx].map((c) => String(c ?? ""));
  const col = {};
  header.forEach((h, i) => {
    const t = h.replace(/\s+/g, " ");
    if (/会社名|支払先|支払い先/.test(t) && col.name === undefined) col.name = i;
    else if (/振込先|口座|銀行/.test(t) && col.bank === undefined) col.bank = i;
    else if (/支払.*(☑|✓|チェック|済)/.test(t) || /^支払/.test(t)) { if (col.paid === undefined) col.paid = i; }
    else if (/メモ|備考/.test(t) && col.memo === undefined) col.memo = i;
    else {
      for (const e of PAY_ENTITIES) {
        if (col[e.key] === undefined && e.match.test(t) && !(e.key === "amount_cv" && /digital|agri/i.test(t))) { col[e.key] = i; break; }
      }
    }
  });
  const warnings = [];
  if (col.name === undefined) warnings.push("「会社名」の列が見つかりません");
  const found = PAY_ENTITIES.filter((e) => col[e.key] !== undefined).map((e) => e.label);
  if (found.length === 0) warnings.push("振込金額の列（Cool Agri／CV digital／CV）が見つかりません");
  const rows = [];
  for (let r = hIdx + 1; r < grid.length; r++) {
    const line = grid[r];
    const name = clean(col.name !== undefined ? line[col.name] : "");
    if (!name) continue;
    if (/^(合計|小計|目標)/.test(name)) continue;
    const bankRaw = clean(col.bank !== undefined ? line[col.bank] : "");
    const paidRaw = col.paid !== undefined ? line[col.paid] : "";
    const row = {
      payee_name: name,
      bank_info: PLACEHOLDER_BANK.test(bankRaw) ? "" : bankRaw,
      paid: paidRaw === true || /^(true|1|✓|✔|☑|済|〇|○|x|×)$/i.test(String(paidRaw ?? "").trim()),
      memo: clean(col.memo !== undefined ? line[col.memo] : ""),
    };
    for (const e of PAY_ENTITIES) row[e.key] = col[e.key] !== undefined ? Math.round(num(line[col[e.key]])) : 0;
    rows.push(row);
  }
  return { rows, header: { ...col, labels: found }, warnings };
}

export const rowTotal = (r) => PAY_ENTITIES.reduce((s, e) => s + (Number(r[e.key]) || 0), 0);

export function sumPayables(rows) {
  const t = { count: rows.length, unpaid: rows.filter((r) => !r.paid && rowTotal(r) > 0).length, total: 0 };
  for (const e of PAY_ENTITIES) t[e.key] = 0;
  for (const r of rows) { for (const e of PAY_ENTITIES) t[e.key] += Number(r[e.key]) || 0; t.total += rowTotal(r); }
  t.total_ex_tax = Math.round(t.total / 1.1);
  return t;
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** 支払月 1 か月分の CSV（UTF-8 BOM 付き） */
export function payablesToCsv(rows, payMonth) {
  const head = ["支払月", "会社名", "振込先情報", ...PAY_ENTITIES.map((e) => `${e.label} 振込金額（税込）`), "合計（税込）", "支払済", "メモ"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([payMonth, r.payee_name, r.bank_info || "", ...PAY_ENTITIES.map((e) => Number(r[e.key]) || 0), rowTotal(r), r.paid ? "済" : "", r.memo || ""].map(csvCell).join(","));
  }
  const t = sumPayables(rows);
  lines.push(["", "合計", "", ...PAY_ENTITIES.map((e) => t[e.key]), t.total, "", `税抜 ${t.total_ex_tax}`].map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function downloadPayablesCsv(rows, payMonth) {
  downloadText(payablesToCsv(rows, payMonth), `支払い先まとめ_${payMonth}.csv`);
}

/** 今月（YYYY-MM） */
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const monthLabel = (ym) => (ym ? `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月末払` : "");

/** 貼り付けたテキスト（タブ／カンマ区切り）を 2 次元配列にする */
export function textToGrid(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  return lines.map((l) => {
    if (sep === "\t") return l.split("\t");
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}
