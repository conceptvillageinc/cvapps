import { useSalesCategories, classifySalesCategory, salesCategoryOf, salesCategoryDef } from "@/lib/salesCategory";

/**
 * 明細の売上カテゴリー（freee の会計計上部門にあたる）。
 *   「自動（◯◯）」を選ぶと区分と品名から振り分け、それ以外を選ぶとその値で固定する。
 * @param {object} p
 * @param {object} p.item      明細
 * @param {(patch: object) => void} p.onChange
 */
export default function SalesCategorySelect({ item, onChange, disabled = false, className = "" }) {
  const { list } = useSalesCategories();
  const auto = classifySalesCategory(item, list);
  const fixed = salesCategoryDef(item.sales_category, list) ? item.sales_category : "";
  const current = salesCategoryOf(item, list);
  const color = salesCategoryDef(current, list)?.color || "#888";
  return (
    <select
      value={fixed}
      onChange={(e) => onChange({ sales_category: e.target.value || null })}
      disabled={disabled}
      className={`h-6 max-w-[200px] rounded border pl-1 pr-0.5 text-[10px] bg-white ${className}`}
      style={{ borderColor: color, color }}
      title="売上カテゴリー（freee の会計計上部門）。売上粗利管理表でカテゴリーごとに集計します"
      aria-label="売上カテゴリー"
      data-testid="sales-category"
    >
      <option value="">自動（{salesCategoryDef(auto, list)?.short || "—"}）</option>
      {list.filter((c) => c.active || c.key === fixed).map((c) => <option key={c.key} value={c.key}>{c.label}{c.active ? "" : "（使っていない）"}</option>)}
    </select>
  );
}

/** 品名の下に出す小さな印（見積書の画面で、社内用の欄を閉じていても見えるように） */
export function SalesCategoryChip({ item }) {
  const { list } = useSalesCategories();
  const def = salesCategoryDef(salesCategoryOf(item, list), list);
  if (!def) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 leading-4 text-[9.5px]" style={{ borderColor: `${def.color}66`, color: def.color }} title={`売上カテゴリー: ${def.label}${item.sales_category ? "（手で選択）" : "（自動）"}`} data-testid="sales-category-chip">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: def.color }} />{def.short}
    </span>
  );
}
