-- ============================================================================
-- Phase 4-B: 招待制にする
--
-- これまでは @concept-village.co.jp のGoogleアカウントであれば、URLを開いて
-- ログインするだけで利用者登録されていた。管理者が招待した人だけが使える形にする。
--
-- 招待は「まだログインしていない人」に対して出すため、auth.users の id では
-- なくメールアドレスで持つ。初回ログイン時にトリガーが照合して利用者を作る。
-- ============================================================================

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  role         text not null default 'user' check (role in ('admin', 'user')),
  invited_by   uuid references public.users (id) on delete set null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists invitations_email_idx on public.invitations (lower(email));

alter table public.invitations enable row level security;

-- ----------------------------------------------------------------------------
-- 管理者判定。RLS の中から users を読むため security definer にする。
-- ----------------------------------------------------------------------------
create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- 参照はメンバー全員、作成・削除は管理者のみ。
-- 実際の招待作成はサーバー側（/api/invite）が service_role で行うが、
-- 画面から直接触られた場合にも効くようにポリシーを張っておく。
drop policy if exists invitations_members_select on public.invitations;
drop policy if exists invitations_admin_write on public.invitations;

create policy invitations_members_select on public.invitations
  for select using (public.is_app_member());

create policy invitations_admin_write on public.invitations
  for all using (public.is_app_admin()) with check (public.is_app_admin());

-- ----------------------------------------------------------------------------
-- 初回ログイン時の利用者作成。
--
-- 変更点: 招待されている人だけを利用者として登録する。
-- 招待が無い場合は public.users を作らずに終わる。認証自体は通るが、
-- アプリ側は「利用者として登録されていません」の画面を出す。
--
-- ここで例外を投げてサインアップごと失敗させる手もあるが、その場合
-- Googleの汎用エラー画面に飛ばされ、本人には理由が分からない。
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_domain constant text := 'concept-village.co.jp';
  invite         public.invitations%rowtype;
  member_count   integer;
begin
  if split_part(new.email, '@', 2) <> allowed_domain then
    raise exception '% は許可されていないドメインです（% のアカウントでログインしてください）',
      new.email, allowed_domain;
  end if;

  select * into invite
  from public.invitations
  where lower(email) = lower(new.email) and accepted_at is null
  limit 1;

  if found then
    insert into public.users (id, email, full_name, role)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      invite.role
    )
    on conflict (id) do nothing;

    update public.invitations set accepted_at = now() where id = invite.id;
    return new;
  end if;

  -- 利用者が1人もいない状態（初期構築時や、全員消えてしまった場合）の救済。
  -- これが無いと招待できる人が誰もいなくなり、アプリに入れなくなる。
  select count(*) into member_count from public.users;
  if member_count = 0 then
    insert into public.users (id, email, full_name, role)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      'admin'
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 新規の利用者は既定を「メンバー」にする。
-- 移行時は Base44 に合わせて全員 admin にしていたが、招待制にするなら
-- 権限は招待時に選ぶのが筋。既存の行の権限は変えない。
-- ----------------------------------------------------------------------------
alter table public.users alter column role set default 'user';
