#!/usr/bin/env sh
# supabase/migrations/*.sql を 1 本につなげて supabase/dev/all_migrations.sql を作る（dev 環境の初期化用）
set -e
cd "$(dirname "$0")/.."
{
  echo "-- ============================================================================"
  echo "-- dev 環境用: 全マイグレーション（$(ls supabase/migrations | head -1 | cut -c1-4)〜$(ls supabase/migrations | tail -1 | cut -c1-4)）を順番につなげたもの。"
  echo "-- 新しい Supabase プロジェクトの SQL Editor に丸ごと貼り付けて Run する（冪等）。"
  echo "-- 生成: scripts/build-all-migrations.sh（migrations を変えたら再生成する）"
  echo "-- ============================================================================"
  for f in supabase/migrations/*.sql; do echo; echo "-- >>>>>>>> $f"; cat "$f"; done
} > supabase/dev/all_migrations.sql
echo "wrote supabase/dev/all_migrations.sql ($(wc -c < supabase/dev/all_migrations.sql) bytes)"
