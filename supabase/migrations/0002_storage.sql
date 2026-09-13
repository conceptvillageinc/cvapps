-- ============================================================================
-- Phase 4: ファイル保管（Supabase Storage）
--
-- Base44 の UploadFile を置き換える。見積書PDF・価格表スクリーンショットなど、
-- 仕入先の価格が写った書類を扱うため、バケットは非公開にする。
-- URLを知っていれば誰でも読める状態にはしない。
--
-- 読み書きできるのは public.users に登録済みのメンバーのみ（is_app_member）。
-- サーバー側（Vercel Functions）は service_role で直接読む。
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 26214400)  -- 25MB
on conflict (id) do nothing;

-- 既存のポリシーがあれば作り直す（このファイルは何度実行しても同じ結果になる）
drop policy if exists uploads_members_select on storage.objects;
drop policy if exists uploads_members_insert on storage.objects;
drop policy if exists uploads_members_update on storage.objects;
drop policy if exists uploads_members_delete on storage.objects;

create policy uploads_members_select on storage.objects
  for select using (bucket_id = 'uploads' and public.is_app_member());

create policy uploads_members_insert on storage.objects
  for insert with check (bucket_id = 'uploads' and public.is_app_member());

create policy uploads_members_update on storage.objects
  for update using (bucket_id = 'uploads' and public.is_app_member());

create policy uploads_members_delete on storage.objects
  for delete using (bucket_id = 'uploads' and public.is_app_member());
