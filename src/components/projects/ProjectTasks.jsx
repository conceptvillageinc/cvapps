import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, ListChecks, Sheet, ExternalLink, Loader2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";

const STATUS = { todo: { label: "未着手", color: "bg-muted text-muted-foreground" }, doing: { label: "進行中", color: "bg-blue-100 text-blue-700" }, done: { label: "完了", color: "bg-emerald-100 text-emerald-700" }, hold: { label: "保留", color: "bg-amber-100 text-amber-700" } };
const OWNERS = ["CV", "クライアント", "外注"];
const PRESET = ["ヒアリング", "構成・要件整理", "デザイン", "デザイン確認（クライアント）", "構築・コーディング", "入稿・校正", "テスト・最終確認", "公開・納品"];

/** 案件の工程（工程管理表）。その場で編集し、Google スプレッドシートに出力できる。 */
export default function ProjectTasks({ project }) {
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [share, setShare] = useState(false);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["projectTasks", project.id],
    queryFn: () => db.entities.ProjectTask.filter({ project_id: project.id }, "sort_order"),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["projectTasks", project.id] });

  const create = useMutation({
    mutationFn: (name) => db.entities.ProjectTask.create({ project_id: project.id, name, status: "todo", sort_order: tasks.length }),
    onSuccess: invalidate,
    onError: (err) => toast.error("追加できませんでした: " + (err?.message || "不明なエラー")),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }) => db.entities.ProjectTask.update(id, patch),
    onSuccess: invalidate,
    onError: (err) => toast.error("更新できませんでした: " + (err?.message || "不明なエラー")),
  });
  const remove = useMutation({
    mutationFn: (id) => db.entities.ProjectTask.delete(id),
    onSuccess: invalidate,
  });

  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= tasks.length) return;
    const a = tasks[idx]; const b = tasks[j];
    await db.entities.ProjectTask.update(a.id, { sort_order: j });
    await db.entities.ProjectTask.update(b.id, { sort_order: idx });
    invalidate();
  };

  const addPreset = async () => {
    for (let i = 0; i < PRESET.length; i++) {
      await db.entities.ProjectTask.create({ project_id: project.id, name: PRESET[i], status: "todo", sort_order: tasks.length + i, owner: PRESET[i].includes("クライアント") ? "クライアント" : "CV" });
    }
    invalidate();
    toast.success("標準の工程を追加しました。不要なものは削除してください");
  };

  const exportSheet = async () => {
    setExporting(true);
    try {
      const { data } = await db.functions.invoke("exportScheduleSheet", { project_id: project.id, share_with_client: share });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success(`工程管理表を出力しました（${data.rows}行）${data.shared_with ? `。${data.shared_with} に共有しました` : ""}`);
      if (data.sheet_url) window.open(data.sheet_url, "_blank");
    } catch (err) {
      toast.error(err.message);
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2"><ListChecks className="w-4 h-4" /> 工程（{tasks.length}件）</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {project.schedule_sheet_url && (
              <a href={project.schedule_sheet_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> 出力済みのシート</a>
            )}
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><Checkbox checked={share} onCheckedChange={(v) => setShare(!!v)} /> クライアントに閲覧共有</label>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportSheet} disabled={exporting || tasks.length === 0}>
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5" />} スプレッドシートに出力
            </Button>
            {tasks.length === 0 && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={addPreset}>標準の工程を入れる</Button>}
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => create.mutate("新しい工程")}><Plus className="w-3.5 h-3.5" /> 工程を追加</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">工程がありません。「標準の工程を入れる」または「工程を追加」から</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground">
                  <th className="w-12"></th>
                  <th className="text-left px-2 py-1.5 font-medium">工程</th>
                  <th className="text-left px-2 py-1.5 font-medium w-28">担当</th>
                  <th className="text-left px-2 py-1.5 font-medium w-32">開始</th>
                  <th className="text-left px-2 py-1.5 font-medium w-32">終了</th>
                  <th className="text-left px-2 py-1.5 font-medium w-24">状態</th>
                  <th className="text-left px-2 py-1.5 font-medium">備考</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={t.id} className={`border-t ${t.status === "done" ? "opacity-60" : ""}`}>
                    <td className="px-1 py-1 whitespace-nowrap">
                      <button className="text-muted-foreground hover:text-foreground disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-3 h-3" /></button>
                      <button className="text-muted-foreground hover:text-foreground disabled:opacity-20 ml-0.5" disabled={i === tasks.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-3 h-3" /></button>
                    </td>
                    <td className="px-1 py-1"><Input defaultValue={t.name} onBlur={(e) => e.target.value !== t.name && update.mutate({ id: t.id, patch: { name: e.target.value } })} className="h-7 text-xs" /></td>
                    <td className="px-1 py-1">
                      <Input list="task-owners" defaultValue={t.owner || ""} onBlur={(e) => (e.target.value || null) !== (t.owner || null) && update.mutate({ id: t.id, patch: { owner: e.target.value || null } })} className="h-7 text-xs" />
                      <datalist id="task-owners">{OWNERS.map((o) => <option key={o} value={o} />)}</datalist>
                    </td>
                    <td className="px-1 py-1"><Input type="date" defaultValue={t.start_date || ""} onBlur={(e) => (e.target.value || null) !== (t.start_date || null) && update.mutate({ id: t.id, patch: { start_date: e.target.value || null } })} className="h-7 text-xs" /></td>
                    <td className="px-1 py-1"><Input type="date" defaultValue={t.end_date || ""} onBlur={(e) => (e.target.value || null) !== (t.end_date || null) && update.mutate({ id: t.id, patch: { end_date: e.target.value || null } })} className="h-7 text-xs" /></td>
                    <td className="px-1 py-1">
                      <select value={t.status} onChange={(e) => update.mutate({ id: t.id, patch: { status: e.target.value } })} className={`h-7 rounded border px-1 text-[11px] ${STATUS[t.status]?.color || ""}`}>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1"><Input defaultValue={t.notes || ""} onBlur={(e) => (e.target.value || null) !== (t.notes || null) && update.mutate({ id: t.id, patch: { notes: e.target.value || null } })} className="h-7 text-xs" /></td>
                    <td className="px-1 py-1"><button onClick={() => remove.mutate(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tasks.length > 0 && (
          <p className="text-[10px] text-muted-foreground px-3 py-2">
            工程の進捗: {Object.entries(STATUS).map(([k, v]) => `${v.label} ${tasks.filter((t) => t.status === k).length}`).join(" / ")}。
            シートは出力のたびに同じファイルを書き換えます（アプリ側が正）
          </p>
        )}
      </CardContent>
    </Card>
  );
}
