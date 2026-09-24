-- ============================================================================
-- dev 環境用: 全マイグレーション（0001〜0014）を順番につなげたもの。
-- 新しい Supabase プロジェクトの SQL Editor に丸ごと貼り付けて Run する（冪等）。
-- 生成: scripts/build-all-migrations.sh（migrations を変えたら再生成する）
-- ============================================================================

-- >>>>>>>> supabase/migrations/0001_initial_schema.sql
-- ============================================================================
-- CV見積アプリ — 初期スキーマ
--
-- Base44 の8エンティティを Postgres へ移行するための定義。
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
--
-- 方針:
--   * Base44 の id（Mongo形式の文字列）は legacy_id として保持し、
--     本来の主キーは uuid にする。移行スクリプトが legacy_id を使って
--     レコード間の参照（改訂元の見積など）を解決する。
--   * created_at / updated_at は Postgres の慣習に合わせる。
--     フロントエンドが期待する created_date / updated_date への読み替えは
--     アダプタ層（src/api/entities.js）が担当する。
--   * freee 連携は対象外のため、freee_* カラムは作らない。
--   * 見積は line_items（新方式）を主とするが、旧方式のカラムも残す。
--     旧データを失わずに移行し、UIの一本化は後から判断できるようにするため。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 共通: updated_at の自動更新
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- users — アプリの利用メンバー（auth.users と 1:1）
-- ============================================================================
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        text not null default 'admin' check (role in ('admin', 'user')),
  department  text,
  legacy_id   text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.users is 'アプリ利用メンバー。この表に行があることが利用許可の条件（RLSで参照）。';

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 利用許可の判定。
-- RLSポリシーから public.users を参照すると再帰するため、
-- security definer にして関数内では RLS を迂回させる。
-- ----------------------------------------------------------------------------
create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users where id = auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- Googleログイン時に public.users を自動作成する。
-- 許可ドメイン以外はここで弾く（サインアップ自体が失敗する）。
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_domain constant text := 'concept-village.co.jp';
begin
  if split_part(new.email, '@', 2) <> allowed_domain then
    raise exception '% は許可されていないドメインです（% のアカウントでログインしてください）',
      new.email, allowed_domain;
  end if;

  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- clients — クライアント（取引先）
-- ============================================================================
create table public.clients (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  name_kana            text,
  contact_person       text,
  contact_person_kana  text,
  email                text,
  phone                text,
  -- ハイフンなし7桁で保存し、表示時に 〒000-0000 へ整形する（src/lib/postalCode.js）
  postal_code          text,
  address              text,
  notes                text,
  -- 見積作成回数。作成画面の並び順に使う。
  -- Base44 のスキーマには未定義のまま使われていたため、ここで正式に定義する。
  quote_count          integer not null default 0,
  legacy_id            text unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index clients_name_idx on public.clients (name);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ============================================================================
-- print_vendors — 印刷所情報
-- ============================================================================
create table public.print_vendors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  vendor_type     text not null default 'email' check (vendor_type in ('email', 'web')),
  print_types     jsonb not null default '[]'::jsonb,
  email           text,
  phone           text,
  website_url     text,
  contact_person  text,
  notes           text,
  legacy_id       text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index print_vendors_name_idx on public.print_vendors (name);

create trigger print_vendors_set_updated_at
  before update on public.print_vendors
  for each row execute function public.set_updated_at();

-- ============================================================================
-- price_masters — 価格マスタ（枚数×納期のグリッド）
-- ============================================================================
create table public.price_masters (
  id                uuid primary key default gen_random_uuid(),
  category          text not null,
  paper_type_group  text not null default '紙' check (paper_type_group in ('紙', '紙以外')),
  vendor_name       text not null,
  spec_summary      text,
  -- [{ quantity, cells: [{ label, price, selected }] }]
  price_grid        jsonb not null default '[]'::jsonb,
  -- 3ヶ月ごとの棚卸し基準日
  last_updated      date,
  screenshot_url    text,
  source_url        text,
  notes             text,
  legacy_id         text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index price_masters_last_updated_idx on public.price_masters (last_updated desc nulls last);

create trigger price_masters_set_updated_at
  before update on public.price_masters
  for each row execute function public.set_updated_at();

-- ============================================================================
-- estimates — 見積
-- ============================================================================
create table public.estimates (
  id                      uuid primary key default gen_random_uuid(),

  -- 採番: CV-YYMM-連番（src/lib/estimateNumber.js）
  estimate_number         text unique,
  client_name             text not null,
  -- 「御中」「様」。Base44 のスキーマには未定義のまま使われていたため正式に定義する。
  client_honorific        text not null default '御中',
  person_in_charge        text,
  estimate_title          text,
  estimate_date           date,
  validity_period_months  numeric not null default 6,

  -- 1 = 旧方式（design_fees / vendor_prices 中心）, 2 = 新方式（line_items 中心）
  schema_version          integer not null default 2,

  -- 新方式の明細
  -- [{ id, row_type: 'item'|'text', category, name, text, quantity, unit,
  --    unit_price, amount, cost_price, markup_rate, source_type, source_ref }]
  line_items              jsonb not null default '[]'::jsonb,

  -- 印刷仕様（旧方式の入力項目だが、新方式でも案件情報として有用なので残す）
  print_type              text,
  size                    text,
  usage                   text,
  paper_type              text,
  quantities              jsonb not null default '[]'::jsonb,
  color_count             text,
  desired_delivery_date   date,
  additional_notes        text,

  status                  text not null default 'draft'
                            check (status in ('draft', 'collecting', 'calculating',
                                              'review_pending', 'review_in_progress',
                                              'approved', 'rejected', 'sent_to_freee')),
  -- 選択肢は system_settings（deal_probability_options / phase_options）で管理するため
  -- ここでは値を固定しない
  deal_probability        text not null default 'B',
  phase                   text not null default '未着手',
  lost_reason             text,

  -- バージョン管理
  is_final_submitted      boolean not null default false,
  project_group_id        text,
  parent_estimate_id      uuid references public.estimates (id) on delete set null,
  revision_label          text,

  total_amount            numeric,

  -- レビュー・承認
  reviewer_id             uuid references public.users (id) on delete set null,
  reviewer_name           text,
  approved_date           timestamptz,
  -- [{ field, comment, author, author_id, timestamp }]
  review_comments         jsonb not null default '[]'::jsonb,
  approval_checklist      jsonb not null default '{}'::jsonb,

  -- ------------------------------------------------------------------------
  -- 旧方式（schema_version = 1）専用。新規見積では使わない。
  -- 移行時にデータを失わないために保持している。
  -- UIを新方式へ一本化する判断がついた時点で、変換のうえ削除できる。
  -- ------------------------------------------------------------------------
  vendor_prices           jsonb not null default '[]'::jsonb,
  selected_vendor         text,
  cost_price              numeric,
  selling_price           numeric,
  gross_profit            numeric,
  markup_rate             numeric,
  proofreading_fee        numeric default 0,
  other_fees              numeric default 0,
  design_fees             jsonb not null default '[]'::jsonb,
  design_fee_total        numeric default 0,

  created_by              uuid references public.users (id) on delete set null,
  legacy_id               text unique,
  -- 改訂元の Base44 id。移行スクリプトが parent_estimate_id を解決するために一時的に使う。
  legacy_parent_id        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index estimates_created_at_idx       on public.estimates (created_at desc);
create index estimates_client_name_idx      on public.estimates (client_name);
create index estimates_status_idx           on public.estimates (status);
create index estimates_project_group_id_idx on public.estimates (project_group_id);

create trigger estimates_set_updated_at
  before update on public.estimates
  for each row execute function public.set_updated_at();

-- ============================================================================
-- email_logs — 見積依頼メールの記録
--
-- 注意: 現状このテーブルは「送信した」という記録を残すだけで、
-- 実際のメール送信は行われていない（Base44版から未実装）。
-- ============================================================================
create table public.email_logs (
  id                 uuid primary key default gen_random_uuid(),
  estimate_id        uuid not null references public.estimates (id) on delete cascade,
  recipient_company  text not null,
  recipient_email    text,
  subject            text,
  body               text,
  status             text not null default 'draft' check (status in ('draft', 'sent', 'failed')),
  sent_at            timestamptz,
  legacy_id          text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index email_logs_estimate_id_idx on public.email_logs (estimate_id);

create trigger email_logs_set_updated_at
  before update on public.email_logs
  for each row execute function public.set_updated_at();

-- ============================================================================
-- system_settings — 掛け率・選択肢・備考テンプレート等
--
-- setting_value は Base44 と同じく JSON文字列として保持する。
-- フロントが JSON.parse / JSON.stringify する前提のコードになっているため。
-- ============================================================================
create table public.system_settings (
  id             uuid primary key default gen_random_uuid(),
  setting_key    text not null unique,
  setting_value  text not null,
  description    text,
  legacy_id      text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger system_settings_set_updated_at
  before update on public.system_settings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- faq_items — Q&A
-- ============================================================================
create table public.faq_items (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answer      text not null,
  sort_order  integer not null default 0,
  legacy_id   text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index faq_items_sort_order_idx on public.faq_items (sort_order);

create trigger faq_items_set_updated_at
  before update on public.faq_items
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS（Row Level Security）
--
-- 全員が同じ権限の社内ツールなので、
-- 「public.users に登録されているメンバーなら全操作可」とする。
-- メンバーでなければ一切読めない。
-- ============================================================================
alter table public.users           enable row level security;
alter table public.clients         enable row level security;
alter table public.print_vendors   enable row level security;
alter table public.price_masters   enable row level security;
alter table public.estimates       enable row level security;
alter table public.email_logs      enable row level security;
alter table public.system_settings enable row level security;
alter table public.faq_items       enable row level security;

-- users: メンバーは全員分を閲覧でき、権限変更もできる（現状は全員 admin 運用）。
-- 自分自身の行は常に読めるようにしておく（サインアップ直後の取りこぼし防止）。
create policy users_select_self on public.users
  for select to authenticated using (id = auth.uid());

create policy users_select_members on public.users
  for select to authenticated using (public.is_app_member());

create policy users_update_members on public.users
  for update to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 業務テーブルは一律「メンバーなら全操作可」
do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'print_vendors', 'price_masters',
    'estimates', 'email_logs', 'system_settings', 'faq_items'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_app_member()) with check (public.is_app_member())',
      t || '_members_all', t
    );
  end loop;
end;
$$;

-- >>>>>>>> supabase/migrations/0002_storage.sql
-- ============================================================================
-- Phase 4: ファイル保管（Supabase Storage）
--
-- Base44 の UploadFile を置き換える。見積書PDF・価格表スクリーンショットなど、
-- 仕入先の価格が写った書類を扱うため、バケットは非公開にする。
-- URLを知っていれば誰でも読める状態にはしない。
--
-- 読み書きできるのは public.users に登録済みのメンバーのみ（is_app_member）。
-- サーバー側（Vercel Functions）は service_role で直接読む。
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 26214400)  -- 25MB
on conflict (id) do nothing;

-- 既存のポリシーがあれば作り直す（このファイルは何度実行しても同じ結果になる）
drop policy if exists uploads_members_select on storage.objects;
drop policy if exists uploads_members_insert on storage.objects;
drop policy if exists uploads_members_update on storage.objects;
drop policy if exists uploads_members_delete on storage.objects;

create policy uploads_members_select on storage.objects
  for select using (bucket_id = 'uploads' and public.is_app_member());

create policy uploads_members_insert on storage.objects
  for insert with check (bucket_id = 'uploads' and public.is_app_member());

create policy uploads_members_update on storage.objects
  for update using (bucket_id = 'uploads' and public.is_app_member());

create policy uploads_members_delete on storage.objects
  for delete using (bucket_id = 'uploads' and public.is_app_member());

-- >>>>>>>> supabase/migrations/0003_invitations.sql
-- ============================================================================
-- Phase 4-B: 招待制にする
--
-- これまでは @concept-village.co.jp のGoogleアカウントであれば、URLを開いて
-- ログインするだけで利用者登録されていた。管理者が招待した人だけが使える形にする。
--
-- 招待は「まだログインしていない人」に対して出すため、auth.users の id では
-- なくメールアドレスで持つ。初回ログイン時にトリガーが照合して利用者を作る。
-- ============================================================================

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  role         text not null default 'user' check (role in ('admin', 'user')),
  invited_by   uuid references public.users (id) on delete set null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists invitations_email_idx on public.invitations (lower(email));

alter table public.invitations enable row level security;

-- ----------------------------------------------------------------------------
-- 管理者判定。RLS の中から users を読むため security definer にする。
-- ----------------------------------------------------------------------------
create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- 参照はメンバー全員、作成・削除は管理者のみ。
-- 実際の招待作成はサーバー側（/api/invite）が service_role で行うが、
-- 画面から直接触られた場合にも効くようにポリシーを張っておく。
drop policy if exists invitations_members_select on public.invitations;
drop policy if exists invitations_admin_write on public.invitations;

create policy invitations_members_select on public.invitations
  for select using (public.is_app_member());

create policy invitations_admin_write on public.invitations
  for all using (public.is_app_admin()) with check (public.is_app_admin());

-- ----------------------------------------------------------------------------
-- 初回ログイン時の利用者作成。
--
-- 変更点: 招待されている人だけを利用者として登録する。
-- 招待が無い場合は public.users を作らずに終わる。認証自体は通るが、
-- アプリ側は「利用者として登録されていません」の画面を出す。
--
-- ここで例外を投げてサインアップごと失敗させる手もあるが、その場合
-- Googleの汎用エラー画面に飛ばされ、本人には理由が分からない。
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_domain constant text := 'concept-village.co.jp';
  invite         public.invitations%rowtype;
  member_count   integer;
begin
  if split_part(new.email, '@', 2) <> allowed_domain then
    raise exception '% は許可されていないドメインです（% のアカウントでログインしてください）',
      new.email, allowed_domain;
  end if;

  select * into invite
  from public.invitations
  where lower(email) = lower(new.email) and accepted_at is null
  limit 1;

  if found then
    insert into public.users (id, email, full_name, role)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      invite.role
    )
    on conflict (id) do nothing;

    update public.invitations set accepted_at = now() where id = invite.id;
    return new;
  end if;

  -- 利用者が1人もいない状態（初期構築時や、全員消えてしまった場合）の救済。
  -- これが無いと招待できる人が誰もいなくなり、アプリに入れなくなる。
  select count(*) into member_count from public.users;
  if member_count = 0 then
    insert into public.users (id, email, full_name, role)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      'admin'
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 新規の利用者は既定を「メンバー」にする。
-- 移行時は Base44 に合わせて全員 admin にしていたが、招待制にするなら
-- 権限は招待時に選ぶのが筋。既存の行の権限は変えない。
-- ----------------------------------------------------------------------------
alter table public.users alter column role set default 'user';

-- >>>>>>>> supabase/migrations/0004_projects.sql
-- ============================================================================
-- v2 S1: 案件（projects）
--
-- 見積・納品書・請求書の親になる単位。freee販売の「案件」に相当する。
-- 受注確度・フェーズは見積ではなく案件の属性にする（freee販売と同じ位置）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- clients: 請求書の送付方法・定期売上の有無
-- freee側では顧客名に【freee送付】【定期あり／freee送付】等のタグを付けて
-- 運用していた。取込時にタグを剥がし、ここへ移す。
-- ----------------------------------------------------------------------------
alter table public.clients
  add column if not exists invoice_delivery_method text
    check (invoice_delivery_method in ('freee', 'post', 'email', 'hand')),
  add column if not exists invoice_delivery_notes  text,
  add column if not exists has_recurring_billing   boolean not null default false;

comment on column public.clients.invoice_delivery_method is '請求書の送付方法: freee=freeeから送付 / post=郵送 / email=個別メール / hand=持参';
comment on column public.clients.invoice_delivery_notes  is '送付に関する補足（宛先の指定、要確認 など）';
comment on column public.clients.has_recurring_billing   is '定期売上（毎月の請求）がある顧客';

-- ----------------------------------------------------------------------------
-- projects
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id                     uuid primary key default gen_random_uuid(),

  -- 採番: P-YYMM-連番（next_project_number）
  project_number         text not null unique,

  client_id              uuid references public.clients (id) on delete set null,
  -- クライアントが削除・改名されても案件の表示が崩れないよう名前も持つ
  client_name            text not null,
  name                   text not null,

  -- 選択肢は system_settings（deal_probability_options / phase_options）で管理
  deal_probability       text not null default 'A',
  phase                  text not null default '引き合い',
  -- open=進行中 / completed=完了 / lost=失注 / cancelled=取り消し
  status                 text not null default 'open'
                           check (status in ('open', 'completed', 'lost', 'cancelled')),

  -- 見込（税抜）。粗利見込 = 受注見込 - 発注見込 - その他費用（freee販売と同じ式）
  expected_revenue       numeric not null default 0,
  expected_cost          numeric not null default 0,
  other_cost             numeric not null default 0,
  expected_gross_profit  numeric generated always as
                           (expected_revenue - expected_cost - other_cost) stored,

  -- 実績（税抜）。S3 以降は納品書・請求書から集計するが、
  -- 取込データや手入力のためにも列として持つ。
  confirmed_revenue      numeric not null default 0,
  confirmed_cost         numeric not null default 0,
  actual_gross_profit    numeric generated always as
                           (confirmed_revenue - confirmed_cost) stored,

  registered_at          date not null default current_date,
  -- 完了予定日（納品予定）
  due_date               date,
  -- 入金予定日。初期値は完了予定日の翌月末（画面側で設定）
  payment_due_date       date,
  -- 仕入先への支払予定日
  vendor_payment_date    date,

  -- 定期売上（毎月発生する案件）
  is_recurring           boolean not null default false,
  notes                  text,

  created_by             uuid references public.users (id) on delete set null,
  -- freee販売からの取込元を識別するキー（重複取込の防止）
  legacy_id              text unique,
  -- 取込元の行をそのまま保持する（列に落とさなかった項目の参照用）
  legacy_data            jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.projects is '案件。見積・納品書・請求書の親。freee販売の「案件」に相当。';

create index if not exists projects_registered_at_idx on public.projects (registered_at desc);
create index if not exists projects_client_id_idx     on public.projects (client_id);
create index if not exists projects_client_name_idx   on public.projects (client_name);
create index if not exists projects_status_idx        on public.projects (status);
create index if not exists projects_due_date_idx      on public.projects (due_date);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

drop policy if exists projects_members_all on public.projects;
create policy projects_members_all on public.projects
  for all to authenticated
  using (public.is_app_member()) with check (public.is_app_member());

-- ----------------------------------------------------------------------------
-- 採番: P-YYMM-連番。月ごとに 001 から。
-- 取込（過去日付）でも画面（今日）でも同じ関数を使う。
-- 画面からは supabase.rpc('next_project_number') で呼ぶ。
-- ----------------------------------------------------------------------------
create or replace function public.next_project_number(p_date date default current_date)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  prefix text := 'P-' || to_char(p_date, 'YYMM') || '-';
  max_seq integer;
begin
  select coalesce(max((substring(project_number from length(prefix) + 1 for 3))::integer), 0)
    into max_seq
    from public.projects
   where project_number like prefix || '___'
     and substring(project_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  return prefix || lpad((max_seq + 1)::text, 3, '0');
end;
$$;

grant execute on function public.next_project_number(date) to authenticated;

-- ----------------------------------------------------------------------------
-- estimates: 案件への紐付け
-- ----------------------------------------------------------------------------
alter table public.estimates
  add column if not exists project_id uuid references public.projects (id) on delete set null;

create index if not exists estimates_project_id_idx on public.estimates (project_id);

-- ----------------------------------------------------------------------------
-- 既存の見積から案件を起こす（project_group_id ごとに1件）。
-- 案件番号は最初の見積番号の CV- を P- に置き換える（CV-2607-001 → P-2607-001）。
-- 受注確度・フェーズは最新の見積の値を引き継ぐ。
-- ----------------------------------------------------------------------------
insert into public.projects (
  project_number, client_name, name, deal_probability, phase,
  expected_revenue, registered_at, due_date, created_by, client_id
)
select
  case when g.project_group_id ~ '^CV-[0-9]{4}-[0-9]{3}$'
       then 'P-' || substring(g.project_group_id from 4)
       else public.next_project_number(g.first_date) end,
  g.client_name,
  coalesce(nullif(g.estimate_title, ''), g.client_name || 'の案件'),
  case when g.deal_probability in ('A', 'C', 'A（定期売上）', '要注意（A）')
       then g.deal_probability else 'A' end,
  case when g.phase in ('引き合い', '着手中', '未着手', '受注済')
       then g.phase else '引き合い' end,
  coalesce(g.total_amount, 0),
  g.first_date,
  g.desired_delivery_date,
  g.created_by,
  (select c.id from public.clients c where c.name = g.client_name order by c.created_at limit 1)
from (
  select distinct on (e.project_group_id)
    e.project_group_id, e.client_name, e.estimate_title, e.deal_probability, e.phase,
    e.total_amount, e.desired_delivery_date, e.created_by,
    min(e.created_at::date) over (partition by e.project_group_id) as first_date
  from public.estimates e
  where e.project_group_id is not null and e.project_id is null
  order by e.project_group_id, e.created_at desc
) g
where not exists (
  select 1 from public.projects p
   where p.project_number = case when g.project_group_id ~ '^CV-[0-9]{4}-[0-9]{3}$'
                                 then 'P-' || substring(g.project_group_id from 4) end
);

update public.estimates e
   set project_id = p.id
  from public.projects p
 where e.project_id is null
   and e.project_group_id ~ '^CV-[0-9]{4}-[0-9]{3}$'
   and p.project_number = 'P-' || substring(e.project_group_id from 4);

-- ----------------------------------------------------------------------------
-- 選択肢を freee販売に合わせる
-- ----------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description)
values
  ('deal_probability_options', '["A","C","A（定期売上）","要注意（A）"]', '受注確度の選択肢'),
  ('phase_options',            '["引き合い","着手中","未着手","受注済"]',   'フェーズの選択肢'),
  ('fiscal_year_start_month',  '10',                                      '期首の月（10 = 10月始まり）')
on conflict (setting_key) do update
  set setting_value = excluded.setting_value,
      description   = coalesce(public.system_settings.description, excluded.description);

-- >>>>>>>> supabase/migrations/0005_recurring_projects.sql
-- ============================================================================
-- v2 S1 追加: 定期売上の案件を毎月自動生成する
--
-- 「ひな形」（recurring_project_templates）を登録しておくと、毎月1日に
-- その月の案件（projects）が1件ずつ作られる。freee販売の「定期売上」に相当。
--
-- 生成は DB 関数 generate_recurring_projects(月) が行う。
--   * Vercel の cron が毎月1日に /api/recurring-projects を呼ぶ
--   * 画面の「今月分を生成」ボタンからも同じ関数を呼べる
-- 同じ月に2回呼んでも二重には作られない（ひな形×月で一意）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.recurring_project_templates (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid references public.clients (id) on delete set null,
  client_name        text not null,
  -- 生成される案件名。月は自動で「（2026年10月分）」のように付く
  name               text not null,
  deal_probability   text not null default 'A（定期売上）',
  phase              text not null default '受注済',
  expected_revenue   numeric not null default 0,
  expected_cost      numeric not null default 0,
  other_cost         numeric not null default 0,
  -- 生成を始める月（その月の1日）と、終える月（省略時は無期限）
  start_month        date not null default date_trunc('month', current_date)::date,
  end_month          date,
  -- false にすると生成を止める（過去に生成した案件はそのまま）
  is_active          boolean not null default true,
  notes              text,
  created_by         uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint recurring_templates_month_is_first_day
    check (start_month = date_trunc('month', start_month)::date
           and (end_month is null or end_month = date_trunc('month', end_month)::date))
);

comment on table public.recurring_project_templates is '定期売上のひな形。毎月1件ずつ projects を生成する元。';

drop trigger if exists recurring_project_templates_set_updated_at on public.recurring_project_templates;
create trigger recurring_project_templates_set_updated_at
  before update on public.recurring_project_templates
  for each row execute function public.set_updated_at();

alter table public.recurring_project_templates enable row level security;

drop policy if exists recurring_project_templates_members_all on public.recurring_project_templates;
create policy recurring_project_templates_members_all on public.recurring_project_templates
  for all to authenticated
  using (public.is_app_member()) with check (public.is_app_member());

-- 生成された案件に、どのひな形の何月分かを記録する
alter table public.projects
  add column if not exists recurring_template_id uuid
    references public.recurring_project_templates (id) on delete set null,
  add column if not exists recurring_month date;

create unique index if not exists projects_recurring_template_month_uniq
  on public.projects (recurring_template_id, recurring_month)
  where recurring_template_id is not null;

-- ----------------------------------------------------------------------------
-- 指定した月（省略時は今月）の定期案件を生成する。戻り値は作った件数。
--
-- 案件登録日 = その月の1日、完了予定日 = その月の末日、
-- 入金予定日 = 翌月末（通常の案件の既定値と同じ）。
-- ----------------------------------------------------------------------------
create or replace function public.generate_recurring_projects(p_month date default current_date)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  month_start date := date_trunc('month', p_month)::date;
  month_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  pay_due     date := (date_trunc('month', p_month) + interval '2 month - 1 day')::date;
  tpl         record;
  created     integer := 0;
begin
  -- 画面からも呼ばれるので、呼び出し元がメンバーか確認する
  -- （cron は service_role で呼ぶため auth.uid() が null になる。その場合は通す）
  if auth.uid() is not null and not public.is_app_member() then
    raise exception 'このアプリの利用者として登録されていません';
  end if;

  for tpl in
    select t.*
      from public.recurring_project_templates t
     where t.is_active
       and t.start_month <= month_start
       and (t.end_month is null or t.end_month >= month_start)
       and not exists (
         select 1 from public.projects p
          where p.recurring_template_id = t.id and p.recurring_month = month_start
       )
     order by t.created_at
  loop
    insert into public.projects (
      project_number, client_id, client_name, name, deal_probability, phase, status,
      expected_revenue, expected_cost, other_cost,
      registered_at, due_date, payment_due_date, is_recurring, notes,
      recurring_template_id, recurring_month, created_by
    ) values (
      public.next_project_number(month_start),
      tpl.client_id, tpl.client_name,
      tpl.name || '（' || to_char(month_start, 'YYYY') || '年' || extract(month from month_start)::integer || '月分）',
      tpl.deal_probability, tpl.phase, 'open',
      tpl.expected_revenue, tpl.expected_cost, tpl.other_cost,
      month_start, month_end, pay_due, true, tpl.notes,
      tpl.id, month_start, tpl.created_by
    );
    created := created + 1;
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_recurring_projects(date) to authenticated;
grant execute on function public.generate_recurring_projects(date) to service_role;

-- >>>>>>>> supabase/migrations/0006_print_specs.sql
-- ============================================================================
-- v2 S2-2: 印刷仕様（print_specs）
--
-- 1つの見積で「チラシ」と「ラベル」のように複数の印刷物を扱えるよう、
-- 仕様を見積の中に配列で持つ。印刷会社への見積依頼メールは仕様から生成する。
--
-- [{ id, label, print_type, size, paper_type, color_count, quantities: [..],
--    usage, finishing, desired_delivery_date, notes }]
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.estimates
  add column if not exists print_specs jsonb not null default '[]'::jsonb;

comment on column public.estimates.print_specs is '印刷仕様の配列。見積依頼メールはここから生成する。';

-- 依頼メールがどの仕様のものかを履歴に残す
alter table public.email_logs
  add column if not exists spec_label text;

-- >>>>>>>> supabase/migrations/0007_documents.sql
-- ============================================================================
-- v2 S3: 納品書（delivery_notes）・請求書（invoices）
--
--   見積 → 納品書（明細を選んで作る） → 請求書（納品書を1つ以上まとめる）
--
-- 明細は各帳票に写しを持つ（jsonb）。見積を後から直しても発行済みの帳票が
-- 変わらないようにするため。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 請求書
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  -- 採番: I-YYMM-連番。freee から取り込んだものは INV-0000000655 の形をそのまま持つ
  invoice_number      text not null unique,
  project_id          uuid references public.projects (id) on delete set null,
  client_id           uuid references public.clients (id) on delete set null,
  client_name         text not null,
  client_honorific    text not null default '御中',
  client_postal_code  text,
  client_address      text,
  title               text,
  invoice_date        date not null default current_date,
  -- 入金期日。既定は請求日の翌月末
  due_date            date,
  -- [{ id, name, quantity, unit, unit_price, amount, tax_rate, transaction_date, delivery_note_id, cost_price }]
  line_items          jsonb not null default '[]'::jsonb,
  subtotal            numeric not null default 0,
  tax                 numeric not null default 0,
  total               numeric not null default 0,
  -- 税率ごとの内訳 [{ rate, taxable, tax }]
  tax_breakdown       jsonb not null default '[]'::jsonb,
  notes               text,
  -- draft=下書き / sent=送付済 / paid=入金済 / cancelled=取消
  status              text not null default 'draft'
                        check (status in ('draft', 'sent', 'paid', 'cancelled')),
  sent_at             timestamptz,
  paid_at             date,
  paid_amount         numeric,
  -- 送付方法（クライアントの設定を写す）
  delivery_method     text,
  person_in_charge    text,
  created_by          uuid references public.users (id) on delete set null,
  legacy_id           text unique,
  legacy_data         jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists invoices_invoice_date_idx on public.invoices (invoice_date desc);
create index if not exists invoices_project_id_idx   on public.invoices (project_id);
create index if not exists invoices_client_name_idx  on public.invoices (client_name);
create index if not exists invoices_status_idx       on public.invoices (status);
create index if not exists invoices_due_date_idx     on public.invoices (due_date);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;
drop policy if exists invoices_members_all on public.invoices;
create policy invoices_members_all on public.invoices
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- ----------------------------------------------------------------------------
-- 納品書
-- ----------------------------------------------------------------------------
create table if not exists public.delivery_notes (
  id                  uuid primary key default gen_random_uuid(),
  -- 採番: D-YYMM-連番
  delivery_number     text not null unique,
  project_id          uuid references public.projects (id) on delete set null,
  estimate_id         uuid references public.estimates (id) on delete set null,
  client_id           uuid references public.clients (id) on delete set null,
  client_name         text not null,
  client_honorific    text not null default '御中',
  client_postal_code  text,
  client_address      text,
  title               text,
  delivery_date       date not null default current_date,
  -- [{ id, name, quantity, unit, unit_price, amount, tax_rate, cost_price, source_line_id }]
  line_items          jsonb not null default '[]'::jsonb,
  subtotal            numeric not null default 0,
  tax                 numeric not null default 0,
  total               numeric not null default 0,
  tax_breakdown       jsonb not null default '[]'::jsonb,
  notes               text,
  -- draft=下書き / issued=発行済
  status              text not null default 'draft' check (status in ('draft', 'issued')),
  -- まとめた請求書。請求書が削除されたら未請求に戻る
  invoice_id          uuid references public.invoices (id) on delete set null,
  person_in_charge    text,
  created_by          uuid references public.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists delivery_notes_delivery_date_idx on public.delivery_notes (delivery_date desc);
create index if not exists delivery_notes_project_id_idx    on public.delivery_notes (project_id);
create index if not exists delivery_notes_estimate_id_idx   on public.delivery_notes (estimate_id);
create index if not exists delivery_notes_invoice_id_idx    on public.delivery_notes (invoice_id);

drop trigger if exists delivery_notes_set_updated_at on public.delivery_notes;
create trigger delivery_notes_set_updated_at
  before update on public.delivery_notes
  for each row execute function public.set_updated_at();

alter table public.delivery_notes enable row level security;
drop policy if exists delivery_notes_members_all on public.delivery_notes;
create policy delivery_notes_members_all on public.delivery_notes
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- ----------------------------------------------------------------------------
-- 採番: D-YYMM-連番 / I-YYMM-連番（月ごとに 001 から）
-- ----------------------------------------------------------------------------
create or replace function public.next_document_number(p_kind text, p_date date default current_date)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  prefix  text;
  max_seq integer;
begin
  if p_kind = 'delivery' then
    prefix := 'D-' || to_char(p_date, 'YYMM') || '-';
    select coalesce(max((substring(delivery_number from length(prefix) + 1 for 3))::integer), 0)
      into max_seq from public.delivery_notes
     where delivery_number like prefix || '___'
       and substring(delivery_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  elsif p_kind = 'invoice' then
    prefix := 'I-' || to_char(p_date, 'YYMM') || '-';
    select coalesce(max((substring(invoice_number from length(prefix) + 1 for 3))::integer), 0)
      into max_seq from public.invoices
     where invoice_number like prefix || '___'
       and substring(invoice_number from length(prefix) + 1 for 3) ~ '^[0-9]{3}$';
  else
    raise exception 'unknown document kind: %', p_kind;
  end if;
  return prefix || lpad((max_seq + 1)::text, 3, '0');
end;
$$;

grant execute on function public.next_document_number(text, date) to authenticated;

-- ----------------------------------------------------------------------------
-- メール送信履歴を帳票（請求書など）にも使えるようにする
-- ----------------------------------------------------------------------------
alter table public.email_logs
  alter column estimate_id drop not null,
  add column if not exists document_type text,
  add column if not exists document_id   uuid;

create index if not exists email_logs_document_idx on public.email_logs (document_type, document_id);

-- ----------------------------------------------------------------------------
-- 会社情報（帳票の自社欄・振込先・登録番号）。画面（システム設定）で編集する。
-- ----------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description)
values (
  'company_info',
  '{"name":"株式会社コンセプト・ヴィレッジ","representative":"","registration_number":"T7011001094049","tel":"024-905-1295","fax":"024-505-4866","locations":[{"label":"福島","postal":"963-0117","address":"福島県郡山市安積荒井三丁目497-B号 cv-studio"},{"label":"沖縄","postal":"900-0033","address":"沖縄県那覇市久米２丁目９－１１ Abc久米ビル 3階"}],"bank_accounts":[{"bank":"東邦銀行","branch":"郡山営業部","type":"普通","number":"2312454","holder":"カ）コンセプト・ヴィレッジ"},{"bank":"琉球銀行","branch":"本店営業部","type":"普通","number":"1353283","holder":"カ）コンセプト・ヴィレッジ"}],"stamp_path":"","invoice_notes":"","delivery_notes":""}',
  '会社情報（帳票用）'
)
on conflict (setting_key) do nothing;

-- >>>>>>>> supabase/migrations/0008_payments.sql
-- ============================================================================
-- v2 S4: 入金確認（銀行明細の取込と請求書との照合）
--
-- 銀行（東邦・琉球）の入出金明細CSVを取り込み、請求書と照合して入金済にする。
-- 照合で覚えた「振込名義 → クライアント」は clients.bank_payee_names に貯め、
-- 次回から自動で候補に出す。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  -- toho / ryukyu / other
  bank              text not null,
  account_label     text,
  transaction_date  date not null,
  amount_in         numeric not null default 0,
  amount_out        numeric not null default 0,
  -- 明細のままの振込名義（半角カナ）と、照合用に正規化したもの
  payee_raw         text,
  payee_normalized  text,
  balance           numeric,
  -- 同じ明細を2回取り込まないためのキー（銀行＋日付＋名義＋金額＋残高）
  source_hash       text not null unique,
  -- unmatched=未照合 / matched=請求書に紐付け済 / ignored=対象外（手数料・仕入など）
  match_status      text not null default 'unmatched'
                      check (match_status in ('unmatched', 'matched', 'ignored')),
  invoice_id        uuid references public.invoices (id) on delete set null,
  matched_by        text check (matched_by in ('auto', 'manual')),
  memo              text,
  imported_by       uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists bank_transactions_date_idx   on public.bank_transactions (transaction_date desc);
create index if not exists bank_transactions_status_idx on public.bank_transactions (match_status);
create index if not exists bank_transactions_invoice_idx on public.bank_transactions (invoice_id);

drop trigger if exists bank_transactions_set_updated_at on public.bank_transactions;
create trigger bank_transactions_set_updated_at
  before update on public.bank_transactions
  for each row execute function public.set_updated_at();

alter table public.bank_transactions enable row level security;
drop policy if exists bank_transactions_members_all on public.bank_transactions;
create policy bank_transactions_members_all on public.bank_transactions
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- クライアントに、覚えた振込名義（正規化済み）を持つ
alter table public.clients
  add column if not exists bank_payee_names jsonb not null default '[]'::jsonb;

comment on column public.clients.bank_payee_names is '銀行明細の振込名義（正規化済み）。入金の照合で学習する。';

-- 会計（MF仕訳CSV）の勘定科目などの設定
insert into public.system_settings (setting_key, setting_value, description)
values (
  'accounting_settings',
  '{"sales_account":"売上高","receivable_account":"売掛金","deposit_account":"普通預金","fee_account":"支払手数料","tax_category_sales":"課税売上 10%","tax_category_sales_reduced":"課税売上 8%（軽減）","tax_category_none":"対象外","bank_sub_accounts":{"toho":"東邦銀行","ryukyu":"琉球銀行"},"department":""}',
  'MF会計 仕訳CSVの勘定科目'
)
on conflict (setting_key) do nothing;

-- >>>>>>>> supabase/migrations/0009_reports.sql
-- ============================================================================
-- v2 S5: 売上粗利管理表の目標
--
-- 期ごとに、月別の目標（売上・仕入・目標粗利〔ジャンプ〕・必達粗利）と、
-- 実績の仕入・その他原価（銀行明細に無い分の手入力）を持つ。
-- 12要素の配列は期首の月から順（10月始まりなら [10月, 11月, ..., 9月]）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.fiscal_targets (
  id                  uuid primary key default gen_random_uuid(),
  fiscal_year         integer not null unique,
  -- 目標（税抜・月別）
  sales               jsonb not null default '[]'::jsonb,
  purchase            jsonb not null default '[]'::jsonb,
  gross_jump          jsonb not null default '[]'::jsonb,
  gross_must          jsonb not null default '[]'::jsonb,
  -- 実績の仕入・その他原価（手入力。null の月は銀行明細の出金を使う）
  actual_purchase     jsonb not null default '[]'::jsonb,
  actual_other_cost   jsonb not null default '[]'::jsonb,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists fiscal_targets_set_updated_at on public.fiscal_targets;
create trigger fiscal_targets_set_updated_at
  before update on public.fiscal_targets
  for each row execute function public.set_updated_at();

alter table public.fiscal_targets enable row level security;
drop policy if exists fiscal_targets_members_all on public.fiscal_targets;
create policy fiscal_targets_members_all on public.fiscal_targets
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

insert into public.system_settings (setting_key, setting_value, description)
values ('gross_margin_target', '0.8', '粗利率の目標（0.8 = 80%）')
on conflict (setting_key) do nothing;

-- >>>>>>>> supabase/migrations/0010_project_tasks.sql
-- ============================================================================
-- v2 S6: 工程管理（project_tasks）と Google スプレッドシートへの出力
--
-- 案件ごとの工程（ヒアリング → 構成 → デザイン → 構築 → 公開 など）を持ち、
-- 「工程管理表」として Google スプレッドシートに書き出してクライアントと共有する。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null,
  -- CV / クライアント / 外注 など、誰が動く工程か
  owner        text,
  start_date   date,
  end_date     date,
  -- todo=未着手 / doing=進行中 / done=完了 / hold=保留
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done', 'hold')),
  notes        text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on public.project_tasks (project_id, sort_order);

drop trigger if exists project_tasks_set_updated_at on public.project_tasks;
create trigger project_tasks_set_updated_at
  before update on public.project_tasks
  for each row execute function public.set_updated_at();

alter table public.project_tasks enable row level security;
drop policy if exists project_tasks_members_all on public.project_tasks;
create policy project_tasks_members_all on public.project_tasks
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 出力先のスプレッドシート（案件ごとに1つ。2回目以降は同じシートを更新する）
alter table public.projects
  add column if not exists schedule_sheet_id  text,
  add column if not exists schedule_sheet_url text;

-- >>>>>>>> supabase/migrations/0011_feedback_1.sql
-- ============================================================================
-- フィードバック（全体整理v2）対応 第1弾
--
--  16  新規案件の既定値: 受注確度 C / フェーズ 未着手。「引き合い」を選択肢から外す
--  11  クライアントのメール: To に加えて CC を最大2件
--   3  ネット印刷の価格が税込表示か税別表示か（印刷所マスタ・価格マスタ）
--  20  レビュー申請先（誰にレビューを頼んだか）
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 16 案件の既定値と、フェーズ「引き合い」の廃止
-- ----------------------------------------------------------------------------
alter table public.projects
  alter column deal_probability set default 'C',
  alter column phase set default '未着手';

alter table public.recurring_project_templates
  alter column phase set default '受注済';

-- 既存の「引き合い」は「未着手」に寄せる（freee 取込時の既定値だったもの）
update public.projects set phase = '未着手' where phase = '引き合い';
update public.recurring_project_templates set phase = '未着手' where phase = '引き合い';

update public.system_settings
   set setting_value = '["未着手","着手中","受注済"]'
 where setting_key = 'phase_options'
   and setting_value like '%引き合い%';

-- ----------------------------------------------------------------------------
-- 11 クライアントの CC アドレス（配列。最大2件を画面で制限）
-- ----------------------------------------------------------------------------
alter table public.clients
  add column if not exists cc_emails jsonb not null default '[]'::jsonb;

comment on column public.clients.cc_emails is '納品書・請求書・見積書メールの CC アドレス（最大2件）';

-- ----------------------------------------------------------------------------
-- 3 価格の税表示（included=税込表示 / excluded=税別表示）
-- ----------------------------------------------------------------------------
alter table public.print_vendors
  add column if not exists price_tax_mode text not null default 'included'
    check (price_tax_mode in ('included', 'excluded'));

alter table public.price_masters
  add column if not exists price_tax_mode text not null default 'included'
    check (price_tax_mode in ('included', 'excluded'));

comment on column public.price_masters.price_tax_mode is 'price_grid の金額が税込(included)か税別(excluded)か。原価は税別に直して使う';

-- ----------------------------------------------------------------------------
-- 20 レビュー申請先
-- ----------------------------------------------------------------------------
alter table public.estimates
  add column if not exists review_requested_to_id   uuid references public.users (id) on delete set null,
  add column if not exists review_requested_to_name text,
  add column if not exists review_requested_at      timestamptz;

-- >>>>>>>> supabase/migrations/0012_tax_inclusive.sql
-- ============================================================================
-- フィードバック No.7: 税込見積
--
-- 見積ごとに「税込で作る」を持つ。true のとき明細の単価・金額は税込で、
-- 消費税は税込合計から逆算する（計算は src/lib/estimateTotals.js）。
-- 行ごとの税率（10% / 8%）は line_items の tax_rate に持つ（列追加なし）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.estimates
  add column if not exists tax_inclusive boolean not null default false;

comment on column public.estimates.tax_inclusive is 'true = 明細の単価・金額が税込（消費税は税込合計から逆算）';

-- >>>>>>>> supabase/migrations/0013_design_fee_masters.sql
-- ============================================================================
-- デザイン費マスタ（design_fee_masters）
--
-- 見積明細の「+明細を追加 → デザイン費」に出る項目を、画面（デザイン費マスタ）から
-- 編集できるようにする。これまでアプリ内に固定で持っていた一覧（src/lib/designFees.js）を
-- 初期データとして投入する（テーブルが空のときだけ）。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

create table if not exists public.design_fee_masters (
  id              uuid primary key default gen_random_uuid(),
  -- 大分類（チラシデザイン / 名刺デザイン など）
  category        text not null,
  category_order  integer not null default 0,
  name            text not null,
  detail          text,
  -- 想定時間と時間単価（参考値。出し値の根拠）
  hours           numeric,
  unit_price      numeric,
  -- 時間 × 時間単価 の計算値（参考）
  amount          numeric,
  -- 見積に入れる金額（税別）
  selling_price   numeric not null default 0,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists design_fee_masters_order_idx on public.design_fee_masters (category_order, sort_order);

drop trigger if exists design_fee_masters_set_updated_at on public.design_fee_masters;
create trigger design_fee_masters_set_updated_at
  before update on public.design_fee_masters
  for each row execute function public.set_updated_at();

alter table public.design_fee_masters enable row level security;
drop policy if exists design_fee_masters_members_all on public.design_fee_masters;
create policy design_fee_masters_members_all on public.design_fee_masters
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 初期データ（テーブルが空のときだけ入れる）
insert into public.design_fee_masters
  (category, category_order, name, detail, hours, unit_price, amount, selling_price, sort_order)
select * from (values
  ('ブランドロゴデザイン', 0, 'ブランドロゴデザイン（まっさらから）', 'BLUE PRINTを活用した事業・サービスの立ち位置整理・方向性明確化', 9.375, 16000, 150000, 150000, 0),
  ('ブランドロゴデザイン', 0, 'ロゴデータ化・キレイ化（データ納品なし）モノクロ・簡易', 'トレース・DICカラー設定', null, null, 5000, 5000, 10),
  ('ブランドロゴデザイン', 0, 'ロゴデータ化・キレイ化（データ納品なし）フルカラー・複雑', 'トレース・DICカラー設定', null, null, 15000, 15000, 20),
  ('ブランドロゴデザイン', 0, 'ロゴデータ化・キレイ化（データ納品）＋ロゴ規定', 'トレース・ロゴ使用規定含む', null, null, 35000, 35000, 30),
  ('ブランドロゴデザイン', 0, 'ブランドロゴ オプション：ブランド名考案', 'ブランド名から一緒に考案', 3, 16000, 48000, 50000, 40),
  ('チラシデザイン', 10, 'チラシ ベースデザイン（A4表面のみ）', '1〜2案（色変更or配置変更）、写真・テキスト完全支給', 4.375, 16000, 70000, 70000, 0),
  ('チラシデザイン', 10, 'チラシ ベースデザイン（A4表面＋裏面）', '1案、写真・テキスト完全支給', 6.25, 16000, 100000, 100000, 10),
  ('チラシデザイン', 10, 'チラシ オプション：テキスト作成（ベーステキスト支給）', '箇条書きテキストから作成', 1.5, 16000, 24000, 25000, 20),
  ('チラシデザイン', 10, 'チラシ オプション：テキスト作成（ヒアリングから）', 'ヒアリングをしてテキスト作成', 3, 16000, 48000, 50000, 30),
  ('リーフレットデザイン', 20, 'リーフレット ベースデザイン（A4）', '1〜2案、写真・テキスト完全支給', 5, 16000, 80000, 80000, 0),
  ('リーフレットデザイン', 20, 'リーフレット ベースデザイン（A3）', '1〜2案、写真・テキスト完全支給', 9, 16000, 144000, 145000, 10),
  ('リーフレットデザイン', 20, 'リーフレット オプション：イラスト作成', 'イラストベースデザイン', 4, 16000, 64000, 60000, 20),
  ('リーフレットデザイン', 20, 'リーフレット オプション：テキスト作成 A4（ベーステキスト支給）', '', 1.5, 16000, 24000, 25000, 30),
  ('リーフレットデザイン', 20, 'リーフレット オプション：テキスト作成 A4（ヒアリングから）', '', 3, 16000, 48000, 50000, 40),
  ('リーフレットデザイン', 20, 'リーフレット オプション：テキスト作成 A3（ベーステキスト支給）', '', 2, 16000, 32000, 35000, 50),
  ('リーフレットデザイン', 20, 'リーフレット オプション：テキスト作成 A3（ヒアリングから）', '', 3.5, 16000, 56000, 60000, 60),
  ('パンフレットデザイン', 30, 'パンフレット ベースデザイン（8ページ）', '1案、写真・テキスト完全支給', 9, 16000, 144000, 145000, 0),
  ('パンフレットデザイン', 30, 'パンフレット ベースデザイン（12ページ）', '1案、写真・テキスト完全支給', 13, 16000, 208000, 210000, 10),
  ('パンフレットデザイン', 30, 'パンフレット ベースデザイン（16ページ）', '1案、写真・テキスト完全支給', 18, 16000, 288000, 290000, 20),
  ('パンフレットデザイン', 30, 'パンフレット ベースデザイン（20ページ）', '1案、写真・テキスト完全支給', 23, 16000, 368000, 370000, 30),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 8p（ベーステキスト支給）', '', 3, 16000, 48000, 50000, 40),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 8p（ヒアリングから）', '', 4, 16000, 64000, 65000, 50),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 12p（ベーステキスト支給）', '', 4, 16000, 64000, 65000, 60),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 12p（ヒアリングから）', '', 5, 16000, 80000, 80000, 70),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 16p（ベーステキスト支給）', '', 5, 16000, 80000, 80000, 80),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 16p（ヒアリングから）', '', 6, 16000, 96000, 100000, 90),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 20p（ベーステキスト支給）', '', 5, 16000, 80000, 80000, 100),
  ('パンフレットデザイン', 30, 'パンフレット オプション：テキスト作成 20p（ヒアリングから）', '', 6, 16000, 96000, 100000, 110),
  ('名刺デザイン', 40, '名刺 ベースデザイン（両面）', '2〜3案、写真・テキスト完全支給', 2, 16000, 32000, 35000, 0),
  ('名刺デザイン', 40, '名刺 デザイン展開（1名あたり）', '', null, 1000, 1000, 1000, 10),
  ('名刺デザイン', 40, '名刺 ベースデザイン（2つ折り）', '1〜2案、写真・テキスト完全支給', 2.8, 16000, 44800, 45000, 20),
  ('名刺デザイン', 40, '名刺 デザイン展開・2つ折り（1名あたり）', '', null, 1000, 1000, 1000, 30),
  ('POPデザイン', 50, 'POP ベースデザイン', '1〜2案、写真・テキスト完全支給', 2.5, 16000, 40000, 40000, 0),
  ('POPデザイン', 50, 'POP デザイン展開（入稿データ作成含む）', '1案', 1, 16000, 16000, 20000, 10),
  ('パネルデザイン', 60, 'パネル ベースデザイン', '1〜2案、写真・テキスト完全支給', 3, 16000, 48000, 50000, 0),
  ('パネルデザイン', 60, 'パネル デザイン展開（入稿データ作成含む）', '1案', 1, 16000, 16000, 20000, 10),
  ('のぼり旗デザイン', 70, 'のぼり旗 ベースデザイン', '1〜2案、写真・テキスト完全支給', 2.5, 16000, 40000, 40000, 0),
  ('のぼり旗デザイン', 70, 'のぼり旗 デザイン展開（入稿データ作成含む）', '1案', 1, 16000, 16000, 20000, 10),
  ('テーブルクロスデザイン', 80, 'テーブルクロス ベースデザイン（入稿データ作成含む）', '1〜2案、写真・テキスト完全支給', 2, 16000, 32000, 35000, 0),
  ('ユニフォームデザイン', 90, 'ユニフォーム ベースデザイン（入稿データ作成含む）', '1〜2案、写真・テキスト完全支給', 1.5, 16000, 24000, 25000, 0),
  ('ユニフォームデザイン', 90, 'ユニフォーム デザイン展開（入稿データ作成含む）', '1案', 1, 10000, 10000, 10000, 10),
  ('商品パッケージデザイン', 100, '商品パッケージ ベースデザイン', '1〜2案、写真・一括表示完全支給', 5, 16000, 80000, 80000, 0),
  ('商品パッケージデザイン', 100, '商品パッケージ デザイン展開（入稿データ作成含む）', '1案', 1, 16000, 16000, 20000, 10),
  ('Webサイトデザイン（LPのみ）', 110, 'LP デザイン', '1〜2案、写真・テキスト完全支給', 10, 16000, 160000, 160000, 0),
  ('Webサイトデザイン（LPのみ）', 110, 'LP 構築費', 'デザイン確定後', 10, 16000, 160000, 160000, 10),
  ('Webサイトデザイン（複数ページ）', 120, 'Web TOPページ デザイン', '1〜2案、写真・テキスト完全支給', 12, 16000, 192000, 195000, 0),
  ('Webサイトデザイン（複数ページ）', 120, 'Web TOP以外の主要ページ デザイン（1ページあたり）', 'TOPデザイン方向性確定後着手', 3, 16000, 48000, 50000, 10),
  ('Webサイトデザイン（複数ページ）', 120, 'Web プライバシーポリシー等テキスト中心ページ（1ページあたり）', '', 1, 16000, 16000, 20000, 20),
  ('Webサイトデザイン（複数ページ）', 120, 'Web 問い合わせページ デザイン', '', 1, 16000, 16000, 20000, 30),
  ('Webサイトデザイン（複数ページ）', 120, 'Web 構築費 TOPページ', '', null, null, 150000, 200000, 40),
  ('Webサイトデザイン（複数ページ）', 120, 'Web 構築費 TOP以外の主要ページ（1ページあたり）', '', null, null, 30000, 40000, 50),
  ('Webサイトデザイン（複数ページ）', 120, 'Web 構築費 プライバシーポリシー等（1ページあたり）', '', null, null, 25000, 30000, 60),
  ('Webサイトデザイン（複数ページ）', 120, 'Web 構築費 問い合わせページ', '', null, null, 25000, 30000, 70),
  ('写真撮影', 130, '写真撮影：商品撮影（3点まで）', '', 0.4, 16000, 6400, 10000, 0),
  ('写真撮影', 130, '写真撮影：調理撮影（1商品2メニューまで）', '', 2, 16000, 32000, 35000, 10),
  ('写真撮影', 130, '写真撮影：出張ロケ撮影（50〜100カット・移動30分〜1時間）', '', 2.5, 16000, 40000, 40000, 20),
  ('写真撮影', 130, '写真撮影：出張ロケ撮影（50〜100カット・移動1時間〜2時間）', '', 3, 16000, 48000, 50000, 30)
) as v(category, category_order, name, detail, hours, unit_price, amount, selling_price, sort_order)
where not exists (select 1 from public.design_fee_masters);

-- >>>>>>>> supabase/migrations/0014_user_email_profile.sql
-- ============================================================================
-- メール用の個人設定（users）
--
-- 見積依頼メール・見積書／請求書送付メールの「名乗り」と「署名」をユーザーごとに持つ。
--   short_name      名乗り用の名前（苗字）。例: 馬場 → 「コンセプト・ヴィレッジ　馬場です。」
--   email_signature メール末尾の署名（複数行）。未設定なら会社名・氏名・メール・電話から組み立てる
-- 各自が「自分の設定」画面（右上のユーザーメニュー）で編集する。
--
-- Supabase の SQL Editor に貼り付けて実行する（冪等）。
-- ============================================================================

alter table public.users
  add column if not exists short_name      text,
  add column if not exists email_signature text;

comment on column public.users.short_name is 'メールの名乗りに使う名前（苗字）';
comment on column public.users.email_signature is 'メール末尾の署名（未設定なら自動生成）';
