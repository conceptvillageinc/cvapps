// CV アプリ（cv-ax.jp）のページと拡張機能の橋渡し。
// ページは window.postMessage({ source: "cv-app", id, type, payload }) で頼み、
// 結果は { source: "cv-assistant", id, ok, data | error } で返る。
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const announce = () => {
    document.documentElement.dataset.cvAssistant = VERSION;
    window.postMessage({ source: "cv-assistant", type: "hello", version: VERSION }, location.origin);
  };
  if (document.documentElement) announce();
  document.addEventListener("DOMContentLoaded", announce);

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== "cv-app" || !m.id || !m.type) return;
    if (m.type === "ping") { window.postMessage({ source: "cv-assistant", id: m.id, ok: true, data: { version: VERSION } }, location.origin); return; }
    try {
      chrome.runtime.sendMessage({ type: m.type, payload: m.payload || {} }, (res) => {
        const err = chrome.runtime.lastError;
        window.postMessage({ source: "cv-assistant", id: m.id, ...(err ? { ok: false, error: err.message } : res || { ok: false, error: "拡張機能から返事がありません" }) }, location.origin);
      });
    } catch (err) {
      window.postMessage({ source: "cv-assistant", id: m.id, ok: false, error: "拡張機能が更新されました。CV アプリのページを読み込み直してください" }, location.origin);
    }
  });
})();
