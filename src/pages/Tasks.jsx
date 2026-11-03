import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ListTodo, Layers, BarChart3, Lock, Loader2, Archive, MessageSquareMore } from "lucide-react";
import { useTaskData, useTaskWrites } from "@/lib/useTaskData";
import { MY_GROUPS, myGroupOf, myTasks, subtasksOf, userLabel, todayYmd, dueOf } from "@/lib/tasks";
import { UserAvatar, TaskCheck, TaskPlaceChip, DueLabel, PriorityChip, ReviewChip } from "@/components/tasks/parts";
import TaskPanel from "@/components/tasks/TaskPanel";
import Workload from "@/components/tasks/Workload";

/** タスクの 1 行 */
function TaskRow({ task, data, today, onOpen, showAssignee = false, showPlace = true }) {
  const writes = useTaskWrites();
  const subs = subtasksOf(data.tasks, task.id);
  const parent = task.parent_task_id ? data.byId.tasks.get(task.parent_task_id) : null;
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(task.id)} data-testid="task-row">
      <TaskCheck done={task.completed} onToggle={(v) => writes.update(task, { completed: v, completed_at: v ? new Date().toISOString() : null })} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${task.completed ? "line-through text-muted-foreground" : ""}`}>{task.name}</p>
        {parent && <p className="text-[10px] text-muted-foreground truncate">↳ {parent.name} のサブタスク</p>}
      </div>
      <PriorityChip value={task.priority} />
      <ReviewChip value={task.review_status} />
      {subs.length > 0 && <span className="text-[10px] text-muted-foreground tabular-nums" title="サブタスク">{subs.filter((s) => s.completed).length}/{subs.length}</span>}
      {Number(task.estimated_hours) > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{Number(task.estimated_hours)}h</span>}
      {showPlace && <TaskPlaceChip task={parent || task} byId={data.byId} />}
      <DueLabel task={task} today={today} className="w-20 text-right" />
      {showAssignee && <UserAvatar user={data.byId.users.get(task.assignee_id)} size={20} />}
    </li>
  );
}

/** すぐ足す欄（Enter で追加） */
function QuickAdd({ placeholder, onAdd, testId }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {busy ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <Plus className="w-4 h-4 text-muted-foreground" />}
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="flex-1 text-sm focus:outline-none bg-transparent" data-testid={testId}
        onKeyDown={async (e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) { setBusy(true); try { await onAdd(v.trim()); setV(""); } catch (err) { toast.error("追加できませんでした: " + (err?.message || "")); } finally { setBusy(false); } } }} />
    </div>
  );
}

function MyTasksView({ data, me, today, onOpen }) {
  const writes = useTaskWrites();
  const [who, setWho] = useState(me.id);
  const [showDone, setShowDone] = useState(false);
  const list = myTasks(data.tasks, who, { showDone });
  const isMe = who === me.id;
  const person = data.byId.users.get(who);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {me.role !== "guest" && <><span className="text-xs text-muted-foreground">誰のタスク</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} className="h-8 rounded border px-2 text-sm" data-testid="tasks-who">
          {data.users.filter((u) => u.role !== "guest" || u.id === me.id).map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `自分（${userLabel(u)}）` : userLabel(u)}</option>)}
        </select></>}
        {!isMe && <span className="text-[11px] text-muted-foreground"><Lock className="inline w-3 h-3 mr-0.5" />{userLabel(person)}さんの「自分だけ」のタスクは出ません</span>}
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />完了したタスクも出す</label>
      </div>
      <div className="rounded-xl border bg-white divide-y" data-testid="my-tasks">
        {isMe && me.role !== "guest" && <QuickAdd placeholder="タスクを追加（Enter）。最初は「自分だけ」のタスクです。案件・社内プロジェクトに紐づけると共有されます" testId="my-task-add"
          onAdd={(name) => writes.create({ name, assignee_id: me.id, project_id: null, internal_project_id: null, on_schedule: false, parties: [], status: "todo", start_date: today, end_date: today })} />}
        {MY_GROUPS.map((g) => {
          const rows = list.filter((t) => (t.completed ? "done" : myGroupOf(t, today)) === g.key);
          if (!rows.length) return null;
          return (
            <section key={g.key}>
              <p className={`px-3 pt-3 pb-1 text-xs font-semibold ${g.key === "overdue" ? "text-rose-600" : ""}`}>{g.label}（{rows.length}）</p>
              <ul className="divide-y">{rows.map((t) => <TaskRow key={t.id} task={t} data={data} today={today} onOpen={onOpen} />)}</ul>
            </section>
          );
        })}
        {showDone && list.some((t) => t.completed) && (
          <section>
            <p className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground">完了</p>
            <ul className="divide-y">{list.filter((t) => t.completed).map((t) => <TaskRow key={t.id} task={t} data={data} today={today} onOpen={onOpen} />)}</ul>
          </section>
        )}
        {list.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">担当のタスクはありません</p>}
      </div>
    </div>
  );
}

const PROJECT_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"];

function InternalProjectsView({ data, me, today, onOpen }) {
  const qc = useQueryClient();
  const writes = useTaskWrites();
  const active = data.internalProjects.filter((p) => !p.archived);
  const [sel, setSel] = useState(active[0]?.id || null);
  const [showDone, setShowDone] = useState(false);
  const cur = data.byId.internal.get(sel) || active[0];
  const rows = data.tasks.filter((t) => cur && t.internal_project_id === cur.id && !t.parent_task_id && (showDone || !t.completed))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || String(dueOf(a) || "9999").localeCompare(String(dueOf(b) || "9999")));
  const addProject = async () => {
    const name = window.prompt("社内プロジェクトの名前（例: 校正・入稿・発注・請求・売上）");
    if (!name?.trim()) return;
    const r = await db.entities.TaskProject.create({ name: name.trim(), color: PROJECT_COLORS[data.internalProjects.length % PROJECT_COLORS.length], sort_order: data.internalProjects.length + 1 });
    qc.invalidateQueries({ queryKey: ["taskProjects"] }); setSel(r.id);
  };
  const patchProject = async (patch) => { await db.entities.TaskProject.update(cur.id, patch); qc.invalidateQueries({ queryKey: ["taskProjects"] }); };
  return (
    <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
      <aside className="rounded-xl border bg-white p-2 space-y-0.5 h-fit">
        <p className="px-2 py-1 text-[11px] text-muted-foreground">CV のメンバー全員に共有されます</p>
        {active.map((p) => {
          const n = data.tasks.filter((t) => t.internal_project_id === p.id && !t.parent_task_id && !t.completed).length;
          return (
            <button key={p.id} type="button" onClick={() => setSel(p.id)} className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-left ${cur?.id === p.id ? "bg-muted font-semibold" : "hover:bg-muted/50"}`} data-testid="internal-project">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: p.color || "#8b5cf6" }} /><span className="flex-1 truncate">{p.name}</span><span className="text-[10px] text-muted-foreground">{n}</span>
            </button>
          );
        })}
        <Button size="sm" variant="ghost" className="w-full justify-start gap-1 text-xs" onClick={addProject} data-testid="internal-project-add"><Plus className="w-3.5 h-3.5" />社内プロジェクトを作る</Button>
      </aside>
      {cur ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold flex-1">{cur.name}</h2>
            <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />完了も出す</label>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => { const n = window.prompt("名前を変える", cur.name); if (n?.trim()) patchProject({ name: n.trim() }); }}>名前を変える</Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => window.confirm(`「${cur.name}」をしまいますか？（タスクは残ります）`) && patchProject({ archived: true })}><Archive className="w-3.5 h-3.5" />しまう</Button>
          </div>
          <div className="rounded-xl border bg-white divide-y">
            <QuickAdd placeholder={`「${cur.name}」にタスクを追加（Enter）`} testId="internal-task-add"
              onAdd={(name) => writes.create({ name, internal_project_id: cur.id, project_id: null, assignee_id: me.id, on_schedule: false, parties: [], status: "todo" })} />
            <ul className="divide-y">{rows.map((t) => <TaskRow key={t.id} task={t} data={data} today={today} onOpen={onOpen} showAssignee showPlace={false} />)}</ul>
            {rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">タスクはまだありません</p>}
          </div>
        </div>
      ) : <p className="text-sm text-muted-foreground py-10 text-center">左の「社内プロジェクトを作る」から作ってください（例: 校正・入稿・発注・請求・売上／新規案件対応／CV_topics）</p>}
    </div>
  );
}

/**
 * タスク（マイタスク・社内プロジェクト・ワークロード）。?task=ID でタスクの詳細を右に開く
 */
export default function Tasks() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const data = useTaskData();
  const today = todayYmd();
  const isGuest = user?.role === "guest";
  const tab = isGuest ? "my" : params.get("tab") || "my";
  const taskId = params.get("task");
  const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: k === "task" ? false : true }); };
  const me = useMemo(() => data.byId.users.get(user?.id) || user || {}, [data.byId, user]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2"><ListTodo className="w-5 h-5" />タスク</h1>
        {!isGuest && (
          <Tabs value={tab} onValueChange={(v) => setParam("tab", v === "my" ? null : v)}>
            <TabsList>
              <TabsTrigger value="my" className="gap-1 text-xs"><ListTodo className="w-3.5 h-3.5" />マイタスク</TabsTrigger>
              <TabsTrigger value="internal" className="gap-1 text-xs" data-testid="tab-internal"><Layers className="w-3.5 h-3.5" />社内プロジェクト</TabsTrigger>
              <TabsTrigger value="workload" className="gap-1 text-xs" data-testid="tab-workload"><BarChart3 className="w-3.5 h-3.5" />ワークロード</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1"><MessageSquareMore className="w-3.5 h-3.5" />案件の工程表の工程も、担当者のタスクとしてここに出ます</span>
      </div>
      {data.isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto mt-10" /> : (
        <>
          {tab === "my" && <MyTasksView data={data} me={me} today={today} onOpen={(id) => setParam("task", id)} />}
          {tab === "internal" && <InternalProjectsView data={data} me={me} today={today} onOpen={(id) => setParam("task", id)} />}
          {tab === "workload" && <Workload data={data} today={today} onOpenTask={(id) => setParam("task", id)} />}
        </>
      )}
      {taskId && data.byId.tasks.get(taskId) && <TaskPanel key={taskId} taskId={taskId} data={data} onClose={() => setParam("task", null)} onOpenTask={(id) => setParam("task", id)} />}
    </div>
  );
}
