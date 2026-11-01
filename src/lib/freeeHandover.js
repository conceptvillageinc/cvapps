// ============================================================================
// freee販売からの引き継ぎ（見積書・納品書のスクショ画像／PDFを読み取って、CVアプリの書類にする）
//
//   ① 定期売上の見積書 → 案件と見積を作り、案件の画面で「定期売上にする」を開く
//   ② 見積書・納品書   → すでにある案件を選んで、CVアプリの見積・納品書を作る
//
// 読み取りは /api/llm（integrations.Core.InvokeLLM）。ファイルは非公開の Storage に置いてサーバーで読む。
// ============================================================================
import { db } from "@/api/db";
import { newDocItem } from "@/lib/documents";
import { toTaxExclusiveUnitPrice } from "@/lib/estimateTotals";
import { lineAmount } from "@/lib/constants";

export const MAX_HANDOVER_FILES = 5;

export const HANDOVER_SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: ["estimate", "delivery_note", "invoice", "other"], description: "書類の種類。見積書=estimate、納品書=delivery_note、請求書=invoice" },
    doc_number: { type: "string", description: "書類の番号（見積番号・納品書番号など）。無ければ空文字" },
    issue_date: { type: "string", description: "発行日・見積日・納品日（YYYY-MM-DD）。無ければ空文字" },
    client_name: { type: "string", description: "宛先の会社名（「御中」「様」は付けない）。発行元（株式会社コンセプト・ヴィレッジ）ではない" },
    title: { type: "string", description: "件名。無ければ空文字" },
    prices_include_tax: { type: "boolean", description: "明細の単価・金額が税込（内税）なら true、税抜なら false" },
    line_items: {
      type: "array",
      description: "明細の行（上から順に。小計・消費税・合計の行は入れない）",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "品名・内容（複数行ならつなげる）" },
          quantity: { type: "number", description: "数量" },
          unit: { type: "string", description: "単位（式・枚・ヶ月など）" },
          unit_price: { type: "number", description: "単価" },
          amount: { type: "number", description: "金額" },
          tax_rate: { type: "number", description: "税率（10 または 8。※軽減税率の印があれば 8）" },
        },
      },
    },
    subtotal: { type: "number", description: "小計（税抜）" },
    tax: { type: "number", description: "消費税" },
    total: { type: "number", description: "合計（税込）" },
    period: { type: "string", description: "定期・月額の契約期間が書いてあれば（例: 2026年10月〜2027年9月）。無ければ空文字" },
    notes: { type: "string", description: "備考（短く）" },
  },
};

export const HANDOVER_PROMPT = `添付は freee販売で発行した見積書・納品書・請求書のスクリーンショットまたはPDFです（複数ある場合は同じ書類の別ページ）。内容を正確に読み取り、JSONで返してください。

・発行元は「株式会社コンセプト・ヴィレッジ」です。client_name には宛先（「◯◯御中」「◯◯様」の会社名）を入れ、「御中」「様」は付けないでください。
・明細は上から順にすべて入れてください。小計・消費税・合計・値引きの合計行は明細に入れません（値引きが明細の 1 行として書かれていれば、マイナスの金額の行として入れてください）。
・金額のカンマや円記号は取り、数字だけにしてください。
・単価・金額が税込で書かれている（内税）なら prices_include_tax を true にしてください。
・日付は YYYY-MM-DD にしてください（令和などの元号は西暦に直す）。
・読み取れない項目は空欄・0 にしてください。推測で埋めないでください。`;

/** ファイル（同じ書類の 1〜5 枚）を読み取る */
export async function readFreeeDocument(files) {
  const list = [...(files || [])].slice(0, MAX_HANDOVER_FILES);
  if (!list.length) throw new Error("ファイルを選んでください");
  const paths = [];
  for (const f of list) {
    const { file_url } = await db.integrations.Core.UploadFile({ file: f });
    paths.push(file_url);
  }
  const res = await db.integrations.Core.InvokeLLM({ prompt: HANDOVER_PROMPT, file_urls: paths, response_json_schema: HANDOVER_SCHEMA });
  return normalizeRead(res);
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[,，¥￥円\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

/** 読み取り結果を画面で直しやすい形にそろえる（行には id を付け、金額が無ければ数量×単価） */
export function normalizeRead(res) {
  const r = res || {};
  const lines = (Array.isArray(r.line_items) ? r.line_items : [])
    .filter((li) => li && (String(li.name || "").trim() || num(li.amount)))
    .map((li) => {
      const quantity = num(li.quantity) || 1;
      const unit_price = num(li.unit_price) || (num(li.amount) && quantity ? num(li.amount) / quantity : 0);
      return {
        key: Math.random().toString(36).slice(2, 10),
        name: String(li.name || "").trim(),
        quantity,
        unit: String(li.unit || "").trim() || "式",
        unit_price,
        amount: num(li.amount) || lineAmount(quantity, unit_price),
        tax_rate: Number(li.tax_rate) === 8 ? 8 : 10,
      };
    });
  return {
    doc_type: ["estimate", "delivery_note", "invoice"].includes(r.doc_type) ? r.doc_type : "estimate",
    doc_number: String(r.doc_number || "").trim(),
    issue_date: isDate(r.issue_date) ? r.issue_date : "",
    client_name: String(r.client_name || "").replace(/\s*(御中|様)\s*$/, "").trim(),
    title: String(r.title || "").trim(),
    prices_include_tax: !!r.prices_include_tax,
    line_items: lines,
    subtotal: num(r.subtotal), tax: num(r.tax), total: num(r.total),
    period: String(r.period || "").trim(),
    notes: String(r.notes || "").trim(),
  };
}

/** 明細の合計（税抜。税込の書類は税抜に直して足す） */
export function readSubtotal(doc) {
  return Math.round((doc?.line_items || []).reduce((s, li) => {
    const a = Number(li.amount) || 0;
    return s + (doc.prices_include_tax ? (a * 100) / (100 + (li.tax_rate || 10)) : a);
  }, 0));
}

/** 品名から見積の区分を決める（迷うものは空。売上カテゴリーは品名から自動で決まる） */
export function guessCategory(name) {
  const s = String(name || "");
  if (/割引|値引/.test(s)) return "割引";
  if (/印刷|刷り|プリント|シール|ラベル.*(枚|部)|チラシ.*(枚|部)/.test(s)) return "印刷費（紙）";
  if (/システム|アプリ|開発/.test(s)) return "システム構築費";
  if (/サイト|ホームページ|web|ウェブ|LP|保守|サーバー|ドメイン/i.test(s)) return "web構築費";
  if (/デザイン|撮影|制作|ロゴ|コンセプト|ディレクション|校正/.test(s)) return "デザイン費";
  return "";
}

/** 見積の明細（見積は税込のまま持てる） */
export function toEstimateLines(doc) {
  return (doc?.line_items || []).map((li) => ({
    id: `fh_${Math.random().toString(36).slice(2, 10)}`,
    row_type: "item",
    category: guessCategory(li.name),
    name: li.name,
    quantity: Number(li.quantity) || 1,
    unit: li.unit || "式",
    unit_price: Number(li.unit_price) || 0,
    amount: Number(li.amount) || 0,
    tax_rate: li.tax_rate === 8 ? 8 : 10,
    source_type: "freee_handover",
  }));
}

/** 納品書の明細（納品書は税抜で持つ） */
export function toNoteLines(doc) {
  return (doc?.line_items || []).map((li) => {
    const rate = li.tax_rate === 8 ? 8 : 10;
    const qty = Number(li.quantity) || 1;
    const unitPrice = doc.prices_include_tax ? toTaxExclusiveUnitPrice(li.unit_price, rate) : Number(li.unit_price) || 0;
    return newDocItem({
      name: li.name, quantity: qty, unit: li.unit || "式", unit_price: unitPrice,
      amount: doc.prices_include_tax ? lineAmount(qty, unitPrice) : Number(li.amount) || 0,
      tax_rate: rate,
    });
  });
}

// ---------------------------------------------------------------------------
// クライアント・案件の候補（名前の近さ）
// ---------------------------------------------------------------------------
const CORP = /(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|農業法人|\(株\)|（株）|\(有\)|（有）)/g;
export const normName = (s) => String(s || "").replace(CORP, "").replace(/[\s　・\-－_／/（）()「」【】［］\[\]]/g, "").toLowerCase();

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}
/** 0〜1 の近さ（2 文字ずつの重なり） */
export function nameSimilarity(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const A = bigrams(x), B = bigrams(y);
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

/** 読み取った宛先にいちばん近いクライアント（0.6 未満なら null） */
export function matchClient(clients, name) {
  let best = null, score = 0;
  for (const c of clients || []) {
    const s = nameSimilarity(c.name, name);
    if (s > score) { best = c; score = s; }
  }
  return score >= 0.6 ? best : null;
}

/** 書類に合いそうな案件の順（クライアントの近さ＋件名の近さ。進行中を先に） */
export function rankProjects(projects, doc) {
  return (projects || [])
    .map((p) => {
      const c = nameSimilarity(p.client_name, doc?.client_name);
      const t = Math.max(nameSimilarity(p.name, doc?.title), ...(doc?.line_items || []).slice(0, 3).map((li) => nameSimilarity(p.name, li.name) * 0.8));
      const open = p.status === "open" ? 0.05 : 0;
      return { project: p, score: c * 0.6 + t * 0.4 + open, client: c, title: t };
    })
    .sort((a, b) => b.score - a.score);
}

/** 引き継ぎのメモ（案件メモ・見積の社内メモに残す） */
export function handoverMemo(doc, kindLabel) {
  return `freee販売から引き継ぎ（${kindLabel}${doc?.doc_number ? ` ${doc.doc_number}` : ""}${doc?.issue_date ? `・${doc.issue_date}` : ""}）`;
}
