-- ============================================================================
-- 定期売上の修復（必要なところだけ・データの移し替えなし）
--
--   本番で「column "recurring_start_month" of relation "projects" does not exist」が続いている。
--   0048 は途中でエラーになると全体が取り消されるため、定期売上の登録に要るところだけを、
--   失敗しにくい形でまとめた（項目を足す・関数とトリガーを今の形にする）。冪等。
--
-- Supabase の SQL Editor に全部貼り付けて 1 回で実行する。
-- 最後に「確認」の表が出る。recurring_start_month など 4 行が出れば成功。
-- ============================================================================

-- 1. 項目を足す（すでにあれば何もしない）
alter table public.projects
  add column if not exists recurring_template_id uuid references public.recurring_project_templates (id) on delete set null,
  add column if not exists recurring_month date,
  add column if not exists recurring_start_month date,
  add column if not exists recurring_end_month date,
  add column if not exists recurring_one_time_revenue numeric not null default 0,
  add column if not exists recurring_one_time_cost numeric not null default 0;

alter table public.recurring_project_templates
  add column if not exists auto_delivery_note boolean not null default false,
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists project_id uuid references public.projects (id) on delete set null,
  add column if not exists source_estimate_id uuid references public.estimates (id) on delete set null,
  add column if not exists source_line_ids jsonb not null default '[]'::jsonb,
  add column if not exists lines_applied_at timestamptz,
  add column if not exists source_all_line_ids jsonb not null default '[]'::jsonb,
  add column if not exists one_time_revenue numeric not null default 0,
  add column if not exists one_time_cost numeric not null default 0,
  add column if not exists drift_dismissed_sig text,
  add column if not exists first_note_one_time boolean not null default false,
  add column if not exists one_time_line_items jsonb not null default '[]'::jsonb,
  add column if not exists ended_confirmed_at timestamptz,
  add column if not exists last_reviewed_month date;

alter table public.delivery_notes
  add column if not exists recurring_template_id uuid references public.recurring_project_templates (id) on delete set null,
  add column if not exists recurring_month date;

-- 2. 定期売上の案件を作る・ひな形に合わせる関数（0041 の形）
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
      recurring_template_id, recurring_month, recurring_start_month, recurring_end_month,
      recurring_one_time_revenue, recurring_one_time_cost, created_by
    ) values (
      public.next_project_number(t.start_month),
      t.client_id, t.client_name, t.name, t.deal_probability, t.phase, 'open',
      t.expected_revenue, t.expected_cost, t.other_cost,
      t.start_month, (t.end_month + interval '1 month - 1 day')::date, null, true, t.notes,
      t.id, null, t.start_month, t.end_month,
      coalesce(t.one_time_revenue, 0), coalesce(t.one_time_cost, 0), t.created_by
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
      recurring_start_month = t.start_month, recurring_end_month = t.end_month,
      recurring_one_time_revenue = coalesce(t.one_time_revenue, 0), recurring_one_time_cost = coalesce(t.one_time_cost, 0)
    where id = pid;
  end if;
  return pid;
end;
$$;

grant execute on function public.sync_recurring_project(uuid) to authenticated;
grant execute on function public.sync_recurring_project(uuid) to service_role;

-- 3. ひな形を登録・変更したら案件に反映するトリガー・案件を削除したら作り直さないトリガー（0044 の形）
-- ひな形を登録・変更したら案件にも反映する。ただし次のときは何もしない
--   ・案件を削除して project_id が外れただけ
--   ・案件の削除に合わせてひな形を停止中にしているところ（app.skip_recurring_sync = on）
create or replace function public.recurring_templates_sync_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.skip_recurring_sync', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.project_id is not null and new.project_id is null then
    return new;
  end if;
  perform public.sync_recurring_project(new.id);
  return new;
end;
$$;

-- 定期売上の案件（ひな形ごとの 1 件）を削除したら、そのひな形を停止中にする（毎月の処理で作り直さないように）
create or replace function public.recurring_project_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.recurring_template_id is not null and old.recurring_month is null then
    perform set_config('app.skip_recurring_sync', 'on', true);
    update public.recurring_project_templates
       set is_active = false, project_id = null
     where id = old.recurring_template_id;
    perform set_config('app.skip_recurring_sync', '', true);
  end if;
  return old;
end;
$$;

drop trigger if exists recurring_project_after_delete on public.projects;
create trigger recurring_project_after_delete
  after delete on public.projects
  for each row execute function public.recurring_project_after_delete();

drop trigger if exists recurring_templates_sync_project on public.recurring_project_templates;
create trigger recurring_templates_sync_project
  after insert or update on public.recurring_project_templates
  for each row execute function public.recurring_templates_sync_project();

-- 4. 納品書の下書きを作る関数（初回は手で・2 回目から毎月自動。0045 の形）
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


-- 5. 項目を足したことを Supabase（PostgREST）にすぐ読み直させる
notify pgrst, 'reload schema';

-- 6. 確認（4 行出れば成功）
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'projects' and column_name in ('recurring_start_month', 'recurring_end_month', 'recurring_one_time_revenue'))
     or (table_name = 'recurring_project_templates' and column_name = 'first_note_month'))
 order by 1, 2;
