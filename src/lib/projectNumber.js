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

/** 指定した月（"yyyy-MM-dd"、省略時は今月）の定期売上の納品書の下書きを作る（案件はひな形ごとに 1 つ）。戻り値は作った納品書の件数。 */
export async function generateRecurringProjects(dateStr) {
  const { data, error } = await supabase.rpc("generate_recurring_projects", {
    p_month: dateStr || new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error("定期案件の生成に失敗しました: " + error.message);
  return data;
}

/**
 * 定期売上の初回の納品書（下書き）を作る。ym（"YYYY-MM"）の月末の納品日で、その月の分として作る。
 * 2 回目からは毎月 1 日に自動で作られる（初回の月の翌月から）。戻り値は作った件数（作成済みなら 0）。
 */
export async function createFirstRecurringNote(templateId, ym) {
  const { data, error } = await supabase.rpc("generate_recurring_notes", { p_month: `${ym}-01`, p_template_id: templateId, p_first: true });
  if (error) throw new Error("初回の納品書を作れませんでした: " + error.message);
  return Number(data) || 0;
}

/** 初回の月の翌月〜今月（終了月まで）で、まだ無い月の納品書の下書きを作る（毎月 1 日を過ぎて登録したとき用）。戻り値は作った件数 */
export async function catchUpRecurringNotes(templateId, firstYm, endYm) {
  const now = new Date();
  const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const next = (ym) => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
  let count = 0;
  for (let ym = next(firstYm), i = 0; i < 24 && ym <= thisYm && (!endYm || ym <= endYm); ym = next(ym), i++) {
    const { data, error } = await supabase.rpc("generate_recurring_notes", { p_month: `${ym}-01`, p_template_id: templateId, p_first: false });
    if (error) throw new Error("納品書の下書きを作れませんでした: " + error.message);
    count += Number(data) || 0;
  }
  return count;
}
