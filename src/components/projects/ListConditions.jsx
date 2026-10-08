import { Filter, X } from "lucide-react";

// ============================================================================
// 一覧の「今の条件」を 1 行で出す（案件一覧の標準・案件別ネクストアクションで共通）
//   条件の名前は札の外の左に、札の中は値だけ。色は付けず、× で条件ごとに外せる
// ============================================================================

/** 条件の小さな札。onClear があれば × で外せる */
export function CondChip({ label, value, title, onClear }) {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1 rounded border bg-white px-1.5 leading-5" title={title || value}>
        <span className="font-medium text-foreground max-w-[260px] truncate">{value}</span>
        {onClear && <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground" aria-label={`${label}の条件を外す`}><X className="w-3 h-3" /></button>}
      </span>
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
