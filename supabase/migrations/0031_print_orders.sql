-- ============================================================================
-- 入稿記録: 見積書のどの明細（品名・枚数・金額）で、どの入稿先に入稿したか。
--   見積書の明細の「入稿した」ボタン、または納品書を作ったときの候補から記録する。
--   見積書・案件詳細・クライアントカルテの「入稿履歴」に出し、追加印刷の見積を作るときに使う。
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.print_orders (
  id               uuid primary key default gen_random_uuid(),
  estimate_id      uuid references public.estimates (id) on delete set null,
  estimate_number  text not null default '',
  estimate_line_id text,                             -- 見積の明細の id（line_items[].id）
  project_id       uuid references public.projects (id) on delete set null,
  client_id        uuid references public.clients (id) on delete set null,
  client_name      text not null default '',
  ordered_on       date not null default current_date,   -- 入稿日
  name             text not null default '',          -- 品名（明細の写し）
  category         text not null default '',
  quantity         numeric,
  unit             text not null default '',
  unit_price       numeric,                           -- 売価の単価（税別）
  amount           numeric,                           -- 売価の金額（税別）
  cost_price       numeric,                           -- 原価の単価（税別）
  vendor           text not null default '',          -- 仕入先（明細の仕入先）
  source_url       text not null default '',          -- 入稿先 URL
  screenshot_path  text,                              -- 注文画面などのスクショ（Storage uploads）
  memo             text not null default '',
  created_by       uuid references public.users (id) on delete set null,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists print_orders_client_name_idx on public.print_orders (client_name);
create index if not exists print_orders_client_id_idx on public.print_orders (client_id);
create index if not exists print_orders_project_idx on public.print_orders (project_id);
create index if not exists print_orders_estimate_idx on public.print_orders (estimate_id);
create index if not exists print_orders_ordered_on_idx on public.print_orders (ordered_on desc);

drop trigger if exists print_orders_set_updated_at on public.print_orders;
create trigger print_orders_set_updated_at
  before update on public.print_orders
  for each row execute function public.set_updated_at();

alter table public.print_orders enable row level security;
drop policy if exists print_orders_members_all on public.print_orders;
create policy print_orders_members_all on public.print_orders
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

comment on table public.print_orders is '入稿記録（見積のどの明細で、どの入稿先に入稿したか）。追加印刷のときに参照する';
