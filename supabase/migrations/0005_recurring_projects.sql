-- ============================================================================
-- v2 S1 追加: 定期売上の案件を毎月自動生成する
--
-- 「ひな形」（recurring_project_templates）を登録しておくと、毎月1日に
-- その月の案件（projects）が1件ずつ作られる。freee販売の「定期売上」に相当。
--
-- 生成は DB 関数 generate_recurring_projects(月) が行う。
--   * Vercel の cron が毎月1日に /api/recurring-projects を呼ぶ
--   * 画面の「今月分を生成」ボタンからも同じ関数を呼べる
-- 同じ月に2回呼んでも二重には作られない（ひな形×月で一意）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.recurring_project_templates (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid references public.clients (id) on delete set null,
  client_name        text not null,
  -- 生成される案件名。月は自動で「（2026年10月分）」のように付く
  name               text not null,
  deal_probability   text not null default 'A（定期売上）',
  phase              text not null default '受注済',
  expected_revenue   numeric not null default 0,
  expected_cost      numeric not null default 0,
  other_cost         numeric not null default 0,
  -- 生成を始める月（その月の1日）と、終える月（省略時は無期限）
  start_month        date not null default date_trunc('month', current_date)::date,
  end_month          date,
  -- false にすると生成を止める（過去に生成した案件はそのまま）
  is_active          boolean not null default true,
  notes              text,
  created_by         uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint recurring_templates_month_is_first_day
    check (start_month = date_trunc('month', start_month)::date
           and (end_month is null or end_month = date_trunc('month', end_month)::date))
);

comment on table public.recurring_project_templates is '定期売上のひな形。毎月1件ずつ projects を生成する元。';

drop trigger if exists recurring_project_templates_set_updated_at on public.recurring_project_templates;
create trigger recurring_project_templates_set_updated_at
  before update on public.recurring_project_templates
  for each row execute function public.set_updated_at();

alter table public.recurring_project_templates enable row level security;

drop policy if exists recurring_project_templates_members_all on public.recurring_project_templates;
create policy recurring_project_templates_members_all on public.recurring_project_templates
  for all to authenticated
  using (public.is_app_member()) with check (public.is_app_member());

-- 生成された案件に、どのひな形の何月分かを記録する
alter table public.projects
  add column if not exists recurring_template_id uuid
    references public.recurring_project_templates (id) on delete set null,
  add column if not exists recurring_month date;

create unique index if not exists projects_recurring_template_month_uniq
  on public.projects (recurring_template_id, recurring_month)
  where recurring_template_id is not null;

-- ----------------------------------------------------------------------------
-- 指定した月（省略時は今月）の定期案件を生成する。戻り値は作った件数。
--
-- 案件登録日 = その月の1日、完了予定日 = その月の末日、
-- 入金予定日 = 翌月末（通常の案件の既定値と同じ）。
-- ----------------------------------------------------------------------------
create or replace function public.generate_recurring_projects(p_month date default current_date)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  month_start date := date_trunc('month', p_month)::date;
  month_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  pay_due     date := (date_trunc('month', p_month) + interval '2 month - 1 day')::date;
  tpl         record;
  created     integer := 0;
begin
  -- 画面からも呼ばれるので、呼び出し元がメンバーか確認する
  -- （cron は service_role で呼ぶため auth.uid() が null になる。その場合は通す）
  if auth.uid() is not null and not public.is_app_member() then
    raise exception 'このアプリの利用者として登録されていません';
  end if;

  for tpl in
    select t.*
      from public.recurring_project_templates t
     where t.is_active
       and t.start_month <= month_start
       and (t.end_month is null or t.end_month >= month_start)
       and not exists (
         select 1 from public.projects p
          where p.recurring_template_id = t.id and p.recurring_month = month_start
       )
     order by t.created_at
  loop
    insert into public.projects (
      project_number, client_id, client_name, name, deal_probability, phase, status,
      expected_revenue, expected_cost, other_cost,
      registered_at, due_date, payment_due_date, is_recurring, notes,
      recurring_template_id, recurring_month, created_by
    ) values (
      public.next_project_number(month_start),
      tpl.client_id, tpl.client_name,
      tpl.name || '（' || to_char(month_start, 'YYYY') || '年' || extract(month from month_start)::integer || '月分）',
      tpl.deal_probability, tpl.phase, 'open',
      tpl.expected_revenue, tpl.expected_cost, tpl.other_cost,
      month_start, month_end, pay_due, true, tpl.notes,
      tpl.id, month_start, tpl.created_by
    );
    created := created + 1;
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_recurring_projects(date) to authenticated;
grant execute on function public.generate_recurring_projects(date) to service_role;
