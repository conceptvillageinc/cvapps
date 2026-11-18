-- ============================================================================
-- 0063: 領収書の表を作る（本番で 0025 がまだだったため）
--   0025 の「表・索引・権限」の部分だけ。0025 の採番の関数（next_document_number）は、
--   そのあとの 0026（発注書）で領収書の分も含めて作り直し済みなので、ここでは触らない
--   （0025 をそのまま流すと、発注書の採番が消えてしまうため）
--   あわせて、作成者・更新者と変更の履歴（0062）を領収書にも付ける
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

comment on table public.receipts is '領収書（納品書・請求書の明細から作る）';

-- 作成者・更新者と変更の履歴（0062 と同じ）
alter table public.receipts add column if not exists updated_by uuid;
drop trigger if exists receipts_stamp_user on public.receipts;
create trigger receipts_stamp_user before insert or update on public.receipts
  for each row execute function public.stamp_record_user();
drop trigger if exists receipts_history on public.receipts;
create trigger receipts_history after insert or update or delete on public.receipts
  for each row execute function public.track_record_history();

-- 確認: 領収書の表ができたか・採番で領収書の番号が出せるか・記録の仕組みが付いたか
select
  (to_regclass('public.receipts') is not null) as "領収書の表がある",
  public.next_document_number('receipt', current_date) as "次の領収書番号",
  public.next_document_number('partner_order', current_date) as "次の発注書番号（消えていないこと）",
  (select string_agg(distinct trigger_name, '・' order by trigger_name) from information_schema.triggers
    where trigger_schema = 'public' and event_object_table = 'receipts') as "付いている仕組み";
