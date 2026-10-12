// ============================================================================
// CV AX KIT アシスタント（Chrome 拡張機能・サービスワーカー）
//   CV アプリのページから頼まれて、グラフィック（www.graphic.jp）のページを別ウィンドウで開き、
//   読む（番号を振った要素と本文）・操作する（クリック・選択・入力）・スクリーンショットを撮る・閉じる。
//   何を押すかは CV アプリ（AI）が決める。ここは「手」だけで、ログイン情報や API キーは持たない。
//   決まりごと:
//     - 頼みを受けるのは cv-ax.jp のページからだけ
//     - 開く・操作するのは、この拡張機能が開いたグラフィックのタブだけ（ほかのタブには触らない）
//     - 操作の間は 2 秒以上あける（先方のサーバーに負担をかけない）
// ============================================================================
const ALLOWED_ORIGINS = ["https://cv-ax.jp", "https://www.cv-ax.jp"];
const MIN_INTERVAL_MS = 2000;
const SESSION_TTL_MS = 10 * 60 * 1000;

const isGraphicUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" && (x.hostname === "www.graphic.jp" || x.hostname === "graphic.jp"); } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 開いているウィンドウ（サービスワーカーが止まっても忘れないよう storage.session に置く）
async function sessions() { return (await chrome.storage.session.get("sessions")).sessions || {}; }
async function saveSessions(s) { await chrome.storage.session.set({ sessions: s }); }
async function getSession(id) {
  const s = (await sessions())[String(id)];
  if (!s) throw new Error("調べるためのウィンドウが見つかりません（閉じられた可能性があります）");
  return s;
}
async function touch(id, patch = {}) { const all = await sessions(); if (all[id]) { all[id] = { ...all[id], ...patch, at: Date.now() }; await saveSessions(all); } }
async function closeStale() {
  const all = await sessions();
  for (const [id, s] of Object.entries(all)) {
    if (Date.now() - (s.at || 0) > SESSION_TTL_MS) { try { await chrome.windows.remove(s.windowId); } catch { /* もう無い */ } delete all[id]; }
  }
  await saveSessions(all);
}

/** タブの読み込みが落ち着くまで待つ（移動が無ければ短く待つだけ） */
function waitForLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); resolve(); };
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    const t = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") setTimeout(() => { chrome.tabs.get(tabId).then((t2) => { if (t2.status === "complete") finish(); }).catch(finish); }, 600); }).catch(finish);
  });
}
async function settle(tabId) { await sleep(700); await waitForLoad(tabId); await sleep(900); }
async function pace(id) {
  const s = await getSession(id);
  const wait = MIN_INTERVAL_MS - (Date.now() - (s.lastAction || 0));
  if (wait > 0) await sleep(wait);
  await touch(id, { lastAction: Date.now() });
}
async function assertGraphic(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isGraphicUrl(tab.url || tab.pendingUrl || "")) throw new Error(`グラフィック以外のページになりました（${tab.url}）`);
  return tab;
}

// ---- ページの中で動かす関数（ほかの変数を参照しないこと） ----
function snapshotPage() {
  const visible = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  const txt = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const labelOf = (el) => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return txt(l.innerText); }
    const p = el.closest("label"); if (p) return txt(p.innerText);
    return txt(el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.name || "");
  };
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="radio"], [role="option"]';
  let n = 0;
  const elements = [];
  for (const el of document.querySelectorAll(sel)) {
    const isChoice = el.tagName === "INPUT" && /radio|checkbox/.test(el.type);
    if (!isChoice && !visible(el)) continue;
    if (isChoice && !visible(el) && !(el.closest("label") && visible(el.closest("label")))) continue;
    const id = String(++n);
    el.setAttribute("data-cv-id", id);
    const e = { id, tag: el.tagName.toLowerCase() };
    if (el.type && el.tagName === "INPUT") e.type = el.type;
    if (el.getAttribute("role")) e.role = el.getAttribute("role");
    const t = el.tagName === "SELECT" ? "" : txt(el.innerText || el.value || el.alt || "");
    if (t) e.text = t.slice(0, 80);
    const lab = labelOf(el); if (lab && lab !== e.text) e.label = lab.slice(0, 60);
    if (el.tagName === "A") e.href = el.getAttribute("href");
    if (el.tagName === "INPUT" && !isChoice && el.value) e.value = String(el.value).slice(0, 40);
    if (isChoice) { e.value = el.value; if (el.checked) e.checked = true; }
    if (el.tagName === "SELECT") e.options = [...el.options].slice(0, 80).map((o) => ({ value: o.value, text: txt(o.text), selected: o.selected }));
    elements.push(e);
    if (elements.length >= 500) break;
  }
  return { url: location.href, title: document.title, text: txt(document.body?.innerText || "").slice(0, 20000), elements };
}

function actOnPage(action, id, value) {
  const el = document.querySelector(`[data-cv-id="${id}"]`);
  if (!el) return { ok: false, error: `要素 ${id} が見つかりません（ページが変わった可能性があります）` };
  el.scrollIntoView({ block: "center" });
  const fire = (t) => el.dispatchEvent(new Event(t, { bubbles: true }));
  if (action === "click") {
    if (el.tagName === "INPUT" && /radio|checkbox/.test(el.type) && el.closest("label")) el.closest("label").click(); else el.click();
    return { ok: true };
  }
  if (action === "select") {
    if (el.tagName !== "SELECT") return { ok: false, error: "選択肢（select）ではありません" };
    const opt = [...el.options].find((o) => o.value === value) || [...el.options].find((o) => o.text.replace(/\s+/g, " ").trim() === String(value).trim());
    if (!opt) return { ok: false, error: `選択肢「${value}」がありません` };
    el.value = opt.value; fire("input"); fire("change");
    return { ok: true };
  }
  if (action === "type") {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    el.focus(); if (setter) setter.call(el, value); else el.value = value;
    fire("input"); fire("change");
    return { ok: true };
  }
  if (action === "submit") {
    if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); return { ok: true }; }
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    return { ok: true };
  }
  return { ok: false, error: `不明な操作です: ${action}` };
}
// ------------------------------------------------------------------------

const handlers = {
  async open({ url }) {
    await closeStale();
    const target = url && isGraphicUrl(url) ? url : "https://www.graphic.jp/";
    const win = await chrome.windows.create({ url: target, focused: false, width: 1280, height: 900, type: "normal" });
    const tabId = win.tabs[0].id;
    const all = await sessions();
    all[String(tabId)] = { windowId: win.id, tabId, at: Date.now(), lastAction: Date.now() };
    await saveSessions(all);
    await settle(tabId);
    return { session_id: tabId };
  },
  async snapshot({ session_id }) {
    const s = await getSession(session_id);
    await assertGraphic(s.tabId);
    const [r] = await chrome.scripting.executeScript({ target: { tabId: s.tabId }, func: snapshotPage });
    await touch(session_id);
    return r.result;
  },
  async act({ session_id, action, element_id, value, url }) {
    const s = await getSession(session_id);
    await pace(session_id);
    if (action === "goto") {
      if (!isGraphicUrl(url)) throw new Error("グラフィック以外の URL には移動しません");
      await chrome.tabs.update(s.tabId, { url });
    } else if (action === "back") {
      await chrome.tabs.goBack(s.tabId);
    } else if (action === "scroll") {
      await chrome.scripting.executeScript({ target: { tabId: s.tabId }, func: () => window.scrollBy(0, Math.round(window.innerHeight * 0.8)) });
    } else {
      await assertGraphic(s.tabId);
      const [r] = await chrome.scripting.executeScript({ target: { tabId: s.tabId }, func: actOnPage, args: [action, String(element_id), String(value ?? "")] });
      if (!r.result?.ok) throw new Error(r.result?.error || "操作できませんでした");
    }
    await settle(s.tabId);
    const tab = await chrome.tabs.get(s.tabId);
    if (!isGraphicUrl(tab.url || "")) { await chrome.tabs.goBack(s.tabId).catch(() => {}); throw new Error("グラフィック以外のページに移ったので戻しました"); }
    return { url: tab.url };
  },
  async capture({ session_id }) {
    const s = await getSession(session_id);
    await assertGraphic(s.tabId);
    try {
      return { data_url: await chrome.tabs.captureVisibleTab(s.windowId, { format: "jpeg", quality: 70 }) };
    } catch {
      // ウィンドウが隠れていると撮れないことがあるので、いったん前に出して撮る
      await chrome.windows.update(s.windowId, { focused: true });
      await sleep(400);
      return { data_url: await chrome.tabs.captureVisibleTab(s.windowId, { format: "jpeg", quality: 70 }) };
    }
  },
  async close({ session_id }) {
    const all = await sessions();
    const s = all[String(session_id)];
    if (s) { try { await chrome.windows.remove(s.windowId); } catch { /* もう無い */ } delete all[String(session_id)]; await saveSessions(all); }
    return {};
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
  if (sender.id !== chrome.runtime.id || !ALLOWED_ORIGINS.includes(origin)) { sendResponse({ ok: false, error: "このページからは使えません" }); return false; }
  const h = handlers[msg?.type];
  if (!h) { sendResponse({ ok: false, error: `不明な依頼です: ${msg?.type}` }); return false; }
  h(msg.payload || {}).then((data) => sendResponse({ ok: true, data })).catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});

// 拡張機能が止まっても調べ用のウィンドウを残さない
chrome.windows.onRemoved.addListener(async (windowId) => {
  const all = await sessions();
  for (const [id, s] of Object.entries(all)) if (s.windowId === windowId) delete all[id];
  await saveSessions(all);
});
