-- ============================================================================
-- v2 S4: 入金確認（銀行明細の取込と請求書との照合）
--
-- 銀行（東邦・琉球）の入出金明細CSVを取り込み、請求書と照合して入金済にする。
-- 照合で覚えた「振込名義 → クライアント」は clients.bank_payee_names に貯め、
-- 次回から自動で候補に出す。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  -- toho / ryukyu / other
  bank              text not null,
  account_label     text,
  transaction_date  date not null,
  amount_in         numeric not null default 0,
  amount_out        numeric not null default 0,
  -- 明細のままの振込名義（半角カナ）と、照合用に正規化したもの
  payee_raw         text,
  payee_normalized  text,
  balance           numeric,
  -- 同じ明細を2回取り込まないためのキー（銀行＋日付＋名義＋金額＋残高）
  source_hash       text not null unique,
  -- unmatched=未照合 / matched=請求書に紐付け済 / ignored=対象外（手数料・仕入など）
  match_status      text not null default 'unmatched'
                      check (match_status in ('unmatched', 'matched', 'ignored')),
  invoice_id        uuid references public.invoices (id) on delete set null,
  matched_by        text check (matched_by in ('auto', 'manual')),
  memo              text,
  imported_by       uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists bank_transactions_date_idx   on public.bank_transactions (transaction_date desc);
create index if not exists bank_transactions_status_idx on public.bank_transactions (match_status);
create index if not exists bank_transactions_invoice_idx on public.bank_transactions (invoice_id);

drop trigger if exists bank_transactions_set_updated_at on public.bank_transactions;
create trigger bank_transactions_set_updated_at
  before update on public.bank_transactions
  for each row execute function public.set_updated_at();

alter table public.bank_transactions enable row level security;
drop policy if exists bank_transactions_members_all on public.bank_transactions;
create policy bank_transactions_members_all on public.bank_transactions
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- クライアントに、覚えた振込名義（正規化済み）を持つ
alter table public.clients
  add column if not exists bank_payee_names jsonb not null default '[]'::jsonb;

comment on column public.clients.bank_payee_names is '銀行明細の振込名義（正規化済み）。入金の照合で学習する。';

-- 会計（MF仕訳CSV）の勘定科目などの設定
insert into public.system_settings (setting_key, setting_value, description)
values (
  'accounting_settings',
  '{"sales_account":"売上高","receivable_account":"売掛金","deposit_account":"普通預金","fee_account":"支払手数料","tax_category_sales":"課税売上 10%","tax_category_sales_reduced":"課税売上 8%（軽減）","tax_category_none":"対象外","bank_sub_accounts":{"toho":"東邦銀行","ryukyu":"琉球銀行"},"department":""}',
  'MF会計 仕訳CSVの勘定科目'
)
on conflict (setting_key) do nothing;
