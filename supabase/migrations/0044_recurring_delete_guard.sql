-- ============================================================================
-- 定期売上: 案件を削除したら、案件を作り直さない
--
--   これまで: 定期売上の案件を削除すると、ひな形の project_id が外れ（on delete set null）、
--             その変更でひな形のトリガーが動き、定期売上の案件を新しい番号で作り直していた。
--             毎月 1 日の処理（generate_recurring_notes）でも、案件のないひな形から作り直していた。
--   これから: 定期売上の案件を削除したときは、ひな形を「停止中」にして、案件は作り直さない
--             （ひな形ごと消すときは、アプリの削除画面で「定期売上一覧からも削除する」を選ぶ）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

-- ひな形を登録・変更したら案件にも反映する。ただし次のときは何もしない
--   ・案件を削除して project_id が外れただけ
--   ・案件の削除に合わせてひな形を停止中にしているところ（app.skip_recurring_sync = on）
create or replace function public.recurring_templates_sync_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.skip_recurring_sync', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.project_id is not null and new.project_id is null then
    return new;
  end if;
  perform public.sync_recurring_project(new.id);
  return new;
end;
$$;

-- 定期売上の案件（ひな形ごとの 1 件）を削除したら、そのひな形を停止中にする（毎月の処理で作り直さないように）
create or replace function public.recurring_project_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.recurring_template_id is not null and old.recurring_month is null then
    perform set_config('app.skip_recurring_sync', 'on', true);
    update public.recurring_project_templates
       set is_active = false, project_id = null
     where id = old.recurring_template_id;
    perform set_config('app.skip_recurring_sync', '', true);
  end if;
  return old;
end;
$$;

drop trigger if exists recurring_project_after_delete on public.projects;
create trigger recurring_project_after_delete
  after delete on public.projects
  for each row execute function public.recurring_project_after_delete();
