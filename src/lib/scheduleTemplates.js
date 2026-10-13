// ============================================================================
// 工程表テンプレート（画面・SQL の初期データ作りで使う）
//   テンプレート = 工程の並び（カテゴリー・タスク名・工程・担当・日数（営業日）・前の工程・節目・工程表に出す）
//   日付の決め方は 2 通り:
//     - 納期から決める（逆算）: 最後の工程が納期に終わるように、前へさかのぼって開始日を決める
//     - 今日（指定した日）から順に並べる
//   どちらも土日・祝日・会社の休業日をとばして、営業日で数える
//   担当は "cv" / "client" / "other:印刷会社"（その他は名前で持ち、案件の担当の区分に無ければ足す）
//   前の工程（after）は、テンプレートの中の工程の key。null なら 1 つ前の工程、[] なら前の工程なし
//   カテゴリー「全制作物」の工程（納品など）は、テンプレートを組み合わせたときに 1 つにまとめる
// ============================================================================
import { addDays, parseYmd, toYmd, nextWorkday, addWorkdays, newPartyColor } from "./schedule.js";
import { isOffDay } from "./jpHolidays.js";

export const COMMON_CATEGORY = "全制作物";

/** 休みの日なら、前の営業日まで戻す */
export function prevWorkday(s, holidays = null) {
  let d = s;
  for (let i = 0; i < 30 && isOffDay(parseYmd(d), holidays); i++) d = addDays(d, -1);
  return d;
}
/** end を n 日目として、営業日でさかのぼった 1 日目 */
export function subWorkdays(end, n, holidays = null) {
  let d = prevWorkday(end, holidays);
  for (let k = 1; k < n; k++) d = prevWorkday(addDays(d, -1), holidays);
  return d;
}

/** テンプレートの工程を整える（key を振り、前の工程を key の配列にする） */
export function normalizeSteps(steps) {
  const list = (Array.isArray(steps) ? steps : []).map((s, i) => ({
    key: String(s.key || `s${i + 1}`),
    category: String(s.category || ""),
    name: String(s.name || ""),
    phase: String(s.phase || ""),
    parties: Array.isArray(s.parties) ? s.parties.map(String) : ["cv"],
    days: Math.max(0, Math.round(Number(s.days) || 0)),
    after: s.after === undefined ? null : s.after,
    is_milestone: !!s.is_milestone,
    on_schedule: s.on_schedule !== false,
  }));
  const keys = new Set(list.map((s) => s.key));
  return list.map((s, i) => {
    let after = s.after;
    if (after === null) after = i > 0 ? [list[i - 1].key] : [];
    after = (Array.isArray(after) ? after : []).map(String).filter((k) => keys.has(k) && k !== s.key);
    return { ...s, after, days: s.is_milestone ? 0 : Math.max(1, s.days) };
  });
}

/** 前の工程がない順に並べた順番（輪になっていたら、残りは元の順） */
function topoOrder(steps) {
  const done = new Set();
  const out = [];
  let guard = 0;
  while (out.length < steps.length && guard++ < steps.length + 5) {
    let progressed = false;
    for (const s of steps) {
      if (done.has(s.key)) continue;
      if (s.after.every((k) => done.has(k))) { out.push(s); done.add(s.key); progressed = true; }
    }
    if (!progressed) { for (const s of steps) if (!done.has(s.key)) { out.push(s); done.add(s.key); } }
  }
  return out;
}

/**
 * テンプレートを組み合わせて、1 つの工程の並びにする。
 * 「全制作物」の同じ名前の工程（納品など）は 1 つにまとめ、前の工程を合わせる。
 */
export function combineTemplates(templates) {
  const steps = [];
  const commonByName = new Map();
  templates.forEach((tpl, ti) => {
    const norm = normalizeSteps(tpl.steps);
    const remap = new Map();
    for (const s of norm) {
      if (s.category === COMMON_CATEGORY && commonByName.has(s.name)) remap.set(s.key, commonByName.get(s.name).key);
      else remap.set(s.key, `t${ti}_${s.key}`);
    }
    for (const s of norm) {
      const after = s.after.map((k) => remap.get(k));
      if (s.category === COMMON_CATEGORY && commonByName.has(s.name)) {
        const c = commonByName.get(s.name);
        c.after = [...new Set([...c.after, ...after])];
        continue;
      }
      const ns = { ...s, key: remap.get(s.key), after, template: tpl.name };
      if (s.category === COMMON_CATEGORY) commonByName.set(s.name, ns);
      steps.push(ns);
    }
  });
  // まとめた「全制作物」の工程は最後に並べる（納品は表の一番下）
  return [...steps.filter((s) => s.category !== COMMON_CATEGORY || !s.is_milestone), ...steps.filter((s) => s.category === COMMON_CATEGORY && s.is_milestone)];
}

/**
 * 工程の並びに日付を入れる。
 * @param {object[]} steps  combineTemplates の結果
 * @param {{ mode: "deadline"|"start", date: string, holidays?: Set<string> }} opts
 * @returns {Map<string, { start: string, end: string }>}
 */
export function scheduleSteps(steps, { mode, date, holidays = null }) {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const order = topoOrder(steps);
  const out = new Map();
  if (mode === "deadline") {
    const succ = new Map(steps.map((s) => [s.key, []]));
    for (const s of steps) for (const k of s.after) succ.get(k)?.push(s.key);
    const deadline = prevWorkday(date, holidays);
    for (const s of [...order].reverse()) {
      const nexts = succ.get(s.key) || [];
      let end = deadline;
      for (const k of nexts) {
        const n = out.get(k);
        if (!n) continue;
        const limit = byKey.get(k).is_milestone ? n.start : prevWorkday(addDays(n.start, -1), holidays);
        if (limit < end) end = limit;
      }
      const start = s.is_milestone ? end : subWorkdays(end, s.days, holidays);
      out.set(s.key, { start, end });
    }
  } else {
    const base = nextWorkday(date, holidays);
    for (const s of order) {
      const ends = s.after.map((k) => out.get(k)?.end).filter(Boolean).sort();
      const last = ends[ends.length - 1];
      let start;
      if (s.is_milestone) start = last || base;
      else start = last ? nextWorkday(addDays(last, 1), holidays) : base;
      const end = s.is_milestone ? start : addWorkdays(start, s.days, holidays);
      out.set(s.key, { start, end });
    }
  }
  return out;
}

const slug = (s) => Array.from(String(s)).map((c) => c.charCodeAt(0).toString(36)).join("").slice(0, 16);

/** テンプレートの担当（"other:印刷会社"）を、案件の担当の区分の key にする。無い区分は足す */
export function resolveParties(steps, parties) {
  const list = parties.map((p) => ({ ...p }));
  const added = [];
  const map = new Map();
  for (const s of steps) {
    for (const k of s.parties) {
      if (map.has(k)) continue;
      if (k === "cv" || k === "client") { map.set(k, k); continue; }
      const label = k.replace(/^other:/, "");
      let p = list.find((x) => x.label === label);
      if (!p) {
        p = { key: `other:${slug(label)}`, label, color: newPartyColor(list) };
        list.push(p); added.push(p);
      }
      map.set(k, p.key);
    }
  }
  return { map, parties: list, added };
}

/**
 * テンプレートから工程表の下書きを作る。
 * @returns {{ tasks: object[], parties: object[], addedParties: object[], warnings: string[] }}
 *   tasks は保存前の下書き（id は仮。depends_on も仮の id）
 */
export function draftFromTemplates(templates, { mode, date, holidays = null, parties, today = toYmd(new Date()) }) {
  const steps = combineTemplates(templates);
  const dates = scheduleSteps(steps, { mode, date, holidays });
  const { map, parties: allParties, added } = resolveParties(steps, parties);
  const tasks = steps.map((s, i) => {
    const d = dates.get(s.key);
    return {
      id: `draft_${s.key}`,
      category: s.category || null,
      name: s.name,
      phase: s.phase || null,
      parties: [...new Set(s.parties.map((k) => map.get(k)).filter(Boolean))],
      start_date: d.start,
      end_date: d.end,
      is_milestone: s.is_milestone,
      on_schedule: s.on_schedule,
      depends_on: s.after.map((k) => `draft_${k}`),
      completed: false,
      member_ids: [],
      sort_order: i,
    };
  });
  const warnings = [];
  const early = tasks.filter((t) => t.start_date < today);
  if (mode === "deadline" && early.length) warnings.push(`納期から逆算すると、${early.length}件の工程が今日より前に始まることになります。日数を詰めるか、納期を見直してください。`);
  return { tasks, parties: allParties, addedParties: added, warnings };
}

/** いまの工程表をテンプレートの工程にする（日数は営業日で数える） */
export function stepsFromTasks(tasks, parties, workdays) {
  const keyOf = new Map(tasks.map((t, i) => [t.id, `s${i + 1}`]));
  return tasks.map((t, i) => {
    const prev = tasks[i - 1];
    const deps = (t.depends_on || []).filter((id) => keyOf.has(id));
    const after = deps.length === 1 && prev && deps[0] === prev.id ? null : deps.map((id) => keyOf.get(id));
    return {
      key: keyOf.get(t.id),
      category: t.category || "",
      name: t.name || "",
      phase: t.phase || "",
      parties: (t.parties || []).map((k) => (k === "cv" || k === "client" ? k : `other:${parties.find((p) => p.key === k)?.label || k.replace(/^other:/, "")}`)),
      days: t.is_milestone ? 0 : workdays(t),
      after,
      is_milestone: !!t.is_milestone,
      on_schedule: t.on_schedule !== false,
    };
  });
}

/**
 * 案件に合いそうなテンプレート（案件名・見積の件名の言葉で探す）。長い言葉ほど優先（「ミニのぼり」は「のぼり」より先）
 * @returns {object[]} 合うものを合う順に
 */
export function suggestTemplates(templates, texts) {
  const hay = texts.filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
  if (!hay) return [];
  const scored = [];
  for (const t of templates) {
    let best = 0;
    for (const k of t.keywords || []) {
      const kw = String(k).normalize("NFKC").toLowerCase().trim();
      if (kw && hay.includes(kw)) best = Math.max(best, kw.length);
    }
    if (best) scored.push({ t, best });
  }
  scored.sort((a, b) => b.best - a.best);
  // 当たった言葉が、先に選んだテンプレートの当たった言葉の一部でしかないものは外す（「ミニのぼり」と「のぼり」）
  const hitsOf = (t) => (t.keywords || []).map((k) => String(k).normalize("NFKC").toLowerCase().trim()).filter((k) => k && hay.includes(k));
  const out = [];
  for (const { t } of scored) {
    const mine = hitsOf(t);
    const taken = out.flatMap(hitsOf);
    if (mine.every((k) => taken.some((x) => x !== k && x.includes(k)))) continue;
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 最初に入れるテンプレート（SQL の初期データはここから作る）
//   C = CV, K = クライアント, P = 印刷会社, CK = CV＆クライアント
// ---------------------------------------------------------------------------
const C = ["cv"]; const K = ["client"]; const CK = ["cv", "client"]; const P = ["other:印刷会社"];
const step = (category, name, phase, parties, days, opts = {}) => ({ category, name, phase, parties, days, ...opts });
const delivery = (after) => step(COMMON_CATEGORY, "納品", "納品", C, 0, { is_milestone: true, ...(after ? { after } : {}) });

/** 印刷物の基本の流れ（打ち合わせ → 原稿 → 初稿 → 確認 → 修正 → 校了 → 入稿 → 印刷・配送） */
function printFlow(cat, { design = 5, print = 5, rounds = 2, structure = false, printName = "印刷・配送" } = {}) {
  const s = [step(cat, "ヒアリング・打ち合わせ", "打ち合わせ", CK, 1)];
  if (structure) s.push(step(cat, "構成案作成", "初稿", C, 3), step(cat, "構成確認", "確認", K, 2));
  s.push(step(cat, "原稿・写真のご提供", "確認", K, 3), step(cat, "デザイン初稿", "初稿", C, design), step(cat, "初稿確認", "確認", K, 2));
  if (rounds >= 2) s.push(step(cat, "修正・第二稿", "第二稿", C, 2), step(cat, "第二稿確認", "確認", K, 2));
  if (rounds >= 3) s.push(step(cat, "修正・第三稿", "第三稿", C, 2), step(cat, "第三稿確認", "確認", K, 2));
  s.push(step(cat, "最終修正・校了", "校了", CK, 1), step(cat, "入稿", "入稿", C, 1), step(cat, printName, printName.includes("製作") ? "製作・配送" : "印刷・配送", P, print));
  return s;
}
/** 展示会ツールの制作物 1 つ分（デザイン → 確認 → 修正 → 校了 → 入稿 → 製作・配送） */
function toolFlow(cat, prefix, { design = 4, make = 5, firstAfter } = {}) {
  return [
    step(cat, "デザイン初稿", "初稿", C, design, { key: `${prefix}1`, ...(firstAfter ? { after: firstAfter } : {}) }),
    step(cat, "初稿確認", "確認", K, 2, { key: `${prefix}2` }),
    step(cat, "修正・第二稿", "第二稿", C, 2, { key: `${prefix}3` }),
    step(cat, "確認・校了", "校了", K, 2, { key: `${prefix}4` }),
    step(cat, "入稿", "入稿", C, 1, { key: `${prefix}5` }),
    step(cat, "製作・配送", "製作・配送", P, make, { key: `${prefix}6` }),
  ];
}
function singleTool(cat, opts) {
  return [step(cat, "ヒアリング・打ち合わせ", "打ち合わせ", CK, 1), step(cat, "原稿・素材のご提供", "確認", K, 3), ...toolFlow(cat, "x", opts).map(({ key, ...s }) => s), delivery()];
}

export const DEFAULT_TEMPLATES = [
  {
    name: "ブランドロゴ", keywords: ["ロゴ", "ブランド", "ci", "vi"], steps: [
      step("ブランドロゴ", "ヒアリング・打ち合わせ", "打ち合わせ", CK, 1),
      step("ブランドロゴ", "リサーチ・方向性の整理", "初稿", C, 3),
      step("ブランドロゴ", "コンセプト・ラフ案のご提案", "初稿", C, 7),
      step("ブランドロゴ", "ラフ案のご確認・選定", "確認", K, 3),
      step("ブランドロゴ", "ブラッシュアップ", "第二稿", C, 5),
      step("ブランドロゴ", "ブラッシュアップ案のご確認", "確認", K, 2),
      step("ブランドロゴ", "最終調整・決定", "校了", CK, 2),
      step("ブランドロゴ", "データ作成・ロゴガイドライン", "納品", C, 3),
      delivery(),
    ],
  },
  { name: "チラシ", keywords: ["チラシ", "フライヤー", "ちらし"], steps: [...printFlow("チラシ", { design: 5, print: 4 }), delivery()] },
  { name: "ポスター", keywords: ["ポスター"], steps: [...printFlow("ポスター", { design: 4, print: 5 }), delivery()] },
  { name: "パンフレット", keywords: ["パンフレット", "冊子", "会社案内", "カタログ"], steps: [...printFlow("パンフレット", { design: 8, print: 7, rounds: 3, structure: true, printName: "印刷・製本・配送" }), delivery()] },
  { name: "リーフレット", keywords: ["リーフレット"], steps: [...printFlow("リーフレット", { design: 6, print: 5, structure: true, printName: "印刷・折り・配送" }), delivery()] },
  { name: "POP", keywords: ["pop", "ポップ"], steps: [...printFlow("POP", { design: 3, print: 4, rounds: 2 }), delivery()] },
  {
    name: "パッケージデザイン", keywords: ["パッケージ", "ラベル", "シール", "箱"], steps: [
      step("パッケージデザイン", "ヒアリング・打ち合わせ", "打ち合わせ", CK, 1),
      step("パッケージデザイン", "方向性・コンセプトの整理", "初稿", C, 3),
      step("パッケージデザイン", "デザイン案のご提案", "初稿", C, 7),
      step("パッケージデザイン", "デザイン案のご確認", "確認", K, 3),
      step("パッケージデザイン", "修正・第二稿", "第二稿", C, 3),
      step("パッケージデザイン", "第二稿確認", "確認", K, 2),
      step("パッケージデザイン", "版下・展開図の作成", "入稿", C, 3),
      step("パッケージデザイン", "色校正", "確認", P, 5),
      step("パッケージデザイン", "色校のご確認・校了", "校了", K, 2),
      step("パッケージデザイン", "入稿", "入稿", C, 1),
      step("パッケージデザイン", "印刷・加工・配送", "印刷・配送", P, 10),
      delivery(),
    ],
  },
  {
    name: "名刺", keywords: ["名刺"], steps: [
      step("名刺", "掲載内容のご提供", "確認", K, 1),
      step("名刺", "デザイン", "初稿", C, 2),
      step("名刺", "デザインのご確認", "確認", K, 1),
      step("名刺", "修正・校了", "校了", CK, 1),
      step("名刺", "入稿", "入稿", C, 1),
      step("名刺", "印刷・配送", "印刷・配送", P, 4),
      delivery(),
    ],
  },
  {
    name: "展示会ツール（タペストリー・腰巻き・のぼり旗・ミニのぼり旗・パネル）", keywords: ["展示会", "イベント", "ブース"], steps: [
      step(COMMON_CATEGORY, "キックオフ打ち合わせ", "打ち合わせ", CK, 1, { key: "k1" }),
      step(COMMON_CATEGORY, "原稿・写真・ロゴのご提供", "確認", K, 3, { key: "k2" }),
      ...toolFlow("タペストリー", "ta", { design: 4, make: 6, firstAfter: ["k2"] }),
      ...toolFlow("腰巻き", "ko", { design: 3, make: 6, firstAfter: ["k2"] }),
      ...toolFlow("のぼり旗", "no", { design: 3, make: 6, firstAfter: ["k2"] }),
      ...toolFlow("ミニのぼり旗", "mn", { design: 2, make: 6, firstAfter: ["k2"] }),
      ...toolFlow("パネル", "pa", { design: 4, make: 5, firstAfter: ["k2"] }),
      delivery(["ta6", "ko6", "no6", "mn6", "pa6"]),
    ],
  },
  { name: "タペストリー", keywords: ["タペストリー"], steps: singleTool("タペストリー", { design: 4, make: 6 }) },
  { name: "腰巻き", keywords: ["腰巻", "腰幕", "テーブルクロス"], steps: singleTool("腰巻き", { design: 3, make: 6 }) },
  { name: "のぼり旗", keywords: ["のぼり"], steps: singleTool("のぼり旗", { design: 3, make: 6 }) },
  { name: "ミニのぼり旗", keywords: ["ミニのぼり", "卓上のぼり"], steps: singleTool("ミニのぼり旗", { design: 2, make: 6 }) },
  { name: "パネル", keywords: ["パネル"], steps: singleTool("パネル", { design: 4, make: 5 }) },
  {
    name: "Webサイト（LP）", keywords: ["lp", "ランディング"], steps: [
      step("MTG関連", "ヒアリング・要件整理", "打ち合わせ", CK, 2),
      step("デザイン関連", "構成案・ワイヤーフレーム", "初稿", C, 4),
      step("デザイン関連", "構成のご確認", "確認", K, 2),
      step("テキスト関連", "原稿・写真のご提供", "確認", K, 5),
      step("デザイン関連", "デザイン初稿", "初稿", C, 6),
      step("デザイン関連", "デザインのご確認", "確認", K, 3),
      step("デザイン関連", "デザイン修正", "第二稿", C, 3),
      step("デザイン関連", "デザイン確定", "校了", K, 1),
      step("構築関連", "コーディング・構築", "構築", C, 7),
      step("テスト公開", "テストアップ", "テスト公開", C, 1),
      step("最終チェック", "動作確認・修正", "確認", CK, 3),
      step("公開", "公開", "公開", C, 0, { is_milestone: true }),
    ],
  },
  {
    name: "Webサイト（複数ページ）", keywords: ["ホームページ", "webサイト", "ウェブサイト", "サイト", "hp", "コーポレート", "リニューアル"], steps: [
      step("MTG関連", "キックオフ打ち合わせ", "打ち合わせ", CK, 1, { key: "w1" }),
      step("デザイン関連", "要件定義・サイトマップ作成", "初稿", C, 5, { key: "w2" }),
      step("デザイン関連", "サイトマップのご確認", "確認", K, 3, { key: "w3" }),
      step("デザイン関連", "ワイヤーフレーム作成", "初稿", C, 7, { key: "w4" }),
      step("デザイン関連", "ワイヤーフレームのご確認", "確認", K, 3, { key: "w5" }),
      step("テキスト関連", "原稿のご提供", "確認", K, 10, { key: "w6", after: ["w5"] }),
      step("写真撮影・取材関連", "写真撮影・取材", "撮影・取材", C, 3, { key: "w7", after: ["w5"] }),
      step("デザイン関連", "トップページデザイン", "初稿", C, 7, { key: "w8", after: ["w5"] }),
      step("デザイン関連", "トップページのご確認", "確認", K, 3, { key: "w9" }),
      step("デザイン関連", "下層ページデザイン", "初稿", C, 8, { key: "w10" }),
      step("デザイン関連", "下層ページのご確認", "確認", K, 3, { key: "w11" }),
      step("デザイン関連", "デザイン修正・確定", "校了", C, 3, { key: "w12" }),
      step("構築関連", "CMS 構築・コーディング", "構築", C, 15, { key: "w13" }),
      step("構築関連", "テキスト・写真の流し込み", "構築", C, 3, { key: "w14", after: ["w13", "w6", "w7"] }),
      step("テスト公開", "テスト公開", "テスト公開", C, 1, { key: "w15" }),
      step("最終チェック", "動作確認・修正", "確認", CK, 5, { key: "w16" }),
      step("最終チェック", "最終チェック", "確認", K, 2, { key: "w17" }),
      step("公開", "公開", "公開", C, 0, { key: "w18", is_milestone: true }),
    ],
  },
  {
    name: "システム構築", keywords: ["システム", "アプリ", "開発", "予約", "管理画面"], steps: [
      step("要件定義", "ヒアリング・要件定義", "打ち合わせ", CK, 5),
      step("要件定義", "要件のご確認", "確認", K, 3),
      step("設計", "基本設計", "初稿", C, 5),
      step("設計", "設計のご確認", "確認", K, 2),
      step("設計", "画面デザイン", "初稿", C, 5),
      step("設計", "画面デザインのご確認", "確認", K, 3),
      step("開発", "開発", "構築", C, 20),
      step("テスト", "テスト", "テスト公開", C, 5),
      step("テスト", "受け入れ確認", "確認", K, 5),
      step("テスト", "修正", "修正", C, 3),
      step("リリース", "操作説明", "打ち合わせ", CK, 1),
      step("リリース", "本番リリース", "公開", C, 0, { is_milestone: true }),
    ],
  },
  {
    name: "写真撮影", keywords: ["撮影", "写真", "フォト"], steps: [
      step("写真撮影", "打ち合わせ・撮影内容の確認", "打ち合わせ", CK, 1),
      step("写真撮影", "撮影プラン・カット表の作成", "初稿", C, 2),
      step("写真撮影", "撮影プランのご確認", "確認", K, 2),
      step("写真撮影", "撮影準備（ロケハン・小物・機材）", "撮影・取材", C, 2),
      step("写真撮影", "撮影", "撮影・取材", CK, 1),
      step("写真撮影", "セレクト・レタッチ", "初稿", C, 4),
      step("写真撮影", "写真のご確認", "確認", K, 2),
      step("写真撮影", "修正・データ書き出し", "校了", C, 1),
      delivery(),
    ],
  },
  {
    name: "動画制作", keywords: ["動画", "映像", "ムービー", "pv", "youtube"], steps: [
      step("動画制作", "ヒアリング・打ち合わせ", "打ち合わせ", CK, 1),
      step("動画制作", "企画・構成案", "初稿", C, 4),
      step("動画制作", "構成のご確認", "確認", K, 2),
      step("動画制作", "絵コンテ・台本", "初稿", C, 4),
      step("動画制作", "絵コンテのご確認", "確認", K, 2),
      step("動画制作", "撮影準備", "撮影・取材", C, 3),
      step("動画制作", "撮影", "撮影・取材", CK, 1),
      step("動画制作", "編集・初稿", "初稿", C, 7),
      step("動画制作", "初稿のご確認", "確認", K, 3),
      step("動画制作", "修正・第二稿", "第二稿", C, 3),
      step("動画制作", "第二稿のご確認", "確認", K, 2),
      step("動画制作", "テロップ・音の最終調整", "校了", C, 2),
      delivery(),
    ],
  },
];

/**
 * 案件に合うテンプレートを選ぶ（案件名・見積の件名を先に、見積の明細・印刷仕様も見る。複数可）。
 * 組み合わせのテンプレート（展示会ツールなど）を選んだときは、その中にある制作物 1 つだけのテンプレート（パネルなど）は外す。
 * @param {object[]} templates
 * @param {{ project: object, estimates: object[] }} p
 * @returns {object[]} 選ぶテンプレート（最大 4 つ）
 */
export function pickTemplates(templates, { project, estimates = [] }, max = 4) {
  const strong = [project?.name, ...estimates.flatMap((e) => [e.estimate_title, e.print_type])];
  const weak = estimates.flatMap((e) => [
    ...(Array.isArray(e.line_items) ? e.line_items.map((li) => (li.row_type === "text" ? li.text : li.name)) : []),
    ...(Array.isArray(e.print_specs) ? e.print_specs.flatMap((s) => [s.label, s.print_type, s.usage]) : []),
  ]);
  // 明細のうち、制作物そのものではない行（写真補正・素材使用料・送料など）は見ない
  const NOT_ITEM = /補正|レタッチ|使用料|素材|切り抜き|切抜|送料|配送料|色校|手数料|値引/;
  const first = suggestTemplates(templates, strong);
  const second = suggestTemplates(templates, weak.filter((x) => x && !NOT_ITEM.test(String(x)))).filter((t) => !first.some((f) => f.id === t.id));
  let picks = [...first, ...second];
  const covers = (big, small) => big.id !== small.id && (big.steps || []).some((s) => s.category && s.category !== COMMON_CATEGORY && s.category === small.name);
  picks = picks.filter((t) => !picks.some((o) => covers(o, t)));
  return picks.slice(0, max);
}
