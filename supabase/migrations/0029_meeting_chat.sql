-- ============================================================================
-- 議事録の「AI に依頼」: 議事録ごとのやり取り（依頼と AI の回答）。
-- 全メンバーが読める。書き込みはサーバー（/api/meeting-chat）だけが行い、
-- 依頼した人（author_id / author_name）を残す。
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.meeting_chat_messages (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings (id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null default '',
  attachments  jsonb not null default '[]'::jsonb,  -- [{ path, name, type, size }] Storage の uploads バケット
  draft        jsonb,                               -- 見積のたたき台 { title, notes, items: [...] }（見積の依頼のときだけ）
  sheet_url    text,                                -- たたき台をスプレッドシートに出力した先
  author_id    uuid references public.users (id) on delete set null,
  author_name  text not null default '',
  reply_to     uuid references public.meeting_chat_messages (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists meeting_chat_messages_meeting_idx on public.meeting_chat_messages (meeting_id, created_at);

drop trigger if exists meeting_chat_messages_set_updated_at on public.meeting_chat_messages;
create trigger meeting_chat_messages_set_updated_at
  before update on public.meeting_chat_messages
  for each row execute function public.set_updated_at();

alter table public.meeting_chat_messages enable row level security;
drop policy if exists meeting_chat_messages_members_read on public.meeting_chat_messages;
create policy meeting_chat_messages_members_read on public.meeting_chat_messages
  for select to authenticated using (public.is_app_member());

comment on table public.meeting_chat_messages is '議事録の「AI に依頼」のやり取り。全メンバーが閲覧でき、書き込みはサーバーのみ';
