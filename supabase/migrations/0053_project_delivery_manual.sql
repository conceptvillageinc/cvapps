-- ============================================================================
-- 案件の「納品・請求」を、案件一覧から手で決められるようにする
--
--   projects.delivery_state_manual … 空（null）なら、これまでどおり納品書・請求書から自動で決める。
--     none       = 未納品
--     uninvoiced = 納品済・未請求
--     invoiced   = 請求済（freee販売で請求した案件など）
--     na         = 対象外（納品書・請求書の要らない案件。月末チェックに出さない）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。最後の SELECT で 1 行出れば完了。
-- ============================================================================

alter table public.projects
  add column if not exists delivery_state_manual text;

alter table public.projects drop constraint if exists projects_delivery_state_manual_check;
alter table public.projects add constraint projects_delivery_state_manual_check
  check (delivery_state_manual is null or delivery_state_manual in ('none', 'uninvoiced', 'invoiced', 'na'));

comment on column public.projects.delivery_state_manual is '納品・請求の状態を手で決めたとき（空なら納品書・請求書から自動）';

-- 項目を足したことを、Supabase（PostgREST）にすぐ読み直させる
notify pgrst, 'reload schema';

-- 確認: delivery_state_manual の行が 1 行出れば完了
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'projects' and column_name = 'delivery_state_manual';
