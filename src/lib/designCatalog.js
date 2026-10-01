// デザイン費マスタの項目を「一覧（カタログ）」として扱う共通処理。
// 画面（議事録の見積条件）とサーバー（議事録の自動作成）の両方から使うので React に依存しない。

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[,¥￥円\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** DB の行の並び、または { category, items[] } の並びを、平らな一覧にする */
export function flattenDesignCatalog(source) {
  const out = [];
  for (const g of source || []) {
    if (Array.isArray(g.items)) {
      for (const it of g.items) out.push({ master_id: it.id || null, category: g.category, name: it.name, detail: it.detail || "", selling_price: num(it.selling_price ?? it.amount) });
    } else if (g && g.name) {
      if (g.is_active === false) continue;
      out.push({ master_id: g.id || null, category: g.category, name: g.name, detail: g.detail || "", selling_price: num(g.selling_price ?? g.amount) });
    }
  }
  return out;
}

const norm = (s) => String(s || "").replace(/[\s　]/g, "").replace(/[（(]/g, "(").replace(/[）)]/g, ")").toLowerCase();

/** 名前（とカテゴリ）からカタログの項目を探す。完全一致 → 空白・括弧の違いを無視 → 部分一致 */
export function findDesignCatalogItem(catalog, { master_id, category, name } = {}) {
  if (master_id) {
    const byId = catalog.find((c) => c.master_id && c.master_id === master_id);
    if (byId) return byId;
  }
  if (!name) return null;
  const n = norm(name);
  const cat = norm(category);
  const pool = cat ? catalog.filter((c) => norm(c.category) === cat) : catalog;
  return (
    pool.find((c) => c.name === name) ||
    pool.find((c) => norm(c.name) === n) ||
    (cat ? catalog.find((c) => norm(c.name) === n) : null) ||
    pool.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name))) ||
    null
  );
}

/** 選んだ項目の合計（税別） */
export const designItemsTotal = (items) => (items || []).reduce((s, it) => s + Math.round(num(it.selling_price) * (num(it.quantity) || 1)), 0);
