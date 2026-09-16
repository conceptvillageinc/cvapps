import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, Check, ArrowUpDown } from "lucide-react";

// スプレッドシート同様、列内に実在する値（または選択肢マスタ）をチェックボックスで選ぶフィルター
export function ColumnFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const isFiltered = selected !== null;
  const activeSet = selected === null ? new Set(options) : new Set(selected);
  const filteredOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  const toggleValue = (value) => {
    const next = new Set(activeSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // 全選択状態に戻ったらフィルター解除（null）にする
    onChange(next.size === options.length ? null : Array.from(next));
  };

  const selectAll = () => onChange(null);
  const clearAll = () => onChange([]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={`ml-1 align-middle ${isFiltered ? "text-primary" : "text-white/50 hover:text-white"}`}>
          <Filter className="w-3 h-3" fill={isFiltered ? "currentColor" : "none"} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`${label}を検索`}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 border-b text-[10px]">
          <button onClick={selectAll} className="text-primary hover:underline">すべて選択</button>
          <button onClick={clearAll} className="text-muted-foreground hover:underline">クリア</button>
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {filteredOptions.length === 0 && (
            <p className="text-[10px] text-muted-foreground text-center py-3">該当する値がありません</p>
          )}
          {filteredOptions.map(opt => {
            const checked = activeSet.has(opt);
            return (
              <button
                key={opt}
                onClick={() => toggleValue(opt)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/50 text-left"
              >
                <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${checked ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                  {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </span>
                <span className="truncate">{opt || "（空欄）"}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// 法人格表記（ソート対象外）
const CORP_AFFIXES = ["株式会社", "有限会社", "一般社団法人", "NPO法人"];
export function stripCorpAffix(str = "") {
  let s = str;
  CORP_AFFIXES.forEach(p => {
    if (s.startsWith(p)) s = s.slice(p.length);
    if (s.endsWith(p)) s = s.slice(0, -p.length);
  });
  return s.trim();
}

// 並び替え（昇順・降順など）ボタン
export function SortButton({ options, sortKey, currentSort, onChange }) {
  const [open, setOpen] = useState(false);
  const active = currentSort?.key === sortKey;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={`ml-1 align-middle ${active ? "text-primary" : "text-white/50 hover:text-white"}`}>
          <ArrowUpDown className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {options.map(opt => {
          const isActive = active && currentSort.direction === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => { onChange(isActive ? null : { key: sortKey, direction: opt.value }); setOpen(false); }}
              className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/50 flex items-center gap-1.5 ${isActive ? "text-primary font-medium" : ""}`}
            >
              {isActive && <Check className="w-3 h-3" />}
              {opt.label}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

