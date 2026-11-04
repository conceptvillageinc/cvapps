-- ============================================================================
-- 0055: 校了フォーム（クライアントがログインなしで最終デザインを確認・回答する）
--
--   proof_forms           … フォーム 1 つ。案件・見積・対象の項目（見積の明細の写し）と、
--                            タイトル・説明・質問・送信後のメッセージを持つ。URL は推測できない token（/f/<token>）
--   proof_form_responses  … 回答。answers に質問ごとの答え、result に「校了（approved）／修正希望（revise）」
--   notifications.link    … 受信トレイのお知らせの行き先（校了フォームの回答など、タスク以外のお知らせ用）
--
--   社内の画面からは CV のメンバーだけが読み書きできる（RLS）。
--   クライアントのフォーム（ログインなし）は、サーバー（/api/proof-form）が service_role で読み書きし、
--   受付中のフォームの表示に要る項目だけを返す。
--
-- 冪等。Supabase の SQL Editor に貼り付けて実行する。最後の SELECT で 3 行出れば完了。
-- ============================================================================

create table if not exists public.proof_forms (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique,
  project_id      uuid references public.projects (id) on delete set null,
  estimate_id     uuid references public.estimates (id) on delete set null,
  client_name     text,
  project_name    text,
  estimate_number text,
  items           jsonb not null default '[]'::jsonb,   -- 対象の項目 [{ id, name, quantity, unit }]
  title           text not null,
  description     text,
  questions       jsonb not null default '[]'::jsonb,   -- [{ id, type: text|paragraph|checkbox|radio, label, required, options, help }]
  confirm_message text,
  enabled         boolean not null default true,        -- 受付中（止めると URL を開いても回答できない）
  created_by      uuid references public.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists proof_forms_project_idx on public.proof_forms (project_id);
drop trigger if exists proof_forms_set_updated_at on public.proof_forms;
create trigger proof_forms_set_updated_at before update on public.proof_forms
  for each row execute function public.set_updated_at();

create table if not exists public.proof_form_responses (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid not null references public.proof_forms (id) on delete cascade,
  answers      jsonb not null default '{}'::jsonb,
  result       text check (result is null or result in ('approved', 'revise')),
  company_name text,
  person_name  text,
  user_agent   text,
  submitted_at timestamptz not null default now()
);
create index if not exists proof_form_responses_form_idx on public.proof_form_responses (form_id, submitted_at desc);

alter table public.proof_forms enable row level security;
drop policy if exists proof_forms_members_all on public.proof_forms;
create policy proof_forms_members_all on public.proof_forms
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

alter table public.proof_form_responses enable row level security;
drop policy if exists proof_form_responses_members_all on public.proof_form_responses;
create policy proof_form_responses_members_all on public.proof_form_responses
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 受信トレイ: タスク以外のお知らせの行き先
alter table public.notifications add column if not exists link text;

-- 項目を足したことを、Supabase（PostgREST）にすぐ読み直させる
notify pgrst, 'reload schema';

-- 確認: 次の 3 行が出れば完了
select 'proof_forms' as name, count(*)::text as info from information_schema.tables where table_schema = 'public' and table_name = 'proof_forms'
union all select 'proof_form_responses', count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'proof_form_responses'
union all select 'notifications.link', count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'link';
