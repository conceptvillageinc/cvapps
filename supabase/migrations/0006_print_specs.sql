-- ============================================================================
-- v2 S2-2: 印刷仕様（print_specs）
--
-- 1つの見積で「チラシ」と「ラベル」のように複数の印刷物を扱えるよう、
-- 仕様を見積の中に配列で持つ。印刷会社への見積依頼メールは仕様から生成する。
--
-- [{ id, label, print_type, size, paper_type, color_count, quantities: [..],
--    usage, finishing, desired_delivery_date, notes }]
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.estimates
  add column if not exists print_specs jsonb not null default '[]'::jsonb;

comment on column public.estimates.print_specs is '印刷仕様の配列。見積依頼メールはここから生成する。';

-- 依頼メールがどの仕様のものかを履歴に残す
alter table public.email_logs
  add column if not exists spec_label text;
