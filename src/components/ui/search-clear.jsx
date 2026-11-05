import { X } from "lucide-react";

/**
 * 検索欄の右端の ×（入れた文字を 1 回で消す）。検索欄を包む relative の要素の中に、入力欄のすぐ後ろに置く。
 * 入力欄の右側には pr-8 くらいの余白を空けておく。
 */
export default function SearchClear({ value, onClear, className = "" }) {
  if (!String(value || "")) return null;
  return (
    <button type="button" onClick={onClear} onMouseDown={(e) => e.preventDefault()} aria-label="検索の文字を消す" title="検索の文字を消す"
      className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground ${className}`} data-testid="search-clear">
      <X className="w-3.5 h-3.5" />
    </button>
  );
}
