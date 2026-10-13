-- ============================================================================
-- 0036: 工程表テンプレート（マスタ）と、最初の 19 種類
--   案件の工程表が空のとき、案件名から合うテンプレートを選んで下書きを出す
--   steps: [{ key, category, name, phase, parties, days(営業日), after(前の工程の key), is_milestone, on_schedule }]
--   keywords: 案件名・見積の件名にこの言葉があれば候補に出す
-- 0035 のあとに実行する。冪等（同じ名前のテンプレートがあれば入れない。マスタの画面で直せる）。
-- ============================================================================

create table if not exists public.schedule_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  keywords    jsonb not null default '[]'::jsonb,
  steps       jsonb not null default '[]'::jsonb,
  notes       text,
  sort_order  integer not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists schedule_templates_name_key on public.schedule_templates (name);

drop trigger if exists schedule_templates_set_updated_at on public.schedule_templates;
create trigger schedule_templates_set_updated_at before update on public.schedule_templates
  for each row execute function public.set_updated_at();

alter table public.schedule_templates enable row level security;
drop policy if exists schedule_templates_members_all on public.schedule_templates;
create policy schedule_templates_members_all on public.schedule_templates
  for all to authenticated using (public.is_app_member()) with check (public.is_app_member());

-- 1. ブランドロゴ
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('ブランドロゴ', '["ロゴ","ブランド","ci","vi"]'::jsonb, 10, '[
  {"key":"s1","category":"ブランドロゴ","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"ブランドロゴ","name":"リサーチ・方向性の整理","phase":"初稿","parties":["cv"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"ブランドロゴ","name":"コンセプト・ラフ案のご提案","phase":"初稿","parties":["cv"],"days":7,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"ブランドロゴ","name":"ラフ案のご確認・選定","phase":"確認","parties":["client"],"days":3,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"ブランドロゴ","name":"ブラッシュアップ","phase":"第二稿","parties":["cv"],"days":5,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"ブランドロゴ","name":"ブラッシュアップ案のご確認","phase":"確認","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"ブランドロゴ","name":"最終調整・決定","phase":"校了","parties":["cv","client"],"days":2,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"ブランドロゴ","name":"データ作成・ロゴガイドライン","phase":"納品","parties":["cv"],"days":3,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s8"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 2. チラシ
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('チラシ', '["チラシ","フライヤー","ちらし"]'::jsonb, 20, '[
  {"key":"s1","category":"チラシ","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"チラシ","name":"原稿・写真のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"チラシ","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":5,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"チラシ","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"チラシ","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"チラシ","name":"第二稿確認","phase":"確認","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"チラシ","name":"最終修正・校了","phase":"校了","parties":["cv","client"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"チラシ","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"チラシ","name":"印刷・配送","phase":"印刷・配送","parties":["other:印刷会社"],"days":4,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s9"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 3. ポスター
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('ポスター', '["ポスター"]'::jsonb, 30, '[
  {"key":"s1","category":"ポスター","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"ポスター","name":"原稿・写真のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"ポスター","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":4,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"ポスター","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"ポスター","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"ポスター","name":"第二稿確認","phase":"確認","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"ポスター","name":"最終修正・校了","phase":"校了","parties":["cv","client"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"ポスター","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"ポスター","name":"印刷・配送","phase":"印刷・配送","parties":["other:印刷会社"],"days":5,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s9"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 4. パンフレット
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('パンフレット', '["パンフレット","冊子","会社案内","カタログ"]'::jsonb, 40, '[
  {"key":"s1","category":"パンフレット","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"パンフレット","name":"構成案作成","phase":"初稿","parties":["cv"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"パンフレット","name":"構成確認","phase":"確認","parties":["client"],"days":2,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"パンフレット","name":"原稿・写真のご提供","phase":"確認","parties":["client"],"days":3,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"パンフレット","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":8,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"パンフレット","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"パンフレット","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"パンフレット","name":"第二稿確認","phase":"確認","parties":["client"],"days":2,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"パンフレット","name":"修正・第三稿","phase":"第三稿","parties":["cv"],"days":2,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"パンフレット","name":"第三稿確認","phase":"確認","parties":["client"],"days":2,"after":["s9"],"is_milestone":false,"on_schedule":true},
  {"key":"s11","category":"パンフレット","name":"最終修正・校了","phase":"校了","parties":["cv","client"],"days":1,"after":["s10"],"is_milestone":false,"on_schedule":true},
  {"key":"s12","category":"パンフレット","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s11"],"is_milestone":false,"on_schedule":true},
  {"key":"s13","category":"パンフレット","name":"印刷・製本・配送","phase":"印刷・配送","parties":["other:印刷会社"],"days":7,"after":["s12"],"is_milestone":false,"on_schedule":true},
  {"key":"s14","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s13"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 5. リーフレット
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('リーフレット', '["リーフレット"]'::jsonb, 50, '[
  {"key":"s1","category":"リーフレット","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"リーフレット","name":"構成案作成","phase":"初稿","parties":["cv"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"リーフレット","name":"構成確認","phase":"確認","parties":["client"],"days":2,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"リーフレット","name":"原稿・写真のご提供","phase":"確認","parties":["client"],"days":3,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"リーフレット","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":6,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"リーフレット","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"リーフレット","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"リーフレット","name":"第二稿確認","phase":"確認","parties":["client"],"days":2,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"リーフレット","name":"最終修正・校了","phase":"校了","parties":["cv","client"],"days":1,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"リーフレット","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s9"],"is_milestone":false,"on_schedule":true},
  {"key":"s11","category":"リーフレット","name":"印刷・折り・配送","phase":"印刷・配送","parties":["other:印刷会社"],"days":5,"after":["s10"],"is_milestone":false,"on_schedule":true},
  {"key":"s12","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s11"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 6. POP
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('POP', '["pop","ポップ"]'::jsonb, 60, '[
  {"key":"s1","category":"POP","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"POP","name":"原稿・写真のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"POP","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":3,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"POP","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"POP","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"POP","name":"第二稿確認","phase":"確認","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"POP","name":"最終修正・校了","phase":"校了","parties":["cv","client"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"POP","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"POP","name":"印刷・配送","phase":"印刷・配送","parties":["other:印刷会社"],"days":4,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s9"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 7. パッケージデザイン
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('パッケージデザイン', '["パッケージ","ラベル","シール","箱"]'::jsonb, 70, '[
  {"key":"s1","category":"パッケージデザイン","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"パッケージデザイン","name":"方向性・コンセプトの整理","phase":"初稿","parties":["cv"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"パッケージデザイン","name":"デザイン案のご提案","phase":"初稿","parties":["cv"],"days":7,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"パッケージデザイン","name":"デザイン案のご確認","phase":"確認","parties":["client"],"days":3,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"パッケージデザイン","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":3,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"パッケージデザイン","name":"第二稿確認","phase":"確認","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"パッケージデザイン","name":"版下・展開図の作成","phase":"入稿","parties":["cv"],"days":3,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"パッケージデザイン","name":"色校正","phase":"確認","parties":["other:印刷会社"],"days":5,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"パッケージデザイン","name":"色校のご確認・校了","phase":"校了","parties":["client"],"days":2,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"パッケージデザイン","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s9"],"is_milestone":false,"on_schedule":true},
  {"key":"s11","category":"パッケージデザイン","name":"印刷・加工・配送","phase":"印刷・配送","parties":["other:印刷会社"],"days":10,"after":["s10"],"is_milestone":false,"on_schedule":true},
  {"key":"s12","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s11"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 8. 名刺
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('名刺', '["名刺"]'::jsonb, 80, '[
  {"key":"s1","category":"名刺","name":"掲載内容のご提供","phase":"確認","parties":["client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"名刺","name":"デザイン","phase":"初稿","parties":["cv"],"days":2,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"名刺","name":"デザインのご確認","phase":"確認","parties":["client"],"days":1,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"名刺","name":"修正・校了","phase":"校了","parties":["cv","client"],"days":1,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"名刺","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"名刺","name":"印刷・配送","phase":"印刷・配送","parties":["other:印刷会社"],"days":4,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s6"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 9. 展示会ツール（タペストリー・腰巻き・のぼり旗・ミニのぼり旗・パネル）
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('展示会ツール（タペストリー・腰巻き・のぼり旗・ミニのぼり旗・パネル）', '["展示会","イベント","ブース"]'::jsonb, 90, '[
  {"key":"k1","category":"全制作物","name":"キックオフ打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"k2","category":"全制作物","name":"原稿・写真・ロゴのご提供","phase":"確認","parties":["client"],"days":3,"after":["k1"],"is_milestone":false,"on_schedule":true},
  {"key":"ta1","category":"タペストリー","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":4,"after":["k2"],"is_milestone":false,"on_schedule":true},
  {"key":"ta2","category":"タペストリー","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["ta1"],"is_milestone":false,"on_schedule":true},
  {"key":"ta3","category":"タペストリー","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["ta2"],"is_milestone":false,"on_schedule":true},
  {"key":"ta4","category":"タペストリー","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["ta3"],"is_milestone":false,"on_schedule":true},
  {"key":"ta5","category":"タペストリー","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["ta4"],"is_milestone":false,"on_schedule":true},
  {"key":"ta6","category":"タペストリー","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["ta5"],"is_milestone":false,"on_schedule":true},
  {"key":"ko1","category":"腰巻き","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":3,"after":["k2"],"is_milestone":false,"on_schedule":true},
  {"key":"ko2","category":"腰巻き","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["ko1"],"is_milestone":false,"on_schedule":true},
  {"key":"ko3","category":"腰巻き","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["ko2"],"is_milestone":false,"on_schedule":true},
  {"key":"ko4","category":"腰巻き","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["ko3"],"is_milestone":false,"on_schedule":true},
  {"key":"ko5","category":"腰巻き","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["ko4"],"is_milestone":false,"on_schedule":true},
  {"key":"ko6","category":"腰巻き","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["ko5"],"is_milestone":false,"on_schedule":true},
  {"key":"no1","category":"のぼり旗","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":3,"after":["k2"],"is_milestone":false,"on_schedule":true},
  {"key":"no2","category":"のぼり旗","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["no1"],"is_milestone":false,"on_schedule":true},
  {"key":"no3","category":"のぼり旗","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["no2"],"is_milestone":false,"on_schedule":true},
  {"key":"no4","category":"のぼり旗","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["no3"],"is_milestone":false,"on_schedule":true},
  {"key":"no5","category":"のぼり旗","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["no4"],"is_milestone":false,"on_schedule":true},
  {"key":"no6","category":"のぼり旗","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["no5"],"is_milestone":false,"on_schedule":true},
  {"key":"mn1","category":"ミニのぼり旗","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":2,"after":["k2"],"is_milestone":false,"on_schedule":true},
  {"key":"mn2","category":"ミニのぼり旗","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["mn1"],"is_milestone":false,"on_schedule":true},
  {"key":"mn3","category":"ミニのぼり旗","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["mn2"],"is_milestone":false,"on_schedule":true},
  {"key":"mn4","category":"ミニのぼり旗","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["mn3"],"is_milestone":false,"on_schedule":true},
  {"key":"mn5","category":"ミニのぼり旗","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["mn4"],"is_milestone":false,"on_schedule":true},
  {"key":"mn6","category":"ミニのぼり旗","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["mn5"],"is_milestone":false,"on_schedule":true},
  {"key":"pa1","category":"パネル","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":4,"after":["k2"],"is_milestone":false,"on_schedule":true},
  {"key":"pa2","category":"パネル","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["pa1"],"is_milestone":false,"on_schedule":true},
  {"key":"pa3","category":"パネル","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["pa2"],"is_milestone":false,"on_schedule":true},
  {"key":"pa4","category":"パネル","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["pa3"],"is_milestone":false,"on_schedule":true},
  {"key":"pa5","category":"パネル","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["pa4"],"is_milestone":false,"on_schedule":true},
  {"key":"pa6","category":"パネル","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":5,"after":["pa5"],"is_milestone":false,"on_schedule":true},
  {"key":"s33","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["ta6","ko6","no6","mn6","pa6"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 10. タペストリー
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('タペストリー', '["タペストリー"]'::jsonb, 100, '[
  {"key":"s1","category":"タペストリー","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"タペストリー","name":"原稿・素材のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"タペストリー","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":4,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"タペストリー","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"タペストリー","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"タペストリー","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"タペストリー","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"タペストリー","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s8"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 11. 腰巻き
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('腰巻き', '["腰巻","腰幕","テーブルクロス"]'::jsonb, 110, '[
  {"key":"s1","category":"腰巻き","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"腰巻き","name":"原稿・素材のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"腰巻き","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":3,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"腰巻き","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"腰巻き","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"腰巻き","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"腰巻き","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"腰巻き","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s8"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 12. のぼり旗
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('のぼり旗', '["のぼり"]'::jsonb, 120, '[
  {"key":"s1","category":"のぼり旗","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"のぼり旗","name":"原稿・素材のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"のぼり旗","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":3,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"のぼり旗","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"のぼり旗","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"のぼり旗","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"のぼり旗","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"のぼり旗","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s8"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 13. ミニのぼり旗
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('ミニのぼり旗', '["ミニのぼり","卓上のぼり"]'::jsonb, 130, '[
  {"key":"s1","category":"ミニのぼり旗","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"ミニのぼり旗","name":"原稿・素材のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"ミニのぼり旗","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":2,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"ミニのぼり旗","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"ミニのぼり旗","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"ミニのぼり旗","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"ミニのぼり旗","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"ミニのぼり旗","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":6,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s8"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 14. パネル
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('パネル', '["パネル"]'::jsonb, 140, '[
  {"key":"s1","category":"パネル","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"パネル","name":"原稿・素材のご提供","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"パネル","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":4,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"パネル","name":"初稿確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"パネル","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"パネル","name":"確認・校了","phase":"校了","parties":["client"],"days":2,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"パネル","name":"入稿","phase":"入稿","parties":["cv"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"パネル","name":"製作・配送","phase":"製作・配送","parties":["other:印刷会社"],"days":5,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s8"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 15. Webサイト（LP）
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('Webサイト（LP）', '["lp","ランディング"]'::jsonb, 150, '[
  {"key":"s1","category":"MTG関連","name":"ヒアリング・要件整理","phase":"打ち合わせ","parties":["cv","client"],"days":2,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"デザイン関連","name":"構成案・ワイヤーフレーム","phase":"初稿","parties":["cv"],"days":4,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"デザイン関連","name":"構成のご確認","phase":"確認","parties":["client"],"days":2,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"テキスト関連","name":"原稿・写真のご提供","phase":"確認","parties":["client"],"days":5,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"デザイン関連","name":"デザイン初稿","phase":"初稿","parties":["cv"],"days":6,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"デザイン関連","name":"デザインのご確認","phase":"確認","parties":["client"],"days":3,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"デザイン関連","name":"デザイン修正","phase":"第二稿","parties":["cv"],"days":3,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"デザイン関連","name":"デザイン確定","phase":"校了","parties":["client"],"days":1,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"構築関連","name":"コーディング・構築","phase":"構築","parties":["cv"],"days":7,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"テスト公開","name":"テストアップ","phase":"テスト公開","parties":["cv"],"days":1,"after":["s9"],"is_milestone":false,"on_schedule":true},
  {"key":"s11","category":"最終チェック","name":"動作確認・修正","phase":"確認","parties":["cv","client"],"days":3,"after":["s10"],"is_milestone":false,"on_schedule":true},
  {"key":"s12","category":"公開","name":"公開","phase":"公開","parties":["cv"],"days":0,"after":["s11"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 16. Webサイト（複数ページ）
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('Webサイト（複数ページ）', '["ホームページ","webサイト","ウェブサイト","サイト","hp","コーポレート","リニューアル"]'::jsonb, 160, '[
  {"key":"w1","category":"MTG関連","name":"キックオフ打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"w2","category":"デザイン関連","name":"要件定義・サイトマップ作成","phase":"初稿","parties":["cv"],"days":5,"after":["w1"],"is_milestone":false,"on_schedule":true},
  {"key":"w3","category":"デザイン関連","name":"サイトマップのご確認","phase":"確認","parties":["client"],"days":3,"after":["w2"],"is_milestone":false,"on_schedule":true},
  {"key":"w4","category":"デザイン関連","name":"ワイヤーフレーム作成","phase":"初稿","parties":["cv"],"days":7,"after":["w3"],"is_milestone":false,"on_schedule":true},
  {"key":"w5","category":"デザイン関連","name":"ワイヤーフレームのご確認","phase":"確認","parties":["client"],"days":3,"after":["w4"],"is_milestone":false,"on_schedule":true},
  {"key":"w6","category":"テキスト関連","name":"原稿のご提供","phase":"確認","parties":["client"],"days":10,"after":["w5"],"is_milestone":false,"on_schedule":true},
  {"key":"w7","category":"写真撮影・取材関連","name":"写真撮影・取材","phase":"撮影・取材","parties":["cv"],"days":3,"after":["w5"],"is_milestone":false,"on_schedule":true},
  {"key":"w8","category":"デザイン関連","name":"トップページデザイン","phase":"初稿","parties":["cv"],"days":7,"after":["w5"],"is_milestone":false,"on_schedule":true},
  {"key":"w9","category":"デザイン関連","name":"トップページのご確認","phase":"確認","parties":["client"],"days":3,"after":["w8"],"is_milestone":false,"on_schedule":true},
  {"key":"w10","category":"デザイン関連","name":"下層ページデザイン","phase":"初稿","parties":["cv"],"days":8,"after":["w9"],"is_milestone":false,"on_schedule":true},
  {"key":"w11","category":"デザイン関連","name":"下層ページのご確認","phase":"確認","parties":["client"],"days":3,"after":["w10"],"is_milestone":false,"on_schedule":true},
  {"key":"w12","category":"デザイン関連","name":"デザイン修正・確定","phase":"校了","parties":["cv"],"days":3,"after":["w11"],"is_milestone":false,"on_schedule":true},
  {"key":"w13","category":"構築関連","name":"CMS 構築・コーディング","phase":"構築","parties":["cv"],"days":15,"after":["w12"],"is_milestone":false,"on_schedule":true},
  {"key":"w14","category":"構築関連","name":"テキスト・写真の流し込み","phase":"構築","parties":["cv"],"days":3,"after":["w13","w6","w7"],"is_milestone":false,"on_schedule":true},
  {"key":"w15","category":"テスト公開","name":"テスト公開","phase":"テスト公開","parties":["cv"],"days":1,"after":["w14"],"is_milestone":false,"on_schedule":true},
  {"key":"w16","category":"最終チェック","name":"動作確認・修正","phase":"確認","parties":["cv","client"],"days":5,"after":["w15"],"is_milestone":false,"on_schedule":true},
  {"key":"w17","category":"最終チェック","name":"最終チェック","phase":"確認","parties":["client"],"days":2,"after":["w16"],"is_milestone":false,"on_schedule":true},
  {"key":"w18","category":"公開","name":"公開","phase":"公開","parties":["cv"],"days":0,"after":["w17"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 17. システム構築
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('システム構築', '["システム","アプリ","開発","予約","管理画面"]'::jsonb, 170, '[
  {"key":"s1","category":"要件定義","name":"ヒアリング・要件定義","phase":"打ち合わせ","parties":["cv","client"],"days":5,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"要件定義","name":"要件のご確認","phase":"確認","parties":["client"],"days":3,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"設計","name":"基本設計","phase":"初稿","parties":["cv"],"days":5,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"設計","name":"設計のご確認","phase":"確認","parties":["client"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"設計","name":"画面デザイン","phase":"初稿","parties":["cv"],"days":5,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"設計","name":"画面デザインのご確認","phase":"確認","parties":["client"],"days":3,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"開発","name":"開発","phase":"構築","parties":["cv"],"days":20,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"テスト","name":"テスト","phase":"テスト公開","parties":["cv"],"days":5,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"テスト","name":"受け入れ確認","phase":"確認","parties":["client"],"days":5,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"テスト","name":"修正","phase":"修正","parties":["cv"],"days":3,"after":["s9"],"is_milestone":false,"on_schedule":true},
  {"key":"s11","category":"リリース","name":"操作説明","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":["s10"],"is_milestone":false,"on_schedule":true},
  {"key":"s12","category":"リリース","name":"本番リリース","phase":"公開","parties":["cv"],"days":0,"after":["s11"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 18. 写真撮影
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('写真撮影', '["撮影","写真","フォト"]'::jsonb, 180, '[
  {"key":"s1","category":"写真撮影","name":"打ち合わせ・撮影内容の確認","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"写真撮影","name":"撮影プラン・カット表の作成","phase":"初稿","parties":["cv"],"days":2,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"写真撮影","name":"撮影プランのご確認","phase":"確認","parties":["client"],"days":2,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"写真撮影","name":"撮影準備（ロケハン・小物・機材）","phase":"撮影・取材","parties":["cv"],"days":2,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"写真撮影","name":"撮影","phase":"撮影・取材","parties":["cv","client"],"days":1,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"写真撮影","name":"セレクト・レタッチ","phase":"初稿","parties":["cv"],"days":4,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"写真撮影","name":"写真のご確認","phase":"確認","parties":["client"],"days":2,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"写真撮影","name":"修正・データ書き出し","phase":"校了","parties":["cv"],"days":1,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s8"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

-- 19. 動画制作
insert into public.schedule_templates (name, keywords, sort_order, steps) values ('動画制作', '["動画","映像","ムービー","pv","youtube"]'::jsonb, 190, '[
  {"key":"s1","category":"動画制作","name":"ヒアリング・打ち合わせ","phase":"打ち合わせ","parties":["cv","client"],"days":1,"after":[],"is_milestone":false,"on_schedule":true},
  {"key":"s2","category":"動画制作","name":"企画・構成案","phase":"初稿","parties":["cv"],"days":4,"after":["s1"],"is_milestone":false,"on_schedule":true},
  {"key":"s3","category":"動画制作","name":"構成のご確認","phase":"確認","parties":["client"],"days":2,"after":["s2"],"is_milestone":false,"on_schedule":true},
  {"key":"s4","category":"動画制作","name":"絵コンテ・台本","phase":"初稿","parties":["cv"],"days":4,"after":["s3"],"is_milestone":false,"on_schedule":true},
  {"key":"s5","category":"動画制作","name":"絵コンテのご確認","phase":"確認","parties":["client"],"days":2,"after":["s4"],"is_milestone":false,"on_schedule":true},
  {"key":"s6","category":"動画制作","name":"撮影準備","phase":"撮影・取材","parties":["cv"],"days":3,"after":["s5"],"is_milestone":false,"on_schedule":true},
  {"key":"s7","category":"動画制作","name":"撮影","phase":"撮影・取材","parties":["cv","client"],"days":1,"after":["s6"],"is_milestone":false,"on_schedule":true},
  {"key":"s8","category":"動画制作","name":"編集・初稿","phase":"初稿","parties":["cv"],"days":7,"after":["s7"],"is_milestone":false,"on_schedule":true},
  {"key":"s9","category":"動画制作","name":"初稿のご確認","phase":"確認","parties":["client"],"days":3,"after":["s8"],"is_milestone":false,"on_schedule":true},
  {"key":"s10","category":"動画制作","name":"修正・第二稿","phase":"第二稿","parties":["cv"],"days":3,"after":["s9"],"is_milestone":false,"on_schedule":true},
  {"key":"s11","category":"動画制作","name":"第二稿のご確認","phase":"確認","parties":["client"],"days":2,"after":["s10"],"is_milestone":false,"on_schedule":true},
  {"key":"s12","category":"動画制作","name":"テロップ・音の最終調整","phase":"校了","parties":["cv"],"days":2,"after":["s11"],"is_milestone":false,"on_schedule":true},
  {"key":"s13","category":"全制作物","name":"納品","phase":"納品","parties":["cv"],"days":0,"after":["s12"],"is_milestone":true,"on_schedule":true}
]'::jsonb)
on conflict (name) do nothing;

notify pgrst, 'reload schema';
