-- ============================================================================
-- 社外のアドレスの特別招待（管理者のみ）
--
--   これまで: @concept-village.co.jp 以外のアカウントは、初回ログイン時に必ず弾いていた。
--   これから: 管理者が「社外のアドレスとして特別に招待」したアドレスだけは、社外のドメインでも利用者として登録する。
--             招待されていない社外のアカウントは、これまでどおり弾く。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.invitations
  add column if not exists external boolean not null default false;

comment on column public.invitations.external is '社外のアドレスとして管理者が特別に招待した（社外のドメインでもログインを許す）';

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
  -- 社外のドメインは、管理者が特別に招待したアドレスだけ通す
  if split_part(new.email, '@', 2) <> allowed_domain
     and not exists (select 1 from public.invitations i where lower(i.email) = lower(new.email) and i.external) then
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
