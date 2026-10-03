-- ============================================================================
-- 0026: 発注書（CV → 連携先）
--   見積の明細から選んだ行で、連携先（クライアント一覧または印刷所情報）へ出す発注書。
--   採番は PO-YYMM-連番。支払条件の定型文はシステム設定 po_payment_terms（JSON 配列）。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create table if not exists public.partner_orders (
  id                   uuid primary key default gen_random_uuid(),
  po_number            text not null unique,
  estimate_id          uuid references public.estimates (id) on delete set null,
  project_id           uuid references public.projects (id) on delete set null,
  -- 連携先: client（クライアント一覧）/ print_vendor（印刷所情報）
  partner_type         text not null default 'client' check (partner_type in ('client', 'print_vendor')),
  partner_id           uuid,
  partner_name         text not null,
  partner_honorific    text not null default '御中',
  partner_postal_code  text,
  partner_address      text,
  partner_contact      text,
  title                text,
  order_date           date not null default current_date,
  due_date             date,
  -- 納品先: cv / client / other
  delivery_to_kind     text not null default 'cv' check (delivery_to_kind in ('cv', 'client', 'other')),
  delivery_to          text,
  payment_terms        text,
  -- [{ id, name, quantity, unit, unit_price, amount, tax_rate, source_line_id }]
  line_items           jsonb not null default '[]'::jsonb,
  subtotal             numeric not null default 0,
  tax                  numeric not null default 0,
  total                numeric not null default 0,
  tax_breakdown        jsonb not null default '[]'::jsonb,
  notes                text,
  status               text not null default 'issued' check (status in ('draft', 'issued', 'sent', 'done')),
  sent_at              timestamptz,
  person_in_charge     text,
  created_by           uuid references public.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists partner_orders_order_date_idx on public.partner_orders (order_date desc);
create index if not exists partner_orders_estimate_idx   on public.partner_orders (estimate_id);
create index if not exists partner_orders_project_idx    on public.partner_orders (project_id);

drop trigger if exists partner_orders_set_updated_at on public.partner_orders;
create trigger partner_orders_set_updated_at before update on public.partner_orders
  for each row execute function public.set_updated_at();

alter table public.partner_orders enable row level security;
drop policy if exists partner_orders_members_all on public.partner_orders;
create policy partner_orders_members_all on public.partner_orders
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 採番に発注書（PO-YYMM-連番）を追加
create or replace function public.next_document_number(p_kind text, p_date date default current_date)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  prefix  text;
  max_seq integer;
begin
  if p_kind = 'delivery' then
    prefix := 'D-' || to_char(p_date, 'YYMM') || '-';
    select coalesce(max((substring(delivery_number from length(prefix) + 1 for 3))::integer), 0)
      into max_seq from public.delivery_notes
     where delivery_number like prefix || '___'
       and substring(delivery_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  elsif p_kind = 'invoice' then
    prefix := 'I-' || to_char(p_date, 'YYMM') || '-';
    select coalesce(max((substring(invoice_number from length(prefix) + 1 for 3))::integer), 0)
      into max_seq from public.invoices
     where invoice_number like prefix || '___'
       and substring(invoice_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  elsif p_kind = 'receipt' then
    prefix := 'R-' || to_char(p_date, 'YYMM') || '-';
    select coalesce(max((substring(receipt_number from length(prefix) + 1 for 3))::integer), 0)
      into max_seq from public.receipts
     where receipt_number like prefix || '___'
       and substring(receipt_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  elsif p_kind = 'partner_order' then
    prefix := 'PO-' || to_char(p_date, 'YYMM') || '-';
    select coalesce(max((substring(po_number from length(prefix) + 1 for 3))::integer), 0)
      into max_seq from public.partner_orders
     where po_number like prefix || '___'
       and substring(po_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  else
    raise exception 'unknown document kind: %', p_kind;
  end if;
  return prefix || lpad((max_seq + 1)::text, 3, '0');
end;
$$;

grant execute on function public.next_document_number(text, date) to authenticated;

comment on table public.partner_orders is '発注書（CV から連携先へ）';
