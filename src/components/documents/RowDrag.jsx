import { useState } from "react";
import { GripVertical, ChevronUp, ChevronDown } from "lucide-react";

// ============================================================================
// 納品書・請求書の明細: つかんで上下に動かす（見積の明細と同じ操作）
//   const drag = useRowDrag(items, setItems);
//   <tr {...drag.rowProps(li)}> <td><RowHandle {...drag.handleProps(li, idx)} /></td> …
// ============================================================================

/** 配列の中で 1 つを別の位置へ */
export function moveTo(items, fromIdx, toIdx) {
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= items.length || toIdx >= items.length || fromIdx === toIdx) return items;
  const next = [...items];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function useRowDrag(items, onChange, { disabled = false } = {}) {
  const [dragId, setDragId] = useState(null);
  const idxOf = (id) => items.findIndex((li) => li.id === id);
  return {
    dragId,
    /** 行（tr）に付ける: 上に重ねた時点で入れ替える（落とすまで待たない） */
    rowProps: (li) => ({
      onDragOver: (e) => {
        if (!dragId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        if (dragId !== li.id) onChange(moveTo(items, idxOf(dragId), idxOf(li.id)));
      },
      onDrop: (e) => { if (dragId) { e.preventDefault(); setDragId(null); } },
      className: dragId === li.id ? "opacity-40" : "",
    }),
    /** つまみ（RowHandle）に渡す */
    handleProps: (li, idx) => ({
      disabled,
      isFirst: idx === 0,
      isLast: idx === items.length - 1,
      onDragStart: (e) => {
        setDragId(li.id);
        // つかんだ行そのものを影として出す
        const row = e.currentTarget.closest("tr");
        if (row && e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", li.id); e.dataTransfer.setDragImage(row, 16, 16); }
      },
      onDragEnd: () => setDragId(null),
      onMove: (dir) => onChange(moveTo(items, idx, idx + dir)),
    }),
  };
}

/** 行の左端のつまみ（つかんで上下に動かす・▲▼で 1 つずつ） */
export function RowHandle({ onDragStart, onDragEnd, onMove, isFirst, isLast, disabled }) {
  if (disabled) return null;
  return (
    <div className="flex flex-col items-center">
      <span draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="つかんで上下に動かす" className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing inline-block" data-testid="row-grip">
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      <span className="flex flex-col opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button type="button" onClick={() => onMove(-1)} disabled={isFirst} className="text-muted-foreground/60 hover:text-foreground disabled:opacity-20 leading-none" title="1 つ上へ" aria-label="1 つ上へ"><ChevronUp className="w-3 h-3" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={isLast} className="text-muted-foreground/60 hover:text-foreground disabled:opacity-20 leading-none" title="1 つ下へ" aria-label="1 つ下へ"><ChevronDown className="w-3 h-3" /></button>
      </span>
    </div>
  );
}
