-- ============================================================================
-- 0065: 議事録の録音を、録音していないタブ・端末から止める合図（stop_requested_at）
--   議事録の画面の「録音を止める」で、いまの時刻を入れる。
--   録音しているタブは 1 分ごとの「録音中の合図」のときにこの値を見て、録音を始めたあとの合図なら録音を終える。
--   （同じブラウザの別タブには、データベースを通さずすぐに伝える）
--   何度実行しても大丈夫（列が既にあれば何もしない）。
-- ============================================================================

alter table public.meetings
  add column if not exists stop_requested_at timestamptz;

comment on column public.meetings.stop_requested_at is '録音を止める合図（議事録の画面の「録音を止める」で入る。録音中のタブが見て録音を終える）';

-- 確認: 列ができたか
select column_name as 列, data_type as 型
from information_schema.columns
where table_schema = 'public' and table_name = 'meetings' and column_name in ('recording_heartbeat_at', 'stop_requested_at')
order by column_name;
