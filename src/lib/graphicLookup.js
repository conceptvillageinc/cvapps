// ============================================================================
// 「グラフィックで調べる」の画面側
//   拡張機能「CV AX KIT アシスタント」（社員の Chrome）にグラフィックのページを開いてもらい、
//   ページを読む → AI（/api/graphic-agent）に次の 1 手を聞く → 拡張機能が操作する、を価格が分かるまで繰り返す。
//   価格が分かったら、その画面のスクショを撮って保管し、一覧の行に仕入・URL・条件・スクショを入れる。
// ============================================================================
import { db } from "@/api/db";
import { MAX_STEPS, GRAPHIC_START_URL, resultToRow } from "@/lib/graphicAgent";

let seq = 0;

/** 拡張機能が入っているか（バージョン。無ければ ""） */
export function assistantVersion() {
  return document.documentElement.dataset.cvAssistant || "";
}

/** 拡張機能に頼む */
export function callAssistant(type, payload = {}, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = `cv${Date.now()}_${++seq}`;
    const onMsg = (e) => {
      if (e.source !== window || e.data?.source !== "cv-assistant" || e.data.id !== id) return;
      window.removeEventListener("message", onMsg); clearTimeout(t);
      if (e.data.ok) resolve(e.data.data); else reject(new Error(e.data.error || "拡張機能でエラーが起きました"));
    };
    const t = setTimeout(() => { window.removeEventListener("message", onMsg); reject(new Error("拡張機能から返事がありません（Chrome に「CV AX KIT アシスタント」が入っているか確かめてください）")); }, timeout);
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "cv-app", id, type, payload }, window.location.origin);
  });
}

/** 入っているか確かめる（ページを開いた直後は、拡張機能の準備を少し待つ） */
export async function detectAssistant() {
  if (assistantVersion()) return assistantVersion();
  try { const r = await callAssistant("ping", {}, { timeout: 1500 }); return r?.version || ""; } catch { return ""; }
}

/** うまくいかなかったときの診断（最後に見ていたページの様子。グラフィックの公開ページの情報だけ） */
function debugOf(snap) {
  if (!snap) return null;
  return {
    url: snap.url, title: snap.title,
    tables: (snap.tables || []).slice(0, 4).map((t) => ({ title: t.title, rows: t.rows.slice(0, 12) })),
    controls: (snap.elements || []).filter((e) => !e.nav && (e.tag === "select" || e.type === "radio" || e.tag === "button")).slice(0, 40)
      .map((e) => `${e.tag}${e.type ? `(${e.type})` : ""} ${e.label || ""} ${e.text || ""}${e.options ? ` [${e.options.slice(0, 12).map((o) => `${o.selected ? "★" : ""}${o.text}`).join("/")}]` : ""}${e.checked ? " ✓" : ""}`.trim()),
    text: String(snap.text || "").slice(0, 2500),
  };
}

const dataUrlToFile = async (dataUrl, name) => {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
};

/**
 * 1 品目を調べる。
 * @param {object} item  一覧の行
 * @param {{ onStep?: (s: { step, reason, url }) => void, isCancelled?: () => boolean }} [opts]
 * @returns {Promise<{ ok: boolean, patch?: object, reason?: string, steps: number }>}
 */
export async function lookupItem(item, { onStep, isCancelled } = {}) {
  const history = [];
  const trace = []; // 経過（画面で見られる・うまくいかなかったときの診断用）
  let lastSnap = null;
  let session = null;
  try {
    ({ session_id: session } = await callAssistant("open", { url: GRAPHIC_START_URL }));
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (isCancelled?.()) return { ok: false, reason: "止めました", steps: step - 1 };
      const snapshot = await callAssistant("snapshot", { session_id: session });
      lastSnap = snapshot;
      const { data: a } = await db.functions.invoke("graphicAgent", { item, snapshot, history, step });
      onStep?.({ step, reason: a.reason, url: snapshot.url });
      const el = (snapshot.elements || []).find((e) => String(e.id) === String(a.element_id));
      const page = (() => { try { const u = new URL(snapshot.url); return u.pathname + u.search; } catch { return ""; } })();
      const entry = { action: a.action, target: el ? (el.text || el.label || el.href || "") : "", value: a.value, url: a.action === "goto" ? a.url : "", page };
      trace.push({ step, page, action: a.action, target: entry.target, value: a.value, reason: a.reason });

      if (a.action === "done") {
        const patch = resultToRow(a.result, snapshot.url);
        if (!patch.cost_total) { history.push({ ...entry, outcome: "価格が 0 円だったので、もう一度読み直してください" }); continue; }
        try {
          const { data_url: shot } = await callAssistant("capture", { session_id: session });
          const { file_url: path } = await db.integrations.Core.UploadFile({ file: await dataUrlToFile(shot, `graphic-${Date.now()}.jpg`) });
          patch.screenshot_path = path;
        } catch { /* スクショが撮れなくても価格は使う */ }
        patch.checked_at = new Date().toISOString();
        return { ok: true, patch, steps: step, trace };
      }
      if (a.action === "fail") return { ok: false, reason: a.reason || "見つかりませんでした", steps: step, trace, debug: debugOf(lastSnap) };
      if (a.action === "blocked") { history.push({ ...entry, outcome: `止めました: ${a.reason}` }); continue; }
      try {
        await callAssistant("act", { session_id: session, action: a.action, element_id: a.element_id, value: a.value, url: a.url });
        history.push({ ...entry, outcome: "ok" });
      } catch (e) {
        history.push({ ...entry, outcome: `失敗: ${e.message}` });
      }
    }
    return { ok: false, reason: `${MAX_STEPS} 手で価格にたどり着けませんでした`, steps: MAX_STEPS, trace, debug: debugOf(lastSnap) };
  } catch (e) {
    return { ok: false, reason: e.message, steps: history.length, trace, debug: debugOf(lastSnap) };
  } finally {
    // 閉じ終わってから次の品目に進む（重なるとウィンドウを見失うため）
    if (session) await callAssistant("close", { session_id: session }).catch(() => {});
  }
}
