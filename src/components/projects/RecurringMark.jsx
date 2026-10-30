import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { db } from "@/api/db";

/** 定期売上の印（案件・見積・納品書・請求書の一覧で共通。柔らかい赤） */
export default function RecurringMark({ className = "", title = "定期売上" }) {
  return (
    <span title={title} className={`inline-flex items-center gap-0.5 rounded border border-rose-200 bg-rose-50 px-1 py-px text-[9px] font-medium leading-tight text-rose-700 shrink-0 whitespace-nowrap ${className}`} data-testid="recurring-mark">
      <Repeat className="w-2.5 h-2.5" />定期
    </span>
  );
}

/** 定期売上の案件の id（一覧で「この見積・納品書・請求書は定期売上か」を見るのに使う） */
export function useRecurringProjectIds() {
  const { data = [] } = useQuery({
    queryKey: ["projects", "recurringIds"],
    queryFn: () => db.entities.Project.filter({ is_recurring: true }),
    staleTime: 60_000,
  });
  return useMemo(() => new Set(data.map((p) => p.id)), [data]);
}

/** 請求書に定期売上の分が入っているか（案件・明細の案件・定期の納品書から写した明細） */
export const invoiceHasRecurring = (inv, ids) =>
  ids.has(inv?.project_id) || (inv?.line_items || []).some((li) => li.source_type === "recurring" || ids.has(li.project_id));

/** 納品書が定期売上の分か（毎月の自動作成、または定期売上の案件の納品書） */
export const noteIsRecurring = (n, ids) => !!n?.recurring_template_id || ids.has(n?.project_id);
