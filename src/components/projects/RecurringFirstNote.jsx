import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import MonthSelect from "@/components/ui/month-select";
import { createFirstRecurringNote, catchUpRecurringNotes } from "@/lib/projectNumber";

/**
 * 定期売上の初回の納品書をまだ作っていないときに出す（案件の画面）。何月末で出すかを選んで、ボタン 1 つで作る。
 * 2 回目からは毎月 1 日に自動で作られる。
 */
export default function RecurringFirstNote({ template }) {
  const qc = useQueryClient();
  const [ym, setYm] = useState(String(template?.start_month || "").slice(0, 7));
  const run = useMutation({
    mutationFn: async () => {
      const first = await createFirstRecurringNote(template.id, ym);
      const more = template.auto_delivery_note ? await catchUpRecurringNotes(template.id, ym, template.end_month ? String(template.end_month).slice(0, 7) : "") : 0;
      return { first, more };
    },
    onSuccess: ({ first, more }) => {
      qc.invalidateQueries({ queryKey: ["deliveryNotes"] });
      qc.invalidateQueries({ queryKey: ["recurringTemplates"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      toast.success(first ? `初回の納品書（下書き）を作りました${more ? `。今月までの ${more} 件も作りました` : ""}` : "その月の納品書はすでにあります");
    },
    onError: (err) => toast.error(err?.message || "作れませんでした"),
  });
  if (!template || template.first_note_month) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="recurring-first-note-bar">
      <Truck className="w-4 h-4 shrink-0" />
      <span className="font-medium">初回の納品書はまだ作っていません</span>
      <span className="text-sky-800/80">（2 回目からは毎月 1 日に自動で作ります）</span>
      <span className="ml-auto inline-flex items-center gap-1.5">
        <MonthSelect value={ym} onChange={setYm} ariaLabel="初回の納品書の月" monthSuffix="" />
        <span>月末で</span>
        <Button size="sm" className="h-8 gap-1 text-xs" disabled={!ym || run.isPending} onClick={() => run.mutate()} data-testid="recurring-first-note-create">
          {run.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />} 初回の納品書を作成
        </Button>
      </span>
    </div>
  );
}
