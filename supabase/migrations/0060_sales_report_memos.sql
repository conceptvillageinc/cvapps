-- ============================================================================
-- 0060: 売上粗利管理表のメモ
--   「着地見込のみ」「実績のみ」「シミュレーション」の表示ごとに別々のメモを、期ごとに 1 つずつ持つ。
--   見られる・書けるのは daichi@concept-village.co.jp だけ（画面に出さないだけでなく、データベースでも読めない）。
--   見られる人を変えるときは、下の can_view_sales_memos() のアドレスを書き換えて、このファイルをもう一度実行する。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

create or replace function public.can_view_sales_memos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_member()
     and coalesce(public.current_user_email() in (
       'daichi@concept-village.co.jp'
     ), false);
$$;

create table if not exists public.sales_report_memos (
  id           uuid primary key default gen_random_uuid(),
  fiscal_year  integer not null,
  mode         text not null check (mode in ('forecast', 'actual', 'simulation')),
  body         text not null default '',
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (fiscal_year, mode)
);
comment on table public.sales_report_memos is '売上粗利管理表のメモ（期 × 表示: forecast=着地見込のみ / actual=実績のみ / simulation=シミュレーション）';

drop trigger if exists sales_report_memos_set_updated_at on public.sales_report_memos;
create trigger sales_report_memos_set_updated_at before update on public.sales_report_memos
  for each row execute function public.set_updated_at();

alter table public.sales_report_memos enable row level security;
drop policy if exists sales_report_memos_restricted_all on public.sales_report_memos;
create policy sales_report_memos_restricted_all on public.sales_report_memos
  for all to authenticated using (public.can_view_sales_memos()) with check (public.can_view_sales_memos());

-- 確認: テーブルと、読み書きの決まり（ポリシー）ができたか
select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'sales_report_memos';
