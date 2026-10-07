// 見積の明細に付けるスクショ（原価の根拠・入稿先の画面など）。1 行に 3 枚まで。
//   新しい形は screenshot_paths（配列）。前からある screenshot_path（1 枚）も読み、
//   書くときは両方をそろえる（screenshot_path は 1 枚目。価格確認・入稿記録などが使う）。
export const MAX_LINE_SHOTS = 3;

/** 明細のスクショのパス（最大 3 枚） */
export function lineShots(li) {
  const list = Array.isArray(li?.screenshot_paths) && li.screenshot_paths.length ? li.screenshot_paths : (li?.screenshot_path ? [li.screenshot_path] : []);
  return [...new Set(list.filter(Boolean))].slice(0, MAX_LINE_SHOTS);
}

/** スクショの並びを、明細に当てる値にする */
export function shotsPatch(paths) {
  const list = [...new Set((paths || []).filter(Boolean))].slice(0, MAX_LINE_SHOTS);
  return { screenshot_paths: list, screenshot_path: list[0] || null };
}

/** 1 枚足す（3 枚あるときは足さない） */
export function addShotPatch(li, path) {
  const cur = lineShots(li);
  if (!path || cur.includes(path) || cur.length >= MAX_LINE_SHOTS) return shotsPatch(cur);
  return shotsPatch([...cur, path]);
}
