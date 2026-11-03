-- ============================================================================
-- 見積の社内メモ（見積ごと）
--
--   internal_memo … 社内だけで見るメモ。見積書・プレビュー・PDF・メール・納品書には出さない。
--                   見積の編集画面（印刷費・仕入の価格確認の下）で書き、案件詳細の見積の欄にも先頭を出す。
--   ※ 明細の「提出」チェック（外すと社内用）は明細（line_items）の中に持つので、SQL は不要。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。最後の SELECT で 1 行出れば完了。
-- ============================================================================

alter table public.estimates
  add column if not exists internal_memo text;

comment on column public.estimates.internal_memo is '社内メモ（提出物には出さない）';

-- 項目を足したことを、Supabase（PostgREST）にすぐ読み直させる
notify pgrst, 'reload schema';

-- 確認: internal_memo の行が 1 行出れば完了
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'estimates' and column_name = 'internal_memo';
