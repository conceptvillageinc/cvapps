-- ============================================================================
-- 0025: 領収書
--   納品書・請求書の明細から選んだ行で領収書を作る。採番は R-YYMM-連番。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create table if not exists public.receipts (
  id                  uuid primary key default gen_random_uuid(),
  receipt_number      text not null unique,
  delivery_note_id    uuid references public.delivery_notes (id) on delete set null,
  invoice_id          uuid references public.invoices (id) on delete set null,
  project_id          uuid references public.projects (id) on delete set null,
  client_id           uuid references public.clients (id) on delete set null,
  client_name         text not null,
  client_honorific    text not null default '御中',
  client_postal_code  text,
  client_address      text,
  title               text,
  -- 但し書き（「チラシ印刷代として」）
  proviso             text,
  issue_date          date not null default current_date,
  -- cash / transfer / card
  payment_method      text not null default 'cash',
  -- [{ id, name, quantity, unit, unit_price, amount, tax_rate, source_item_id }]
  line_items          jsonb not null default '[]'::jsonb,
  subtotal            numeric not null default 0,
  tax                 numeric not null default 0,
  total               numeric not null default 0,
  tax_breakdown       jsonb not null default '[]'::jsonb,
  notes               text,
  status              text not null default 'issued' check (status in ('draft', 'issued', 'sent')),
  sent_at             timestamptz,
  person_in_charge    text,
  created_by          uuid references public.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists receipts_issue_date_idx on public.receipts (issue_date desc);
create index if not exists receipts_delivery_idx   on public.receipts (delivery_note_id);
create index if not exists receipts_invoice_idx    on public.receipts (invoice_id);
create index if not exists receipts_client_idx     on public.receipts (client_name);

drop trigger if exists receipts_set_updated_at on public.receipts;
create trigger receipts_set_updated_at before update on public.receipts
  for each row execute function public.set_updated_at();

alter table public.receipts enable row level security;
drop policy if exists receipts_members_all on public.receipts;
create policy receipts_members_all on public.receipts
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 採番に領収書（R-YYMM-連番）を追加
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
  else
    raise exception 'unknown document kind: %', p_kind;
  end if;
  return prefix || lpad((max_seq + 1)::text, 3, '0');
end;
$$;

grant execute on function public.next_document_number(text, date) to authenticated;

comment on table public.receipts is '領収書（納品書・請求書の明細から作る）';
