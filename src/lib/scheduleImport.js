// ============================================================================
// 工程表の読み取り（スプレッドシート・Excel・CSV・画像・PDF → 工程の下書き）
//   表は「行ごとのセルの値」と「塗られたマスの範囲（列）」の文字にして AI に渡す。画像・PDF はそのまま渡す
//   AI が返すのは工程（カテゴリー・タスク名・工程・担当・開始日・終了日・節目）と大事な日。
//   前の工程は日付から決める（同じカテゴリーで、始まる前に終わっている工程のうち一番遅く終わるもの）
// ============================================================================
import { PHASES, taskRange, workdaysIn } from "./schedule.js";
import { resolveParties, stepsFromTasks } from "./scheduleTemplates.js";

const colName = (i) => { let s = ""; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/**
 * 表（値と塗り）を AI に渡す文字にする。
 * @param {string[][]} rows
 * @param {(string|null)[][]} [fills]
 */
export function gridToText(rows, fills = [], { maxChars = 60000 } = {}) {
  const lines = [];
  const height = Math.max(rows.length, fills.length);
  for (let r = 0; r < height; r++) {
    const cells = (rows[r] || []).map((v, c) => (String(v ?? "").trim() ? `${colName(c)}=${String(v).trim().replace(/\s+/g, " ")}` : null)).filter(Boolean);
    const runs = [];
    const fr = fills[r] || [];
    for (let c = 0; c < fr.length; c++) {
      if (!fr[c]) continue;
      let e = c;
      while (e + 1 < fr.length && fr[e + 1] === fr[c]) e++;
      runs.push(`${colName(c)}${e > c ? `〜${colName(e)}` : ""}(${fr[c]})`);
      c = e;
    }
    if (!cells.length && !runs.length) continue;
    lines.push(`行${r + 1}: ${cells.join(" | ")}${runs.length ? `　【塗り】${runs.join(", ")}` : ""}`);
  }
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n（長いので途中まで）` : text;
}

/** CSV（, かタブ区切り）を表にする */
export function parseCsv(text) {
  const sep = (text.split("\n")[0] || "").includes("\t") ? "\t" : ",";
  const rows = [];
  let row = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export const IMPORT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "工程表のタイトル（表にあれば。例: 〇〇様 展示会ツール制作スケジュール）。無ければ空" },
    key_dates: {
      type: "array",
      description: "納品期限・使用日・公開日など、表に書かれた大事な日",
      items: { type: "object", properties: { label: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" } }, required: ["label", "date"] },
    },
    tasks: {
      type: "array",
      description: "工程（表の上から順に）",
      items: {
        type: "object",
        properties: {
          category: { type: "string", description: "カテゴリー（制作物・タスクカテゴリ。例: パンフレット、デザイン関連）。無ければ空" },
          name: { type: "string", description: "タスク名" },
          phase: { type: "string", description: `工程。次から近いものを選ぶ（無ければ空）: ${PHASES.join("・")}` },
          parties: {
            type: "array",
            description: "担当。CV（コンセプト・ヴィレッジ・自社）／クライアント（発注元のお客様）／その他（印刷会社・外注・協力会社など。名前を label に）",
            items: { type: "object", properties: { kind: { type: "string", enum: ["cv", "client", "other"] }, label: { type: "string", description: "その他のときの名前。CV・クライアントのときは空" } }, required: ["kind"] },
          },
          start_date: { type: "string", description: "開始日 YYYY-MM-DD（読めなければ空）" },
          end_date: { type: "string", description: "終了日 YYYY-MM-DD（1 日だけなら開始日と同じ。読めなければ空）" },
          is_milestone: { type: "boolean", description: "納品・校了・公開など 1 日の節目（◆）なら true" },
          completed: { type: "boolean", description: "ステータス・状況の列が「完了」「済」なら true" },
        },
        required: ["name"],
      },
    },
    notes: { type: "string", description: "読み取れなかったところ・自信がないところ（日本語で短く）。無ければ空" },
  },
  required: ["tasks"],
};

/** AI への指示 */
export function importPrompt({ today, clientName = "", source = "表", grid = "" }) {
  return `あなたは制作会社（株式会社コンセプト・ヴィレッジ、略して CV）の進行管理担当です。
渡された${source}は、印刷物・Web・映像などの制作スケジュール（工程表・ガントチャート）です。中身を読み取り、工程の一覧にしてください。

【読み方】
- 1 行が 1 つの工程（タスク）のことが多いです。カテゴリー（制作物・タスクカテゴリ）が結合セルや見出し行になっているときは、その下の工程すべてに同じカテゴリーを入れます。
- 開始日・終了日の列があればその日付を使います。無いときは、日付の見出し（月・日・曜日の行）と、塗られたマス（【塗り】の列の範囲、または画像の棒）の位置から開始日と終了日を読みます。
- 年が書かれていないときは、今日（${today}）に近い年にします（今日より 2 か月以上前になる月は翌年）。
- 担当: CV・コンセプト・ヴィレッジ・自社は cv、${clientName ? `「${clientName}」や` : ""}クライアント・お客様・先方は client、それ以外（印刷会社・外注・協力会社など）は other で、名前を label に入れます。「A＆B」「A・B」のように複数なら両方入れます。担当が無ければ空の配列にします。
- 納品・校了・公開・使用日のように 1 日だけの節目は is_milestone を true にします。
- ステータス・状況の列が「完了」「済」の工程は completed を true にします。
- 表の上の方にある「納品期限 11/6（金）」のような大事な日は key_dates に入れます。
- 表に無いことを作らないでください。読めない日付は空にし、notes に書きます。
${grid ? `\n【表の中身】（行番号: 列=値。【塗り】は背景が塗られたマスの列の範囲と色）\n${grid}` : ""}`;
}

/**
 * 前の工程を日付から決める（同じカテゴリーで、始まる前に終わる工程のうち一番遅く終わるもの。
 * 同じカテゴリーに無ければ、全体で始まる前に終わる工程のうち一番遅く終わるもの）。節目は、その日までに終わる各カテゴリーの最後の工程。
 */
export function inferDepends(tasks) {
  const withRange = tasks.map((t) => ({ t, r: taskRange(t) }));
  return tasks.map((t, i) => {
    const r = withRange[i].r;
    if (!r) return i > 0 ? [tasks[i - 1].id] : [];
    const before = withRange.filter((x, j) => j !== i && x.r && (t.is_milestone ? x.r.end <= r.start && !x.t.is_milestone : x.r.end < r.start));
    if (!before.length) return [];
    if (t.is_milestone) {
      // 各カテゴリーで一番遅く終わる工程
      const lastByCat = new Map();
      for (const x of before) { const c = x.t.category || ""; if (!lastByCat.has(c) || x.r.end > lastByCat.get(c).r.end) lastByCat.set(c, x); }
      const latest = [...lastByCat.values()].map((x) => x.r.end).sort().pop();
      // 節目の日に近いもの（直前の 10 日以内）だけつなぐ
      return [...lastByCat.values()].filter((x) => x.r.end >= latest || x.r.end >= addDaysYmd(r.start, -10)).map((x) => x.t.id);
    }
    const same = before.filter((x) => (x.t.category || "") === (t.category || ""));
    const pool = same.length ? same : before;
    const maxEnd = pool.map((x) => x.r.end).sort().pop();
    return pool.filter((x) => x.r.end === maxEnd).slice(0, 2).map((x) => x.t.id);
  });
}
function addDaysYmd(s, k) { const [y, m, d] = s.split("-").map(Number); const dt = new Date(y, m - 1, d + k); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; }

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

/**
 * AI の結果 → 工程表の下書き（保存前）
 * @returns {{ tasks, parties, addedParties, keyDates, title, notes, missingDates }}
 */
export function draftFromImport(result, { parties }) {
  const raw = (result?.tasks || []).filter((t) => String(t.name || "").trim());
  const partyStr = (p) => (p.kind === "cv" ? "cv" : p.kind === "client" ? "client" : `other:${String(p.label || "その他").trim()}`);
  const steps = raw.map((t) => ({ parties: [...new Set((t.parties || []).map(partyStr))] }));
  const { map, parties: allParties, added } = resolveParties(steps, parties);
  let missing = 0;
  const tasks = raw.map((t, i) => {
    const s = isYmd(t.start_date) ? t.start_date : isYmd(t.end_date) ? t.end_date : null;
    let e = isYmd(t.end_date) ? t.end_date : s;
    if (s && e < s) e = s;
    if (!s) missing++;
    return {
      id: `imp_${i}`,
      category: String(t.category || "").trim() || null,
      name: String(t.name).trim(),
      phase: String(t.phase || "").trim() || null,
      parties: steps[i].parties.map((k) => map.get(k)).filter(Boolean),
      start_date: s,
      end_date: t.is_milestone ? s : e,
      is_milestone: !!t.is_milestone,
      on_schedule: true,
      completed: !!t.completed,
      member_ids: [],
      depends_on: [],
      sort_order: i,
    };
  });
  const deps = inferDepends(tasks);
  tasks.forEach((t, i) => { t.depends_on = deps[i]; });
  const keyDates = (result?.key_dates || []).filter((k) => k?.label && isYmd(k.date)).map((k) => ({ label: String(k.label).trim(), date: k.date }));
  return { tasks, parties: allParties, addedParties: added, keyDates, title: String(result?.title || "").trim(), notes: String(result?.notes || "").trim(), missingDates: missing };
}

/** 下書き → テンプレートの工程（日数は営業日。日付が読めなかった工程は 1 日） */
export function stepsFromImport(draft, holidays) {
  return stepsFromTasks(draft.tasks, draft.parties, (t) => { const r = taskRange(t); return r ? workdaysIn(r.start, r.end, holidays) : 1; });
}
