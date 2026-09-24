-- ============================================================================
-- 印刷所への見積依頼メールの「返答」を記録する（email_logs）
--
--   sender_email       送った本人のアドレス（返信の確認はこの人の Gmail を読む）
--   gmail_message_id / gmail_thread_id
--                      Gmail 上の送信メールとスレッド。返信の自動確認に使う
--   replied_at / replied_by / reply_note
--                      「返答あり」を手で付けた記録（電話・FAX の返答にも使う）
--   reply_detected_at / reply_from / reply_snippet / reply_checked_at
--                      Gmail を確認して見つけた返信（自動）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.email_logs
  add column if not exists sender_email      text,
  add column if not exists gmail_message_id  text,
  add column if not exists gmail_thread_id   text,
  add column if not exists replied_at        timestamptz,
  add column if not exists replied_by        text,
  add column if not exists reply_note        text,
  add column if not exists reply_detected_at timestamptz,
  add column if not exists reply_from        text,
  add column if not exists reply_snippet     text,
  add column if not exists reply_checked_at  timestamptz;

comment on column public.email_logs.gmail_thread_id is 'Gmail のスレッドID。返信の自動確認に使う';
comment on column public.email_logs.replied_at is '「返答あり」を手で付けた日時';
comment on column public.email_logs.reply_detected_at is 'Gmail で返信を検知した日時';
