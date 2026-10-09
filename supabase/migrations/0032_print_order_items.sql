-- ============================================================================
-- 入稿記録の内訳（社内見積の ✓ の行を小見出しごとにまとめた 1 件の、行ごとの品名・数量・金額）
--   例: 「ユニフォーム（ポロシャツ）ブラック」7枚 の内訳 M 4枚 / XL 1枚 / L 2枚 / 袋入れ / 送料
--   追加印刷の見積を作るとき、内訳の行をそのまま明細にする。
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================
alter table public.print_orders add column if not exists items jsonb not null default '[]'::jsonb;

comment on column public.print_orders.items is '内訳 [{ row, name, quantity, unit, unit_price, amount, cost_price, vendor, source_url, extra }]（extra は送料・袋入れなど数量に足さない行）';

notify pgrst, 'reload schema';
