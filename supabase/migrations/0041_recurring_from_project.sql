-- ============================================================================
-- 定期売上を「案件・見積から」登録する
--
--   * 案件（または見積）の画面で「定期売上にする」を押すと、その案件をそのまま定期売上の案件にする
--     （ひな形 recurring_project_templates.project_id にその案件を入れる。新しい案件は作らない）
--   * 毎月の納品書の明細は、元にした見積の明細（チェックしたもの）から作る
--     （source_estimate_id・source_line_ids に、どの見積のどの明細から入れたかを残す）
--   * 案件名・クライアントは案件の方を正にする（ひな形を直しても、案件名は上書きしない）
--   * 案件に紐づかないひな形（これまでの「定期売上の設定」から登録したもの）は、今までどおり案件を作る
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.recurring_project_templates
  add column if not exists project_id uuid references public.projects (id) on delete set null,
  add column if not exists source_estimate_id uuid references public.estimates (id) on delete set null,
  add column if not exists source_line_ids jsonb not null default '[]'::jsonb,
  add column if not exists lines_applied_at timestamptz;

comment on column public.recurring_project_templates.project_id is '定期売上にした案件（案件・見積の画面から登録したとき）';
comment on column public.recurring_project_templates.source_estimate_id is '毎月の納品書の明細を入れた見積';

-- ----------------------------------------------------------------------------
-- ひな形の定期売上の案件を作る・ひな形の内容に合わせる。案件の id を返す（0039 の版を置きかえ）
-- ----------------------------------------------------------------------------
create or replace function public.sync_recurring_project(p_template_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t   record;
  pid uuid;
begin
  select * into t from public.recurring_project_templates where id = p_template_id;
  if not found then return null; end if;

  select id into pid from public.projects
   where recurring_template_id = t.id and recurring_month is null limit 1;

  -- 案件の画面から定期売上にしたときは、その案件を定期売上の案件にする
  if pid is null and t.project_id is not null then
    update public.projects set recurring_template_id = t.id, recurring_month = null
     where id = t.project_id and (recurring_template_id is null or recurring_template_id = t.id)
    returning id into pid;
  end if;

  if pid is null then
    insert into public.projects (
      project_number, client_id, client_name, name, deal_probability, phase, status,
      expected_revenue, expected_cost, other_cost,
      registered_at, due_date, payment_due_date, is_recurring, notes,
      recurring_template_id, recurring_month, recurring_start_month, recurring_end_month, created_by
    ) values (
      public.next_project_number(t.start_month),
      t.client_id, t.client_name, t.name, t.deal_probability, t.phase, 'open',
      t.expected_revenue, t.expected_cost, t.other_cost,
      t.start_month, (t.end_month + interval '1 month - 1 day')::date, null, true, t.notes,
      t.id, null, t.start_month, t.end_month, t.created_by
    ) returning id into pid;
    update public.recurring_project_templates set project_id = pid where id = t.id and project_id is distinct from pid;
  else
    update public.projects set
      -- 案件名・クライアントは、案件から登録したひな形では案件の方を正にする
      client_id   = case when t.project_id is null then t.client_id else client_id end,
      client_name = case when t.project_id is null then t.client_name else client_name end,
      name        = case when t.project_id is null then t.name else name end,
      deal_probability = t.deal_probability,
      expected_revenue = t.expected_revenue, expected_cost = t.expected_cost, other_cost = t.other_cost,
      due_date = (t.end_month + interval '1 month - 1 day')::date,
      is_recurring = true,
      recurring_start_month = t.start_month, recurring_end_month = t.end_month
    where id = pid;
  end if;
  return pid;
end;
$$;

grant execute on function public.sync_recurring_project(uuid) to authenticated;
grant execute on function public.sync_recurring_project(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 毎月の処理（0039 の版を置きかえ）。納品書の件名は案件名（案件の方を正にする）
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
  month_label text := to_char(date_trunc('month', p_month), 'YYYY') || '年' || extract(month from p_month)::integer || '月分';
  tpl         record;
  cli         record;
  pid         uuid;
  pname       text;
  items       jsonb;
  breakdown   jsonb;
  v_subtotal  numeric;
  v_tax       numeric;
  created     integer := 0;
begin
  if auth.uid() is not null and not public.is_app_member() then
    raise exception 'このアプリの利用者として登録されていません';
  end if;

  for tpl in
    select t.*
      from public.recurring_project_templates t
     where t.is_active
       and t.start_month <= month_start
       and (t.end_month is null or t.end_month >= month_start)
     order by t.created_at
  loop
    pid := public.sync_recurring_project(tpl.id);
    select name into pname from public.projects where id = pid;

    if not tpl.auto_delivery_note or jsonb_array_length(coalesce(tpl.line_items, '[]'::jsonb)) = 0 then continue; end if;
    if exists (select 1 from public.delivery_notes d where d.recurring_template_id = tpl.id and d.recurring_month = month_start) then continue; end if;

    select c.* into cli from public.clients c where c.id = tpl.client_id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', 'rli_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
             'name', replace(coalesce(li->>'name', ''), '{年月}', month_label),
             'quantity', coalesce((li->>'quantity')::numeric, 1),
             'unit', coalesce(nullif(li->>'unit', ''), '式'),
             'unit_price', coalesce((li->>'unit_price')::numeric, 0),
             'amount', round(coalesce((li->>'quantity')::numeric, 1) * coalesce((li->>'unit_price')::numeric, 0)),
             'tax_rate', case when (li->>'tax_rate') = '8' then 8 else 10 end,
             'sales_category', nullif(li->>'sales_category', ''),
             'source_type', 'recurring'
           ) order by ord), '[]'::jsonb)
      into items
      from jsonb_array_elements(tpl.line_items) with ordinality as e(li, ord)
     where coalesce(li->>'name', '') <> '';

    if jsonb_array_length(items) = 0 then continue; end if;

    select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'taxable', taxable, 'tax', floor(taxable * rate / 100)) order by rate desc), '[]'::jsonb),
           coalesce(sum(taxable), 0), coalesce(sum(floor(taxable * rate / 100)), 0)
      into breakdown, v_subtotal, v_tax
      from (
        select (x->>'tax_rate')::integer as rate, sum((x->>'amount')::numeric) as taxable
          from jsonb_array_elements(items) x group by 1
      ) g;

    insert into public.delivery_notes (
      delivery_number, project_id, client_id, client_name, client_honorific, client_postal_code, client_address,
      title, delivery_date, line_items, subtotal, tax, total, tax_breakdown, notes, status,
      recurring_template_id, recurring_month, created_by
    ) values (
      public.next_document_number('delivery', month_end),
      pid, tpl.client_id, tpl.client_name, '御中', cli.postal_code, cli.address,
      coalesce(pname, tpl.name) || '（' || month_label || '）', month_end, items, v_subtotal, v_tax, v_subtotal + v_tax, breakdown, null, 'draft',
      tpl.id, month_start, tpl.created_by
    );
    created := created + 1;
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_recurring_projects(date) to authenticated;
grant execute on function public.generate_recurring_projects(date) to service_role;

-- これまでのひな形にも、定期売上の案件を project_id として入れておく
update public.recurring_project_templates t set project_id = p.id
  from public.projects p
 where p.recurring_template_id = t.id and p.recurring_month is null and t.project_id is null;
