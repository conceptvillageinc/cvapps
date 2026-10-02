-- ============================================================================
-- 0024: 資金繰り表（CV の口座のキャッシュフロー）
--   cash_plan_items: 定期支払（給与・家賃・借入返済など）と一時的な予定（税金・賞与・融資の入金）
--   画面は許可したアドレス（システム設定 cashflow_allowed_emails）だけに出す。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create table if not exists public.cash_plan_items (
  id            uuid primary key default gen_random_uuid(),
  -- recurring（毎月）/ oneoff（1 回）
  kind          text not null check (kind in ('recurring', 'oneoff')),
  name          text not null,
  -- 人件費 / 経費 / 借入返済 / 税金 / その他支出 / 借入入金 / その他収入
  category      text not null,
  -- in（入金）/ out（支払）
  direction     text not null check (direction in ('in', 'out')),
  amount        numeric not null default 0,
  -- recurring: 毎月の支払日（1〜31。月末は 31）、開始月・終了月（'2026-10'。終了は空で無期限）
  day_of_month  integer,
  start_month   text,
  end_month     text,
  -- oneoff: 日付
  on_date       date,
  memo          text,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists cash_plan_items_set_updated_at on public.cash_plan_items;
create trigger cash_plan_items_set_updated_at before update on public.cash_plan_items
  for each row execute function public.set_updated_at();

alter table public.cash_plan_items enable row level security;
drop policy if exists cash_plan_items_members_all on public.cash_plan_items;
create policy cash_plan_items_members_all on public.cash_plan_items
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

comment on table public.cash_plan_items is '資金繰り表の定期支払・一時的な予定';
