-- ============================================================================
-- 0035: 工程表（タスクの土台）
--   project_tasks（工程）に、タスクとして使う項目を足す:
--     category（制作物・タスクカテゴリ）、phase（工程: 初稿・確認・校了・入稿…）、
--     parties（担当の区分: CV・クライアント・その他。複数可）、member_ids（担当の CV メンバー）、
--     show_members（クライアント向けにメンバー名も出す）、completed（未完了／完了）、
--     is_milestone（節目 ◆）、on_schedule（クライアント向け工程表に出す）、
--     estimated_hours / actual_hours（見込み時間・実績時間）、depends_on（前の工程の id の配列）
--   users.avatar_url: メンバーの顔写真（工程表のアイコン）
--   projects.schedule_settings: 工程表のタイトル・担当の区分（色）・大事な日（納品期限・使用日など）
--   schedule_shares: クライアント向け共有リンク（推測できない URL。パスワード・期限は任意）
--     リンクの中身はサーバー（/api/schedule-share）が service_role で読み、工程表に出す工程だけを返す
--   工程表テンプレートは 0036（このあとに実行）
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

alter table public.project_tasks add column if not exists category       text;
alter table public.project_tasks add column if not exists phase          text;
alter table public.project_tasks add column if not exists parties        jsonb not null default '[]'::jsonb;
alter table public.project_tasks add column if not exists member_ids     jsonb not null default '[]'::jsonb;
alter table public.project_tasks add column if not exists show_members   boolean not null default false;
alter table public.project_tasks add column if not exists completed      boolean not null default false;
alter table public.project_tasks add column if not exists completed_at   timestamptz;
alter table public.project_tasks add column if not exists is_milestone   boolean not null default false;
alter table public.project_tasks add column if not exists on_schedule    boolean not null default true;
alter table public.project_tasks add column if not exists estimated_hours numeric;
alter table public.project_tasks add column if not exists actual_hours   numeric;
alter table public.project_tasks add column if not exists depends_on     jsonb not null default '[]'::jsonb;

-- これまでの「状態」を未完了／完了に寄せる（完了だけ完了。未着手・進行中・保留は未完了）
update public.project_tasks set completed = true, completed_at = coalesce(completed_at, updated_at)
  where status = 'done' and completed = false;
-- これまでの「担当」（CV / クライアント / 外注）を担当の区分にする
update public.project_tasks set parties = case
    when owner ilike '%クライアント%' then '["client"]'::jsonb
    when owner ilike '%外注%' then '["other:外注"]'::jsonb
    when owner ilike '%CV%' then '["cv"]'::jsonb
    else parties end
  where parties = '[]'::jsonb and owner is not null and owner <> '';

-- メンバーの顔写真（工程表のアイコンに使う。小さく縮めた画像を data URL で持つ）
alter table public.users add column if not exists avatar_url text;
alter table public.users drop constraint if exists users_avatar_url_size;
alter table public.users add constraint users_avatar_url_size check (avatar_url is null or (length(avatar_url) < 200000 and avatar_url like 'data:image/%'));

alter table public.projects add column if not exists schedule_settings jsonb not null default '{}'::jsonb;

create table if not exists public.schedule_shares (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null unique references public.projects (id) on delete cascade,
  token          text not null unique,
  enabled        boolean not null default true,
  password_hash  text,           -- scrypt（salt:hash）。空ならパスワードなし
  expires_at     date,           -- この日まで見られる。空なら期限なし
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists schedule_shares_set_updated_at on public.schedule_shares;
create trigger schedule_shares_set_updated_at before update on public.schedule_shares
  for each row execute function public.set_updated_at();

alter table public.schedule_shares enable row level security;
drop policy if exists schedule_shares_members_all on public.schedule_shares;
create policy schedule_shares_members_all on public.schedule_shares
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

comment on table public.schedule_shares is 'クライアント向け工程表の共有リンク（ログイン不要・閲覧専用）';

notify pgrst, 'reload schema';
