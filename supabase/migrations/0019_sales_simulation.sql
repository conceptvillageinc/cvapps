-- ============================================================================
-- 0019: 売上粗利管理表の「シミュレーション」（着地見込を月ごとに手で置き換えて試算する）
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

alter table public.fiscal_targets
  add column if not exists simulation jsonb not null default '{}'::jsonb;

comment on column public.fiscal_targets.simulation is
  'シミュレーション用の上書き値 { sales_a:[12], sales_a2:[12], cost_a:[12], cost_a2:[12], recurring:[12], updated_at, updated_by }。null の月は実データの着地見込を使う';
