-- ============================================================================
-- 定期売上: 「毎月 1 件ずつ案件を作る」から「ひな形ごとに案件を 1 つ」に変える
--
--   * ひな形を登録すると、定期売上の案件が 1 つだけできる（以後、ひな形を直すと案件にも反映）
--   * 毎月の処理（generate_recurring_projects）は、その案件に紐づけて、その月の
--     納品書の下書きだけを作る（「毎月の納品書も作る」にしたひな形のみ）
--   * 見積・納品書・請求書は、その 1 つの案件にぶら下がる
--   * 見込（売上粗利管理表・資金繰り）は、案件の月額 × 月で、月ごとに請求済み分を引く（画面側）
--
-- あわせて、
--   * 納品書をまとめた請求書の明細に、元の納品書の案件（project_id）を入れる
--     （売上を元の案件ごとに分けて集計するため。画面で新しく作る請求書は自動で入る）
--
-- 【これまでに月ごとに作られた案件について】
--   ひな形ごとに、いちばん古い月の案件を「定期売上の案件」にし（案件番号はそのまま。
--   名前の「（YYYY年M月分）」は外す）、ほかの月の案件に紐づいていた見積・納品書・請求書・
--   議事録・領収書・発注書・入稿記録・印刷仕様の一覧・工程をその案件に移してから、
--   空になった月の案件を削除する。
--   実行前に何がまとめられるかは、下の「確認用」の SELECT で見られる。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等。2 回目以降は何も変わらない）。
-- ============================================================================

-- 確認用（実行前に、この SELECT だけを実行すると、まとめられる月の案件が一覧で出る）
-- select t.name as ひな形, p.project_number, p.name, p.recurring_month
--   from public.projects p join public.recurring_project_templates t on t.id = p.recurring_template_id
--  where p.recurring_month is not null order by t.name, p.recurring_month;

alter table public.projects
  add column if not exists recurring_start_month date,
  add column if not exists recurring_end_month date;

comment on column public.projects.recurring_start_month is '定期売上の案件: 始めた月（その月の1日）。これがある案件は月額 × 月で見込を数える';
comment on column public.projects.recurring_end_month is '定期売上の案件: 終える月（null なら無期限）';

-- 定期売上の案件（ひな形 1 つにつき 1 件）は recurring_month が null。月ごとの案件（旧）とは別に一意にする
create unique index if not exists projects_recurring_template_parent_uniq
  on public.projects (recurring_template_id)
  where recurring_template_id is not null and recurring_month is null;

-- ----------------------------------------------------------------------------
-- ひな形の定期売上の案件を作る・ひな形の内容に合わせる。案件の id を返す
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
  else
    update public.projects set
      client_id = t.client_id, client_name = t.client_name, name = t.name,
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

-- ひな形を登録・変更したら、案件にも反映する
create or replace function public.recurring_templates_sync_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_recurring_project(new.id);
  return new;
end;
$$;

drop trigger if exists recurring_templates_sync_project on public.recurring_project_templates;
create trigger recurring_templates_sync_project
  after insert or update on public.recurring_project_templates
  for each row execute function public.recurring_templates_sync_project();

-- ----------------------------------------------------------------------------
-- 毎月の処理: 指定した月（省略時は今月）の納品書の下書きを作る。戻り値は作った納品書の件数。
-- （案件はひな形ごとに 1 つ。無ければここでも作る）
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
      tpl.name || '（' || month_label || '）', month_end, items, v_subtotal, v_tax, v_subtotal + v_tax, breakdown, null, 'draft',
      tpl.id, month_start, tpl.created_by
    );
    created := created + 1;
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_recurring_projects(date) to authenticated;
grant execute on function public.generate_recurring_projects(date) to service_role;

-- ----------------------------------------------------------------------------
-- これまでの月ごとの案件を、ひな形ごとの 1 つの案件にまとめる
-- ----------------------------------------------------------------------------
do $$
declare
  t      record;
  pid    uuid;
  kids   uuid[];
  moved  integer := 0;
  merged integer := 0;
begin
  for t in select * from public.recurring_project_templates order by created_at loop
    select id into pid from public.projects where recurring_template_id = t.id and recurring_month is null limit 1;

    -- まだ定期売上の案件が無ければ、いちばん古い月の案件をそれにする（案件番号はそのまま）
    if pid is null then
      select id into pid from public.projects
       where recurring_template_id = t.id and recurring_month is not null
       order by recurring_month, created_at limit 1;
      if pid is not null then
        update public.projects set recurring_month = null, name = t.name, registered_at = t.start_month where id = pid;
      end if;
    end if;
    pid := public.sync_recurring_project(t.id); -- 無ければ作る・ひな形の内容に合わせる

    select coalesce(array_agg(id), '{}') into kids from public.projects
     where recurring_template_id = t.id and recurring_month is not null and id <> pid;
    if array_length(kids, 1) is null then continue; end if;

    -- 月ごとの案件の請求書: 明細に案件と「何月分か」（service_month）を残してから付け替える
    -- （まとめたあとも、月ごとの請求済み額を正しく数えるため。請求書の見た目は変わらない）
    update public.invoices i set line_items = (
        select jsonb_agg(case when coalesce(li->>'project_id', c.id::text) = c.id::text
                              then li || jsonb_build_object('project_id', pid::text, 'service_month', to_char(c.recurring_month, 'YYYY-MM'))
                              else li end order by ord)
          from jsonb_array_elements(i.line_items) with ordinality as e(li, ord))
      from public.projects c
     where c.id = i.project_id and c.id = any(kids)
       and jsonb_typeof(i.line_items) = 'array' and jsonb_array_length(i.line_items) > 0;

    update public.estimates        set project_id = pid where project_id = any(kids);
    update public.delivery_notes   set project_id = pid where project_id = any(kids);
    update public.invoices         set project_id = pid where project_id = any(kids);
    update public.meetings         set project_id = pid where project_id = any(kids);
    update public.receipts         set project_id = pid where project_id = any(kids);
    update public.partner_orders   set project_id = pid where project_id = any(kids);
    update public.print_orders     set project_id = pid where project_id = any(kids);
    update public.print_spec_lists set project_id = pid where project_id = any(kids);
    update public.project_tasks    set project_id = pid where project_id = any(kids);
    -- 請求書の明細の案件（あれば）も付け替える
    update public.invoices i set line_items = (
        select jsonb_agg(case when li->>'project_id' = any(select k::text from unnest(kids) k)
                              then jsonb_set(li, '{project_id}', to_jsonb(pid::text)) else li end order by ord)
          from jsonb_array_elements(i.line_items) with ordinality as e(li, ord))
     where jsonb_typeof(i.line_items) = 'array' and jsonb_array_length(i.line_items) > 0
       and exists (select 1 from jsonb_array_elements(i.line_items) li where li->>'project_id' = any(select k::text from unnest(kids) k));

    delete from public.projects where id = any(kids);
    moved := moved + array_length(kids, 1);
    merged := merged + 1;
  end loop;
  raise notice '定期売上: % 件のひな形で、月ごとの案件 % 件を 1 つの案件にまとめました', merged, moved;
end;
$$;

-- ----------------------------------------------------------------------------
-- 納品書をまとめた請求書の明細に、元の納品書の案件を入れる（売上を案件ごとに分けるため）
-- ----------------------------------------------------------------------------
update public.invoices i set line_items = (
    select jsonb_agg(case when li ? 'delivery_note_id' and dn.project_id is not null
                          then li || jsonb_build_object('project_id', dn.project_id::text) else li end order by ord)
      from jsonb_array_elements(i.line_items) with ordinality as e(li, ord)
      left join public.delivery_notes dn on dn.id::text = li->>'delivery_note_id')
 where jsonb_typeof(i.line_items) = 'array' and jsonb_array_length(i.line_items) > 0
   and exists (
     select 1 from jsonb_array_elements(i.line_items) li
       join public.delivery_notes dn on dn.id::text = li->>'delivery_note_id'
      where dn.project_id is not null and (li->>'project_id') is distinct from dn.project_id::text);
