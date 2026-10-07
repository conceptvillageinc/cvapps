import { useEffect } from "react";

// ============================================================================
// スクロールを軽くする: スクロール中だけ、見えている範囲に透明の覆いを 1 枚出して
// 中身のホバー（行の色・ボタンの色の切り替えとその色のアニメーション）を止める。
// マウスを一覧の上に置いたままホイールを回すと、カーソルの下を通る行ごとにホバーの
// 描き直しが走り、行の多い一覧でスクロールが引っかかるため。
//   中身全体の pointer-events を切り替える方法は、そのたびに全要素のスタイル計算が走って
//   かえって重くなるので使わない（覆い 1 枚の表示・非表示だけにする）。
//   スクロールが止まって少し経つと覆いを消す。ボタンを押したまま（ドラッグ・文字選択）のときは出さない。
// ============================================================================

const IDLE_MS = 200;

/**
 * @param {React.RefObject<HTMLElement>} ref        スクロールする要素
 * @param {React.RefObject<HTMLElement>} shieldRef  覆い（ScrollHoverShield）
 */
export function useScrollHoverPause(ref, shieldRef) {
  useEffect(() => {
    const el = ref.current;
    const shield = shieldRef.current;
    if (!el || !shield) return undefined;
    let shown = false;
    const show = (v) => { if (shown !== v) { shown = v; shield.style.display = v ? "block" : "none"; } };
    let timer = null;
    let pressed = false;
    const onDown = () => { pressed = true; };
    const onUp = () => { pressed = false; };
    const onScroll = () => {
      if (pressed) return;
      show(true);
      clearTimeout(timer);
      timer = setTimeout(() => show(false), IDLE_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("dragstart", onDown, true);
    window.addEventListener("dragend", onUp, true);
    window.addEventListener("drop", onUp, true);
    return () => {
      clearTimeout(timer);
      show(false);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("dragstart", onDown, true);
      window.removeEventListener("dragend", onUp, true);
      window.removeEventListener("drop", onUp, true);
    };
  }, [ref, shieldRef]);
}

/**
 * スクロールする要素の先頭に置く覆い。高さ 0 の sticky の中に、見えている範囲ぶんの透明の板を持つ
 * （sticky の中に置くので、覆いの上でホイールを回してもその要素がスクロールする）。
 */
export const ScrollHoverShield = ({ shieldRef }) => (
  <div aria-hidden className="sticky top-0 z-40 h-0 pointer-events-none">
    <div ref={shieldRef} className="absolute -inset-x-6 -top-6 h-[100vh] pointer-events-auto" style={{ display: "none" }} data-testid="scroll-shield" />
  </div>
);
