-- 売上粗利管理表のメモ（「着地見込のみ」「実績のみ」「シミュレーション」の表示ごとに別々。期ごと）
--   { forecast: { text, updated_at, updated_by }, actual: {...}, simulation: {...} }
--   読み書きの権限は fiscal_targets のまま（アプリのメンバー）
alter table public.fiscal_targets
  add column if not exists memos jsonb not null default '{}'::jsonb;
comment on column public.fiscal_targets.memos is '売上粗利管理表のメモ（表示ごと: forecast / actual / simulation）';

-- 確認: 列ができたか（memos・jsonb・既定値 {}）
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'fiscal_targets' and column_name = 'memos';
