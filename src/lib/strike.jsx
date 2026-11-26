// ============================================================================
// 打ち消し線（タスクの説明・コメント）
//   文字は ~~ではさんで保存し、表示するときに線を引く（例: ~~済んだこと~~）
//   ショートカット: Mac は Control＋Option＋X か ⌘＋Shift＋X、Windows は Ctrl＋Alt＋X か Alt＋Shift＋5
// ============================================================================

/** 打ち消し線のショートカットか（Option／Alt を押すと e.key が変わるので、キーの位置 e.code で見る） */
export function isStrikeShortcut(e) {
  if (e.nativeEvent?.isComposing || e.isComposing) return false;
  if (e.code === "KeyX" && e.ctrlKey && e.altKey && !e.metaKey) return true; // Control＋Option＋X／Ctrl＋Alt＋X
  if (e.code === "KeyX" && e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey) return true; // ⌘＋Shift＋X
  if (e.code === "Digit5" && e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey) return true; // Alt＋Shift＋5（Windows の Google ドキュメントと同じ）
  return false;
}

/**
 * 入力欄で選んでいる文字に打ち消し線を付ける・外す（もう付いていれば外す）。
 *   何も選んでいないときは ~~~~ を入れて、そのあいだにカーソルを置く。
 *   「元に戻す（⌘Z）」で戻せるように、ブラウザの文字入力として書き換える
 */
export function toggleStrike(el) {
  if (!el) return;
  const v = el.value; let a = el.selectionStart; let b = el.selectionEnd;
  // 選んだ範囲のまわりの空白は線に入れない
  while (a < b && /\s/.test(v[a])) a++;
  while (b > a && /\s/.test(v[b - 1])) b--;
  const sel = v.slice(a, b);
  let from = a; let to = b; let text; let selStart; let selEnd;
  if (v.slice(a - 2, a) === "~~" && v.slice(b, b + 2) === "~~") { // 外側に ~~ がある → 外す
    from = a - 2; to = b + 2; text = sel; selStart = from; selEnd = from + sel.length;
  } else if (sel.length >= 4 && sel.startsWith("~~") && sel.endsWith("~~")) { // 選んだ中に ~~ がある → 外す
    text = sel.slice(2, -2); selStart = from; selEnd = from + text.length;
  } else if (!sel) {
    text = "~~~~"; selStart = selEnd = from + 2;
  } else { // 行ごとに付ける（~~ は 1 行の中だけで効く）
    text = sel.split("\n").map((line) => (line.trim() ? line.replace(/^(\s*)(.*?)(\s*)$/, "$1~~$2~~$3") : line)).join("\n");
    selStart = from; selEnd = from + text.length;
  }
  el.focus();
  el.setSelectionRange(from, to);
  let ok = false;
  try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
  if (!ok) { // 古いブラウザ：値を直接入れて、React に知らせる
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, v.slice(0, from) + text + v.slice(to));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(selStart, selEnd);
}

/** 打ち消し線を付けて表示する。each は線の外・中の文字それぞれに使う飾り（@メンションの色など） */
export function renderStrike(text, each = (s) => s) {
  const parts = String(text ?? "").split(/(~~[^\n]+?~~)/g);
  return parts.map((p, i) => (/^~~[^\n]+?~~$/.test(p)
    ? <s key={i} className="text-slate-400 decoration-slate-500">{each(p.slice(2, -2))}</s>
    : <span key={i}>{each(p)}</span>));
}

/** 線の印（~~）を取った文字（短い一覧・通知の見出しなど） */
export const stripStrike = (text) => String(text ?? "").replace(/~~([^\n]+?)~~/g, "$1");
