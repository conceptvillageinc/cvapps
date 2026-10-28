-- ============================================================================
-- 定期売上: 毎月の案件といっしょに、その月の納品書（下書き）も作る
--
-- ひな形（recurring_project_templates）に納品書の明細を持たせ、
-- auto_delivery_note が true なら、generate_recurring_projects が
-- その月の案件に紐づく納品書の下書きを 1 件作る（納品日 = その月の末日）。
-- 月末に、同じクライアントのほかの納品書と並べて、1 枚の請求書にまとめられる。
--
--   明細の品名の「{年月}」は「2026年10月分」に置き換わる。
--   同じひな形×月の納品書は 1 件だけ（二重には作らない）。
--   案件だけ先に作られていた月も、もう一度生成すると納品書だけ作る。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.recurring_project_templates
  add column if not exists auto_delivery_note boolean not null default false,
  -- [{ name, quantity, unit, unit_price, tax_rate, sales_category }]
  add column if not exists line_items jsonb not null default '[]'::jsonb;

alter table public.delivery_notes
  add column if not exists recurring_template_id uuid
    references public.recurring_project_templates (id) on delete set null,
  add column if not exists recurring_month date;

create unique index if not exists delivery_notes_recurring_template_month_uniq
  on public.delivery_notes (recurring_template_id, recurring_month)
  where recurring_template_id is not null;

-- ----------------------------------------------------------------------------
-- 指定した月（省略時は今月）の定期案件を生成する。戻り値は作った案件の件数。
-- （0005 の版に、納品書の下書きを作る処理を足したもの）
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
  month_label text := to_char(date_trunc('month', p_month), 'YYYY') || '年' || extract(month from p_month)::integer || '月分';
  tpl         record;
  proj        record;
  cli         record;
  items       jsonb;
  breakdown   jsonb;
  v_subtotal  numeric;
  v_tax       numeric;
  created     integer := 0;
begin
  -- 画面からも呼ばれるので、呼び出し元がメンバーか確認する
  -- （cron は service_role で呼ぶため auth.uid() が null になる。その場合は通す）
  if auth.uid() is not null and not public.is_app_member() then
    raise exception 'このアプリの利用者として登録されていません';
  end if;

  -- 1. 案件
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
      tpl.name || '（' || month_label || '）',
      tpl.deal_probability, tpl.phase, 'open',
      tpl.expected_revenue, tpl.expected_cost, tpl.other_cost,
      month_start, month_end, pay_due, true, tpl.notes,
      tpl.id, month_start, tpl.created_by
    );
    created := created + 1;
  end loop;

  -- 2. 納品書の下書き（明細のあるひな形だけ。その月の案件に紐づける）
  for tpl in
    select t.*
      from public.recurring_project_templates t
     where t.is_active
       and t.auto_delivery_note
       and jsonb_array_length(coalesce(t.line_items, '[]'::jsonb)) > 0
       and t.start_month <= month_start
       and (t.end_month is null or t.end_month >= month_start)
       and not exists (
         select 1 from public.delivery_notes d
          where d.recurring_template_id = t.id and d.recurring_month = month_start
       )
     order by t.created_at
  loop
    select p.* into proj from public.projects p
     where p.recurring_template_id = tpl.id and p.recurring_month = month_start
     limit 1;
    select c.* into cli from public.clients c where c.id = tpl.client_id;

    -- 明細: 金額 = 数量 × 単価（1 円未満は四捨五入）。品名の {年月} を置き換える
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

    -- 税率ごとに合計してから消費税（1 円未満切り捨て）。画面の computeDocTotals と同じ
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
      proj.id, tpl.client_id, tpl.client_name, '御中', cli.postal_code, cli.address,
      tpl.name || '（' || month_label || '）', month_end, items, v_subtotal, v_tax, v_subtotal + v_tax, breakdown, null, 'draft',
      tpl.id, month_start, tpl.created_by
    );
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_recurring_projects(date) to authenticated;
grant execute on function public.generate_recurring_projects(date) to service_role;
