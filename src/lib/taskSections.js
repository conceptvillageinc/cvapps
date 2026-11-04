// ============================================================================
// タスクのリストの見出し（セクション）と並び順
//
//   マイタスク     … 利用者ごとの見出し（本人だけが見る）。タスクは my_section_id / my_sort_order
//   社内プロジェクト … プロジェクトごとの見出し（メンバー全員）。タスクは section_id / section_sort_order
//   見出しの無いタスクは、いちばん上の「新しく割り当てられたタスク」（マイタスク）／「見出しなし」に入る
//   並び順は小数で持ち、間に入れるときは前後のまん中にする（ほかのタスクを書き換えない）
// ============================================================================

export const MODES = {
  my: { section: "my_section_id", order: "my_sort_order", noneLabel: "新しく割り当てられたタスク" },
  internal: { section: "section_id", order: "section_sort_order", noneLabel: "見出しなし" },
};

const fallbackOrder = (t) => -new Date(t.created_at || 0).getTime() / 1e12; // 並び順が無いものは新しい順に上へ
export const orderOf = (t, mode) => {
  const v = t?.[MODES[mode].order];
  return v === null || v === undefined || v === "" ? fallbackOrder(t) : Number(v);
};

/** 見出しごとに分ける。[{ section: null | 見出し, tasks }]（見出しなしが先頭、あとは見出しの順） */
export function groupIntoSections(tasks, sections, mode) {
  const key = MODES[mode].section;
  const ids = new Set(sections.map((s) => s.id));
  const sorted = [...(tasks || [])].sort((a, b) => orderOf(a, mode) - orderOf(b, mode));
  const groups = [{ section: null, tasks: sorted.filter((t) => !ids.has(t[key])) }];
  for (const s of [...sections].sort((a, b) => Number(a.sort_order) - Number(b.sort_order))) groups.push({ section: s, tasks: sorted.filter((t) => t[key] === s.id) });
  return groups;
}

/** list（その見出しのタスク、並び順どおり）の index の位置に入れるときの並び順 */
export function orderAt(list, index, mode, movingId = null) {
  const rest = list.filter((t) => t.id !== movingId);
  const prev = rest[index - 1]; const next = rest[index];
  const p = prev ? orderOf(prev, mode) : null; const n = next ? orderOf(next, mode) : null;
  if (p === null && n === null) return 1;
  if (p === null) return n - 1;
  if (n === null) return p + 1;
  return (p + n) / 2;
}

/** 動かしたときに書き込む項目 */
export const movePatch = (mode, sectionId, order) => ({ [MODES[mode].section]: sectionId || null, [MODES[mode].order]: order });

/** 次の見出しの並び順 */
export const nextSectionOrder = (sections) => (sections || []).reduce((m, s) => Math.max(m, Number(s.sort_order) || 0), 0) + 1;
