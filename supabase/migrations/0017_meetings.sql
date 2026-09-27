-- ============================================================================
-- 議事録（meetings）
--
-- スマホで録音した打ち合わせの音声を取り込み、文字起こしと議事録（概要・決定事項・ToDo・
-- 保留・補足メモ）を AI で作る。仕様: docs/meeting-minutes-spec.md
--
--   meetings            1 件の打ち合わせ（音声・文字起こし・議事録・確認事項・分析指標）
--   meeting_segments    録音の断片（5 分ごとに送るため。断片ごとに文字起こしを持つ）
--   meeting_checklists  打ち合わせの種類ごとの「確認すべき項目」（システム設定で編集）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.meetings (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null default '',
  held_at              date,
  meeting_type         text not null default 'other',
  client_id            uuid references public.clients (id) on delete set null,
  client_name          text,
  project_id           uuid references public.projects (id) on delete set null,
  estimate_id          uuid references public.estimates (id) on delete set null,
  participants         jsonb not null default '[]'::jsonb,
  -- 音声（録音は断片を meeting_segments に持つ。ファイル取込は audio_path に 1 本）
  audio_path           text,
  audio_duration_sec   numeric,
  audio_size           bigint,
  source               text not null default 'record' check (source in ('record', 'upload')),
  -- recording → uploaded → transcribing → summarizing → draft → finalized（error あり）
  status               text not null default 'recording'
                         check (status in ('recording', 'uploaded', 'transcribing', 'summarizing', 'draft', 'finalized', 'error')),
  error_message        text,
  progress             jsonb not null default '{}'::jsonb,
  -- 文字起こし: [{ start, end, speaker, text }]。raw は AI が出したまま、transcript は人が直したもの
  transcript_raw       jsonb,
  transcript           jsonb,
  -- 議事録: { overview, decisions[], todos[{ owner, due, text, done }], open_items[], notes }
  summary              jsonb,
  -- 確認事項: [{ key, label, status: confirmed|unconfirmed|n_a, evidence }]
  checkpoints          jsonb,
  -- 分析指標（将来の分析用）
  analysis             jsonb,
  retention_until      date,
  audio_deleted_at     timestamptz,
  finalized_at         timestamptz,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists meetings_held_at_idx on public.meetings (held_at desc);
create index if not exists meetings_client_idx on public.meetings (client_name);
create index if not exists meetings_project_idx on public.meetings (project_id);

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

alter table public.meetings enable row level security;
drop policy if exists meetings_members_all on public.meetings;
create policy meetings_members_all on public.meetings
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- ---------------------------------------------------------------------------
create table if not exists public.meeting_segments (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references public.meetings (id) on delete cascade,
  seq            integer not null,
  storage_path   text not null,
  mime_type      text,
  duration_sec   numeric,
  size           bigint,
  -- この断片の文字起こし（開始時刻は断片内の秒。結合時に offset を足す）
  transcript     jsonb,
  transcribed_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (meeting_id, seq)
);

alter table public.meeting_segments enable row level security;
drop policy if exists meeting_segments_members_all on public.meeting_segments;
create policy meeting_segments_members_all on public.meeting_segments
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- ---------------------------------------------------------------------------
create table if not exists public.meeting_checklists (
  id            uuid primary key default gen_random_uuid(),
  meeting_type  text not null,
  key           text not null,
  label         text not null,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (meeting_type, key)
);

drop trigger if exists meeting_checklists_set_updated_at on public.meeting_checklists;
create trigger meeting_checklists_set_updated_at
  before update on public.meeting_checklists
  for each row execute function public.set_updated_at();

alter table public.meeting_checklists enable row level security;
drop policy if exists meeting_checklists_members_all on public.meeting_checklists;
create policy meeting_checklists_members_all on public.meeting_checklists
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 初期値（仕様確認向け。システム設定で増減できる）
insert into public.meeting_checklists (meeting_type, key, label, sort_order) values
  ('spec',   'quantity',   '部数・数量', 10),
  ('spec',   'size',       'サイズ', 20),
  ('spec',   'paper',      '用紙・素材', 30),
  ('spec',   'colors',     '色数', 40),
  ('spec',   'finishing',  '加工・オプション', 50),
  ('spec',   'delivery',   '納期', 60),
  ('spec',   'budget',     '予算', 70),
  ('spec',   'submission', '入稿方法・入稿期限', 80),
  ('spec',   'proofs',     '校正回数', 90),
  ('spec',   'ship_to',    '納品先', 100),
  ('first',  'purpose',    '目的・課題', 10),
  ('first',  'target',     'ターゲット・配布先', 20),
  ('first',  'budget',     '予算感', 30),
  ('first',  'schedule',   '希望時期', 40),
  ('first',  'decision',   '決裁者・決め方', 50),
  ('proof',  'fixes',      '修正箇所', 10),
  ('proof',  'final_ok',   '校了の合意', 20),
  ('proof',  'ship_to',    '納品先・納品方法', 30),
  ('proof',  'invoice',    '請求・入金予定', 40),
  ('regular','progress',   '前回からの進捗', 10),
  ('regular','next',       '次回までの宿題', 20)
on conflict (meeting_type, key) do nothing;

-- 打ち合わせの種類と音声の保存期間（システム設定）
insert into public.system_settings (setting_key, setting_value, description) values
  ('meeting_types', '[{"key":"first","label":"初回ヒアリング"},{"key":"spec","label":"仕様確認"},{"key":"proof","label":"校正・納品"},{"key":"regular","label":"定例"},{"key":"other","label":"その他"}]', '議事録: 打ち合わせの種類'),
  ('meeting_audio_retention_days', '30', '議事録: 音声の保存日数（過ぎたら音声だけ削除）')
on conflict (setting_key) do nothing;

-- 音声ファイルの取り込み（ボイスメモなど）は 25MB を超えるので上限を 200MB に
update storage.buckets set file_size_limit = 209715200 where id = 'uploads';
