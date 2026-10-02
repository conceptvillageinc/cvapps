-- ============================================================================
-- 0022: 支払い先まとめ（月末に受領した請求書を、翌月末に支払う一覧にまとめる）
--   payees   : 支払い先のマスタ（会社名・振込先情報）
--   payables : 支払月ごとの支払い一覧（支払元 3 社の振込金額・支払済・メモ）
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create table if not exists public.payees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  bank_info   text,
  notes       text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists payees_name_key on public.payees (name);

create table if not exists public.payables (
  id                uuid primary key default gen_random_uuid(),
  -- 支払月（月末払）。'2026-09' のように年月で持つ
  pay_month         text not null,
  payee_id          uuid references public.payees (id) on delete set null,
  payee_name        text not null,
  bank_info         text,
  -- 支払元ごとの振込金額（税込）
  amount_coolagri   numeric not null default 0,
  amount_cvdigital  numeric not null default 0,
  amount_cv         numeric not null default 0,
  paid              boolean not null default false,
  memo              text,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payables_month_idx on public.payables (pay_month, sort_order);

drop trigger if exists payees_set_updated_at on public.payees;
create trigger payees_set_updated_at before update on public.payees
  for each row execute function public.set_updated_at();
drop trigger if exists payables_set_updated_at on public.payables;
create trigger payables_set_updated_at before update on public.payables
  for each row execute function public.set_updated_at();

alter table public.payees enable row level security;
alter table public.payables enable row level security;
drop policy if exists payees_members_all on public.payees;
create policy payees_members_all on public.payees
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());
drop policy if exists payables_members_all on public.payables;
create policy payables_members_all on public.payables
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

comment on table public.payees is '支払い先のマスタ（支払い先まとめ）';
comment on table public.payables is '支払月ごとの支払い一覧（支払い先まとめ）';
