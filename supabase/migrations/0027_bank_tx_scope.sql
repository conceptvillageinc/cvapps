-- ============================================================================
-- 銀行明細の「取り込んだ場所」
--   payments … 入金確認で取り込んだもの。入金確認・会計データ出力・売上粗利管理表・資金繰り表で使う
--   cashplan … 資金繰り表で取り込んだもの。資金繰り表の残高の起点にだけ使い、ほかの画面には出さない
-- 同じ明細（source_hash が同じ）を入金確認で取り込み直すと payments に昇格する。
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.bank_transactions
  add column if not exists scope text not null default 'payments';

alter table public.bank_transactions drop constraint if exists bank_transactions_scope_check;
alter table public.bank_transactions
  add constraint bank_transactions_scope_check check (scope in ('payments', 'cashplan'));

create index if not exists bank_transactions_scope_idx on public.bank_transactions (scope);

comment on column public.bank_transactions.scope is 'payments=入金確認で取り込み（全画面で使う） / cashplan=資金繰り表で取り込み（資金繰り表だけで使う）';
