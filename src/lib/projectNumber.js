// 案件番号の採番: P-YYMM-連番（例: P-2609-001）。月が変わると 001 に戻る。
// 採番は DB 関数 next_project_number（supabase/migrations/0004_projects.sql）が行う。
// 取込スクリプトと画面で同じ関数を使うことで、番号の重複を避ける。

import { supabase } from "@/lib/supabase";

export async function generateProjectNumber(dateStr) {
  const { data, error } = await supabase.rpc("next_project_number", {
    p_date: dateStr || new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error("案件番号の採番に失敗しました: " + error.message);
  return data;
}
