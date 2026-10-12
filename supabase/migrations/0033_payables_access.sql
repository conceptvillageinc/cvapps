-- ============================================================================
-- 0033: 支払い先まとめ・カード明細を見られる人をしぼる
--   ・支払い先まとめ（payees / payables）… daichi・hinako だけ
--   ・カード利用明細（card_charges）
--       MF（マネーフォワード ビジネスカード）… daichi・hinako
--       JCB・VISA・種類がまだ決まっていない明細 … daichi だけ
--   ・売上粗利管理表・速報デイリーの「仕入」「その他原価」に使う月ごとの合計は、
--     明細を見せずにメンバー全員が引ける関数（payables_cv_monthly / card_cv_monthly）で出す。
--   見られる人を変えるときは、下の 2 つの関数のアドレスを書き換えて、このファイルをもう一度実行する。
-- 冪等。Supabase の SQL Editor に貼って実行する。
-- ============================================================================

-- ログイン中の人のメールアドレス（小文字）
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

-- 支払い先まとめを見られる人
create or replace function public.can_view_payables()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_member()
     and coalesce(public.current_user_email() in (
       'daichi@concept-village.co.jp',
       'hinako@concept-village.co.jp'
     ), false);
$$;

-- JCB・VISA（と種類がまだ決まっていない）カード明細を見られる人
create or replace function public.can_view_private_cards()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_member()
     and coalesce(public.current_user_email() in (
       'daichi@concept-village.co.jp'
     ), false);
$$;

-- カードの種類（mf / jcb / visa。null はまだ決まっていない＝daichi だけ）
alter table public.card_charges add column if not exists card_brand text;
comment on column public.card_charges.card_brand is 'カードの種類（mf / jcb / visa）。null は未設定で daichi だけが見られる';

-- 支払い先まとめ
drop policy if exists payees_members_all on public.payees;
drop policy if exists payees_restricted_all on public.payees;
create policy payees_restricted_all on public.payees
  for all to authenticated using (public.can_view_payables()) with check (public.can_view_payables());

drop policy if exists payables_members_all on public.payables;
drop policy if exists payables_restricted_all on public.payables;
create policy payables_restricted_all on public.payables
  for all to authenticated using (public.can_view_payables()) with check (public.can_view_payables());

-- カード利用明細
drop policy if exists card_charges_members_all on public.card_charges;
drop policy if exists card_charges_restricted_all on public.card_charges;
create policy card_charges_restricted_all on public.card_charges
  for all to authenticated
  using (public.can_view_payables() and (card_brand = 'mf' or public.can_view_private_cards()))
  with check (public.can_view_payables() and (card_brand = 'mf' or public.can_view_private_cards()));

-- 月ごとの合計（明細は返さない）。メンバーなら誰でも引ける
create or replace function public.payables_cv_monthly()
returns table (pay_month text, amount_cv numeric, row_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.pay_month, sum(p.amount_cv), count(*) filter (where p.amount_cv <> 0)
  from public.payables p
  where public.is_app_member()
  group by p.pay_month;
$$;

create or replace function public.card_cv_monthly()
returns table (charge_month text, amount numeric, row_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.charge_month, sum(c.amount), count(*)
  from public.card_charges c
  where public.is_app_member() and coalesce(c.entity, 'cv') = 'cv'
  group by c.charge_month;
$$;

-- 取り込み済みかどうか（指紋）だけを確かめる。見えない明細と同じものを二重に入れないため
create or replace function public.card_fingerprints_exist(fps text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select c.fingerprint from public.card_charges c
  where public.can_view_payables() and c.fingerprint = any (fps);
$$;

revoke all on function public.current_user_email() from public, anon;
revoke all on function public.can_view_payables() from public, anon;
revoke all on function public.can_view_private_cards() from public, anon;
revoke all on function public.payables_cv_monthly() from public, anon;
revoke all on function public.card_cv_monthly() from public, anon;
revoke all on function public.card_fingerprints_exist(text[]) from public, anon;
grant execute on function public.current_user_email() to authenticated;
grant execute on function public.can_view_payables() to authenticated;
grant execute on function public.can_view_private_cards() to authenticated;
grant execute on function public.payables_cv_monthly() to authenticated;
grant execute on function public.card_cv_monthly() to authenticated;
grant execute on function public.card_fingerprints_exist(text[]) to authenticated;

notify pgrst, 'reload schema';
