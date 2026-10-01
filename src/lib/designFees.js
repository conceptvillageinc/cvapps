// コンセプト・ヴィレッジ デザイン料金マスタ
// 固定の初期一覧は designFeeData.js（サーバー側の議事録処理からも読むため、React に依存しないファイル）
import { DESIGN_FEE_MASTER } from "./designFeeData";
export { DESIGN_FEE_MASTER, DESIGN_CATEGORIES, getDesignItemsByCategory } from "./designFeeData";

// ----------------------------------------------------------------------------
// DB のデザイン費マスタ（design_fee_masters）を読む。
// 画面「デザイン費マスタ」で編集した内容がそのまま見積の「+明細を追加 → デザイン費」に出る。
// テーブルがまだ無い／空のとき（マイグレーション未実行）は上の固定一覧にフォールバックする。
// ----------------------------------------------------------------------------
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { db } from "@/api/db";

export const DESIGN_FEE_MASTER_QUERY_KEY = ["designFeeMaster"];

/** DB の行を { category, category_order, items:[...] } の並びにまとめる */
export function groupDesignFeeRows(rows) {
  const sorted = [...rows].sort((a, b) =>
    (a.category_order - b.category_order) || a.category.localeCompare(b.category, "ja") || (a.sort_order - b.sort_order)
  );
  const groups = [];
  for (const row of sorted) {
    let g = groups.find((x) => x.category === row.category);
    if (!g) { g = { category: row.category, category_order: row.category_order, items: [] }; groups.push(g); }
    g.items.push(row);
  }
  return groups;
}

/**
 * @param {{ activeOnly?: boolean }} [opts]  activeOnly=true で「使わない」にした項目を除く（見積側）
 */
export function useDesignFeeMaster({ activeOnly = true } = {}) {
  const query = useQuery({
    queryKey: DESIGN_FEE_MASTER_QUERY_KEY,
    queryFn: () => db.entities.DesignFeeMaster.list("category_order"),
    retry: false,
  });
  const rows = query.data;
  const groups = useMemo(() => {
    if (!rows || rows.length === 0) return DESIGN_FEE_MASTER;
    return groupDesignFeeRows(activeOnly ? rows.filter((r) => r.is_active !== false) : rows);
  }, [rows, activeOnly]);
  return {
    groups,
    rows: rows || [],
    fromDb: Boolean(rows && rows.length > 0),
    isLoading: query.isLoading,
    error: query.error,
  };
}
