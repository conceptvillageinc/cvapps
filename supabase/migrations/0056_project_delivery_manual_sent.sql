-- ============================================================================
-- 0056: 案件の「納品・請求」を手で「請求書送付済（sent）」にできるようにする
--   projects.delivery_state_manual に使える値へ 'sent' を足す（0053 の続き）。
--   「請求書送付済」は請求書の状態からは自動で決めず、案件一覧の「納品・請求」で手で選ぶ。
--
-- 冪等。Supabase の SQL Editor に貼り付けて実行する。最後の SELECT で 1 行出れば完了。
-- ============================================================================

alter table public.projects drop constraint if exists projects_delivery_state_manual_check;
alter table public.projects add constraint projects_delivery_state_manual_check
  check (delivery_state_manual is null or delivery_state_manual in ('none', 'uninvoiced', 'invoiced', 'sent', 'na'));

notify pgrst, 'reload schema';

-- 確認: 'sent' を含む制約が 1 行出れば完了
select conname as name, pg_get_constraintdef(oid) as info
from pg_constraint
where conname = 'projects_delivery_state_manual_check' and pg_get_constraintdef(oid) like '%sent%';
