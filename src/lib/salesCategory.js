// ============================================================================
// 売上カテゴリー（freee 販売の「会計計上部門」にあたるもの）
//   見積・納品書・請求書の明細 1 行ごとに付ける。手で選んだもの（sales_category）があればそれ、
//   無ければ区分（category）と品名から自動で振り分ける。
//   売上粗利管理表で、請求書の明細をカテゴリーごとに毎月・年間で集計する。
//   対象は 2026-10-01 以降の請求書（freee 販売から取り込んだ過去分は対象外）。
//
// 一覧・表示順・振り分けの語は「売上カテゴリーマスタ」で変えられる
// （システム設定 sales_categories に JSON で保存。無ければ下の初期の一覧）。
// ============================================================================
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useSystemSettings } from "@/lib/useSystemSettings";

export const SALES_CATEGORIES_KEY = "sales_categories";

/** 売上カテゴリーで集計を始める日（今期＝15期の期首） */
export const SALES_CATEGORY_FROM = "2026-10-01";

/** カテゴリーの色の候補 */
export const SALES_CATEGORY_COLORS = ["#6d5bd0", "#2a78d6", "#1baf7a", "#eb6834", "#0e9bb5", "#eda100", "#d64545", "#c2418f", "#5f7d2b", "#8a6a4f", "#64748b"];

/**
 * 初期の一覧。
 *   est_words  見積の区分（デザイン費・印刷費 など）にこの語が含まれていればこのカテゴリー（品名より優先）
 *   keywords   品名にこの語が含まれていればこのカテゴリー（いちばん長く一致した語のカテゴリー。同じ長さなら上の行）
 *   discount   割引の行（自動計算の割引・マイナスの行）を入れるカテゴリー
 *   fallback   どれにも当てはまらない行を入れるカテゴリー
 */
export const DEFAULT_SALES_CATEGORIES = [
  { key: "coordinate", label: "コーディネート・プロデュース・コンサルティング", short: "コーディネート", color: "#6d5bd0",
    est_words: ["ディレクション", "コンセプト設計", "プロデュース", "コンサル", "コーディネート"],
    keywords: ["ディレクション", "進行管理", "プロデュース", "コンサル", "コーディネート", "コンセプト", "ブランディング", "戦略", "監修", "マーケティング", "ワークショップ", "伴走"] },
  { key: "design", label: "デザイン", short: "デザイン", color: "#2a78d6",
    est_words: ["デザイン費"],
    keywords: ["デザイン", "イラスト", "ロゴ", "DTP", "レイアウト", "版下", "作図", "トレース", "パッケージ", "キャラクター"] },
  { key: "print", label: "印刷", short: "印刷", color: "#1baf7a",
    est_words: ["印刷費"],
    keywords: ["印刷", "製本", "加工", "出力", "刷り", "プリント", "ラベル", "シール", "封入", "封筒", "名刺", "チラシ", "パンフ", "ポスター", "リーフレット", "送料", "配送"] },
  { key: "shooting", label: "撮影", short: "撮影", color: "#eb6834",
    est_words: ["撮影", "動画", "映像"],
    keywords: ["撮影", "写真", "動画", "映像", "カメラ", "ドローン", "ロケ", "スタジオ", "モデル", "ムービー", "空撮"] },
  { key: "build", label: "構築", short: "構築", color: "#0e9bb5",
    est_words: ["構築費"],
    keywords: ["構築", "コーディング", "システム", "開発", "サイト", "ホームページ", "HP", "WEB", "LP", "サーバ", "ドメイン", "CMS", "WordPress", "実装", "保守", "アプリ"] },
  { key: "writing", label: "ライティング・他", short: "ライティング・他", color: "#eda100", fallback: true,
    est_words: ["ライティング", "原稿", "取材"],
    keywords: ["ライティング", "原稿", "執筆", "取材", "インタビュー", "ナレーション", "翻訳", "記事", "コピーライト", "校閲", "文字起こし"] },
  { key: "cv_discount", label: "CV割引", short: "CV割引", color: "#d64545", discount: true,
    est_words: ["割引"],
    keywords: ["割引", "値引", "ディスカウント", "DRAW UP", "ドローアップ"] },
].map((c) => ({ active: true, discount: false, fallback: false, ...c }));

const words = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,、，\n]/)).map((w) => String(w).trim()).filter(Boolean);

/** 保存されている値を同じ形にそろえる（壊れていれば初期の一覧） */
export function normalizeSalesCategories(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch { list = null; } }
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_SALES_CATEGORIES;
  const out = [];
  for (const [i, c] of list.entries()) {
    const label = String(c?.label || "").trim();
    const key = String(c?.key || "").trim();
    if (!label || !key || out.some((x) => x.key === key)) continue;
    out.push({
      key, label,
      short: String(c.short || "").trim() || label,
      color: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : SALES_CATEGORY_COLORS[i % SALES_CATEGORY_COLORS.length],
      est_words: words(c.est_words), keywords: words(c.keywords),
      discount: !!c.discount, fallback: !!c.fallback, active: c.active !== false,
    });
  }
  return out.length ? out : DEFAULT_SALES_CATEGORIES;
}

// いま使っている一覧（画面がシステム設定を読んだら差し替わる。集計・帳票の写しなど hook を使えない所で使う）
let current = DEFAULT_SALES_CATEGORIES;
export const getSalesCategories = () => current;

/** マスタの一覧（hook）。読み込むと getSalesCategories の値も差し替える */
export function useSalesCategories() {
  const { settings, isLoading } = useSystemSettings();
  const row = settings.find((x) => x.setting_key === SALES_CATEGORIES_KEY) || null;
  const list = useMemo(() => normalizeSalesCategories(row?.setting_value), [row?.setting_value]);
  current = list;
  return { list, active: list.filter((c) => c.active), row, isLoading, fromSettings: !!row };
}

/** マスタを保存する（システム設定に upsert） */
export function useSaveSalesCategories() {
  const queryClient = useQueryClient();
  return async (row, list) => {
    const data = { setting_key: SALES_CATEGORIES_KEY, setting_value: JSON.stringify(list), description: "売上カテゴリー（freee の会計計上部門）の一覧・表示順・自動振り分けの語" };
    if (row) await db.entities.SystemSettings.update(row.id, data);
    else await db.entities.SystemSettings.create(data);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  };
}

export const salesCategoryDef = (key, defs = current) => defs.find((c) => c.key === key) || null;

/**
 * 区分と品名から売上カテゴリーを推定する（使っているカテゴリーだけ）。見出し・小計の行は null。
 *   ① 割引の行（自動計算の割引・マイナスの行・割引の語）→ 割引のカテゴリー
 *   ② 見積の区分に「見積の区分の語」が含まれる → そのカテゴリー（上の行から順に）
 *   ③ 品名に「品名の語」が含まれる → いちばん長く一致した語のカテゴリー（同じ長さなら上の行）
 *   ④ どれにも当たらない → 「当てはまらない行」のカテゴリー
 */
export function classifySalesCategory(li, defs = current) {
  if (!li || li.row_type === "text" || li.row_type === "subtotal") return null;
  const list = defs.filter((c) => c.active);
  if (list.length === 0) return null;
  const cat = String(li.category || "");
  const name = `${li.name || ""} ${li.memo || ""}`;
  const has = (text, w) => text.toLowerCase().includes(w.toLowerCase());

  // ①
  const disc = list.find((c) => c.discount);
  if (disc && (li.rule === "discount" || Number(li.amount) < 0 || disc.est_words.some((w) => has(cat, w)) || disc.keywords.some((w) => has(`${cat} ${name}`, w)))) return disc.key;
  // ②（自動計算のディレクション費・コンセプト設計費の行は区分で決まる）
  for (const c of list) if (!c.discount && c.est_words.some((w) => has(cat, w))) return c.key;
  // ③
  let best = null;
  for (const c of list) {
    if (c.discount) continue;
    for (const w of c.keywords) if (has(name, w) && (!best || w.length > best.len)) best = { key: c.key, len: w.length };
  }
  if (best) return best.key;
  // ④
  return (list.find((c) => c.fallback && !c.discount) || list.filter((c) => !c.discount).at(-1) || list[0]).key;
}

/** 明細の売上カテゴリー（手で選んだもの → 自動）。見出し・小計の行は null */
export function salesCategoryOf(li, defs = current) {
  if (!li || li.row_type === "text" || li.row_type === "subtotal") return null;
  return defs.some((c) => c.key === li.sales_category) ? li.sales_category : classifySalesCategory(li, defs);
}

/** 売上カテゴリーを集計に含める請求書か（今期以降・freee 取込分を除く・取消を除く） */
export function invoiceInSalesCategoryScope(inv) {
  return !!inv && inv.status !== "cancelled" && !inv.legacy_id && String(inv.invoice_date || "") >= SALES_CATEGORY_FROM;
}

/**
 * 請求書の明細を売上カテゴリー × 月で集計する（税別）。
 * @param {object[]} invoices
 * @param {{ key: string }[]} months  fiscalMonths の戻り値
 * @param {object[]} [estimates]  見積（カテゴリーを持たない請求書の明細を、写し元の見積の明細から振り分けるのに使う）
 * @param {object[]} [defs]       カテゴリーの一覧（マスタ）
 * @returns {{ rows: { key, label, short, color, sales: number[], gross: number[], cost: number[] }[], totalSales: number[] }}
 */
export function salesByCategory(invoices, months, estimates = [], defs = current) {
  // 見積の明細（id → 明細）。カテゴリーを引き継ぐ前に作った請求書の明細は、写し元の見積の明細で振り分ける
  const estLine = new Map();
  for (const e of estimates || []) for (const li of e.line_items || []) if (li?.id) estLine.set(li.id, li);
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const blank = () => Array(months.length).fill(0);
  const all = defs.map((c) => ({ ...c, sales: blank(), cost: blank(), gross: blank(), lines: blank() }));
  const byKey = new Map(all.map((r) => [r.key, r]));
  const totalSales = blank();
  for (const inv of invoices || []) {
    if (!invoiceInSalesCategoryScope(inv)) continue;
    const i = idx.get(String(inv.invoice_date).slice(0, 7));
    if (i === undefined) continue;
    for (const li of inv.line_items || []) {
      const src = !defs.some((c) => c.key === li.sales_category) && li.source_line_id ? estLine.get(li.source_line_id) : null;
      const key = src ? salesCategoryOf(src, defs) : salesCategoryOf(li, defs);
      const r = key && byKey.get(key);
      if (!r) continue;
      const amount = Number(li.amount) || 0;
      const qty = Number(li.quantity) || 1;
      const cost = li.cost_price != null && li.cost_price !== "" ? Number(li.cost_price) * qty : 0;
      r.sales[i] += amount; r.cost[i] += cost; r.gross[i] += amount - cost; r.lines[i] += 1;
      totalSales[i] += amount;
    }
  }
  // 使っていないカテゴリーは、金額があるときだけ出す
  const rows = all.filter((r) => r.active || r.lines.some((n) => n > 0));
  return { rows, totalSales };
}
