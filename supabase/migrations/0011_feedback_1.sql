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
