-- ============================================================================
-- v2 S1: 案件（projects）
--
-- 見積・納品書・請求書の親になる単位。freee販売の「案件」に相当する。
-- 受注確度・フェーズは見積ではなく案件の属性にする（freee販売と同じ位置）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- clients: 請求書の送付方法・定期売上の有無
-- freee側では顧客名に【freee送付】【定期あり／freee送付】等のタグを付けて
-- 運用していた。取込時にタグを剥がし、ここへ移す。
-- ----------------------------------------------------------------------------
alter table public.clients
  add column if not exists invoice_delivery_method text
    check (invoice_delivery_method in ('freee', 'post', 'email', 'hand')),
  add column if not exists invoice_delivery_notes  text,
  add column if not exists has_recurring_billing   boolean not null default false;

comment on column public.clients.invoice_delivery_method is '請求書の送付方法: freee=freeeから送付 / post=郵送 / email=個別メール / hand=持参';
comment on column public.clients.invoice_delivery_notes  is '送付に関する補足（宛先の指定、要確認 など）';
comment on column public.clients.has_recurring_billing   is '定期売上（毎月の請求）がある顧客';

-- ----------------------------------------------------------------------------
-- projects
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id                     uuid primary key default gen_random_uuid(),

  -- 採番: P-YYMM-連番（next_project_number）
  project_number         text not null unique,

  client_id              uuid references public.clients (id) on delete set null,
  -- クライアントが削除・改名されても案件の表示が崩れないよう名前も持つ
  client_name            text not null,
  name                   text not null,

  -- 選択肢は system_settings（deal_probability_options / phase_options）で管理
  deal_probability       text not null default 'A',
  phase                  text not null default '引き合い',
  -- open=進行中 / completed=完了 / lost=失注 / cancelled=取り消し
  status                 text not null default 'open'
                           check (status in ('open', 'completed', 'lost', 'cancelled')),

  -- 見込（税抜）。粗利見込 = 受注見込 - 発注見込 - その他費用（freee販売と同じ式）
  expected_revenue       numeric not null default 0,
  expected_cost          numeric not null default 0,
  other_cost             numeric not null default 0,
  expected_gross_profit  numeric generated always as
                           (expected_revenue - expected_cost - other_cost) stored,

  -- 実績（税抜）。S3 以降は納品書・請求書から集計するが、
  -- 取込データや手入力のためにも列として持つ。
  confirmed_revenue      numeric not null default 0,
  confirmed_cost         numeric not null default 0,
  actual_gross_profit    numeric generated always as
                           (confirmed_revenue - confirmed_cost) stored,

  registered_at          date not null default current_date,
  -- 完了予定日（納品予定）
  due_date               date,
  -- 入金予定日。初期値は完了予定日の翌月末（画面側で設定）
  payment_due_date       date,
  -- 仕入先への支払予定日
  vendor_payment_date    date,

  -- 定期売上（毎月発生する案件）
  is_recurring           boolean not null default false,
  notes                  text,

  created_by             uuid references public.users (id) on delete set null,
  -- freee販売からの取込元を識別するキー（重複取込の防止）
  legacy_id              text unique,
  -- 取込元の行をそのまま保持する（列に落とさなかった項目の参照用）
  legacy_data            jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.projects is '案件。見積・納品書・請求書の親。freee販売の「案件」に相当。';

create index if not exists projects_registered_at_idx on public.projects (registered_at desc);
create index if not exists projects_client_id_idx     on public.projects (client_id);
create index if not exists projects_client_name_idx   on public.projects (client_name);
create index if not exists projects_status_idx        on public.projects (status);
create index if not exists projects_due_date_idx      on public.projects (due_date);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

drop policy if exists projects_members_all on public.projects;
create policy projects_members_all on public.projects
  for all to authenticated
  using (public.is_app_member()) with check (public.is_app_member());

-- ----------------------------------------------------------------------------
-- 採番: P-YYMM-連番。月ごとに 001 から。
-- 取込（過去日付）でも画面（今日）でも同じ関数を使う。
-- 画面からは supabase.rpc('next_project_number') で呼ぶ。
-- ----------------------------------------------------------------------------
create or replace function public.next_project_number(p_date date default current_date)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  prefix text := 'P-' || to_char(p_date, 'YYMM') || '-';
  max_seq integer;
begin
  select coalesce(max((substring(project_number from length(prefix) + 1 for 3))::integer), 0)
    into max_seq
    from public.projects
   where project_number like prefix || '___'
     and substring(project_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  return prefix || lpad((max_seq + 1)::text, 3, '0');
end;
$$;

grant execute on function public.next_project_number(date) to authenticated;

-- ----------------------------------------------------------------------------
-- estimates: 案件への紐付け
-- ----------------------------------------------------------------------------
alter table public.estimates
  add column if not exists project_id uuid references public.projects (id) on delete set null;

create index if not exists estimates_project_id_idx on public.estimates (project_id);

-- ----------------------------------------------------------------------------
-- 既存の見積から案件を起こす（project_group_id ごとに1件）。
-- 案件番号は最初の見積番号の CV- を P- に置き換える（CV-2607-001 → P-2607-001）。
-- 受注確度・フェーズは最新の見積の値を引き継ぐ。
-- ----------------------------------------------------------------------------
insert into public.projects (
  project_number, client_name, name, deal_probability, phase,
  expected_revenue, registered_at, due_date, created_by, client_id
)
select
  case when g.project_group_id ~ '^CV-[0-9]{4}-[0-9]{3}$'
       then 'P-' || substring(g.project_group_id from 4)
       else public.next_project_number(g.first_date) end,
  g.client_name,
  coalesce(nullif(g.estimate_title, ''), g.client_name || 'の案件'),
  case when g.deal_probability in ('A', 'C', 'A（定期売上）', '要注意（A）')
       then g.deal_probability else 'A' end,
  case when g.phase in ('引き合い', '着手中', '未着手', '受注済')
       then g.phase else '引き合い' end,
  coalesce(g.total_amount, 0),
  g.first_date,
  g.desired_delivery_date,
  g.created_by,
  (select c.id from public.clients c where c.name = g.client_name order by c.created_at limit 1)
from (
  select distinct on (e.project_group_id)
    e.project_group_id, e.client_name, e.estimate_title, e.deal_probability, e.phase,
    e.total_amount, e.desired_delivery_date, e.created_by,
    min(e.created_at::date) over (partition by e.project_group_id) as first_date
  from public.estimates e
  where e.project_group_id is not null and e.project_id is null
  order by e.project_group_id, e.created_at desc
) g
where not exists (
  select 1 from public.projects p
   where p.project_number = case when g.project_group_id ~ '^CV-[0-9]{4}-[0-9]{3}$'
                                 then 'P-' || substring(g.project_group_id from 4) end
);

update public.estimates e
   set project_id = p.id
  from public.projects p
 where e.project_id is null
   and e.project_group_id ~ '^CV-[0-9]{4}-[0-9]{3}$'
   and p.project_number = 'P-' || substring(e.project_group_id from 4);

-- ----------------------------------------------------------------------------
-- 選択肢を freee販売に合わせる
-- ----------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description)
values
  ('deal_probability_options', '["A","C","A（定期売上）","要注意（A）"]', '受注確度の選択肢'),
  ('phase_options',            '["引き合い","着手中","未着手","受注済"]',   'フェーズの選択肢'),
  ('fiscal_year_start_month',  '10',                                      '期首の月（10 = 10月始まり）')
on conflict (setting_key) do update
  set setting_value = excluded.setting_value,
      description   = coalesce(public.system_settings.description, excluded.description);
