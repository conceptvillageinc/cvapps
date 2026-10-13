import { useEffect, useRef, useState } from "react";

/**
 * 表の中の文字の欄。ふだんは全文を折り返して見せ（途中で切らない）、クリックすると入力欄になる。
 * Enter か欄の外をクリックで確定、Esc で取り消し。datalist の候補（list）も使える。
 */
export default function EditableCell({ value, onCommit, list, placeholder = "", className = "", textClassName = "", required = false, testId, autoEdit = false }) {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef(null);
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  const finish = (save) => {
    setEditing(false);
    const v = draft.trim();
    if (!save || v === (value || "") || (required && !v)) return;
    onCommit(v);
  };
  if (editing) {
    return (
      <input ref={ref} list={list} value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) finish(true); if (e.key === "Escape") finish(false); }}
        className={`h-7 w-full rounded border border-slate-300 bg-white px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring ${className}`} data-testid={testId} />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)}
      className={`block min-h-7 w-full rounded border border-transparent px-1.5 py-1 text-left text-xs leading-snug break-words whitespace-normal hover:border-slate-200 hover:bg-white ${value ? "" : "text-muted-foreground/60"} ${className} ${textClassName}`}
      title="クリックして編集" data-testid={testId}>
      {value || placeholder || " "}
    </button>
  );
}
