-- 案件の状態に「未」（pending: まだ動き出していない・進行中の手前）を追加する
--   これまで: open（進行中）・completed（完了）・lost（失注）・cancelled（取消）
--   既存の案件の状態は変えない
-- 状態のチェック制約を外す（名前が違っていても、status と 'cancelled' を含むチェックなら外す）
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'public.projects'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%status%' and pg_get_constraintdef(oid) like '%cancelled%'
  loop
    execute format('alter table public.projects drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.projects add constraint projects_status_check
  check (status in ('pending', 'open', 'completed', 'lost', 'cancelled'));

-- 確認: 状態ごとの案件数と、「未」を受け付けるか（制約の中身）
select status, count(*) as 件数 from public.projects group by status order by status;
select conname, pg_get_constraintdef(oid) as 中身 from pg_constraint where conrelid = 'public.projects'::regclass and conname = 'projects_status_check';
