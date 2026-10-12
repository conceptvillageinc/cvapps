// 支払い先まとめ: クレジットカード利用明細 CSV の読み取り・集計・CSV 出力
import { decodeCsv, parseCsvText as parseCsv } from "@/lib/bankImport";
import { downloadText } from "@/lib/mfExport";
import { BILL_TO } from "@/lib/payables";

/** 列の役割と、見出しから当てる手がかり */
export const CARD_FIELDS = [
  { key: "charged_at", label: "利用日", match: /利用日|ご利用日|取引日|決済日|日付|^日$/ },
  { key: "merchant", label: "利用先", match: /利用先|ご利用先|加盟店|店名|利用店|摘要|内容|取引先|明細/ },
  { key: "amount", label: "金額", match: /利用金額|ご利用金額|請求額|金額|支払額/ },
  { key: "holder", label: "利用者・カード", match: /利用者|名義|カード名|カード番号|カード|社員|メンバー/ },
  { key: "memo", label: "メモ", match: /備考|メモ|コメント|経費|科目|部門|プロジェクト|タグ/ },
];

const num = (v) => {
  const s = String(v ?? "").replace(/[\\￥¥,\s円]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** "2026/09/03" "2026-9-3" "20260903" "令和8年9月3日" → "2026-09-03" */
export function toIsoDate(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/. 年]\s*(\d{1,2})[-/. 月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^令和\s*(\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return `${2018 + Number(m[1])}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

// 列を当てるときの優先順（上から順に探す）。「カード利用明細ID」のような ID の列は、利用先などに当てない
const FIELD_PRIORITY = {
  charged_at: [/^(ご)?利用日/, /取引日/, /決済日/, /日付|^日$/, /確定日/],
  merchant: [/^(ご)?利用先|ご利用店|利用店|加盟店|店名/, /取引内容|利用内容|^内容$|摘要/, /取引先|支払先/, /内容|明細/],
  amount: [/^(ご)?利用金額/, /確定金額|請求額|支払額|出金額/, /金額/],
  holder: [/利用者|名義|社員|メンバー/, /カード名|^カード$/, /カード/],
  memo: [/備考|メモ|コメント/, /科目|部門|プロジェクト|タグ/],
};
const ID_HEADER = /ID|ＩＤ|番号|No\.?$|^#/i;
/** 中身が ID のような英数字の羅列か（利用先に当てない） */
function looksLikeIds(rows, col) {
  const vals = rows.map((r) => String(r?.[col] ?? "").trim()).filter(Boolean).slice(0, 20);
  if (vals.length === 0) return false;
  return vals.filter((v) => /^[A-Za-z0-9_-]{10,}$/.test(v)).length / vals.length >= 0.8;
}

/** 見出し行を探し、列の役割を当てる。返り値 { headerIndex, header, mapping: { charged_at: colIdx, ... } } */
export function guessCardMapping(grid) {
  const rows = grid || [];
  let headerIndex = -1; let best = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    const hits = CARD_FIELDS.filter((f) => cells.some((c) => f.match.test(c))).length;
    if (hits > best && hits >= 2) { best = hits; headerIndex = i; }
  }
  const header = headerIndex >= 0 ? rows[headerIndex].map((c) => String(c ?? "").trim()) : [];
  const body = headerIndex >= 0 ? rows.slice(headerIndex + 1) : [];
  const mapping = {};
  const used = new Set();
  for (const f of CARD_FIELDS) {
    let found = -1;
    for (const re of FIELD_PRIORITY[f.key]) {
      found = header.findIndex((h, i) => !used.has(i) && re.test(h)
        && (f.key === "holder" || !ID_HEADER.test(h))
        && (f.key !== "merchant" || !looksLikeIds(body, i)));
      if (found >= 0) break;
    }
    if (found >= 0) { mapping[f.key] = found; used.add(found); }
  }
  return { headerIndex, header, mapping };
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const fingerprintOf = (c) => `${c.charged_at}|${clean(c.merchant).normalize("NFKC").toLowerCase()}|${Math.round(c.amount)}|${clean(c.holder).normalize("NFKC").toLowerCase()}`;

/** 2 次元配列と列の対応から利用明細を作る。日付か金額が無い行、合計行は飛ばす */
export function rowsFromGrid(grid, headerIndex, mapping, entity = "cv", cardLabel = "", cardBrand = null) {
  const out = []; const skipped = [];
  const get = (row, key) => (mapping[key] === undefined || mapping[key] === "" ? "" : row[mapping[key]]);
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    const charged_at = toIsoDate(get(row, "charged_at"));
    const amount = num(get(row, "amount"));
    const merchant = clean(get(row, "merchant"));
    if (!charged_at || !amount) { skipped.push(i + 1); continue; }
    if (/^(合計|小計|総計)/.test(merchant)) continue;
    const c = { charged_at, charge_month: charged_at.slice(0, 7), merchant: merchant || "（利用先不明）", amount: Math.round(amount), holder: clean(get(row, "holder")) || null, memo: clean(get(row, "memo")) || null, entity, card_label: cardLabel || null, source: "csv", card_brand: cardBrand || null };
    c.fingerprint = fingerprintOf(c);
    out.push(c);
  }
  return { rows: out, skipped };
}

/** ファイル（CSV）→ 2 次元配列 */
export async function cardCsvToGrid(file) {
  const text = await decodeCsv(file);
  return parseCsv(text);
}

export function sumCharges(list) {
  const t = { count: list.length, total: 0, byEntity: {}, byHolder: new Map() };
  for (const b of BILL_TO) t.byEntity[b.code] = 0;
  for (const c of list) {
    const a = Number(c.amount) || 0;
    t.total += a;
    t.byEntity[c.entity] = (t.byEntity[c.entity] || 0) + a;
    const h = c.holder || "（利用者なし）";
    t.byHolder.set(h, (t.byHolder.get(h) || 0) + a);
  }
  t.total_ex_tax = Math.round(t.total / 1.1);
  return t;
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function chargesToCsv(list, month) {
  const head = ["利用月", "利用日", "利用先", "金額（税込）", "利用者・カード", "会社", "メモ"];
  const lines = [head.join(",")];
  for (const c of list) {
    const b = BILL_TO.find((x) => x.code === c.entity);
    lines.push([c.charge_month, c.charged_at, c.merchant, Number(c.amount) || 0, c.holder || "", b ? b.label : c.entity, c.memo || ""].map(csvCell).join(","));
  }
  const t = sumCharges(list);
  lines.push(["", "", "合計", t.total, "", "", `税抜 ${t.total_ex_tax}`].map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
export function downloadChargesCsv(list, month) { downloadText(chargesToCsv(list, month), `カード利用明細まとめ_${month}.csv`); }

// ============================================================================
// カードの種類（MF / JCB / VISA）
//   JCB・VISA と、種類がまだ決まっていない明細は daichi だけが見られる（0033_payables_access.sql）。
// ============================================================================
/** カード名・利用者・メモから種類を推し量る（種類付けの画面の初期値） */
export function guessBrand(c) {
  const t = `${c.card_label || ""} ${c.holder || ""} ${c.memo || ""}`.normalize("NFKC");
  if (/jcb/i.test(t)) return "jcb";
  if (/visa/i.test(t)) return "visa";
  if (/mf|マネーフォワード|money\s*forward|ビジネスカード/i.test(t)) return "mf";
  return "";
}

/**
 * 種類が決まっていない明細を、取り込みのまとまりごとに分ける。
 *   同じ会社・カード名・取り込み方で、取り込んだ時刻が 3 分以内に続くものを 1 回の取り込みとみなす。
 * @returns {Array<{ key, rows, entity, card_label, source, importedAt, months: string[], total, guess }>}
 */
export function importBatches(rows) {
  const sorted = [...(rows || [])].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const batches = [];
  let cur = null;
  for (const r of sorted) {
    const sig = `${r.entity || "cv"}|${r.card_label || ""}|${r.source || "csv"}`;
    const t = Date.parse(r.created_at || "") || 0;
    if (!cur || cur.sig !== sig || t - cur.last > 3 * 60 * 1000) {
      cur = { sig, key: `${sig}|${r.created_at || r.id}`, rows: [], entity: r.entity || "cv", card_label: r.card_label || "", source: r.source || "csv", importedAt: r.created_at || "", last: t };
      batches.push(cur);
    }
    cur.rows.push(r);
    cur.last = t;
  }
  return batches.map(({ sig: _sig, last: _last, ...b }) => {
    const months = [...new Set(b.rows.map((r) => r.charge_month))].sort();
    const total = b.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const votes = new Map();
    for (const r of b.rows) { const g = guessBrand(r); if (g) votes.set(g, (votes.get(g) || 0) + 1); }
    const guess = [...votes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || "";
    const holders = [...new Set(b.rows.map((r) => r.holder).filter(Boolean))];
    return { ...b, months, total, guess, holders };
  }).reverse(); // 新しい取り込みから
}

// ============================================================================
// 紙の利用明細（VISA）を写真から読み取る
// ============================================================================
export const CARD_OCR_SCHEMA = {
  type: "object",
  properties: {
    charges: {
      type: "array",
      description: "利用明細の 1 行ごと（合計・小計・前回請求額・お支払い額の行は含めない）",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "利用日（YYYY-MM-DD）。年が書かれていなければ空" },
          month_day: { type: "string", description: "利用日の月日（MM-DD）。必ず入れる" },
          merchant: { type: "string", description: "利用店名・ご利用先（書いてあるとおり）" },
          amount: { type: "number", description: "利用金額（円・税込）。返品・取消はマイナス" },
          holder: { type: "string", description: "利用者・カード名義（家族カードなど、行ごとに分かれていれば）。無ければ空" },
          note: { type: "string", description: "支払区分（1回払い・分割など）や読みにくい点。無ければ空" },
        },
      },
    },
    statement_month: { type: "string", description: "明細のお支払い月・ご請求月（YYYY-MM）。分からなければ空" },
    notes: { type: "string", description: "写真が切れている・ぼやけて読めない行があるなど、確かめてほしいこと。無ければ空" },
  },
};

export const CARD_OCR_PROMPT = `添付した写真は、クレジットカード（VISA）の紙の利用明細書です。利用明細の行を 1 行ずつ読み取って JSON で返してください。

【読み取り】
- 1 行 = 1 件の利用です。利用日・利用店名（ご利用先）・利用金額を読み取ります。
- 金額はカンマや「¥」「円」を除いた数値。返品・取消・値引きの行はマイナスにします。
- 合計・小計・前回ご請求額・今回お支払い額・振替日・手数料の案内など、利用そのものでない行は含めません。
- 利用日に年が書かれていないことが多いので、month_day（MM-DD）は必ず入れ、年まで分かるときだけ date（YYYY-MM-DD）も入れます。
- 写真が傾いていても、表の行と列を取り違えないようにしてください。読めない文字は推測で埋めず、note に「一部読めない」と書きます。`;

/** 明細の年月（お支払い月）から、年の無い利用日（MM-DD）の年を決める。お支払い月より後の月は前の年 */
export function resolveOcrDate(v, statementMonth) {
  const iso = toIsoDate(v?.date);
  if (iso) return iso;
  const m = String(v?.month_day || "").match(/(\d{1,2})\D+(\d{1,2})/);
  if (!m || !/^\d{4}-\d{2}$/.test(statementMonth || "")) return "";
  const sy = Number(statementMonth.slice(0, 4)); const sm = Number(statementMonth.slice(5, 7));
  const mm = Number(m[1]); const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  const y = mm > sm ? sy - 1 : sy;
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** 読み取り結果 → 画面で直せる行 */
export function ocrRowsFromResult(res, { statementMonth, fileName = "" } = {}) {
  const list = Array.isArray(res?.charges) ? res.charges : [];
  return list.map((v, i) => {
    const charged_at = resolveOcrDate(v, statementMonth);
    return {
      key: `${fileName}#${i}`,
      file_name: fileName,
      charged_at,
      merchant: clean(v?.merchant),
      amount: Math.round(num(v?.amount)) || 0,
      holder: clean(v?.holder),
      memo: clean(v?.note),
      include: true,
    };
  });
}

/** 画面で直した行 → 取り込む明細（日付か金額が無い行は null） */
export function ocrRowToCharge(r, { entity = "cv", cardLabel = "" } = {}) {
  const charged_at = toIsoDate(r.charged_at);
  const amount = Math.round(num(r.amount));
  if (!charged_at || !amount) return null;
  const c = { charged_at, charge_month: charged_at.slice(0, 7), merchant: clean(r.merchant) || "（利用先不明）", amount, holder: clean(r.holder) || null, memo: clean(r.memo) || null, entity, card_label: cardLabel || null, source: "ocr", card_brand: "visa" };
  c.fingerprint = fingerprintOf(c);
  return c;
}

/**
 * 写真を読み取りに出せる大きさにする（長い辺 2400px・JPEG）。PDF と小さい画像はそのまま。
 *   スマホの写真は 1 枚 5MB を超えることがあり、そのままだと読み取りの上限にかかる。
 */
export async function shrinkImage(file, { maxSide = 2400, maxBytes = 1.5 * 1024 * 1024 } = {}) {
  if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return file; }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= maxBytes) { bmp.close?.(); return file; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

/**
 * もう入っている明細の指紋（二重取り込みを防ぐ）。
 *   見えない明細（ほかの人のカード・種類が未設定）とも比べられるよう、データベースの関数で確かめる。
 *   関数がまだ無い（SQL 未実行）ときは、取り込む月の明細を読んで比べる。
 */
export async function existingFingerprints(db, charges) {
  const fps = [...new Set(charges.map((c) => c.fingerprint))];
  if (fps.length === 0) return new Set();
  try {
    const have = new Set();
    for (let i = 0; i < fps.length; i += 200) {
      const rows = await db.rpc("card_fingerprints_exist", { fps: fps.slice(i, i + 200) });
      for (const r of rows || []) have.add(typeof r === "string" ? r : r.card_fingerprints_exist ?? r.fingerprint);
    }
    return have;
  } catch {
    const months = [...new Set(charges.map((c) => c.charge_month))];
    const existing = [];
    for (const m of months) existing.push(...await db.entities.CardCharge.filter({ charge_month: m }));
    return new Set(existing.map((r) => r.fingerprint));
  }
}
