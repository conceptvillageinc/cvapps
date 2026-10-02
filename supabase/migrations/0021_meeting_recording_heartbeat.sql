-- ============================================================================
-- 0021: 議事録の録音中の合図（recording_heartbeat_at）
--   録音中の端末が 1 分ごとに更新する。5 分以上更新が無いものは「録音中」と見なさない。
--   議事録一覧・新規議事録の「レコーディング中」の帯と、録音前の確認に使う。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

alter table public.meetings
  add column if not exists recording_heartbeat_at timestamptz;

create index if not exists meetings_recording_live_idx
  on public.meetings (status, recording_heartbeat_at);

comment on column public.meetings.recording_heartbeat_at is
  '録音中の端末が 1 分ごとに更新する合図。録音を終えると null';
