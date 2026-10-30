-- ============================================================================
-- 案件の実績（受注合計・発注合計）を自動にする
--   受注合計 = 請求書（この案件の分）、発注合計 = 連携先への発注書 ＋ 入稿記録の原価。
--   画面が confirmed_revenue / confirmed_cost に書き戻す（src/lib/projectActuals.js）。
--   手で入れた案件は「手入力」の印を付け、自動では上書きしない。
--
--   いま手入力の値が入っている案件は、値を守るために「手入力」にしておく
--   （案件の画面の「自動に戻す」で、請求書などから出す形に切り替えられる）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.projects
  add column if not exists actual_revenue_manual boolean,
  add column if not exists actual_cost_manual boolean;

-- 初めて流したときだけ: 値が入っている案件は手入力、空の案件は自動
update public.projects set actual_revenue_manual = coalesce(confirmed_revenue, 0) <> 0 where actual_revenue_manual is null;
update public.projects set actual_cost_manual    = coalesce(confirmed_cost, 0) <> 0    where actual_cost_manual is null;

alter table public.projects
  alter column actual_revenue_manual set default false,
  alter column actual_revenue_manual set not null,
  alter column actual_cost_manual set default false,
  alter column actual_cost_manual set not null;

comment on column public.projects.actual_revenue_manual is '受注合計（実績）を手で入れた（true なら請求書から自動で上書きしない）';
comment on column public.projects.actual_cost_manual is '発注合計（実績）を手で入れた（true なら発注書・入稿記録から自動で上書きしない）';
