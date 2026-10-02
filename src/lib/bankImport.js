// ============================================================================
// 銀行の入出金明細CSV（東邦銀行・琉球銀行・大東銀行）の読み取りと、請求書との照合
// 東邦・琉球は決まった形。それ以外（大東など）は見出しの文字から列を当てる。
// ============================================================================

/** CSVの文字コードを判定して文字列にする（銀行のCSVは Shift_JIS が多い） */
export async function decodeCsv(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // UTF-8 として読めるか試し、だめなら Shift_JIS
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return t.replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

export function parseCsvText(text) {
  const rows = []; let row = []; let field = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => {
  const s = String(v ?? "").replace(/[\\￥¥,\s]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// "2026- 4- 3" / "2026/02/25" / "20260403" → "2026-04-03"
function normalizeDate(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/. ]\s*(\d{1,2})[-/. ]\s*(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(?:令和|R)\s*(\d{1,2})[.年/]\s*(\d{1,2})[.月/]\s*(\d{1,2})/);
  if (m) return `${2018 + Number(m[1])}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

/**
 * 半角カナの振込名義を照合用に正規化する。
 *   全角化 → 法人格の略記（ｶ) (ｶ) ｶ. ﾄｸﾋ) など）と記号・空白を除く → カタカナ
 */
export function normalizePayee(raw) {
  let s = String(raw ?? "").normalize("NFKC");
  s = s.replace(/[\s　]+/g, "");
  // 法人格の略記
  s = s.replace(/[（(]?(カ|ユ|ド|シヤ|ザイ|トクヒ|イ|シ|ガク|ホウ)[）)．.]/g, "");
  s = s.replace(/[（(](カ|ユ|ド|シヤ|ザイ|トクヒ|イ|シ)[）)]?/g, "");
  s = s.replace(/^[．.]?(カ|ユ)[．.]/, "").replace(/[．.](カ|ユ)[．.]?$/, "");
  s = s.replace(/[．.,、。・\-－ー―‐]/g, "");
  // ひらがな → カタカナ
  s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return s.toUpperCase();
}

/** クライアント名（漢字）やフリガナを照合用に正規化する */
export function normalizeClientForBank(client) {
  const kana = client?.name_kana ? normalizePayee(client.name_kana) : "";
  const name = String(client?.name || "").normalize("NFKC")
    .replace(/(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|学校法人|医療法人|社会福祉法人)/g, "")
    .replace(/[\s　]+/g, "");
  return { kana, name };
}

export async function sha1Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * CSVを読み取り、取込用の行に変換する。銀行は先頭行から判定する。
 * @returns {Promise<{ bank, accountLabel, rows: [{ bank, account_label, transaction_date, amount_in, amount_out, payee_raw, payee_normalized, balance, source_hash }] , skipped: number }>}
 */
export async function parseBankCsv(text) {
  const rows = parseCsvText(text);
  if (rows.length === 0) throw new Error("CSVが空です");
  const first = rows[0].map((c) => String(c).trim());

  let bank; let accountLabel; let parsed = [];
  if (first[0] === "1" && rows.length > 1 && String(rows[1][0]).trim() === "2") {
    // 東邦銀行: 1,出力日,支店,種別,口座,名義 / 2,"日付","名義","","入金","残高"
    bank = "toho";
    accountLabel = `東邦銀行 ${first[2] || ""} ${first[4] || ""}`.replace(/\s+/g, " ").trim();
    for (const r of rows.slice(1)) {
      if (String(r[0]).trim() !== "2") continue;
      const date = normalizeDate(r[1]);
      if (!date) continue;
      const payee = String(r[2] ?? "").trim();
      const out = num(r[3]);
      const inn = num(r[4]);
      parsed.push({ transaction_date: date, payee_raw: payee, amount_in: inn, amount_out: out, balance: num(r[5]) });
    }
  } else if (/銀行/.test(first[0]) && first.length >= 4 && !looksLikeHeader(first)) {
    // 琉球銀行: 銀行,支店,種別,口座,開始日,終了日,出力日時 / ID,日付,出金,入金,摘要,残高
    bank = /琉球/.test(first[0]) ? "ryukyu" : /大東/.test(first[0]) ? "daito" : "other";
    accountLabel = `${first[0]} ${first[1] || ""} ${first[3] || ""}`.replace(/\s+/g, " ").trim();
    for (const r of rows.slice(1)) {
      const date = normalizeDate(r[1]);
      if (!date) continue;
      parsed.push({ transaction_date: date, payee_raw: String(r[4] ?? "").trim(), amount_out: num(r[2]), amount_in: num(r[3]), balance: num(r[5]) });
    }
  } else {
    // 見出しから列を当てる（大東銀行など）。日付・入金・出金・残高・摘要の見出しがある表に対応
    const g = parseGenericBankCsv(rows, text);
    if (!g) throw new Error("対応していないCSV形式です（日付・入金・出金・残高の見出しがある入出金明細に対応しています）");
    bank = g.bank; accountLabel = g.accountLabel; parsed = g.parsed;
  }

  const out = [];
  for (const p of parsed) {
    const key = [bank, p.transaction_date, p.payee_raw, p.amount_in, p.amount_out, p.balance].join("|");
    out.push({
      bank,
      account_label: accountLabel,
      ...p,
      payee_normalized: normalizePayee(p.payee_raw),
      source_hash: await sha1Hex(key),
    });
  }
  return { bank, accountLabel, rows: out, skipped: rows.length - 1 - parsed.length };
}

export const BANK_LABELS = { toho: "東邦銀行", ryukyu: "琉球銀行", daito: "大東銀行", other: "その他" };

/** 通帳の画像から読み取った行（{ transaction_date, payee_raw, amount_in, amount_out, balance }）を取込用の行にする */
export async function rowsFromPassbook(bank, lines, accountLabel = "") {
  const out = [];
  for (const p of lines) {
    const key = [bank, p.transaction_date, p.payee_raw, p.amount_in, p.amount_out, p.balance].join("|");
    out.push({ bank, account_label: accountLabel || BANK_LABELS[bank] || bank, ...p, payee_normalized: normalizePayee(p.payee_raw), source_hash: await sha1Hex(key) });
  }
  return out;
}
export const BANK_CODES = ["toho", "ryukyu", "daito"];

const H = {
  date: /取引日|日付|年月日|^日$|お取引日|取扱日/,
  out: /出金|お支払|支払金額|引出|お引出/,
  inn: /入金|お預り|お預入|預入|入金額/,
  balance: /残高/,
  payee: /摘要|内容|取引内容|お取引内容|振込人|名義|備考|取引先/,
};
function looksLikeHeader(cells) { return cells.some((c) => H.date.test(c)) && cells.some((c) => H.balance.test(c) || H.inn.test(c) || H.out.test(c)); }

/** 見出し行を探して、列の役割を当てる。見つからなければ null */
function parseGenericBankCsv(rows, text) {
  let hIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) { if (looksLikeHeader(rows[i].map((c) => String(c ?? "").trim()))) { hIdx = i; break; } }
  if (hIdx < 0) return null;
  const header = rows[hIdx].map((c) => String(c ?? "").trim());
  const find = (re, skip = []) => header.findIndex((h, i) => !skip.includes(i) && re.test(h));
  const col = {};
  col.date = find(H.date);
  col.out = find(H.out); col.inn = find(H.inn, [col.out]); col.balance = find(H.balance); col.payee = find(H.payee, [col.date, col.out, col.inn, col.balance]);
  if (col.date < 0 || (col.inn < 0 && col.out < 0)) return null;
  const head = rows.slice(0, hIdx).flat().map((c) => String(c ?? "")).join(" ") + " " + String(text || "").slice(0, 400);
  const bank = /大東/.test(head) ? "daito" : /東邦/.test(head) ? "toho" : /琉球/.test(head) ? "ryukyu" : "other";
  const parsed = [];
  for (const r of rows.slice(hIdx + 1)) {
    const date = normalizeDate(r[col.date]);
    if (!date) continue;
    parsed.push({
      transaction_date: date,
      payee_raw: col.payee >= 0 ? String(r[col.payee] ?? "").trim() : "",
      amount_out: col.out >= 0 ? Math.abs(num(r[col.out])) : 0,
      amount_in: col.inn >= 0 ? Math.abs(num(r[col.inn])) : 0,
      balance: col.balance >= 0 ? num(r[col.balance]) : null,
    });
  }
  const meta = rows.slice(0, hIdx).flat().map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 4).join(" ");
  const label = BANK_LABELS[bank];
  return { bank, accountLabel: (meta.includes(label) ? meta : `${label} ${meta}`).trim(), parsed };
}

/**
 * 入金1件に対する請求書の候補を出す。
 * 優先順: 覚えた振込名義が一致 → 金額が一致（手数料引きも許容） → フリガナが似ている
 * @returns [{ invoice, score, reasons: [] }]
 */
export function suggestInvoices(tx, invoices, clients) {
  if (!tx || tx.amount_in <= 0) return [];
  const byName = new Map(clients.map((c) => [c.name, c]));
  const payee = tx.payee_normalized || normalizePayee(tx.payee_raw);
  const out = [];
  for (const inv of invoices) {
    if (!(inv.status === "sent" || inv.status === "draft")) continue;
    const client = (inv.client_id && clients.find((c) => c.id === inv.client_id)) || byName.get(inv.client_name);
    const reasons = []; let score = 0;
    const total = Number(inv.total) || 0;
    const diff = total - tx.amount_in;
    if (diff === 0) { score += 50; reasons.push("金額一致"); }
    else if (diff > 0 && diff <= 1100) { score += 30; reasons.push(`手数料差 ${diff.toLocaleString()}円`); }
    else if (Math.abs(diff) <= 5) { score += 20; reasons.push("端数差"); }
    if (client) {
      const learned = Array.isArray(client.bank_payee_names) ? client.bank_payee_names : [];
      if (payee && learned.includes(payee)) { score += 60; reasons.push("振込名義を学習済み"); }
      else {
        const { kana } = normalizeClientForBank(client);
        if (payee && kana && (kana.includes(payee) || payee.includes(kana))) { score += 35; reasons.push("フリガナが一致"); }
        else if (payee && kana && kana.slice(0, 4) && payee.includes(kana.slice(0, 4))) { score += 15; reasons.push("フリガナが部分一致"); }
      }
    }
    // 日付: 請求日より前の入金は減点
    if (inv.invoice_date && tx.transaction_date < inv.invoice_date) { score -= 20; reasons.push("請求日より前"); }
    if (score >= 30) out.push({ invoice: inv, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** 自動で確定してよいか（1件だけ高得点） */
export function isConfident(candidates) {
  if (candidates.length === 0) return false;
  const [a, b] = candidates;
  return a.score >= 80 && (!b || b.score < 50);
}
