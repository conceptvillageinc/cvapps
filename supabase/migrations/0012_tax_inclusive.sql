-- ============================================================================
-- フィードバック No.7: 税込見積
--
-- 見積ごとに「税込で作る」を持つ。true のとき明細の単価・金額は税込で、
-- 消費税は税込合計から逆算する（計算は src/lib/estimateTotals.js）。
-- 行ごとの税率（10% / 8%）は line_items の tax_rate に持つ（列追加なし）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.estimates
  add column if not exists tax_inclusive boolean not null default false;

comment on column public.estimates.tax_inclusive is 'true = 明細の単価・金額が税込（消費税は税込合計から逆算）';
