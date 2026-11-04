// ============================================================================
// タスク管理のデータ（タスク・利用者・案件・社内プロジェクト）と、書き込み
//   タスクは RLS で「見えるもの」だけが返る（非公開のタスクは作った人と担当者だけ）
// ============================================================================
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { toast } from "sonner";

export const TASKS_KEY = ["tasks", "all"];

export function useTaskData() {
  const { data: tasks = [], isLoading } = useQuery({ queryKey: TASKS_KEY, queryFn: () => db.entities.ProjectTask.listAll("sort_order") });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => db.entities.User.list("full_name") });
  const { data: projects = [] } = useQuery({ queryKey: ["projects", "forTasks"], queryFn: () => db.entities.Project.listAll("-registered_at"), staleTime: 60_000 });
  const { data: internalProjects = [] } = useQuery({ queryKey: ["taskProjects"], queryFn: () => db.entities.TaskProject.list("sort_order") });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => db.entities.Client.list("-name"), staleTime: 60_000 });
  const byId = useMemo(() => ({
    users: new Map(users.map((u) => [u.id, u])),
    projects: new Map(projects.map((p) => [p.id, p])),
    internal: new Map(internalProjects.map((p) => [p.id, p])),
    clients: new Map(clients.map((c) => [c.id, c])),
    tasks: new Map(tasks.map((t) => [t.id, t])),
  }), [users, projects, internalProjects, tasks, clients]);
  return { tasks, users, projects, internalProjects, clients, byId, isLoading };
}

/** タスクの書き込み（画面はすぐ変え、保存できなければ読み直す） */
export function useTaskWrites() {
  const qc = useQueryClient();
  const setLocal = (fn) => qc.setQueryData(TASKS_KEY, (old) => fn(old || []));
  // 一覧と、案件の工程表を読み直す
  const done = (t) => { qc.invalidateQueries({ queryKey: TASKS_KEY }); if (t?.project_id) qc.invalidateQueries({ queryKey: ["projectTasks", t.project_id] }); };
  return {
    async update(task, patch) {
      setLocal((list) => list.map((x) => (x.id === task.id ? { ...x, ...patch } : x)));
      try { const r = await db.entities.ProjectTask.update(task.id, patch); done({ ...task, ...patch }); return r; } catch (e) { done(task); throw e; }
    },
    async create(row) {
      const r = await db.entities.ProjectTask.create(row);
      setLocal((list) => [...list, r]);
      done(r);
      return r;
    },
    async remove(task) {
      setLocal((list) => list.filter((x) => x.id !== task.id && x.parent_task_id !== task.id));
      await db.entities.ProjectTask.delete(task.id);
      done(task);
    },
    /**
     * ボタン一つで削除する。少しのあいだ「元に戻す」を出し、押すとタスクとサブタスクを作り直す
     *   （コメント・添付は戻らない）。案件の工程表の工程は、工程表からも消えるので確かめてから消す
     */
    async removeWithUndo(task, allTasks = []) {
      if (task.project_id && !task.parent_task_id && task.on_schedule !== false && !window.confirm(`「${task.name}」は案件の工程表の工程です。削除すると工程表からも消えます。削除しますか？`)) return false;
      const subs = (allTasks || []).filter((x) => x.parent_task_id === task.id);
      await this.remove(task);
      const strip = ({ id, created_at, updated_at, created_date, updated_date, ...rest }) => rest; // eslint-disable-line no-unused-vars
      toast.success(`「${task.name}」を削除しました`, {
        description: "コメント・添付は元に戻りません",
        duration: 8000,
        action: {
          label: "元に戻す",
          onClick: async () => {
            try {
              const r = await this.create(strip(task));
              for (const sub of subs) await this.create({ ...strip(sub), parent_task_id: r.id, pin: null });
              toast.success("元に戻しました");
            } catch (e) { toast.error("元に戻せませんでした: " + (e?.message || "")); }
          },
        },
      });
      return true;
    },
  };
}

/** タスクのひな形（説明とサブタスク）。システム設定での登録はこのあとの段階 */
export const TASK_TEMPLATES = [
  {
    key: "proof",
    label: "入稿依頼・校正チェック",
    description: [
      "【希望納期】",
      "［　］月［　］日［　］曜日",
      "",
      "【入稿情報】",
      "発送先：",
      "発送元：CV",
      "社内見積URL：",
      "備考：",
      "",
      "※色校正を取る場合、金額確認",
    ].join("\n"),
    subtasks: ["お問合せ先（郵便番号／住所／電話番号／URL）", "QRコード", "写真（CMYK／RGB・解像度）", "誤字脱字", "発送先／発送元", "文字のバランス", "色味", "入稿情報"],
  },
];
