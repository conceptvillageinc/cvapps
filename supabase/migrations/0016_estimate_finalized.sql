-- ============================================================================
-- 見積の状態に「確定（レビューなし）」を追加
--
-- レビューは必須ではないので、相談せずにそのまま送付する見積を区別できるようにする。
--   status = 'finalized'   レビューなしで確定
--   finalized_at / finalized_by  誰がいつ確定したか
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.estimates drop constraint if exists estimates_status_check;
alter table public.estimates
  add constraint estimates_status_check
  check (status in ('draft', 'collecting', 'calculating', 'review_pending', 'review_in_progress',
                    'approved', 'rejected', 'sent_to_freee', 'finalized'));

alter table public.estimates
  add column if not exists finalized_at timestamptz,
  add column if not exists finalized_by text;

comment on column public.estimates.finalized_at is 'レビューなしで確定した日時';
