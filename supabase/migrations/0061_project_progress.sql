-- ============================================================================
-- 0061: 案件の「フェーズ」と「状態」を「進捗」の 1 つにまとめる
--   進捗は projects.status に入れる（pending=未着手 / open=着手中 / completed=納品済 / lost=失注）
--   今の値との対応:
--     状態「未」                         → 未着手（pending のまま。フェーズが着手中・受注済でも未着手）
--     状態「進行中」（フェーズは問わない） → 着手中（open のまま）
--     状態「完了」                       → 納品済（completed のまま）
--     状態「失注」「取消」                → 失注（取消 cancelled だけ lost に書き換える）
--   フェーズ（projects.phase）は消さずに残す（画面には出さない）。
--   書き換える前の値は project_progress_backup に残す（元に戻すとき・見比べるとき用）
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

-- 書き換える前の値の控え（最初の 1 回だけ作る）
create table if not exists public.project_progress_backup (
  project_id  uuid primary key,
  phase       text,
  status      text,
  saved_at    timestamptz not null default now()
);
insert into public.project_progress_backup (project_id, phase, status)
select id, phase, status from public.projects
on conflict (project_id) do nothing;
alter table public.project_progress_backup enable row level security;
-- 控えはアプリの画面からは使わない（SQL Editor で見るだけ）。メンバーは読むだけ
drop policy if exists project_progress_backup_read on public.project_progress_backup;
create policy project_progress_backup_read on public.project_progress_backup
  for select to authenticated using (public.is_app_member());

-- 取消 → 失注
update public.projects set status = 'lost' where status = 'cancelled';

comment on column public.projects.status is '進捗: pending=未着手 / open=着手中 / completed=納品済 / lost=失注（0061 で取消を失注にまとめた。cancelled は使わない）';
comment on column public.projects.phase is '（使わない）以前のフェーズ。0061 で進捗（status）にまとめた。値は残している';

-- 確認: 進捗ごとの件数（取消が 0 件になっていること）と、控えの件数
select case status when 'pending' then '未着手' when 'open' then '着手中' when 'completed' then '納品済' when 'lost' then '失注' else status end as 進捗,
       count(*) as 件数
from public.projects group by status
union all
select '（控え）project_progress_backup', count(*) from public.project_progress_backup
order by 1;
