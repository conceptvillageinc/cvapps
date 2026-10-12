-- ============================================================================
-- 0034: 印刷仕様の一覧（価格調べ）
--   議事録から印刷物の仕様を書き出して一覧にし、過不足を直して確定 → 価格（仕入）を入れて、
--   社内見積（原価計算表）の形で出力する（スプレッドシート・新しい見積・原価計算表に行を足す）。
--   items は 1 行 = 印刷物 1 つ（品目・印刷物種別・サイズ・用紙・色数・加工・数量・単位・納期・備考・根拠・仕入・URL・スクショ）。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create table if not exists public.print_spec_lists (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid references public.meetings (id) on delete set null,
  client_id    uuid references public.clients (id) on delete set null,
  client_name  text,
  project_id   uuid references public.projects (id) on delete set null,
  title        text not null default '',
  items        jsonb not null default '[]'::jsonb,
  -- draft: 仕様を確かめ中 / confirmed: 一覧を確定（価格を入れて出力する段階）
  status       text not null default 'draft' check (status in ('draft', 'confirmed')),
  -- 出力の記録 [{ kind: sheet|estimate|cost_sheet, url, label, at, by }]
  outputs      jsonb not null default '[]'::jsonb,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists print_spec_lists_meeting_idx on public.print_spec_lists (meeting_id);

drop trigger if exists print_spec_lists_set_updated_at on public.print_spec_lists;
create trigger print_spec_lists_set_updated_at before update on public.print_spec_lists
  for each row execute function public.set_updated_at();

alter table public.print_spec_lists enable row level security;
drop policy if exists print_spec_lists_members_all on public.print_spec_lists;
create policy print_spec_lists_members_all on public.print_spec_lists
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

comment on table public.print_spec_lists is '印刷仕様の一覧（議事録から書き出して確定し、価格を入れて社内見積の形で出力する）';

notify pgrst, 'reload schema';
