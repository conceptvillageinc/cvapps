-- ============================================================================
-- 0057: 納品書の「請求書作成」を一覧から手で「処理済」にできるようにする
--   delivery_notes.invoiced_manual … true なら、請求書とつながっていなくても「処理済」として扱う
--     （freee販売で請求した分・請求の要らない分など）。請求書とつながっている納品書は、これまでどおり自動で「処理済」。
--
-- 冪等。Supabase の SQL Editor に貼り付けて実行する。最後の SELECT で 1 行出れば完了。
-- ============================================================================

alter table public.delivery_notes
  add column if not exists invoiced_manual boolean not null default false;

comment on column public.delivery_notes.invoiced_manual is '請求書作成を手で「処理済」にした（請求書とつながっていなくても処理済として扱う）';

notify pgrst, 'reload schema';

-- 確認: invoiced_manual の行が 1 行出れば完了
select column_name as name, data_type as info
from information_schema.columns
where table_schema = 'public' and table_name = 'delivery_notes' and column_name = 'invoiced_manual';
