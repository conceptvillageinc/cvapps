import { useState } from "react";
import { Filter, X, Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ============================================================================
// 一覧の「今の条件」を 1 行で出す（案件一覧の標準・案件別ネクストアクションで共通）
//   条件の名前は札の外の左に、札の中は値だけ。色は付けず、× で条件ごとに外せる。
//   editor を渡すと札をクリックして、その場で条件を変えられる（チェックの一覧・並び順の一覧）
// ============================================================================

/**
 * 条件の小さな札。
 * @param {string} label         条件の名前（札の外の左）
 * @param {string} value         札の中の文字
 * @param {(close: () => void) => React.ReactNode} [editor]  札をクリックしたときに開く中身
 * @param {() => void} [onClear] × で外す
 */
export function CondChip({ label, value, title, onClear, editor }) {
  const [open, setOpen] = useState(false);
  const box = "inline-flex items-center gap-1 rounded border bg-white px-1.5 leading-5";
  const text = <span className="font-medium text-foreground max-w-[260px] truncate">{value}</span>;
  const clear = onClear && (
    <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground" aria-label={`${label}の条件を外す`}><X className="w-3 h-3" /></button>
  );
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      <span>{label}</span>
      {editor ? (
        <span className={box}>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-0.5 hover:text-primary" title={`${title || value}（クリックで変更）`} aria-label={`${label}を変更`}>
                {text}<ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-0 text-xs">
              {editor(() => setOpen(false))}
            </PopoverContent>
          </Popover>
          {clear}
        </span>
      ) : (
        <span className={box} title={title || value}>{text}{clear}</span>
      )}
    </span>
  );
}

/** 条件の行（中身は CondChip などを並べる） */
export function ConditionsRow({ children, className = "" }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground shrink-0 ${className}`} data-testid="list-conditions">
      <Filter className="w-3.5 h-3.5" />
      {children}
    </div>
  );
}

/** 値の並びを札に入れる文字にする（4 つ以上は「A・B・C ほか2」） */
export const joinValues = (values) => (values.length > 3 ? `${values.slice(0, 3).join("・")} ほか${values.length - 3}` : values.join("・") || "（なし）");

/**
 * 札の中身: 表示する値をチェックで選ぶ。selected = null は「すべて」
 * @param {string[]} options
 * @param {string[]|null} selected
 * @param {(next: string[]|null) => void} onChange  すべて選んだときは null を渡す
 * @param {(v: string) => string} [labelOf]
 */
export function CheckListEditor({ options, selected, onChange, labelOf = (v) => v || "（空欄）" }) {
  const set = new Set(selected ?? options);
  const toggle = (v) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next.size === options.length ? null : options.filter((o) => next.has(o)));
  };
  return (
    <div data-testid="cond-editor">
      <div className="flex items-center justify-between px-2 py-1.5 border-b text-[10px]">
        <button type="button" onClick={() => onChange(null)} className="text-primary hover:underline">すべて選択</button>
        <span className="text-muted-foreground">{set.size}/{options.length}</span>
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => toggle(o)} className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 text-left">
            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${set.has(o) ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
              {set.has(o) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </span>
            <span className="truncate">{labelOf(o)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 札の中身: 並び順を 1 つ選ぶ
 * @param {{ id: string, label: string, value: any }[]} options
 * @param {string} currentId
 */
export function SortEditor({ options, currentId, onChange, close }) {
  return (
    <div className="max-h-72 overflow-y-auto py-1" data-testid="cond-editor">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => { onChange(o.value); close(); }} className={`w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 text-left ${o.id === currentId ? "text-primary font-medium" : ""}`}>
          <Check className={`w-3 h-3 shrink-0 ${o.id === currentId ? "opacity-100" : "opacity-0"}`} />
          {o.label}
        </button>
      ))}
    </div>
  );
}
