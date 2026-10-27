-- 案件の受注見込・発注見込を「見積の明細から入れた」ときの記録
--   { estimate_id, estimate_number, line_ids: [...], revenue, cost, applied_at, applied_by }
--   見積があとで変わったら、案件の画面に「見積と見込みに差があります」を出すために使う
alter table public.projects add column if not exists forecast_source jsonb;
