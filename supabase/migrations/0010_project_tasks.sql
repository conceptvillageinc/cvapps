-- ============================================================================
-- v2 S6: 工程管理（project_tasks）と Google スプレッドシートへの出力
--
-- 案件ごとの工程（ヒアリング → 構成 → デザイン → 構築 → 公開 など）を持ち、
-- 「工程管理表」として Google スプレッドシートに書き出してクライアントと共有する。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null,
  -- CV / クライアント / 外注 など、誰が動く工程か
  owner        text,
  start_date   date,
  end_date     date,
  -- todo=未着手 / doing=進行中 / done=完了 / hold=保留
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done', 'hold')),
  notes        text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on public.project_tasks (project_id, sort_order);

drop trigger if exists project_tasks_set_updated_at on public.project_tasks;
create trigger project_tasks_set_updated_at
  before update on public.project_tasks
  for each row execute function public.set_updated_at();

alter table public.project_tasks enable row level security;
drop policy if exists project_tasks_members_all on public.project_tasks;
create policy project_tasks_members_all on public.project_tasks
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 出力先のスプレッドシート（案件ごとに1つ。2回目以降は同じシートを更新する）
alter table public.projects
  add column if not exists schedule_sheet_id  text,
  add column if not exists schedule_sheet_url text;
