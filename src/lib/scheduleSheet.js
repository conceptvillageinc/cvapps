// ============================================================================
// 工程表をスプレッドシートのマス目にする（サーバーの /api/export-schedule-sheet が使う）
//   見本の工程表と同じ形: タイトル・大事な日 → 見出し（カテゴリー・タスク名・工程・担当・開始日・終了日 ＋ 月・日・曜日）
//   日のマスは担当の色で塗る。土日・祝日・会社の休業日は灰色、大事な日は赤、節目は ◆。
//   ここは Google に依存しない（マス目の値と色だけを作る）。
// ============================================================================
import { addDays, dayInfo, daysBetween, diffDays, taskRange, partyOf, partyText, categoryTints, scheduleBounds, jpDate, md, WEEKDAYS, parseYmd } from "./schedule.js";

export const LEFT_COLS = [
  { key: "category", label: "カテゴリー", width: 120 },
  { key: "name", label: "タスク名", width: 230 },
  { key: "phase", label: "工程", width: 80 },
  { key: "party", label: "担当", width: 150 },
  { key: "start", label: "開始日", width: 92 },
  { key: "end", label: "終了日", width: 92 },
];
export const HEAD_ROWS = 6; // タイトル・大事な日・空き・月・日・曜日
const MAX_DAYS = 370;

const NAVY = "#1e3a5f";
const NAVY2 = "#24205e";
const OFF = "#e5e7eb";
const KEY = "#dc2626";
const KEY_LIGHT = "#fee2e2";
const MILESTONE = "#d946ef";

/** #rrggbb を白と混ぜる（完了した工程は薄く） */
export function lighten(hex, k = 0.55) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const mix = (c) => Math.round(c + (255 - c) * k);
  const r = mix((n >> 16) & 255); const g = mix((n >> 8) & 255); const b = mix(n & 255);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** 「11/6（金）」 */
const mdw = (s) => (s ? `${md(s)}（${WEEKDAYS[parseYmd(s).getDay()]}）` : "");

/**
 * @param {object} p
 * @param {string} p.title
 * @param {object[]} p.tasks       clientTasks() したもの（member_ids に名前）
 * @param {object[]} p.parties
 * @param {object[]} p.keyDates
 * @param {Set<string>} [p.holidays]
 * @param {string} [p.updated]     更新日 YYYY-MM-DD
 * @returns {{ cells: object[][], merges: object[], widths: number[], frozenRows: number, frozenCols: number, days: number }}
 *   cells[r][c] = { v, bg?, fg?, bold?, size?, align? }
 */
export function buildScheduleGrid({ title, tasks, parties, keyDates = [], holidays = null, updated = "" }) {
  const b = scheduleBounds(tasks, keyDates, { padDays: 1 });
  let days = daysBetween(b.from, b.to);
  if (days.length > MAX_DAYS) days = days.slice(0, MAX_DAYS);
  const info = days.map((d) => dayInfo(d, holidays));
  const keyMap = new Map(keyDates.map((k) => [k.date, k.label]));
  const tints = categoryTints(tasks);
  const L = LEFT_COLS.length;
  const width = L + days.length;
  const blank = () => Array.from({ length: width }, () => ({ v: "" }));
  const cells = [];
  const merges = [];

  // 1〜3 行目: タイトル・大事な日
  const r0 = blank(); r0[0] = { v: title, bold: true, size: 14 }; cells.push(r0);
  const r1 = blank();
  r1[0] = { v: keyDates.map((k) => `${k.label}　${mdw(k.date)}`).join("　／　"), bold: true, fg: KEY };
  if (updated) r1[3] = { v: `更新: ${updated.replace(/-/g, "/")}`, fg: "#64748b" };
  cells.push(r1);
  cells.push(blank());

  // 4〜6 行目: 見出し
  const hm = blank(); const hd = blank(); const hw = blank();
  LEFT_COLS.forEach((c, i) => {
    hm[i] = { v: c.label, bg: NAVY, fg: "#ffffff", bold: true, align: "CENTER" };
    hd[i] = { v: "", bg: NAVY }; hw[i] = { v: "", bg: NAVY };
    merges.push({ r0: 3, r1: 6, c0: i, c1: i + 1 });
  });
  let monthStart = 0;
  info.forEach((d, i) => {
    const col = L + i;
    const key = keyMap.get(d.date);
    const bg = key ? KEY : d.off ? "#4b5563" : NAVY2;
    hm[col] = { v: i === 0 || d.day === 1 ? `${d.month}月` : "", bg: NAVY2, fg: "#ffffff", bold: true, align: "LEFT" };
    hd[col] = { v: String(d.day), bg, fg: "#ffffff", bold: true, align: "CENTER" };
    hw[col] = { v: d.holiday ? "祝" : d.weekday, bg, fg: "#ffffff", align: "CENTER", size: 8 };
    const next = info[i + 1];
    if (!next || next.day === 1) { if (i > monthStart) merges.push({ r0: 3, r1: 4, c0: L + monthStart, c1: L + i + 1 }); monthStart = i + 1; }
  });
  cells.push(hm, hd, hw);

  // 工程の行
  let groupStart = null;
  tasks.forEach((t, ti) => {
    const row = blank();
    const tint = tints.get(t.category || "") || "#ffffff";
    const r = taskRange(t);
    const label = partyText(t, parties, (x) => x);
    const first = ti === 0 || (tasks[ti - 1].category || "") !== (t.category || "");
    row[0] = { v: first ? t.category || "" : "", bg: tint, bold: true, align: "CENTER" };
    row[1] = { v: `${t.is_milestone ? "◆ " : ""}${t.name}${t.completed ? "（完了）" : ""}`, bg: tint, fg: t.completed ? "#94a3b8" : undefined };
    row[2] = { v: t.phase || "", bg: tint, align: "CENTER" };
    row[3] = { v: label, bg: tint, align: "CENTER", fg: t.parties?.length === 1 ? partyOf(parties, t.parties[0]).color : undefined, bold: true };
    row[4] = { v: r ? mdw(r.start) : "", bg: tint, align: "CENTER" };
    row[5] = { v: r ? mdw(r.end) : "", bg: tint, align: "CENTER" };
    const color = t.parties?.length ? partyOf(parties, t.parties[0]).color : "#94a3b8";
    info.forEach((d, i) => {
      const col = L + i;
      const inBar = r && d.date >= r.start && d.date <= r.end;
      const base = keyMap.has(d.date) ? KEY_LIGHT : d.off ? OFF : undefined;
      if (t.is_milestone && r && d.date === r.start) row[col] = { v: "◆", fg: t.completed ? "#a3a3a3" : MILESTONE, bold: true, align: "CENTER", bg: base };
      else if (inBar) row[col] = { v: "", bg: t.completed ? lighten(color) : color };
      else row[col] = { v: "", bg: base };
    });
    cells.push(row);
    const rowIdx = cells.length - 1;
    if (first) groupStart = rowIdx;
    const last = ti === tasks.length - 1 || (tasks[ti + 1].category || "") !== (t.category || "");
    if (last && rowIdx > groupStart) merges.push({ r0: groupStart, r1: rowIdx + 1, c0: 0, c1: 1 });
  });

  // 担当の色の凡例
  cells.push(blank());
  const legend = blank();
  legend[0] = { v: "担当の色", bold: true, fg: "#64748b" };
  parties.forEach((p, i) => { if (1 + i < L) legend[1 + i] = { v: p.label, bg: p.color, fg: "#ffffff", bold: true, align: "CENTER" }; });
  cells.push(legend);

  return {
    cells,
    merges,
    widths: [...LEFT_COLS.map((c) => c.width), ...days.map(() => 26)],
    frozenRows: HEAD_ROWS,
    frozenCols: 2,
    days: days.length,
    from: days[0],
    to: days[days.length - 1],
  };
}

export { diffDays, addDays, jpDate };
