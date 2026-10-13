// ============================================================================
// 工程表の共通部分（画面・共有リンクのページ・サーバーのスプレッドシート出力で使う）
//   工程（project_tasks）: カテゴリー（制作物）・タスク名・工程・担当の区分・開始日・終了日・完了・節目・前の工程
//   担当の区分（parties）: "cv" / "client" / そのほかは案件ごとに足す（schedule_settings.parties）。複数可（「CV＆クライアント」）
//   前の工程（depends_on）: 前の工程が終わった翌日より前に始まる工程は、後ろへずらす（日数はそのまま）
// ============================================================================
import { isOffDay, jpHolidays } from "./jpHolidays.js";

const pad = (n) => String(n).padStart(2, "0");
export const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, k) => { const d = parseYmd(s); d.setDate(d.getDate() + k); return toYmd(d); };
export const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 「10月13日（火）」 */
export function jpDate(s) {
  if (!isYmd(s)) return "";
  const d = parseYmd(s);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}
export const md = (s) => (isYmd(s) ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : "");

/** よく使う工程の名前（自由に入れることもできる） */
export const PHASES = ["打ち合わせ", "初稿", "確認", "修正", "第二稿", "第三稿", "校了", "入稿", "印刷・配送", "製作・配送", "撮影・取材", "構築", "テスト公開", "公開", "納品", "使用"];

const OTHER_COLORS = ["#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#0ea5e9", "#64748b"];
/** カテゴリーの帯の色（見本の工程表の水色・黄色…） */
export const CATEGORY_TINTS = ["#dbeafe", "#fef3c7", "#dcfce7", "#fce7f3", "#ede9fe", "#ffedd5", "#e0f2fe", "#f1f5f9"];

/** 担当の区分の一覧（案件の設定。無ければ CV とクライアント） */
export function partiesOf(project) {
  const set = project?.schedule_settings?.parties;
  const clientLabel = `${project?.client_name || "クライアント"}様`;
  const base = [{ key: "cv", label: "CV", color: "#3b82f6" }, { key: "client", label: clientLabel, color: "#ef4444" }];
  if (!Array.isArray(set) || set.length === 0) return base;
  const out = set.map((p) => ({ key: String(p.key), label: String(p.label || p.key), color: p.color || "#64748b" }));
  for (const b of base) if (!out.some((p) => p.key === b.key)) out.unshift(b);
  return out;
}
/** 担当の区分 1 つ（設定に無い「other:外注」のような古い値は、その名前で灰色） */
export function partyOf(parties, key) {
  const p = parties.find((x) => x.key === key);
  if (p) return p;
  const label = String(key || "").replace(/^other:/, "");
  return { key, label: label || "—", color: "#94a3b8" };
}
export function newPartyColor(parties) {
  const used = new Set(parties.map((p) => p.color));
  return OTHER_COLORS.find((c) => !used.has(c)) || OTHER_COLORS[parties.length % OTHER_COLORS.length];
}

/** 工程の期間（片方しか無ければ 1 日） */
export function taskRange(t) {
  const s = isYmd(t.start_date) ? t.start_date : isYmd(t.end_date) ? t.end_date : null;
  const e = isYmd(t.end_date) ? t.end_date : s;
  if (!s) return null;
  return e < s ? { start: s, end: s } : { start: s, end: e };
}

/** 大事な日（納品期限・使用日など） */
export function keyDatesOf(project) {
  const k = project?.schedule_settings?.key_dates;
  return Array.isArray(k) ? k.filter((x) => isYmd(x?.date)) : [];
}

/** 工程表の日付の範囲（工程と大事な日を含め、前後に少し余白） */
export function scheduleBounds(tasks, keyDates = [], { today = toYmd(new Date()), padDays = 2 } = {}) {
  const dates = [];
  for (const t of tasks) { const r = taskRange(t); if (r) dates.push(r.start, r.end); }
  for (const k of keyDates) dates.push(k.date);
  if (dates.length === 0) return { from: today, to: addDays(today, 27) };
  dates.sort();
  return { from: addDays(dates[0], -padDays), to: addDays(dates[dates.length - 1], padDays) };
}

/** 日ごとの情報（休み・祝日・曜日） */
export function dayInfo(s, extraHolidays = null) {
  const d = parseYmd(s);
  const holiday = jpHolidays(d.getFullYear()).has(s);
  return { date: s, day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear(), weekday: WEEKDAYS[d.getDay()], off: isOffDay(d, extraHolidays), holiday, sat: d.getDay() === 6, sun: d.getDay() === 0 };
}
export function daysBetween(from, to) {
  const out = [];
  for (let s = from; s <= to; s = addDays(s, 1)) out.push(s);
  return out;
}
/** その週の月曜日 */
export function weekStart(s) {
  const d = parseYmd(s);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return toYmd(d);
}

/** 前の工程（taskId が predId に、まわりまわって頼っていないか。頼っていれば矢印を引くと輪になる） */
export function wouldCycle(tasks, taskId, predId) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set();
  const stack = [predId];
  while (stack.length) {
    const id = stack.pop();
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of byId.get(id)?.depends_on || []) stack.push(p);
  }
  return false;
}

/** 休みの日なら、次の営業日まで進める */
export function nextWorkday(s, holidays = null) {
  let d = s;
  for (let i = 0; i < 30 && isOffDay(parseYmd(d), holidays); i++) d = addDays(d, 1);
  return d;
}
/** 期間の営業日の数（休みだけの期間は 1） */
export function workdaysIn(start, end, holidays = null) {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isOffDay(parseYmd(d), holidays)) n++;
  return Math.max(1, n);
}
/** start から営業日で n 日目（start が 1 日目） */
export function addWorkdays(start, n, holidays = null) {
  let d = nextWorkday(start, holidays);
  for (let k = 1; k < n; k++) d = nextWorkday(addDays(d, 1), holidays);
  return d;
}

/**
 * 前の工程に合わせて、後ろの工程をずらす（前の工程が終わった次の営業日より前に始まる工程だけ。前へは戻さない）。
 * ずらした工程は、営業日の日数をそのままにする（土日・祝日・会社の休業日をまたぐと、そのぶん終了日が延びる）。
 * @param {object[]} tasks   いまの工程（変更を当てたもの）
 * @param {string[]} fromIds 変えた工程の id
 * @param {{ holidays?: Set<string> }} [opts]  会社の休業日
 * @returns {Array<{ id, start_date, end_date }>}  ずらした工程
 */
export function shiftDependents(tasks, fromIds, { holidays = null } = {}) {
  const cur = new Map(tasks.map((t) => [t.id, { ...t }]));
  const succ = new Map();
  for (const t of tasks) for (const p of t.depends_on || []) succ.set(p, [...(succ.get(p) || []), t.id]);
  const changed = new Map();
  const queue = [...fromIds];
  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const id = queue.shift();
    for (const sid of succ.get(id) || []) {
      const s = cur.get(sid);
      const r = taskRange(s);
      if (!r) continue;
      const predEnds = (s.depends_on || []).map((p) => taskRange(cur.get(p) || {})?.end).filter(Boolean).sort();
      if (!predEnds.length) continue;
      const required = nextWorkday(addDays(predEnds[predEnds.length - 1], 1), holidays);
      if (r.start >= required) continue;
      s.start_date = required;
      s.end_date = s.is_milestone ? required : addWorkdays(required, workdaysIn(r.start, r.end, holidays), holidays);
      changed.set(sid, { id: sid, start_date: s.start_date, end_date: s.end_date });
      queue.push(sid);
    }
  }
  return [...changed.values()];
}

/** ずらしたことで大事な日（納品期限など）を越えてしまった工程。[{ name, key }] */
export function crossedKeyDates(before, shifts, keyDates) {
  const out = [];
  const byId = new Map(before.map((t) => [t.id, t]));
  for (const s of shifts) {
    const t = byId.get(s.id);
    const oldEnd = t && taskRange(t)?.end;
    if (!oldEnd) continue;
    const k = (keyDates || []).find((x) => oldEnd <= x.date && s.end_date > x.date);
    if (k) out.push({ name: t.name, key: k });
  }
  return out;
}

/** 担当の表示（「CV＆マルリフーズ様」。メンバー名を出すときは「CV（平地）」） */
export function partyText(task, parties, memberName = () => "") {
  const keys = Array.isArray(task.parties) && task.parties.length ? task.parties : [];
  const names = keys.map((k) => partyOf(parties, k).label);
  const members = task.show_members ? (task.member_ids || []).map(memberName).filter(Boolean) : [];
  if (members.length && keys.includes("cv")) {
    const i = keys.indexOf("cv");
    names[i] = `CV（${members.join("・")}）`;
  } else if (members.length) names.push(members.join("・"));
  return names.join("＆");
}

/** カテゴリーの並び（最初に出てきた順）と、その色 */
export function categoryTints(tasks) {
  const order = [];
  for (const t of tasks) { const c = t.category || ""; if (!order.includes(c)) order.push(c); }
  return new Map(order.map((c, i) => [c, CATEGORY_TINTS[i % CATEGORY_TINTS.length]]));
}

/** メンバーの短い名前（工程表に出す。表示名 → 姓） */
export function memberShortName(u) {
  if (!u) return "";
  if (u.short_name) return String(u.short_name);
  const full = String(u.full_name || "").trim();
  return full ? full.split(/[\s　]+/)[0] : "";
}

/**
 * クライアントに見せる工程（工程表に出すものだけ。社内メモ・時間は外し、前の工程も見せる工程どうしに絞る）。
 * メンバー名は show_members のときだけ、名前（member_ids に名前を入れる）で返す。
 */
export function clientTasks(tasks, memberName = () => "", memberAvatar = () => "") {
  const shown = (tasks || []).filter((t) => t.on_schedule !== false);
  const ids = new Set(shown.map((t) => t.id));
  return shown.map((t) => ({
    id: t.id,
    category: t.category || "",
    name: t.name || "",
    phase: t.phase || "",
    parties: Array.isArray(t.parties) ? t.parties : [],
    ...(() => {
      const ms = t.show_members ? (t.member_ids || []).map((id) => ({ name: memberName(id), avatar: memberAvatar(id) || "" })).filter((m) => m.name) : [];
      return { member_ids: ms.map((m) => m.name), member_avatars: ms.map((m) => m.avatar) };
    })(),
    show_members: !!t.show_members,
    start_date: t.start_date || null,
    end_date: t.end_date || null,
    completed: !!t.completed,
    is_milestone: !!t.is_milestone,
    depends_on: (t.depends_on || []).filter((p) => ids.has(p)),
  }));
}

/** 工程表のタイトル（設定が無ければ「〇〇様 案件名 スケジュール」） */
export function scheduleTitle(project) {
  const t = project?.schedule_settings?.title;
  if (t) return String(t);
  return `${project?.client_name ? `${project.client_name}様　` : ""}${project?.name || ""} スケジュール`.trim();
}

/** セクション（カテゴリー）の印の色（最初に出てきた順） */
export const CATEGORY_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#f97316", "#06b6d4", "#64748b"];
export function categoryColors(tasks) {
  const order = [];
  for (const t of tasks) { const c = t.category || ""; if (!order.includes(c)) order.push(c); }
  return new Map(order.map((c, i) => [c, CATEGORY_COLORS[i % CATEGORY_COLORS.length]]));
}

/** 会社名の前後につく法人格（株式会社・有限会社・(株) など） */
const CORP_FORMS = [
  "株式会社", "有限会社", "合同会社", "合資会社", "合名会社", "相互会社",
  "一般社団法人", "公益社団法人", "一般財団法人", "公益財団法人", "社会福祉法人", "社会医療法人", "医療法人社団", "医療法人財団", "医療法人",
  "学校法人", "宗教法人", "特定非営利活動法人", "NPO法人", "農事組合法人", "農業協同組合", "生活協同組合", "協同組合", "事業協同組合",
  "独立行政法人", "地方独立行政法人", "国立大学法人", "公立大学法人", "税理士法人", "弁護士法人", "司法書士法人", "行政書士法人", "監査法人",
];
const CORP_RE = new RegExp(`^(?:${CORP_FORMS.join("|")})|(?:${CORP_FORMS.join("|")})$`, "g");
const CORP_ABBR_RE = /[（(](?:株|有|合|資|名|社|財|医|学|宗|特非|NPO)[）)]|[㈱㈲㈳㈴㈶㈵㈻㈼]/g;

/**
 * 担当の丸いアイコンに出す 1 文字（法人格・「様」・空白を除いた最初の文字）
 * 例: 「有限会社吾妻食品様」→「吾」、「(株)ABC」→「A」
 */
export function partyInitial(label) {
  let s = String(label || "").normalize("NFKC").trim().replace(/[様殿]$/, "");
  for (let i = 0; i < 3; i++) s = s.replace(CORP_ABBR_RE, "").replace(CORP_RE, "").replace(/^[\s・、,.]+|[\s・、,.]+$/g, "");
  const ch = Array.from(s)[0];
  return ch ? ch.toUpperCase() : Array.from(String(label || "?"))[0];
}
