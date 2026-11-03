import { Landmark } from "lucide-react";

/** 補助金を使う案件の印（案件一覧・案件詳細で共通） */
export default function SubsidyMark({ className = "", title = "補助金を使う案件" }) {
  return (
    <span title={title} className={`inline-flex items-center gap-0.5 rounded border border-orange-200 bg-orange-50 px-1 py-px text-[9px] font-medium leading-tight text-orange-800 shrink-0 whitespace-nowrap ${className}`} data-testid="subsidy-mark">
      <Landmark className="w-2.5 h-2.5" />補助金
    </span>
  );
}
