-- ============================================================================
-- 0064: AI チャット（Claude）
--   ・チャット（ai_chats）… 作った人のもの。メンバーに招待した人だけが見られる
--   ・メンバー（ai_chat_members）… owner（作った人）／editor（共同編集：質問も下書きの直しもできる。招待した人はみなこれ）
--   ・メッセージ（ai_chat_messages）… 人の質問と Claude の回答。回答はサーバー（service role）が書く
--   ・下書き（ai_chats.draft_text）… チャットの横の「下書き」欄。owner・editor が一緒に直せる
--   CVアプリの情報（案件・見積など）は、回答を作るときに「質問した人の権限」で読む（サーバー側）。
--   添付ファイルは Storage の uploads/ai-chats/<チャットID>/…（読み書きの権限は既存の uploads のまま）
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create table if not exists public.ai_chats (
  id               uuid primary key default gen_random_uuid(),
  title            text not null default '新しいチャット',
  owner_id         uuid not null default auth.uid() references public.users (id) on delete cascade,
  draft_text       text not null default '',
  draft_version    integer not null default 0,
  draft_updated_by text,
  draft_updated_at timestamptz,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ai_chats_owner_idx on public.ai_chats (owner_id, last_message_at desc);

create table if not exists public.ai_chat_members (
  chat_id    uuid not null references public.ai_chats (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner', 'editor')),
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists ai_chat_members_user_idx on public.ai_chat_members (user_id);

create table if not exists public.ai_chat_messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.ai_chats (id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  author_id    uuid references public.users (id) on delete set null,
  author_name  text not null default '',
  content      text not null default '',
  attachments  jsonb not null default '[]'::jsonb,  -- [{ path, name, type, size }]
  status       text not null default 'done' check (status in ('pending', 'done', 'error')),
  used_data    jsonb not null default '[]'::jsonb,  -- 回答に使った CVアプリの情報（[{ label }]）
  usage        jsonb,                                -- トークン数（回答だけ）
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ai_chat_messages_chat_idx on public.ai_chat_messages (chat_id, created_at);

drop trigger if exists ai_chats_set_updated_at on public.ai_chats;
create trigger ai_chats_set_updated_at before update on public.ai_chats for each row execute function public.set_updated_at();
drop trigger if exists ai_chat_messages_set_updated_at on public.ai_chat_messages;
create trigger ai_chat_messages_set_updated_at before update on public.ai_chat_messages for each row execute function public.set_updated_at();

-- 作ったら、作った人を owner のメンバーにする
create or replace function public.ai_chat_add_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_chat_members (chat_id, user_id, role, added_by)
  values (new.id, new.owner_id, 'owner', new.owner_id)
  on conflict (chat_id, user_id) do update set role = 'owner';
  return new;
end;
$$;
drop trigger if exists ai_chats_add_owner on public.ai_chats;
create trigger ai_chats_add_owner after insert on public.ai_chats for each row execute function public.ai_chat_add_owner();

-- 権限（メンバーか・書き込めるか・owner か）
create or replace function public.ai_chat_role(p_chat uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.ai_chat_members where chat_id = p_chat and user_id = auth.uid();
$$;
create or replace function public.can_read_ai_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_member() and public.ai_chat_role(p_chat) is not null;
$$;
create or replace function public.can_write_ai_chat(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_member() and coalesce(public.ai_chat_role(p_chat) in ('owner', 'editor'), false);
$$;
create or replace function public.is_ai_chat_owner(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_member() and coalesce(public.ai_chat_role(p_chat) = 'owner', false);
$$;

alter table public.ai_chats enable row level security;
alter table public.ai_chat_members enable row level security;
alter table public.ai_chat_messages enable row level security;

-- チャット: メンバーが読む。作るのは本人。タイトル・下書きを直すのは owner・editor。消すのは owner
drop policy if exists ai_chats_select on public.ai_chats;
create policy ai_chats_select on public.ai_chats for select to authenticated using (public.can_read_ai_chat(id) or owner_id = auth.uid());
drop policy if exists ai_chats_insert on public.ai_chats;
create policy ai_chats_insert on public.ai_chats for insert to authenticated with check (public.is_app_member() and owner_id = auth.uid());
drop policy if exists ai_chats_update on public.ai_chats;
create policy ai_chats_update on public.ai_chats for update to authenticated using (public.can_write_ai_chat(id)) with check (public.can_write_ai_chat(id));
drop policy if exists ai_chats_delete on public.ai_chats;
create policy ai_chats_delete on public.ai_chats for delete to authenticated using (public.is_ai_chat_owner(id));

-- メンバー: メンバーが読む。招待・外すのは owner（自分で抜けるのは本人）
drop policy if exists ai_chat_members_select on public.ai_chat_members;
create policy ai_chat_members_select on public.ai_chat_members for select to authenticated using (public.can_read_ai_chat(chat_id));
drop policy if exists ai_chat_members_insert on public.ai_chat_members;
create policy ai_chat_members_insert on public.ai_chat_members for insert to authenticated with check (public.is_ai_chat_owner(chat_id) and role = 'editor');
-- 権限を変える操作はない（招待した人はみな共同編集）
drop policy if exists ai_chat_members_update on public.ai_chat_members;
drop policy if exists ai_chat_members_delete on public.ai_chat_members;
create policy ai_chat_members_delete on public.ai_chat_members for delete to authenticated using (role <> 'owner' and (public.is_ai_chat_owner(chat_id) or user_id = auth.uid()));

-- メッセージ: メンバーが読む。画面から書けるのは自分の質問だけ（回答はサーバーが書く）
drop policy if exists ai_chat_messages_select on public.ai_chat_messages;
create policy ai_chat_messages_select on public.ai_chat_messages for select to authenticated using (public.can_read_ai_chat(chat_id));
drop policy if exists ai_chat_messages_insert on public.ai_chat_messages;
create policy ai_chat_messages_insert on public.ai_chat_messages for insert to authenticated
  with check (public.can_write_ai_chat(chat_id) and role = 'user' and author_id = auth.uid());

comment on table public.ai_chats is 'AI チャット（Claude）。メンバーだけが見られる。draft_text は共同で直す下書き';
comment on table public.ai_chat_members is 'AI チャットのメンバー（owner＝作った人 / editor＝共同編集）';
comment on table public.ai_chat_messages is 'AI チャットのメッセージ（人の質問と Claude の回答。回答はサーバーが書く）';

-- 確認: 3 つの表と、読み書きの決まり（ポリシー）ができたか
select tablename as 表, count(*) as 決まりの数
from pg_policies where schemaname = 'public' and tablename in ('ai_chats', 'ai_chat_members', 'ai_chat_messages')
group by 1 order by 1;
