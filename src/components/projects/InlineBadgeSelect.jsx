import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { getDealProbabilityColor, getPhaseColor, PROJECT_STATUS_MAP } from "@/lib/constants";

// ============================================================================
// 一覧の札（受注確度・フェーズ・状態）をクリックして、その場で変える
//   案件一覧（標準）と案件別ネクストアクションで共通。選ぶとすぐ保存する。
//   受注確度を「定期」を含む値にしたときは、案件の編集画面と同じく定期売上の印も付ける
// ============================================================================

const FIELD_LABEL = { deal_probability: "受注確度", phase: "フェーズ", status: "状態" };

function useChoices(field) {
  const { dealProbabilityOptions = [], phaseOptions = [] } = useSystemSettings();
  if (field === "status") return Object.entries(PROJECT_STATUS_MAP).map(([value, v]) => ({ value, label: v.label, cls: v.color }));
  if (field === "deal_probability") return dealProbabilityOptions.map((v) => ({ value: v, label: v, cls: getDealProbabilityColor(v) }));
  return phaseOptions.map((v) => ({ value: v, label: v, cls: getPhaseColor(v) }));
}

/**
 * @param {object} p
 * @param {object} p.project
 * @param {'deal_probability'|'phase'|'status'} p.field
 */
export default function InlineBadgeSelect({ project, field }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const choices = useChoices(field);
  const current = field === "status" ? (project.status || "open") : (project[field] || "");
  const cur = choices.find((c) => c.value === current) || (current ? { value: current, label: field === "status" ? (PROJECT_STATUS_MAP[current]?.label || current) : current, cls: field === "phase" ? getPhaseColor(current) : field === "deal_probability" ? getDealProbabilityColor(current) : "" } : null);
  // 選択肢に無い今の値（古い値）も一覧に残す
  const list = cur && !choices.some((c) => c.value === cur.value) ? [...choices, cur] : choices;

  const save = useMutation({
    mutationFn: (value) => {
      const patch = { [field]: value };
      if (field === "deal_probability" && /定期/.test(value)) patch.is_recurring = true;
      return db.entities.Project.update(project.id, patch);
    },
    onSuccess: (_row, value) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      const label = list.find((c) => c.value === value)?.label || value;
      toast.success(`${FIELD_LABEL[field]}を「${label}」にしました`);
    },
    onError: (err) => toast.error(`${FIELD_LABEL[field]}を変えられませんでした: ` + (err?.message || "不明なエラー")),
  });

  const stop = (e) => e.stopPropagation(); // 行のクリック（案件詳細を開く）にしない
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={stop} className="inline-flex items-center rounded-md cursor-pointer hover:ring-2 hover:ring-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" title={`${FIELD_LABEL[field]}を変更（クリック）`} aria-label={`${FIELD_LABEL[field]}を変更`} data-testid={`inline-${field}`}>
          {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : cur ? (
            <Badge className={`text-[10px] whitespace-nowrap pointer-events-none ${cur.cls}`}>{cur.label}</Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground border border-dashed rounded px-1.5 py-0.5 cursor-pointer">未設定</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1" onClick={stop}>
        <p className="px-2 py-1 text-[10px] text-muted-foreground">{FIELD_LABEL[field]}を変更</p>
        {list.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => { setOpen(false); if (c.value !== current) save.mutate(c.value); }}
            className="w-full flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/60 text-left"
          >
            <Check className={`w-3 h-3 shrink-0 ${c.value === current ? "opacity-100 text-primary" : "opacity-0"}`} />
            <Badge className={`text-[10px] whitespace-nowrap pointer-events-none ${c.cls}`}>{c.label}</Badge>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
