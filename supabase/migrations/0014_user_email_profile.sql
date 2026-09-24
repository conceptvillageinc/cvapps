-- ============================================================================
-- メール用の個人設定（users）
--
-- 見積依頼メール・見積書／請求書送付メールの「名乗り」と「署名」をユーザーごとに持つ。
--   short_name      名乗り用の名前（苗字）。例: 馬場 → 「コンセプト・ヴィレッジ　馬場です。」
--   email_signature メール末尾の署名（複数行）。未設定なら会社名・氏名・メール・電話から組み立てる
-- 各自が「自分の設定」画面（右上のユーザーメニュー）で編集する。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.users
  add column if not exists short_name      text,
  add column if not exists email_signature text;

comment on column public.users.short_name is 'メールの名乗りに使う名前（苗字）';
comment on column public.users.email_signature is 'メール末尾の署名（未設定なら自動生成）';
