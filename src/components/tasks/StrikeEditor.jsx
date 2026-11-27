import { useLayoutEffect, useRef } from "react";
import { isStrikeShortcut } from "@/lib/strike";

// ============================================================================
// 打ち消し線をそのまま見ながら書ける入力欄（タスクの説明）
//   保存する文字は今までどおり ~~ … ~~ ではさんだ形（表示・コメント・受信トレイと同じ）。
//   入力中は ~~ を見せず、線を引いて見せる。太字などのほかの飾りは付けない
// ============================================================================

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 保存する文字 → 入力欄の中身（HTML） */
function toHtml(text) {
  const t = String(text ?? "");
  const html = t.split("\n").map((line) => line.split(/(~~[^\n]+?~~)/g).map((p) => (/^~~[^\n]+?~~$/.test(p) ? `<s>${esc(p.slice(2, -2))}</s>` : esc(p))).join("")).join("<br>");
  return t.endsWith("\n") ? html + "<br>" : html; // 最後の改行は、もう 1 つ <br> が無いと見えない
}

const isStruck = (el) => ["S", "STRIKE", "DEL"].includes(el.tagName) || /line-through/.test(el.style?.textDecoration || el.style?.textDecorationLine || "");
const BLOCK = new Set(["DIV", "P", "LI"]);
// 線は 1 行の中だけで効くので、行ごとにはさむ
const wrapLines = (s) => s.replace(/~~/g, "").split("\n").map((l) => (l.trim() ? `~~${l}~~` : l)).join("\n");

/** 入力欄の中身 → 保存する文字 */
function fromDom(root) {
  const walk = (node, struck) => {
    let out = "";
    node.childNodes.forEach((n, i) => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/ /g, " "); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === "BR") { if (!(node === root && i === node.childNodes.length - 1)) out += "\n"; return; } // 最後の <br> は見せるためだけのもの
      const block = BLOCK.has(n.tagName);
      const inner = walk(n, struck || isStruck(n));
      const s = !struck && isStruck(n) ? wrapLines(inner) : inner;
      out += (block && out && !out.endsWith("\n") ? "\n" : "") + s;
    });
    return out;
  };
  return walk(root, false);
}

export default function StrikeEditor({ value, onChange, onBlur, placeholder, className = "", testId }) {
  const ref = useRef(null);
  const last = useRef(null); // 自分で書いた値（そのときは中身を作り直さない＝カーソルが飛ばない）
  useLayoutEffect(() => {
    if (!ref.current || value === last.current) return;
    ref.current.innerHTML = toHtml(value);
    last.current = value;
  }, [value]);
  const emit = () => { const t = fromDom(ref.current); last.current = t; onChange(t); };
  const empty = !value;
  return (
    <div className="relative">
      {empty && <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">{placeholder}</span>}
      <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={placeholder}
        onInput={emit} onBlur={onBlur}
        onKeyDown={(e) => {
          if (isStrikeShortcut(e)) { e.preventDefault(); document.execCommand("strikeThrough"); emit(); return; }
          // 太字・斜体・下線は付けない（保存できないため）
          if ((e.metaKey || e.ctrlKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) { e.preventDefault(); return; }
          if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault(); document.execCommand("insertLineBreak");
            if (document.queryCommandState("strikeThrough")) document.execCommand("strikeThrough"); // 新しい行は線なしで書き始める
            emit();
          }
        }}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }}
        onDrop={(e) => e.preventDefault()}
        className={`whitespace-pre-wrap break-words outline-none [&_s]:text-slate-400 [&_s]:decoration-slate-500 [&_strike]:text-slate-400 ${className}`} data-testid={testId} />
    </div>
  );
}
