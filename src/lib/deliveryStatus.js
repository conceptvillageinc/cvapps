// ============================================================================
// 納品・請求の状態（見積一覧・案件一覧・月末チェックで出す印）
//   納品書・請求書のつながり（納品書の estimate_id / project_id / invoice_id）から自動で決める。入力は増やさない。
//     none        未納品            … 納品書がまだ無い
//     uninvoiced  納品済・未請求     … 納品書のうち、請求書になっていないものがある（請求担当の作業待ち。納品書が下書きでも同じ）
//     invoiced    請求書作成済       … 納品書がすべて請求書になった
//     sent        請求書送付済       … 手で決める（案件の「納品・請求」で選ぶ。請求書の状態からは自動で決めない）
//   見積は、その見積から作った納品書の明細の合計が見積の合計に届いていなければ「一部納品 ○%」も付ける（分納）。
// ============================================================================
import { clientLines } from "@/lib/estimateTotals";
/** その日の月末（YYYY-MM-DD） */
export function monthEndOf(ymd) {
  const d = new Date(`${String(ymd).slice(0, 7)}-01T00:00:00`);
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
}

export const DELIVERY_STATE = {
  none: { label: "未納品", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  uninvoiced: { label: "納品済・未請求", cls: "bg-amber-50 text-amber-800 border-amber-300" },
  invoiced: { label: "請求書作成済", cls: "bg-sky-50 text-sky-800 border-sky-300" },
  sent: { label: "請求書送付済", cls: "bg-blue-100 text-blue-800 border-blue-400" },
  na: { label: "対象外", cls: "bg-white text-slate-400 border-slate-200" },
};
export const DELIVERY_STATE_ORDER = ["none", "uninvoiced", "invoiced", "sent", "na"];
/** 請求書まで作った状態（作成済・送付済） */
export const isBilledState = (state) => state === "invoiced" || state === "sent";

/** 案件で手で決められる状態（projects.delivery_state_manual。空なら納品書から自動） */
export const MANUAL_DELIVERY_STATES = ["none", "uninvoiced", "invoiced", "sent", "na"];

const sumItems = (items) => (items || []).reduce((s, li) => s + (Number(li.amount) || 0), 0);

/** 納品書の一覧から状態を決める */
/**
 * 納品書の「請求書作成」が処理済か（この納品書から請求書を作った、または一覧で手で「処理済」にした）
 *   手で処理済にするのは、freee販売で請求した分・請求の要らない分など（delivery_notes.invoiced_manual）
 */
export const isNoteInvoiced = (n) => !!n?.invoice_id || n?.invoiced_manual === true;

export function stateOfNotes(notes) {
  const list = notes || [];
  if (list.length === 0) return "none";
  // 「納品書 下書き」の状態は使わない（下書きの納品書も、納品済・未請求として数える）
  // 「請求書送付済」は手で決める（請求書の状態からは自動で決めない）
  return list.some((n) => !isNoteInvoiced(n)) ? "uninvoiced" : "invoiced";
}

/** 見積の税抜の明細合計（納品書と同じ数え方: テキスト行・小計行は除く） */
function estimateBase(estimate) {
  return sumItems(clientLines(estimate?.line_items).filter((li) => li.row_type !== "text" && li.row_type !== "subtotal"));
}

/**
 * 見積の納品・請求の状態。提出済の見積だけ（未提出・失注は null で「—」）。
 * @returns {{ state, notes, partial: number|null } | null}  partial は納品した割合（0〜1。全部なら null）
 */
export function estimateDelivery(estimate, notesByEstimate, { submitted }) {
  if (!submitted) return null;
  const notes = notesByEstimate.get(estimate.id) || [];
  const state = stateOfNotes(notes);
  let partial = null;
  if (notes.length) {
    const delivered = new Set(notes.flatMap((n) => (n.line_items || []).map((li) => li.source_line_id).filter(Boolean)));
    const lines = clientLines(estimate.line_items).filter((li) => li.row_type !== "text" && li.row_type !== "subtotal" && li.source_type !== "rule" && Number(li.amount) > 0);
    const base = estimateBase({ line_items: lines });
    const done = sumItems(lines.filter((li) => delivered.has(li.id)));
    // 見積の行が納品書に全部入っていなくても、金額が届いていれば（行をまとめた等）全部とみなす
    const byAmount = sumItems(notes.flatMap((n) => n.line_items || []));
    if (base > 0 && done < base && byAmount < base * 0.995) partial = Math.max(done, byAmount) / base;
  }
  return { state, notes, partial };
}

/** 案件の納品・請求の状態（案件の納品書すべてで判定） */
export function projectDelivery(project, notesByProject) {
  const notes = notesByProject.get(project.id) || [];
  const auto = stateOfNotes(notes);
  // 手で決めた状態（freee販売で請求した案件・納品書の要らない案件など）があれば、それを使う
  const manual = MANUAL_DELIVERY_STATES.includes(project?.delivery_state_manual) ? project.delivery_state_manual : null;
  return { state: manual || auto, auto, manual: !!manual, notes, partial: null };
}

/** 納品書を見積・案件ごとに引けるようにする */
export function indexNotes(notes) {
  const byEstimate = new Map();
  const byProject = new Map();
  for (const n of notes || []) {
    if (n.estimate_id) byEstimate.set(n.estimate_id, [...(byEstimate.get(n.estimate_id) || []), n]);
    if (n.project_id) byProject.set(n.project_id, [...(byProject.get(n.project_id) || []), n]);
  }
  return { byEstimate, byProject };
}
