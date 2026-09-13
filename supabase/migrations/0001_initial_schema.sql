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
