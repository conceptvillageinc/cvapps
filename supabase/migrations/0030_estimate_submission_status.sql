-- ============================================================================
-- 見積の提出ステータス（未提出／提出済／失注）
--   最後にクライアントへ出した版を「提出済」、通らなかった版を「失注」にする。
--   ・ある版を提出済にすると、同じ見積（project_group_id）で前に提出済だった版は失注になる（画面・サーバーで行う）
--   ・アプリから見積書をメールで送ると、その版は提出済になる（/api/send-document-email）
--   ・案件を失注にすると（状態・受注確度・フェーズが失注）、その案件の提出済の見積は失注になる（下のトリガー）
-- これまでの「最終提出版」（is_final_submitted）は提出済として引き継ぐ。
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.estimates
  add column if not exists submission_status text not null default 'unsubmitted',
  add column if not exists submitted_at timestamptz;

do $$ begin
  alter table public.estimates add constraint estimates_submission_status_check
    check (submission_status in ('unsubmitted', 'submitted', 'lost'));
exception when duplicate_object then null; end $$;

create index if not exists estimates_submission_status_idx on public.estimates (submission_status);

-- これまでの「最終提出版」を提出済に（まだ未提出のままのものだけ）
update public.estimates set submission_status = 'submitted'
 where is_final_submitted = true and submission_status = 'unsubmitted';

-- 案件が失注になったら、その案件の提出済の見積を失注にする
create or replace function public.estimates_lost_with_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status = 'lost' and old.status is distinct from 'lost')
     or (coalesce(new.deal_probability, '') like '%失注%' and coalesce(old.deal_probability, '') not like '%失注%')
     or (coalesce(new.phase, '') like '%失注%' and coalesce(old.phase, '') not like '%失注%') then
    update public.estimates
       set submission_status = 'lost', is_final_submitted = false
     where project_id = new.id and submission_status = 'submitted';
  end if;
  return new;
end $$;

drop trigger if exists projects_lost_estimates on public.projects;
create trigger projects_lost_estimates
  after update on public.projects
  for each row execute function public.estimates_lost_with_project();

comment on column public.estimates.submission_status is '提出ステータス: unsubmitted=未提出 / submitted=提出済（最後に出した版）/ lost=失注';
