-- 案件の「参考資料」（ファイル添付）
--   ファイルの実体は Storage の uploads バケット（projects/<案件ID>/attachments/…）。読み書きの権限は既存の uploads の設定のまま
--   一覧は projects.attachments に [{ id, path, name, type, size, caption, uploaded_at, uploaded_by }] で持つ
alter table public.projects
  add column if not exists attachments jsonb not null default '[]'::jsonb;
comment on column public.projects.attachments is '案件の参考資料（添付ファイルの一覧）。ファイルは Storage の uploads/projects/<案件ID>/attachments/';

-- 確認: 列ができたか（attachments・jsonb・既定値 []）
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'projects' and column_name = 'attachments';
