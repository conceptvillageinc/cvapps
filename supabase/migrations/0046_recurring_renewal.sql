-- ============================================================================
-- 定期売上: 終了・更新の管理
--
--   ended_confirmed_at  … 「更新しない（終了）」を押した日時（要対応から外す。終了月までは納品書を作る）
--   last_reviewed_month … 無期限の定期売上で「見直し済み（このまま継続）」にした見直しの月（次の見直しはその 12 か月後）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.recurring_project_templates
  add column if not exists ended_confirmed_at timestamptz,
  add column if not exists last_reviewed_month date;

comment on column public.recurring_project_templates.ended_confirmed_at is '「更新しない（終了）」を押した日時';
comment on column public.recurring_project_templates.last_reviewed_month is '無期限の定期売上で見直し済みにした月（次はその 12 か月後）';
