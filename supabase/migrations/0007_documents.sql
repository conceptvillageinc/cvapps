-- ============================================================================
-- v2 S3: 納品書（delivery_notes）・請求書（invoices）
--
--   見積 → 納品書（明細を選んで作る） → 請求書（納品書を1つ以上まとめる）
--
-- 明細は各帳票に写しを持つ（jsonb）。見積を後から直しても発行済みの帳票が
-- 変わらないようにするため。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 請求書
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  -- 採番: I-YYMM-連番。freee から取り込んだものは INV-0000000655 の形をそのまま持つ
  invoice_number      text not null unique,
  project_id          uuid references public.projects (id) on delete set null,
  client_id           uuid references public.clients (id) on delete set null,
  client_name         text not null,
  client_honorific    text not null default '御中',
  client_postal_code  text,
  client_address      text,
  title               text,
  invoice_date        date not null default current_date,
  -- 入金期日。既定は請求日の翌月末
  due_date            date,
  -- [{ id, name, quantity, unit, unit_price, amount, tax_rate, transaction_date, delivery_note_id, cost_price }]
  line_items          jsonb not null default '[]'::jsonb,
  subtotal            numeric not null default 0,
  tax                 numeric not null default 0,
  total               numeric not null default 0,
  -- 税率ごとの内訳 [{ rate, taxable, tax }]
  tax_breakdown       jsonb not null default '[]'::jsonb,
  notes               text,
  -- draft=下書き / sent=送付済 / paid=入金済 / cancelled=取消
  status              text not null default 'draft'
                        check (status in ('draft', 'sent', 'paid', 'cancelled')),
  sent_at             timestamptz,
  paid_at             date,
  paid_amount         numeric,
  -- 送付方法（クライアントの設定を写す）
  delivery_method     text,
  person_in_charge    text,
  created_by          uuid references public.users (id) on delete set null,
  legacy_id           text unique,
  legacy_data         jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists invoices_invoice_date_idx on public.invoices (invoice_date desc);
create index if not exists invoices_project_id_idx   on public.invoices (project_id);
create index if not exists invoices_client_name_idx  on public.invoices (client_name);
create index if not exists invoices_status_idx       on public.invoices (status);
create index if not exists invoices_due_date_idx     on public.invoices (due_date);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;
drop policy if exists invoices_members_all on public.invoices;
create policy invoices_members_all on public.invoices
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- ----------------------------------------------------------------------------
-- 納品書
-- ----------------------------------------------------------------------------
create table if not exists public.delivery_notes (
  id                  uuid primary key default gen_random_uuid(),
  -- 採番: D-YYMM-連番
  delivery_number     text not null unique,
  project_id          uuid references public.projects (id) on delete set null,
  estimate_id         uuid references public.estimates (id) on delete set null,
  client_id           uuid references public.clients (id) on delete set null,
  client_name         text not null,
  client_honorific    text not null default '御中',
  client_postal_code  text,
  client_address      text,
  title               text,
  delivery_date       date not null default current_date,
  -- [{ id, name, quantity, unit, unit_price, amount, tax_rate, cost_price, source_line_id }]
  line_items          jsonb not null default '[]'::jsonb,
  subtotal            numeric not null default 0,
  tax                 numeric not null default 0,
  total               numeric not null default 0,
  tax_breakdown       jsonb not null default '[]'::jsonb,
  notes               text,
  -- draft=下書き / issued=発行済
  status              text not null default 'draft' check (status in ('draft', 'issued')),
  -- まとめた請求書。請求書が削除されたら未請求に戻る
  invoice_id          uuid references public.invoices (id) on delete set null,
  person_in_charge    text,
  created_by          uuid references public.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists delivery_notes_delivery_date_idx on public.delivery_notes (delivery_date desc);
create index if not exists delivery_notes_project_id_idx    on public.delivery_notes (project_id);
create index if not exists delivery_notes_estimate_id_idx   on public.delivery_notes (estimate_id);
create index if not exists delivery_notes_invoice_id_idx    on public.delivery_notes (invoice_id);

drop trigger if exists delivery_notes_set_updated_at on public.delivery_notes;
create trigger delivery_notes_set_updated_at
  before update on public.delivery_notes
  for each row execute function public.set_updated_at();

alter table public.delivery_notes enable row level security;
drop policy if exists delivery_notes_members_all on public.delivery_notes;
create policy delivery_notes_members_all on public.delivery_notes
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- ----------------------------------------------------------------------------
-- 採番: D-YYMM-連番 / I-YYMM-連番（月ごとに 001 から）
-- ----------------------------------------------------------------------------
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
  else
    raise exception 'unknown document kind: %', p_kind;
  end if;
  return prefix || lpad((max_seq + 1)::text, 3, '0');
end;
$$;

grant execute on function public.next_document_number(text, date) to authenticated;

-- ----------------------------------------------------------------------------
-- メール送信履歴を帳票（請求書など）にも使えるようにする
-- ----------------------------------------------------------------------------
alter table public.email_logs
  alter column estimate_id drop not null,
  add column if not exists document_type text,
  add column if not exists document_id   uuid;

create index if not exists email_logs_document_idx on public.email_logs (document_type, document_id);

-- ----------------------------------------------------------------------------
-- 会社情報（帳票の自社欄・振込先・登録番号）。画面（システム設定）で編集する。
-- ----------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description)
values (
  'company_info',
  '{"name":"株式会社コンセプト・ヴィレッジ","representative":"","registration_number":"T7011001094049","tel":"024-905-1295","fax":"024-505-4866","locations":[{"label":"福島","postal":"963-0117","address":"福島県郡山市安積荒井三丁目497-B号 cv-studio"},{"label":"沖縄","postal":"900-0033","address":"沖縄県那覇市久米２丁目９－１１ Abc久米ビル 3階"}],"bank_accounts":[{"bank":"東邦銀行","branch":"郡山営業部","type":"普通","number":"2312454","holder":"カ）コンセプト・ヴィレッジ"},{"bank":"琉球銀行","branch":"本店営業部","type":"普通","number":"1353283","holder":"カ）コンセプト・ヴィレッジ"}],"stamp_path":"","invoice_notes":"","delivery_notes":""}',
  '会社情報（帳票用）'
)
on conflict (setting_key) do nothing;
