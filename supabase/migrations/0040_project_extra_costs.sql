-- ============================================================================
-- 案件の「見積外の原価」
--   見積には入っていないが、仕入で後から原価に入る金額（原価計算表の「掛け率 1.00 の行」にあたる）。
--   行は案件に JSON で持ち、合計は画面がその他費用（other_cost）に足し込む
--   （粗利見込・売上粗利管理表・資金繰りはその他費用を見るので、そのまま反映される）。
--   [{ id, date, author, name, vendor, amount, memo }]（amount は税抜）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.projects
  add column if not exists extra_costs jsonb not null default '[]'::jsonb;

comment on column public.projects.extra_costs is '見積外の原価（後から仕入で原価に入る金額）の行。合計は other_cost に含めて持つ';
