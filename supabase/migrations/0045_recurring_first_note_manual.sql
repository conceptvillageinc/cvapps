-- ============================================================================
-- 定期売上: 初回の納品書は手で作る（ボタン 1 つ。何月末で出すかを選ぶ）。2 回目からは毎月自動
--
--   * ひな形に first_note_month（初回の納品書の月）を持たせる
--   * generate_recurring_notes(月, ひな形, p_first)
--       p_first = true  … 初回の納品書を作る（自動で作るかどうかの設定に関わらず作る。
--                          「初回だけの費用も入れる」なら初回だけの明細も入れる。first_note_month を入れる）
--       p_first = false … 毎月の自動（初回の月とそれより前の月は作らない。初回をまだ作っていなければ開始月は作らない）
--   * generate_recurring_projects(月)（毎月 1 日の処理）は p_first = false で全部のひな形を回す
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。0043 を実行したあとに実行する。
-- ============================================================================

alter table public.recurring_project_templates
  add column if not exists first_note_month date;

comment on column public.recurring_project_templates.first_note_month is '初回の納品書を作った月（毎月の自動はこの月の翌月から）';

-- すでに開始月の納品書があるひな形は、それを初回とみなす
update public.recurring_project_templates t
   set first_note_month = t.start_month
 where t.first_note_month is null
   and exists (select 1 from public.delivery_notes d where d.recurring_template_id = t.id and d.recurring_month = t.start_month);

-- 引数が 2 つの版（0043）は消して、3 つの版にする（同じ名前で両方あると呼び分けられないため）
drop function if exists public.generate_recurring_notes(date, uuid);

create or replace function public.generate_recurring_notes(p_month date default current_date, p_template_id uuid default null, p_first boolean default false)
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
  if p_first and p_template_id is null then
    raise exception '初回の納品書は、ひな形を指定して作ってください';
  end if;

  for tpl in
    select t.*
      from public.recurring_project_templates t
     where t.is_active
       and (p_template_id is null or t.id = p_template_id)
       and (p_first or t.start_month <= month_start)
       and (t.end_month is null or t.end_month >= month_start)
     order by t.created_at
  loop
    -- 毎月の自動: 初回の月（初回がまだなら開始月）とそれより前は作らない。自動で作る設定のときだけ
    if not p_first then
      if not tpl.auto_delivery_note then continue; end if;
      if month_start <= coalesce(tpl.first_note_month, tpl.start_month) then continue; end if;
    end if;

    pid := public.sync_recurring_project(tpl.id);
    select name into pname from public.projects where id = pid;

    if jsonb_array_length(coalesce(tpl.line_items, '[]'::jsonb)) = 0 then continue; end if;
    if exists (select 1 from public.delivery_notes d where d.recurring_template_id = tpl.id and d.recurring_month = month_start) then
      if p_first then
        update public.recurring_project_templates set first_note_month = month_start where id = tpl.id and first_note_month is distinct from month_start;
      end if;
      continue;
    end if;

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
      -- 初回の納品書で「初回だけの費用も入れる」なら、初回だけの明細を先に並べる
      from jsonb_array_elements(
             case when p_first and tpl.first_note_one_time
                  then coalesce(tpl.one_time_line_items, '[]'::jsonb) || coalesce(tpl.line_items, '[]'::jsonb)
                  else tpl.line_items end
           ) with ordinality as e(li, ord)
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
    if p_first then
      update public.recurring_project_templates set first_note_month = month_start where id = tpl.id;
    end if;
    created := created + 1;
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_recurring_notes(date, uuid, boolean) to authenticated;
grant execute on function public.generate_recurring_notes(date, uuid, boolean) to service_role;

-- 毎月 1 日の処理（cron・定期売上一覧の「この月の納品書の下書きを作る」）。全部のひな形で 2 回目以降を作る
create or replace function public.generate_recurring_projects(p_month date default current_date)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return public.generate_recurring_notes(p_month, null, false);
end;
$$;

grant execute on function public.generate_recurring_projects(date) to authenticated;
grant execute on function public.generate_recurring_projects(date) to service_role;
