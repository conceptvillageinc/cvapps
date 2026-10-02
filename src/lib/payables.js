// 支払い先まとめ: スプレッドシートの読み取り・CSV 出力・集計
import { downloadText } from "@/lib/mfExport";

/** 支払元（振込金額の列） */
export const PAY_ENTITIES = [
  { key: "amount_cv", label: "CV", match: /^cv\b|^cv\s*$|^CV\s*\n|cv\s*振込/i },
  { key: "amount_cvdigital", label: "cv digital", match: /cv\s*digital|デジタル/i },
  { key: "amount_coolagri", label: "Cool Agri", match: /cool\s*agri|クールアグリ/i },
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
 * 見出し行は「会社名」を含む行。列は見出しの文字で見分ける（CV／cv digital／Cool Agri／支払／会社名／振込先）。
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
  if (found.length === 0) warnings.push("振込金額の列（CV／cv digital／Cool Agri）が見つかりません");
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
  const head = ["支払月", "会社名", "振込先情報", ...PAY_ENTITIES.map((e) => `${e.label} 振込金額（税込）`), "合計（税込）", "支払期限", "支払済", "メモ"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([payMonth, r.payee_name, r.bank_info || "", ...PAY_ENTITIES.map((e) => Number(r[e.key]) || 0), rowTotal(r), r.due_date || "", r.paid ? "済" : "", r.memo || ""].map(csvCell).join(","));
  }
  const t = sumPayables(rows);
  lines.push(["", "合計", "", ...PAY_ENTITIES.map((e) => t[e.key]), t.total, "", "", `税抜 ${t.total_ex_tax}`].map(csvCell).join(","));
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

// ----------------------------------------------------------------------------
// 請求書 PDF／画像の読み取り
//   月末に届いた請求書をまとめてスキャンし、1 ファイル（複数ページ可）ずつ AI に読ませる。
//   1 ファイルに複数の請求書が入っていてもよい（配列で返る）。
// ----------------------------------------------------------------------------

/** 宛先（請求書の「〜御中」）→ 支払元。読み取り結果の bill_to に入る値 */
export const BILL_TO = [
  { code: "cv", key: "amount_cv", label: "CV", names: "株式会社コンセプト・ヴィレッジ／コンセプトヴィレッジ／concept-village／Concept Village／CONCEPT VILLAGE／CV" },
  { code: "cvdigital", key: "amount_cvdigital", label: "cv digital", names: "cv digital／CV digital／CVデジタル／株式会社cv digital" },
  { code: "coolagri", key: "amount_coolagri", label: "Cool Agri", names: "Cool Agri／クールアグリ／株式会社Cool Agri／株式会社クールアグリ" },
];
export const billToKey = (code) => BILL_TO.find((b) => b.code === code)?.key || "";

export const INVOICE_SCHEMA = {
  type: "object",
  properties: {
    invoices: {
      type: "array",
      description: "添付に含まれる請求書すべて。1 通の請求書が複数ページでも 1 件にまとめる。見積書・納品書・領収書は含めない",
      items: {
        type: "object",
        properties: {
          payee_name: { type: "string", description: "請求書を発行した会社名（支払い先）。ロゴ・社印・振込先欄の近くにある社名。「〜御中」の宛先は含めない。法人格は書いてあるとおり" },
          bill_to: { type: "string", enum: ["coolagri", "cvdigital", "cv", "unknown"], description: "請求書の宛先（〜御中）がどの会社か。株式会社コンセプト・ヴィレッジ／concept-village→cv、cv digital／CVデジタル→cvdigital、Cool Agri／クールアグリ→coolagri、判別できなければ unknown" },
          bill_to_text: { type: "string", description: "宛先に書かれていた社名そのまま。無ければ空" },
          amount: { type: "number", description: "請求金額の合計（税込）。「ご請求金額」「合計」など税込の総額。読み取れなければ 0" },
          amount_ex_tax: { type: "number", description: "税抜金額。無ければ 0" },
          tax: { type: "number", description: "消費税額。無ければ 0" },
          invoice_date: { type: "string", description: "請求日（YYYY-MM-DD）。無ければ空" },
          due_date: { type: "string", description: "支払期限（YYYY-MM-DD）。無ければ空" },
          invoice_no: { type: "string", description: "請求書番号。無ければ空" },
          subject: { type: "string", description: "件名・内容の要約（20 文字程度。例「9月分 チラシ印刷代」）" },
          bank_info: { type: "string", description: "振込先（銀行名　支店名　種別　口座番号　口座名義）を 1 行で。無ければ空" },
          pages: { type: "string", description: "この請求書が載っているページ（例「1-2」）。画像なら空" },
        },
      },
    },
    notes: { type: "string", description: "請求書以外の書類が混ざっている、金額が読みにくいなど、確認してほしいことがあれば 1〜2 行。無ければ空" },
  },
};

export const INVOICE_PROMPT = `添付したファイル（スキャンした請求書の PDF または画像）に含まれる請求書を、1 通ずつ読み取って JSON で返してください。

【前提】
- 当社グループは 3 社あり、請求書の宛先（「〜御中」「〜様」）がどの会社宛かで支払元が決まります。
  ・cv: ${BILL_TO[0].names}
  ・cvdigital: ${BILL_TO[1].names}
  ・coolagri: ${BILL_TO[2].names}
  宛先は英語表記（concept-village のようにハイフン付きや小文字）や「御中」「様」付きでも同じ会社です。
  宛先が上のどれでもない・読めないときは unknown にしてください。
- 支払い先（payee_name）は請求書を発行した側です。当社グループ 3 社の名前を payee_name にしないでください。

【読み取り】
- 1 つのファイルに複数の請求書が入っていることがあります（1 通ごとに 1 件）。1 通が複数ページにわたるときは 1 件にまとめます。
- 金額はカンマや「¥」「円」を除いた数値で返します。amount は税込の請求合計です。
- 日付は YYYY-MM-DD。和暦（令和 8 年）は西暦に直します。
- 振込先は「銀行名　支店名　種別　口座番号　口座名義」の順で 1 行にします。
- 見積書・納品書・領収書・明細書だけのページは請求書ではないので含めず、notes に一言書いてください。
- 読み取れない項目は空文字や 0 にし、推測で埋めないでください。`;

/** 1 ファイルを保管して読み取る。返り値 { invoices: [...], notes, file_path } */
export async function extractInvoices(file, { db }) {
  const { file_url } = await db.integrations.Core.UploadFile({ file });
  const res = await db.integrations.Core.InvokeLLM({ prompt: INVOICE_PROMPT, file_urls: [file_url], response_json_schema: INVOICE_SCHEMA });
  const invoices = (Array.isArray(res?.invoices) ? res.invoices : []).map((v, i) => normalizeInvoice(v, file_url, file.name, i));
  return { invoices, notes: res?.notes || "", file_path: file_url };
}

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : "");

export function normalizeInvoice(v, file_path, file_name, index = 0) {
  const billTo = BILL_TO.some((b) => b.code === v?.bill_to) ? v.bill_to : "";
  return {
    id: `${file_path}#${index}`,
    file_path,
    file_name: file_name || "",
    payee_name: clean(v?.payee_name),
    bill_to: billTo,
    bill_to_text: clean(v?.bill_to_text),
    amount: Math.round(num(v?.amount)) || 0,
    amount_ex_tax: Math.round(num(v?.amount_ex_tax)) || 0,
    tax: Math.round(num(v?.tax)) || 0,
    invoice_date: isoDate(v?.invoice_date),
    due_date: isoDate(v?.due_date),
    invoice_no: clean(v?.invoice_no),
    subject: clean(v?.subject),
    bank_info: PLACEHOLDER_BANK.test(clean(v?.bank_info)) ? "" : clean(v?.bank_info),
    pages: clean(v?.pages),
    include: true,
  };
}

const fmtMd = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");

/** 請求書 1 件の内訳メモ（例「No.123 9/30 ¥55,000 チラシ印刷代」） */
export function invoiceLabel(inv) {
  const b = BILL_TO.find((x) => x.code === inv.bill_to);
  return [inv.invoice_no ? `No.${inv.invoice_no}` : "", fmtMd(inv.invoice_date), `¥${(inv.amount || 0).toLocaleString()}`, b ? `→${b.label}` : "", inv.subject].filter(Boolean).join(" ");
}

/**
 * 読み取った請求書（include=true のもの）を、支払い先ごとの 1 行にまとめる。
 * 同じ支払い先の請求書が複数あれば、宛先ごとの金額を足し、内訳をメモに残す。
 */
export function invoicesToRows(invoices) {
  const byName = new Map();
  for (const inv of invoices) {
    if (!inv.include) continue;
    const name = clean(inv.payee_name);
    if (!name) continue;
    let row = byName.get(name);
    if (!row) {
      row = { payee_name: name, bank_info: "", paid: false, memo: "", due_date: "", file_paths: [], invoices: [] };
      for (const e of PAY_ENTITIES) row[e.key] = 0;
      byName.set(name, row);
    }
    const key = billToKey(inv.bill_to) || "amount_cv";
    row[key] += inv.amount || 0;
    if (!row.bank_info && inv.bank_info) row.bank_info = inv.bank_info;
    if (inv.due_date && (!row.due_date || inv.due_date < row.due_date)) row.due_date = inv.due_date;
    if (inv.file_path && !row.file_paths.includes(inv.file_path)) row.file_paths.push(inv.file_path);
    row.invoices.push({ file_path: inv.file_path, file_name: inv.file_name || "", bill_to: inv.bill_to || "cv", amount: inv.amount || 0, invoice_date: inv.invoice_date, due_date: inv.due_date, invoice_no: inv.invoice_no, subject: inv.subject });
  }
  for (const row of byName.values()) {
    row.memo = row.invoices.length === 1 ? [row.invoices[0].invoice_no ? `No.${row.invoices[0].invoice_no}` : "", row.invoices[0].subject].filter(Boolean).join(" ") : row.invoices.map((v) => invoiceLabel(v)).join(" ／ ");
  }
  return [...byName.values()];
}

/** 請求書 1 通ごとの CSV（読み取り結果の確認用。支払い先まとめの CSV とは別） */
export function invoicesToCsv(list, payMonth = "") {
  const head = ["支払月", "支払い先（発行元）", "宛先（支払元）", "金額（税込）", "請求日", "支払期限", "請求書No.", "件名", "振込先情報", "ファイル名"];
  const lines = [head.join(",")];
  for (const v of list) {
    const b = BILL_TO.find((x) => x.code === v.bill_to);
    lines.push([v.pay_month || payMonth, v.payee_name || "", b ? b.label : "（不明）", Number(v.amount) || 0, v.invoice_date || "", v.due_date || "", v.invoice_no || "", v.subject || "", v.bank_info || "", v.file_name || ""].map(csvCell).join(","));
  }
  const total = list.reduce((s, v) => s + (Number(v.amount) || 0), 0);
  lines.push(["", "合計", `${list.length} 通`, total, "", "", "", "", "", ""].map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
export function downloadInvoicesCsv(list, payMonth) {
  downloadText(invoicesToCsv(list, payMonth), `請求書読み取り_${payMonth || thisMonth()}.csv`);
}

/** 一覧の行（invoices 列）から請求書 1 通ごとの一覧に戻す */
export function rowsToInvoices(rows) {
  const out = [];
  for (const r of rows) {
    for (const v of (Array.isArray(r.invoices) ? r.invoices : [])) {
      out.push({ ...v, pay_month: r.pay_month, payee_name: r.payee_name, bank_info: r.bank_info || "", file_name: v.file_name || (v.file_path ? String(v.file_path).split("/").pop() : "") });
    }
  }
  return out;
}

/** 既存の行（同じ月・同じ支払い先）に、読み取った行を足し込む */
export function mergePayableRow(existing, add) {
  const out = { ...existing };
  for (const e of PAY_ENTITIES) out[e.key] = (Number(existing[e.key]) || 0) + (Number(add[e.key]) || 0);
  out.bank_info = existing.bank_info || add.bank_info || null;
  out.due_date = [existing.due_date, add.due_date].filter(Boolean).sort()[0] || null;
  out.file_paths = [...new Set([...(existing.file_paths || []), ...(add.file_paths || [])])];
  out.invoices = [...(existing.invoices || []), ...(add.invoices || [])];
  out.memo = [existing.memo, add.memo].filter(Boolean).join(" ／ ") || null;
  return out;
}

/** 翌月（YYYY-MM）。請求書は届いた月の翌月末に支払う */
export const nextMonth = (ym) => { const [y, m] = (ym || thisMonth()).split("-").map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
