-- ============================================================================
-- 0023: クレジットカード利用明細（支払い先まとめ）
--   マネーフォワード ビジネスカードなどの利用明細 CSV を取り込み、月ごとに保持する。
--   売上粗利管理表の「実績 その他原価」の既定値になる。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create table if not exists public.card_charges (
  id           uuid primary key default gen_random_uuid(),
  charged_at   date not null,
  -- 利用月（'2026-09'）。集計はこの列で行う
  charge_month text not null,
  merchant     text not null,
  amount       numeric not null default 0,
  holder       text,
  card_label   text,
  memo         text,
  -- どの会社のカードか（cv / cvdigital / coolagri）
  entity       text not null default 'cv',
  source       text not null default 'csv',
  -- 同じ明細を二重に取り込まないための印（利用日｜利用先｜金額｜利用者）
  fingerprint  text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists card_charges_fingerprint_key on public.card_charges (fingerprint);
create index if not exists card_charges_month_idx on public.card_charges (charge_month, charged_at);

drop trigger if exists card_charges_set_updated_at on public.card_charges;
create trigger card_charges_set_updated_at before update on public.card_charges
  for each row execute function public.set_updated_at();

alter table public.card_charges enable row level security;
drop policy if exists card_charges_members_all on public.card_charges;
create policy card_charges_members_all on public.card_charges
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

comment on table public.card_charges is 'クレジットカードの利用明細（支払い先まとめ）';
