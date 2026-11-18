-- ============================================================================
-- 0062: 作成者・更新者と、変更の履歴
--   対象: 案件・見積書・納品書・請求書・領収書・発注書・定期売上（ひな形）・クライアント
--   ・作成者（created_by）… 作ったときにログイン中の人を自動で入れる（画面が入れていなければ）
--   ・更新者（updated_by）… 書き換えるたびにログイン中の人を自動で入れる
--   ・変更の履歴（record_history）… 作成・変更・削除のたびに「いつ・誰が・どの項目を」残す
--       同じ人が 10 分以内に続けて書き換えた分（自動保存など）は 1 行にまとめる
--       ログインした人がいない書き換え（メール送付の記録・毎月の自動作成など）は「システム（自動）」
--   この SQL より前の作成・変更は履歴に残っていない（作成者は入っている分だけ出る）
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

-- 変更の履歴
create table if not exists public.record_history (
  id              uuid primary key default gen_random_uuid(),
  table_name      text not null,
  record_id       uuid not null,
  action          text not null check (action in ('insert', 'update', 'delete')),
  user_id         uuid,
  user_name       text not null default '',
  changed_fields  text[] not null default '{}',
  changes         jsonb not null default '{}'::jsonb,   -- { 項目: [前, 後] }（短い値だけ。明細など大きいものは null）
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists record_history_record_idx on public.record_history (table_name, record_id, created_at desc);
comment on table public.record_history is '案件・見積書・納品書・請求書・領収書・発注書・定期売上・クライアントの作成・変更・削除の履歴（トリガーが書く）';

alter table public.record_history enable row level security;
drop policy if exists record_history_read on public.record_history;
create policy record_history_read on public.record_history
  for select to authenticated using (public.is_app_member());
-- 書き込みはトリガー（security definer）だけ。画面からは書けない

-- 作成者・更新者を入れる（作成者は画面が入れていなければ。メンバー表にいる人だけ）
create or replace function public.stamp_record_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  member uuid;
begin
  if uid is not null then
    select id into member from public.users where id = uid;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is null and member is not null then new.created_by := member; end if;
    new.updated_by := member;
  else
    new.updated_by := member;
  end if;
  return new;
end;
$$;

-- 変更の履歴を書く
create or replace function public.track_record_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  uname text := 'システム（自動）';
  rid uuid;
  fields text[] := '{}';
  diff jsonb := '{}'::jsonb;
  k text; ov jsonb; nv jsonb;
  last_row public.record_history%rowtype;
  skip text[] := array['updated_at', 'updated_by', 'created_at', 'created_by', 'search_text'];
begin
  if uid is not null then
    select coalesce(nullif(trim(full_name), ''), email) into uname from public.users where id = uid;
    uname := coalesce(uname, 'ログイン中の人');
  end if;

  if tg_op = 'DELETE' then
    rid := old.id;
    insert into public.record_history (table_name, record_id, action, user_id, user_name)
    values (tg_table_name, rid, 'delete', uid, uname);
    return old;
  end if;

  rid := new.id;
  if tg_op = 'INSERT' then
    insert into public.record_history (table_name, record_id, action, user_id, user_name)
    values (tg_table_name, rid, 'insert', uid, uname);
    return new;
  end if;

  -- UPDATE: 変わった項目（日時の自動更新などは除く）
  for k, nv in select key, value from jsonb_each(to_jsonb(new)) loop
    if k = any(skip) then continue; end if;
    ov := to_jsonb(old) -> k;
    if ov is distinct from nv then
      fields := fields || k;
      -- 短い値（文字・数・真偽・空）だけ前後を残す。明細などの大きいものは「変わった」だけ
      if (ov is null or jsonb_typeof(ov) in ('string', 'number', 'boolean', 'null')) and (nv is null or jsonb_typeof(nv) in ('string', 'number', 'boolean', 'null'))
         and coalesce(length(ov::text), 0) <= 200 and coalesce(length(nv::text), 0) <= 200 then
        diff := diff || jsonb_build_object(k, jsonb_build_array(ov, nv));
      else
        diff := diff || jsonb_build_object(k, null);
      end if;
    end if;
  end loop;
  if array_length(fields, 1) is null then return new; end if;

  -- 同じ人が 10 分以内に続けて書き換えた分は 1 行にまとめる（前の値は最初のまま、後の値は最新に）
  select * into last_row from public.record_history
   where table_name = tg_table_name and record_id = rid
   order by updated_at desc limit 1;
  if found and last_row.action = 'update' and last_row.user_id is not distinct from uid and last_row.updated_at > now() - interval '10 minutes' then
    update public.record_history set
      changed_fields = (select array_agg(distinct f) from unnest(last_row.changed_fields || fields) f),
      changes = (
        select coalesce(jsonb_object_agg(key, case
                 when d.value is null or (last_row.changes -> key) is null then d.value
                 else jsonb_build_array((last_row.changes -> key) -> 0, d.value -> 1) end), '{}'::jsonb)
          from jsonb_each(diff) d
      ) || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(last_row.changes) e where not (diff ? e.key)),
      updated_at = now()
    where id = last_row.id;
  else
    insert into public.record_history (table_name, record_id, action, user_id, user_name, changed_fields, changes)
    values (tg_table_name, rid, 'update', uid, uname, fields, diff);
  end if;
  return new;
end;
$$;

-- 8 つの表に、作成者・更新者の列とトリガーを付ける（まだ作っていない表は飛ばす。あとで作ったら、この SQL をもう一度実行する）
do $$
declare t text;
begin
  foreach t in array array['projects', 'estimates', 'delivery_notes', 'invoices', 'receipts', 'partner_orders', 'recurring_project_templates', 'clients'] loop
    if to_regclass('public.' || t) is null then
      raise notice '表 % がまだ無いので飛ばしました', t;
      continue;
    end if;
    execute format('alter table public.%I add column if not exists created_by uuid', t);
    execute format('alter table public.%I add column if not exists updated_by uuid', t);
    execute format('drop trigger if exists %I on public.%I', t || '_stamp_user', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.stamp_record_user()', t || '_stamp_user', t);
    execute format('drop trigger if exists %I on public.%I', t || '_history', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.track_record_history()', t || '_history', t);
  end loop;
end $$;

-- 確認: 8 つの表それぞれに、記録の仕組みが付いたか（「まだ無い表」と出たものは飛ばした表）
select t.name as 表,
  case when to_regclass('public.' || t.name) is null then 'まだ無い表（飛ばしました）'
       else coalesce((select string_agg(distinct trigger_name, '・' order by trigger_name) from information_schema.triggers
                      where trigger_schema = 'public' and event_object_table = t.name
                        and (trigger_name like '%\_stamp\_user' or trigger_name like '%\_history')), '付いていません') end as 記録の仕組み
from unnest(array['projects', 'estimates', 'delivery_notes', 'invoices', 'receipts', 'partner_orders', 'recurring_project_templates', 'clients']) as t(name)
order by 1;
