import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Lock, FolderKanban, Layers, ChevronDown } from "lucide-react";
import { isPrivateTask, subtasksOf } from "@/lib/tasks";
import { TaskPlaceChip } from "@/components/tasks/parts";

/** 紐づけ先を変える（サブタスクも同じ紐づけ先にして、見える範囲をそろえる） */
export async function moveTaskPlace(writes, task, allTasks, patch) {
  try {
    await writes.update(task, patch);
    await Promise.all(subtasksOf(allTasks, task.id).map((s) => writes.update(s, patch)));
    toast.success(isPrivateTask(patch) ? "自分だけのタスクにしました（ほかのメンバーには見えません）" : "紐づけ先を変えました（CV のメンバーに共有されます）");
  } catch (e) { toast.error("紐づけ先を変えられませんでした: " + (e?.message || "")); }
}

/** 紐づけ先を選ぶ（案件・プロジェクト・自分だけ） */
export default function PlacePicker({ task, projects, internalProjects, byId, onChange, compact = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return projects.filter((p) => p.status !== "cancelled" && (!k || [p.project_number, p.client_name, p.name].join(" ").toLowerCase().includes(k))).slice(0, 30);
  }, [projects, q]);
  const pick = (patch) => { setOpen(false); onChange(patch); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          // 一覧の「紐づけ先」の列（押すと選べる）
          <button type="button" className="inline-flex max-w-full items-center gap-0.5 rounded px-0.5 -mx-0.5 hover:bg-white hover:ring-1 hover:ring-slate-300" title="紐づけ先を変える" data-testid="row-place">
            {isPrivateTask(task) ? <span className="px-1 text-[11px] text-slate-400">— 選ぶ</span> : <TaskPlaceChip task={task} byId={byId} className="!max-w-full min-w-0" />}
            <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
          </button>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 rounded hover:bg-muted px-1 -mx-1 py-0.5" data-testid="task-place">
            <TaskPlaceChip task={task} byId={byId} /><ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-96 p-2" align="start">
        <button type="button" className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted text-left" onClick={() => pick({ project_id: null, internal_project_id: null })}>
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />自分だけ（どこにも紐づけない。ほかのメンバーには見えません）
        </button>
        <p className="mt-2 px-2 text-[10px] font-semibold text-muted-foreground">プロジェクト</p>
        {internalProjects.filter((p) => !p.archived).map((p) => (
          <button key={p.id} type="button" className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted text-left" onClick={() => pick({ project_id: null, internal_project_id: p.id })}>
            <Layers className="w-3.5 h-3.5" style={{ color: p.color || "#8b5cf6" }} />{p.name}
          </button>
        ))}
        <p className="mt-2 px-2 text-[10px] font-semibold text-muted-foreground">案件</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件番号・クライアント・案件名で探す" className="mx-2 mb-1 h-7 w-[calc(100%-1rem)] rounded border px-2 text-xs" />
        <div className="max-h-56 overflow-y-auto">
          {list.map((p) => (
            <button key={p.id} type="button" className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted text-left" onClick={() => pick({ project_id: p.id, internal_project_id: null })}>
              <FolderKanban className="w-3.5 h-3.5 text-blue-600 shrink-0" /><span className="font-mono text-[10px] text-muted-foreground shrink-0">{p.project_number}</span><span className="truncate">{p.client_name}／{p.name}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
