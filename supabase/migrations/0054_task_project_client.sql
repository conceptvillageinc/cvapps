-- ============================================================================
-- プロジェクト（タスク管理）をクライアントで作れるようにする
--
--   task_projects.client_id … クライアントのプロジェクト（Asana と同じく、クライアント名で作る）。
--                             そのクライアントの案件と、案件のタスクがプロジェクトの中に並ぶ。
--                             空なら社内のプロジェクト（校正・入稿・発注・請求・売上 など）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。最後の SELECT で 1 行出れば完了。
-- ============================================================================

alter table public.task_projects
  add column if not exists client_id uuid references public.clients (id) on delete set null;

create index if not exists task_projects_client_idx on public.task_projects (client_id);

comment on column public.task_projects.client_id is 'クライアントのプロジェクト（空なら社内のプロジェクト）';

-- 項目を足したことを、Supabase（PostgREST）にすぐ読み直させる
notify pgrst, 'reload schema';

-- 確認: client_id の行が 1 行出れば完了
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'task_projects' and column_name = 'client_id';
