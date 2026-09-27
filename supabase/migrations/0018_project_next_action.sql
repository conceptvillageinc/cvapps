-- ============================================================================
-- 0018: 案件の「ネクストアクション」（案件一覧のネクストアクションビュー用）
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

alter table public.projects
  add column if not exists next_action            text,
  add column if not exists next_action_updated_at timestamptz,
  add column if not exists next_action_updated_by text;

comment on column public.projects.next_action is '次にやること（自由記述。案件一覧のネクストアクションビューで編集）';
comment on column public.projects.next_action_updated_at is 'ネクストアクションを最後に書き換えた日時';
comment on column public.projects.next_action_updated_by is 'ネクストアクションを最後に書き換えた人（表示名）';
