-- ============================================================================
-- 案件の「見積の区分」（▼の見出しで案件の見積を分ける）と、補助金の案件の印
--
--   projects.estimate_sections … 区分の一覧 [{ id, name, forecast, billing }]（付けていない案件は空）
--                                 forecast: 見込みに入れる ／ billing: 納品書・請求書の元にする
--   projects.uses_subsidy      … 補助金を使う案件（案件一覧に「補助金」の印・絞り込み）
--   estimates.estimate_section … その見積の区分の id（空なら未分類）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。最後の SELECT で 3 行出れば完了。
-- ============================================================================

alter table public.projects
  add column if not exists estimate_sections jsonb,
  add column if not exists uses_subsidy boolean not null default false;

alter table public.estimates
  add column if not exists estimate_section text;

comment on column public.projects.estimate_sections is '見積の区分（▼の見出し）[{id, name, forecast, billing}]';
comment on column public.projects.uses_subsidy is '補助金を使う案件';
comment on column public.estimates.estimate_section is '見積の区分の id（projects.estimate_sections の id。空なら未分類）';

-- 項目を足したことを、Supabase（PostgREST）にすぐ読み直させる
notify pgrst, 'reload schema';

-- 確認: 次の 3 行が出れば完了
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'projects' and column_name in ('estimate_sections', 'uses_subsidy'))
    or (table_name = 'estimates' and column_name = 'estimate_section'))
order by table_name, column_name;
