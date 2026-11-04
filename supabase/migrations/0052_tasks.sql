-- ============================================================================
-- 0052: タスク管理（Asana の置きかえ）
--
--   タスクは工程表の工程（project_tasks）と同じもの。案件の工程表に入れた工程が、そのまま担当者のタスクになる。
--
--   見える範囲:
--     案件に紐づくタスク・社内プロジェクトに紐づくタスク … CV のメンバー全員
--     どこにも紐づかないタスク（マイタスク）           … 作った人と担当者だけ（ワークロードにも数えない）
--     ゲスト（社外の方）                               … 担当になったタスク（とそのサブタスク）と、その案件・社内プロジェクトだけ
--
--   project_tasks に足す項目:
--     internal_project_id（社内プロジェクト）、assignee_id（担当者）、created_by（作った人）、
--     priority（優先度 high/mid/low）、review_status（確認の状態 todo=要対応 / reviewing=確認中 / ok=OK）、
--     description（説明）、parent_task_id（サブタスクの親）、pin（校正のピン {attachment_id, page, x, y, no}）
--     project_id は空でもよくする（社内プロジェクト・マイタスクのため）
--   task_projects     … 社内プロジェクト（校正・入稿・発注・請求・売上、新規案件対応、CV_topics など）
--   task_sections     … リストの見出し（セクション）。マイタスクは利用者ごと（本人だけが見る）、社内プロジェクトはプロジェクトごと
--                       タスクは my_section_id / my_sort_order（担当者のマイタスクでの場所）と
--                       section_id / section_sort_order（社内プロジェクトでの場所）を持つ
--   task_comments     … タスクのコメント（@メンションは mentions に利用者の id）
--   task_attachments  … タスクの添付（画像・PDF。ファイルは Storage の uploads/tasks/<タスクid>/…）
--   notifications     … 受信トレイ（メンション・担当になった・コメント）。トリガーで入れる
--   users.daily_hours … 1 日の稼働時間（ワークロードで超えた日を薄い赤にする。既定 8 時間）
--   users.role に guest（社外の方）を足す。is_app_member() は guest を含めない（ほかの表は今までどおり CV のメンバーだけ）
--
-- 冪等。Supabase の SQL Editor に貼り付けて実行する。最後の SELECT で 7 行出れば完了。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ゲスト（社外の方）
-- ----------------------------------------------------------------------------
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in ('admin', 'user', 'guest'));
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check check (role in ('admin', 'user', 'guest'));

alter table public.users add column if not exists daily_hours numeric not null default 8;
alter table public.users drop constraint if exists users_daily_hours_range;
alter table public.users add constraint users_daily_hours_range check (daily_hours >= 0 and daily_hours <= 24);
comment on column public.users.daily_hours is '1 日の稼働時間（ワークロードで超えた日を薄い赤にする）';

-- CV のメンバー（ゲストは含めない）。ほかの表の RLS はこれを見るので、ゲストは今までどおり何も読めない
create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users where id = auth.uid() and role <> 'guest');
$$;

create or replace function public.is_guest()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'guest');
$$;

-- ゲストは、利用者の名前・顔写真（担当者・コメントの表示）だけ読めるようにする
drop policy if exists users_select_guest on public.users;
create policy users_select_guest on public.users
  for select to authenticated using (public.is_guest());

-- ----------------------------------------------------------------------------
-- 社内プロジェクト
-- ----------------------------------------------------------------------------
create table if not exists public.task_projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,
  description text,
  archived    boolean not null default false,
  sort_order  integer not null default 0,
  created_by  uuid references public.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists task_projects_set_updated_at on public.task_projects;
create trigger task_projects_set_updated_at before update on public.task_projects
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- タスク（project_tasks を広げる）
-- ----------------------------------------------------------------------------
alter table public.project_tasks alter column project_id drop not null;
alter table public.project_tasks add column if not exists internal_project_id uuid references public.task_projects (id) on delete set null;
alter table public.project_tasks add column if not exists assignee_id   uuid references public.users (id) on delete set null;
alter table public.project_tasks add column if not exists created_by    uuid references public.users (id) on delete set null;
alter table public.project_tasks alter column created_by set default auth.uid();
alter table public.project_tasks add column if not exists priority      text;
alter table public.project_tasks add column if not exists review_status text;
alter table public.project_tasks add column if not exists description   text;
alter table public.project_tasks add column if not exists parent_task_id uuid references public.project_tasks (id) on delete cascade;
alter table public.project_tasks add column if not exists pin           jsonb;
alter table public.project_tasks drop constraint if exists project_tasks_priority_check;
alter table public.project_tasks add constraint project_tasks_priority_check check (priority is null or priority in ('high', 'mid', 'low'));
alter table public.project_tasks drop constraint if exists project_tasks_review_status_check;
alter table public.project_tasks add constraint project_tasks_review_status_check check (review_status is null or review_status in ('todo', 'reviewing', 'ok'));

create index if not exists project_tasks_assignee_idx on public.project_tasks (assignee_id) where completed = false;
create index if not exists project_tasks_internal_idx on public.project_tasks (internal_project_id, sort_order);
create index if not exists project_tasks_parent_idx on public.project_tasks (parent_task_id, sort_order);

-- ゲストが見られるタスクか（担当のタスクと、そのサブタスク）。RLS の中から自分の表を読むので security definer
create or replace function public.guest_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_tasks t
    left join public.project_tasks p on p.id = t.parent_task_id
    where t.id = p_task and (t.assignee_id = auth.uid() or p.assignee_id = auth.uid())
  );
$$;

-- 見られるタスクか（メンバー: 共有のタスクと、自分が作った・担当の非公開タスク ／ ゲスト: 担当のタスク）
create or replace function public.can_see_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_app_member() then exists (
      select 1 from public.project_tasks t
      where t.id = p_task and (t.project_id is not null or t.internal_project_id is not null or t.created_by = auth.uid() or t.assignee_id = auth.uid()))
    when public.is_guest() then public.guest_task(p_task)
    else false end;
$$;

drop policy if exists project_tasks_members_all on public.project_tasks;
drop policy if exists project_tasks_members_rw on public.project_tasks;
create policy project_tasks_members_rw on public.project_tasks
  for all to authenticated
  using (public.is_app_member() and (project_id is not null or internal_project_id is not null or created_by = auth.uid() or assignee_id = auth.uid()))
  with check (public.is_app_member() and (project_id is not null or internal_project_id is not null or created_by = auth.uid() or assignee_id = auth.uid()));
drop policy if exists project_tasks_guest_select on public.project_tasks;
create policy project_tasks_guest_select on public.project_tasks
  for select to authenticated using (public.is_guest() and public.guest_task(id));
drop policy if exists project_tasks_guest_update on public.project_tasks;
create policy project_tasks_guest_update on public.project_tasks
  for update to authenticated using (public.is_guest() and public.guest_task(id)) with check (public.is_guest() and public.guest_task(id));

alter table public.task_projects enable row level security;
drop policy if exists task_projects_members_all on public.task_projects;
create policy task_projects_members_all on public.task_projects
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());
drop policy if exists task_projects_guest_select on public.task_projects;
create policy task_projects_guest_select on public.task_projects
  for select to authenticated using (public.is_guest() and exists (select 1 from public.project_tasks t where t.internal_project_id = task_projects.id));

-- ゲストは、担当のタスクがある案件だけ読める（タスクの RLS が効くので、担当のタスクだけが数えられる）
drop policy if exists projects_guest_select on public.projects;
create policy projects_guest_select on public.projects
  for select to authenticated using (public.is_guest() and exists (select 1 from public.project_tasks t where t.project_id = projects.id));

-- ----------------------------------------------------------------------------
-- セクション（リストの見出し。名前・並び順は自由に変えられる）
-- ----------------------------------------------------------------------------
create table if not exists public.task_sections (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('my', 'internal')),
  user_id             uuid references public.users (id) on delete cascade,
  internal_project_id uuid references public.task_projects (id) on delete cascade,
  name                text not null,
  sort_order          numeric not null default 0,
  collapsed           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint task_sections_owner check ((kind = 'my' and user_id is not null) or (kind = 'internal' and internal_project_id is not null))
);
create index if not exists task_sections_user_idx on public.task_sections (user_id, sort_order) where kind = 'my';
create index if not exists task_sections_project_idx on public.task_sections (internal_project_id, sort_order) where kind = 'internal';
drop trigger if exists task_sections_set_updated_at on public.task_sections;
create trigger task_sections_set_updated_at before update on public.task_sections
  for each row execute function public.set_updated_at();

alter table public.project_tasks add column if not exists my_section_id      uuid references public.task_sections (id) on delete set null;
alter table public.project_tasks add column if not exists my_sort_order      numeric;
alter table public.project_tasks add column if not exists section_id         uuid references public.task_sections (id) on delete set null;
alter table public.project_tasks add column if not exists section_sort_order numeric;

alter table public.task_sections enable row level security;
-- マイタスクの見出しは本人だけ（ゲストも自分の見出しは持てる）。社内プロジェクトの見出しは CV のメンバー
drop policy if exists task_sections_my on public.task_sections;
create policy task_sections_my on public.task_sections
  for all to authenticated using (kind = 'my' and user_id = auth.uid()) with check (kind = 'my' and user_id = auth.uid());
drop policy if exists task_sections_internal on public.task_sections;
create policy task_sections_internal on public.task_sections
  for all to authenticated using (kind = 'internal' and public.is_app_member()) with check (kind = 'internal' and public.is_app_member());

-- ----------------------------------------------------------------------------
-- 添付・コメント
-- ----------------------------------------------------------------------------
create table if not exists public.task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.project_tasks (id) on delete cascade,
  path        text not null,
  file_name   text,
  mime_type   text,
  size        bigint,
  page_count  integer,
  uploaded_by uuid references public.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id, created_at);

create table if not exists public.task_comments (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.project_tasks (id) on delete cascade,
  author_id      uuid references public.users (id) on delete set null default auth.uid(),
  body           text not null default '',
  mentions       jsonb not null default '[]'::jsonb,
  attachment_ids jsonb not null default '[]'::jsonb,
  pin_task_id    uuid references public.project_tasks (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);
drop trigger if exists task_comments_set_updated_at on public.task_comments;
create trigger task_comments_set_updated_at before update on public.task_comments
  for each row execute function public.set_updated_at();

alter table public.task_attachments enable row level security;
drop policy if exists task_attachments_rw on public.task_attachments;
create policy task_attachments_rw on public.task_attachments
  for all to authenticated using (public.can_see_task(task_id)) with check (public.can_see_task(task_id));

alter table public.task_comments enable row level security;
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select to authenticated using (public.can_see_task(task_id));
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert to authenticated with check (public.can_see_task(task_id) and author_id = auth.uid());
-- 直す・消すのは書いた本人だけ
drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments
  for delete to authenticated using (author_id = auth.uid());

-- 添付のファイル（Storage）。ゲストは担当のタスクのフォルダ（tasks/<タスクid>/）だけ読み書きできる
drop policy if exists uploads_guest_task_select on storage.objects;
create policy uploads_guest_task_select on storage.objects
  for select using (bucket_id = 'uploads' and public.is_guest() and split_part(name, '/', 1) = 'tasks'
    and split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$' and public.guest_task(split_part(name, '/', 2)::uuid));
drop policy if exists uploads_guest_task_insert on storage.objects;
create policy uploads_guest_task_insert on storage.objects
  for insert with check (bucket_id = 'uploads' and public.is_guest() and split_part(name, '/', 1) = 'tasks'
    and split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$' and public.guest_task(split_part(name, '/', 2)::uuid));

-- ----------------------------------------------------------------------------
-- 受信トレイ（お知らせ）
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  kind        text not null,            -- mention / assigned / comment
  task_id     uuid references public.project_tasks (id) on delete cascade,
  comment_id  uuid references public.task_comments (id) on delete cascade,
  actor_id    uuid references public.users (id) on delete set null,
  title       text,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notifications_own_select on public.notifications;
create policy notifications_own_select on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_own_delete on public.notifications;
create policy notifications_own_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());
-- 入れるのは下のトリガーだけ（insert のポリシーは置かない）

-- コメントが付いたら: メンションされた人に「mention」、担当者に「comment」（書いた本人には送らない）
create or replace function public.notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.project_tasks%rowtype;
  uid uuid;
  mentioned uuid[] := '{}';
begin
  select * into t from public.project_tasks where id = new.task_id;
  for uid in select distinct (jsonb_array_elements_text(coalesce(new.mentions, '[]'::jsonb)))::uuid loop
    if uid is distinct from new.author_id and exists (select 1 from public.users where id = uid) then
      insert into public.notifications (user_id, kind, task_id, comment_id, actor_id, title, body)
      values (uid, 'mention', new.task_id, new.id, new.author_id, t.name, left(new.body, 300));
      mentioned := mentioned || uid;
    end if;
  end loop;
  if t.assignee_id is not null and t.assignee_id is distinct from new.author_id and not (t.assignee_id = any (mentioned)) then
    insert into public.notifications (user_id, kind, task_id, comment_id, actor_id, title, body)
    values (t.assignee_id, 'comment', new.task_id, new.id, new.author_id, t.name, left(new.body, 300));
  end if;
  return new;
end;
$$;
drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify after insert on public.task_comments
  for each row execute function public.notify_task_comment();

-- 担当者が決まった・変わったら、その人に「assigned」（自分で自分に割り当てたときは送らない）
create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid() then
    insert into public.notifications (user_id, kind, task_id, actor_id, title)
    values (new.assignee_id, 'assigned', new.id, auth.uid(), new.name);
  end if;
  return new;
end;
$$;
drop trigger if exists project_tasks_notify_assigned on public.project_tasks;
create trigger project_tasks_notify_assigned after insert or update of assignee_id on public.project_tasks
  for each row execute function public.notify_task_assigned();

-- 項目を足したことを、Supabase（PostgREST）にすぐ読み直させる
notify pgrst, 'reload schema';

-- 確認: 次の 7 行（足した表・項目）が出れば完了
select 'task_projects' as name, count(*)::text as info from information_schema.tables where table_schema = 'public' and table_name = 'task_projects'
union all select 'task_sections', count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'task_sections'
union all select 'task_comments', count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'task_comments'
union all select 'task_attachments', count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'task_attachments'
union all select 'notifications', count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'notifications'
union all select 'project_tasks.assignee_id', count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'project_tasks' and column_name = 'assignee_id'
union all select 'users.daily_hours', count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'daily_hours';
