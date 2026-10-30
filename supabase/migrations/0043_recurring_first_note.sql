-- ============================================================================
-- 定期売上: 初回の納品書に初回だけの費用を入れる・登録したときにその月の分をすぐ作る
--
--   * ひな形に「初回の納品書に初回だけの費用も入れる」（first_note_one_time）と、
--     初回だけの明細（one_time_line_items。見積でチェックしなかった明細）を持たせる。
--     入れるにしたときは、開始月の納品書の下書きだけ「初回だけの明細 ＋ 毎月の明細」にする。
--   * 1 つのひな形・1 か月分だけ作れる generate_recurring_notes(月, ひな形) を用意する
--     （「定期売上にする」を押したときに、開始月〜今月の分をすぐ作るのに使う）。
--     毎月 1 日の generate_recurring_projects(月) は、これを全部のひな形で呼ぶ。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.recurring_project_templates
  add column if not exists first_note_one_time boolean not null default false,
  add column if not exists one_time_line_items jsonb not null default '[]'::jsonb;

comment on column public.recurring_project_templates.first_note_one_time is '開始月の納品書に、初回だけの費用（one_time_line_items）も入れる';

-- ----------------------------------------------------------------------------
-- 指定した月の納品書の下書きを作る（p_template_id を渡すとそのひな形だけ）。戻り値は作った件数
-- ----------------------------------------------------------------------------
create or replace function public.generate_recurring_notes(p_month date default current_date, p_template_id uuid default null)
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
       and (p_template_id is null or t.id = p_template_id)
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
      -- 開始月で「初回の納品書に初回だけの費用も入れる」なら、初回だけの明細を先に並べる
      from jsonb_array_elements(
             case when tpl.first_note_one_time and month_start = tpl.start_month
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
    created := created + 1;
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_recurring_notes(date, uuid) to authenticated;
grant execute on function public.generate_recurring_notes(date, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 毎月 1 日の処理（cron・定期売上一覧の「この月の納品書の下書きを作る」）。全部のひな形で作る
-- ----------------------------------------------------------------------------
create or replace function public.generate_recurring_projects(p_month date default current_date)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return public.generate_recurring_notes(p_month, null);
end;
$$;

grant execute on function public.generate_recurring_projects(date) to authenticated;
grant execute on function public.generate_recurring_projects(date) to service_role;
