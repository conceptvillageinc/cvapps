import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ============================================================================
// 一覧の日付（案件登録日など）をクリックして、その場で変える。「変更する」で保存する。
//   案件番号は登録したときの番号のまま（登録日を変えても振り直さない）
// ============================================================================

const FIELD_LABEL = { registered_at: "案件登録日" };

export default function InlineDateCell({ project, field, className = "" }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(project[field] || "");
  const queryClient = useQueryClient();
  const label = FIELD_LABEL[field] || "日付";

  const save = useMutation({
    mutationFn: (v) => db.entities.Project.update(project.id, { [field]: v }),
    onSuccess: (_row, v) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success(`${label}を ${v} にしました`);
      setOpen(false);
    },
    onError: (err) => toast.error(`${label}を変えられませんでした: ` + (err?.message || "不明なエラー")),
  });

  const stop = (e) => e.stopPropagation(); // 行のクリック（案件詳細を開く）にしない
  const commit = () => {
    if (!value) { toast.error(`${label}を入れてください`); return; }
    if (value === project[field]) { setOpen(false); return; }
    save.mutate(value);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(project[field] || ""); }}>
      <PopoverTrigger asChild>
        <button type="button" onClick={stop} className={`rounded px-1 -mx-1 tabular-nums hover:bg-primary/5 hover:ring-1 hover:ring-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`} title={`${label}を変更（クリック）`} aria-label={`${label}を変更`} data-testid={`inline-${field}`}>
          {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : project[field] || "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 space-y-2" onClick={stop}>
        <p className="text-xs font-semibold">{label}を変更</p>
        <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} className="h-9" autoFocus aria-label={label} />
        {field === "registered_at" && <p className="text-[10px] text-muted-foreground leading-relaxed">案件番号はそのままです。年度で絞り込んでいるときは、年度の外の日付にすると一覧から見えなくなります</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>キャンセル</Button>
          <Button type="button" size="sm" className="h-8 text-xs" onClick={commit} disabled={save.isPending}>{save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}変更する</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
