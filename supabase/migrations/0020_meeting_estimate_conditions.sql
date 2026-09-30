-- ============================================================================
-- 0020: 議事録の「見積条件」（印刷物・制作/開発・予算）と、見積への流し込み
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

alter table public.meetings
  add column if not exists estimate_conditions jsonb not null default '{}'::jsonb;

comment on column public.meetings.estimate_conditions is
  '見積条件 { budget, budget_evidence, prints:[{print_type, quantities, size, paper_type, color_count, finishing, due_date, usage, budget, evidence}], works:[{kind, description, days, day_rate, owner, due_date, other_cost, budget, evidence}] }';

alter table public.estimates
  add column if not exists meeting_id     uuid references public.meetings (id) on delete set null,
  add column if not exists meeting_budget numeric;

comment on column public.estimates.meeting_id is 'この見積の元になった議事録';
comment on column public.estimates.meeting_budget is '打ち合わせで出た予算（税別）。見積合計と並べて社内向けに表示';

create index if not exists estimates_meeting_id_idx on public.estimates (meeting_id);
