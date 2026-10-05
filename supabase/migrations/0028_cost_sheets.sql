-- ============================================================================
-- 社内見積（原価計算表）: Google スプレッドシートの「【原価計算表】◯期_クライアント名_社内見積」を
-- タブ 1 枚 = 1 件として取り込んだもの。クライアントカルテで、過去の見積の明細・原価・売価・
-- 仕入先・入稿先 URL・原価の根拠のスクショを見るために使う。
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.cost_sheets (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references public.clients (id) on delete set null,
  client_name     text not null default '',
  period          text not null default '',          -- 14期 など
  title           text not null default '',          -- タブ名から件名だけにしたもの
  status          text not null default 'open' check (status in ('open', 'submitted', 'lost')),
  sheet_date      date,                              -- タブ名の日付（入稿日）
  spreadsheet_id  text not null,
  sheet_gid       bigint not null,
  sheet_title     text not null default '',          -- タブ名そのまま
  file_title      text not null default '',          -- ファイル名そのまま
  sheet_url       text not null default '',
  sell_total      numeric not null default 0,        -- 調整後売価合計（税別）
  cost_total      numeric not null default 0,        -- 外注／仕入合計（税別）
  gross           numeric not null default 0,
  margin          numeric,
  authors         jsonb not null default '[]'::jsonb,
  last_entry_date date,
  lines           jsonb not null default '[]'::jsonb, -- 明細（区分・項目・備考・仕入・掛け率・売価・調整後・仕入先・URL・最終納品）
  images          jsonb not null default '[]'::jsonb, -- 根拠のスクショ（Storage のパスと貼り付け位置）
  imported_at     timestamptz not null default now(),
  imported_by     uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (spreadsheet_id, sheet_gid)
);

create index if not exists cost_sheets_client_idx on public.cost_sheets (client_id);
create index if not exists cost_sheets_client_name_idx on public.cost_sheets (client_name);

drop trigger if exists cost_sheets_set_updated_at on public.cost_sheets;
create trigger cost_sheets_set_updated_at
  before update on public.cost_sheets
  for each row execute function public.set_updated_at();

alter table public.cost_sheets enable row level security;
drop policy if exists cost_sheets_members_all on public.cost_sheets;
create policy cost_sheets_members_all on public.cost_sheets
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

comment on table public.cost_sheets is '社内見積（原価計算表のタブを取り込んだもの）。クライアントカルテで過去の見積の明細と原価を見る';
