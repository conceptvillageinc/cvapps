-- ============================================================================
-- v2 S5: 売上粗利管理表の目標
--
-- 期ごとに、月別の目標（売上・仕入・目標粗利〔ジャンプ〕・必達粗利）と、
-- 実績の仕入・その他原価（銀行明細に無い分の手入力）を持つ。
-- 12要素の配列は期首の月から順（10月始まりなら [10月, 11月, ..., 9月]）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.fiscal_targets (
  id                  uuid primary key default gen_random_uuid(),
  fiscal_year         integer not null unique,
  -- 目標（税抜・月別）
  sales               jsonb not null default '[]'::jsonb,
  purchase            jsonb not null default '[]'::jsonb,
  gross_jump          jsonb not null default '[]'::jsonb,
  gross_must          jsonb not null default '[]'::jsonb,
  -- 実績の仕入・その他原価（手入力。null の月は銀行明細の出金を使う）
  actual_purchase     jsonb not null default '[]'::jsonb,
  actual_other_cost   jsonb not null default '[]'::jsonb,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists fiscal_targets_set_updated_at on public.fiscal_targets;
create trigger fiscal_targets_set_updated_at
  before update on public.fiscal_targets
  for each row execute function public.set_updated_at();

alter table public.fiscal_targets enable row level security;
drop policy if exists fiscal_targets_members_all on public.fiscal_targets;
create policy fiscal_targets_members_all on public.fiscal_targets
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

insert into public.system_settings (setting_key, setting_value, description)
values ('gross_margin_target', '0.8', '粗利率の目標（0.8 = 80%）')
on conflict (setting_key) do nothing;
