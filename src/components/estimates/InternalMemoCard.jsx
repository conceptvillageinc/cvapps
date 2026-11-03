import { useEffect, useRef } from "react";
import { Lock } from "lucide-react";

/**
 * 見積ごとの社内メモ（大きめの欄）。見積書・プレビュー・PDF・メール・納品書には一切出ない。
 *   例: 社内見積（スプレッドシート）で入れた内容の説明、実際は 2500 冊で印刷したが 3000 冊で請求する、など
 *   案件詳細の見積の欄にも先頭の数行を出す
 */
export default function InternalMemoCard({ estimate, onUpdate }) {
  const ref = useRef(null);
  const value = estimate.internal_memo || "";
  // 書いた量に合わせて高さを伸ばす
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(120, el.scrollHeight + 2)}px`;
  }, [value]);
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 space-y-2" data-testid="internal-memo">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-violet-900"><Lock className="w-4 h-4" /> 社内メモ</span>
        <span className="text-[11px] text-violet-700">提出物（見積書・プレビュー・PDF・メール・納品書）には出ません。案件詳細の見積の欄にも先頭が出ます</span>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onUpdate({ internal_memo: e.target.value })}
        placeholder={"社内見積で入れた内容の説明、仕入先とのやりとり、注意点など\n例: 実際の印刷は 2500 冊（原価 ¥72,636）。請求は見積どおり 3000 冊で行う"}
        className="w-full min-h-[120px] resize-y rounded-md border border-violet-200 bg-white px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-300"
        data-testid="internal-memo-input"
      />
    </div>
  );
}
