// ============================================================================
// 明細の「似たもの探し」: 印刷価格マスタ・入稿記録・過去見積の明細を、品名・仕様・仕入先の言葉で探す。
//   ・検索窓（見積の明細の上の検索バー・印刷費のパネル）… 打った言葉をすべて含むもの（AND）
//   ・似たもののお知らせ（明細の品名を手で入れたとき・新規見積の件名）… 言葉の半分以上が合うもの
//   全角・半角、カタカナ・ひらがな、大文字・小文字の違いは区別しない。
// ============================================================================
import { toTaxExcluded } from "@/lib/priceTax";

/** 比べる用に文字をそろえる（NFKC・小文字・カタカナ→ひらがな） */
export function normSearch(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 言葉に分ける。空白で区切るほか、英数字（A0・A4・100）と、かな・漢字のまとまりも分ける。
 *   「A0ポスター」→ ["a0", "ぽすたー"]、「A4チラシ（両面印刷）」→ ["a4", "ちらし", "両面印刷"]
 */
export function tokenize(s) {
  const n = normSearch(s);
  const out = n.match(/[a-z0-9][a-z0-9.\-×x]*|[\u3040-\u309f\u30fc]+|[\u4e00-\u9fff々〆]+/g) || [];
  return [...new Set(out.map((t) => t.replace(/[.\-]+$/, "")).filter(Boolean))];
}

const compact = (s) => normSearch(s).replace(/[\s()（）［］[\]「」【】・,，、。/／_＿]/g, "");

/** 検索窓: 打った言葉（空白区切り）をすべて含むか */
export function matchesAll(query, hay) {
  const h = compact(hay);
  const words = normSearch(query).split(/\s+/).map((w) => compact(w)).filter(Boolean);
  if (words.length === 0) return false;
  // 空白なしで打った「a0ぽすたー」も、言葉に分けて探す
  return words.every((w) => h.includes(w) || tokenize(w).every((t) => h.includes(compact(t))));
}

const STOP_RE = /印刷費|印刷代|印刷|制作費|費用|一式|追加|送料|の分|について/g;
const bigrams = (t) => { const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };

/**
 * 似たもの: 0〜1（品名を 2 文字ずつに分けたうち、相手に含まれる割合）。
 *   「A0ポスター印刷」と「ポスター（A0サイズ）」のように、言葉の区切りや並びが違っても拾う。
 *   「印刷」「一式」など手がかりにならない言葉は除き、英数字（A4 など）だけの一致では似ているとしない。
 */
export function similarity(name, hay) {
  const a = compact(name).replace(STOP_RE, "");
  if (a.length < 2) return 0;
  const grams = bigrams(a);
  const h = compact(hay);
  const hit = [...grams].filter((g) => h.includes(g));
  if (!hit.some((g) => /[^a-z0-9.\-×x]/.test(g))) return 0;
  return hit.length / grams.size;
}

/** 価格マスタ 1 件 → 候補（価格表のセル。見積に出すセル（selected）が無ければ全部のセルを薄く出す） */
function masterCandidate(m) {
  const grid = Array.isArray(m.price_grid) ? m.price_grid : [];
  const sel = grid.flatMap((row) => (row.cells || []).filter((c) => c.selected && Number(c.price) > 0).map((c) => ({ quantity: row.quantity, label: c.label, price: c.price })));
  const all = grid.flatMap((row) => (row.cells || []).filter((c) => Number(c.price) > 0).map((c) => ({ quantity: row.quantity, label: c.label, price: c.price })));
  return {
    kind: "master", id: m.id, entry: m,
    title: m.category || "（商品名なし）", sub: m.spec_summary || "", vendor: m.vendor_name || "",
    date: m.last_updated || "", dim: sel.length === 0,
    cells: (sel.length ? sel : all).sort((a, b) => (a.quantity - b.quantity) || String(a.label).localeCompare(String(b.label), "ja")),
    hay: [m.category, m.spec_summary, m.vendor_name, m.notes, m.paper_type_group === "紙" ? "紙" : ""].filter(Boolean).join(" "),
  };
}

/** 入稿記録 1 件 → 候補 */
function orderCandidate(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  return {
    kind: "order", id: o.id, order: o,
    title: o.name || "（品名なし）", sub: items.length > 1 ? items.map((it) => it.name).join("・") : "", vendor: o.vendor || "",
    date: o.ordered_on || "", client: o.client_name || "", amount: o.amount, quantity: o.quantity, unit: o.unit,
    hay: [o.name, o.vendor, o.category, ...items.map((it) => it.name)].filter(Boolean).join(" "),
  };
}

const isUsableLine = (li) => li && li.row_type !== "text" && li.row_type !== "subtotal" && li.source_type !== "rule" && (li.name || "").trim() && !/割引/.test(li.name || "");

/** 過去見積の明細 → 候補（同じクライアント・品名・単価のものは新しい 1 件だけ） */
function lineCandidates(estimates, { excludeEstimateId } = {}) {
  const seen = new Set();
  const out = [];
  for (const e of estimates || []) {
    if (e.id === excludeEstimateId) continue;
    for (const li of e.line_items || []) {
      if (!isUsableLine(li)) continue;
      const k = `${e.client_name}|${compact(li.name)}|${Math.round(Number(li.unit_price) || 0)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        kind: "line", id: `${e.id}:${li.id}`, line: li, estimate: e,
        title: li.name, sub: li.category || "", vendor: li.source_type === "vendor_quote" ? li.source_ref || "" : "",
        date: String(e.estimate_date || e.created_date || "").slice(0, 10), client: e.client_name || "", number: e.estimate_number || "",
        quantity: li.quantity, unit: li.unit, unit_price: li.unit_price, amount: li.amount, cost_price: li.cost_price,
        hay: [li.name, li.category, li.notes, li.memo, li.source_type === "vendor_quote" ? li.source_ref : ""].filter(Boolean).join(" "),
      });
    }
  }
  return out;
}

/**
 * 探す。
 * @param {string} query
 * @param {{ masters?: object[], orders?: object[], estimates?: object[] }} data
 * @param {{ mode?: "all" | "similar", limit?: number, min?: number, kinds?: string[], excludeEstimateId?: string, paperGroup?: string }} [opts]
 * @returns {{ masters: object[], orders: object[], lines: object[], total: number }}
 */
export function searchItems(query, data, { mode = "all", limit = 8, min = 0.5, kinds = ["master", "order", "line"], excludeEstimateId, paperGroup } = {}) {
  const empty = { masters: [], orders: [], lines: [], total: 0 };
  if (!String(query || "").trim()) return empty;
  const score = (c) => (mode === "all" ? (matchesAll(query, c.hay) ? 1 : 0) : similarity(query, c.hay));
  const pick = (list) => list.map((c) => ({ ...c, score: score(c) })).filter((c) => c.score >= (mode === "all" ? 1 : min))
    .sort((a, b) => (b.score - a.score) || String(b.date).localeCompare(String(a.date)));
  const masters = kinds.includes("master") ? pick((data.masters || []).filter((m) => !paperGroup || m.paper_type_group === paperGroup).map(masterCandidate))
    .sort((a, b) => (Number(a.dim) - Number(b.dim)) || (b.score - a.score) || String(b.date).localeCompare(String(a.date))) : [];
  const orders = kinds.includes("order") ? pick((data.orders || []).map(orderCandidate)) : [];
  const lines = kinds.includes("line") ? pick(lineCandidates(data.estimates, { excludeEstimateId })) : [];
  return { masters: masters.slice(0, limit), orders: orders.slice(0, limit), lines: lines.slice(0, limit), total: masters.length + orders.length + lines.length };
}

/** 価格マスタのセルの原価（税別・1 単位あたり） */
export const cellUnitCost = (entry, cell) => toTaxExcluded(cell.price, entry.price_tax_mode) / (cell.quantity || 1);

/**
 * 新規見積の件名に似た過去の見積（件名と明細の品名で比べる）。同じクライアントの見積を先に。
 * @returns {Array<{ estimate, score, sameClient }>}
 */
export function similarEstimates(title, estimates, { clientName = "", limit = 4, min = 0.5 } = {}) {
  if (String(title || "").trim().length < 2) return [];
  const client = normSearch(clientName).replace(/\s+/g, "");
  return (estimates || [])
    .filter((e) => (e.line_items || []).some(isUsableLine))
    .map((e) => {
      const byTitle = similarity(title, e.estimate_title || "");
      const byLines = similarity(title, (e.line_items || []).filter(isUsableLine).map((li) => li.name).join(" ")) * 0.9;
      return { estimate: e, score: Math.max(byTitle, byLines), sameClient: !!client && normSearch(e.client_name).replace(/\s+/g, "") === client };
    })
    .filter((x) => x.score >= min)
    .sort((a, b) => (Number(b.sameClient) - Number(a.sameClient)) || (b.score - a.score) || String(b.estimate.created_date || "").localeCompare(String(a.estimate.created_date || "")))
    .slice(0, limit);
}
