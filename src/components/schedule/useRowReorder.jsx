import { useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 工程の行をつかんで上下にドラッグし、置きたいところで離すと並びが変わる（タイムライン・リスト共通）。
 *   入れられる場所は container の中の [data-drop-index] の要素の下の端（data-drop-category がそのカテゴリー）。
 *   行の下の端 → その行のあと、カテゴリーの見出しの下の端 → そのカテゴリーの先頭。
 *   ドラッグ中は入る場所に青い線を出す。枠の上下の端に近づくと自動でスクロールする。
 * @param {(id, toIndex, category) => void} onDrop
 */
export function useRowReorder(onDrop) {
  const [state, setState] = useState(null); // { id, line: { top, left, width } }
  const ref = useRef(null);

  const start = (e, id, container, scroller) => {
    if (!container || e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    let target = null;
    let lastY = e.clientY;
    const measure = () => {
      const box = (scroller || container).getBoundingClientRect();
      let best = null;
      for (const el of container.querySelectorAll("[data-drop-index]")) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.bottom - lastY);
        if (!best || d < best.d) best = { d, index: Number(el.dataset.dropIndex), category: el.dataset.dropCategory ?? "", y: r.bottom };
      }
      target = best;
      if (best) setState({ id, line: { top: Math.max(box.top, Math.min(box.bottom, best.y)) - 1, left: box.left, width: box.width } });
    };
    // 枠の上下の端（スクロールしない枠なら画面の上下の端）で自動スクロール
    const tick = setInterval(() => {
      const el = scroller && scroller.scrollHeight > scroller.clientHeight ? scroller : null;
      const top = el ? el.getBoundingClientRect().top : 0;
      const bottom = el ? el.getBoundingClientRect().bottom : window.innerHeight;
      const step = lastY < top + 36 ? -14 : lastY > bottom - 36 ? 14 : 0;
      if (!step) return;
      if (el) el.scrollTop += step; else window.scrollBy(0, step);
      measure();
    }, 30);
    const move = (ev) => { lastY = ev.clientY; measure(); };
    const up = () => {
      clearInterval(tick);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      ref.current = null; setState(null);
      if (target) onDrop(id, target.index, target.category === "" ? null : target.category);
    };
    document.body.style.cursor = "grabbing"; document.body.style.userSelect = "none";
    ref.current = id;
    measure();
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const line = state && createPortal(
    <div className="pointer-events-none fixed z-[100] h-[3px] rounded-full bg-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.2)]" style={state.line} data-testid="reorder-line">
      <span className="absolute -left-1 -top-[3px] h-[9px] w-[9px] rounded-full border-2 border-blue-500 bg-white" />
    </div>,
    document.body,
  );
  return { draggingId: state?.id || null, start, line };
}
