import { useMemo, useState } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Plus, ListTodo, Layers, BarChart3, Lock, Loader2, Archive, LayoutList, Columns3, CalendarClock, Pencil } from "lucide-react";
import { useTaskData, useTaskWrites } from "@/lib/useTaskData";
import { MY_GROUPS, myGroupOf, myTasks, userLabel, todayYmd, dueOf, isPrivateTask } from "@/lib/tasks";
import { movePatch, nextSectionOrder, MODES } from "@/lib/taskSections";
import { addDays, weekStart } from "@/lib/schedule";
import { UserAvatar, TaskCheck, TaskPlaceChip, DueLabel } from "@/components/tasks/parts";
import TaskSectionList from "@/components/tasks/TaskSectionList";
import TaskPanel from "@/components/tasks/TaskPanel";
import Workload from "@/components/tasks/Workload";

/** 見出し（セクション）の読み書き */
function useSections(mode, ownerId) {
  const qc = useQueryClient();
  const key = ["taskSections", mode, ownerId];
  const { data: sections = [] } = useQuery({
    queryKey: key, enabled: !!ownerId,
    queryFn: () => db.entities.TaskSection.filter(mode === "my" ? { kind: "my", user_id: ownerId } : { kind: "internal", internal_project_id: ownerId }, "sort_order"),
  });
  const reload = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["tasks", "all"] }); };
  const [editId, setEditId] = useState(null);
  const ops = {
    async add() {
      const row = await db.entities.TaskSection.create({ kind: mode, ...(mode === "my" ? { user_id: ownerId } : { internal_project_id: ownerId }), name: "新しい見出し", sort_order: nextSectionOrder(sections) });
      qc.setQueryData(key, (old) => [...(old || []), row]); setEditId(row.id);
      toast.success("見出しを足しました。名前を押すと直せます");
    },
    doneEditing(s) { if (s?.id === editId) setEditId(null); },
    async rename(s, name) { qc.setQueryData(key, (old) => (old || []).map((x) => (x.id === s.id ? { ...x, name } : x))); await db.entities.TaskSection.update(s.id, { name }); reload(); },
    async toggle(s) { qc.setQueryData(key, (old) => (old || []).map((x) => (x.id === s.id ? { ...x, collapsed: !x.collapsed } : x))); await db.entities.TaskSection.update(s.id, { collapsed: !s.collapsed }); },
    async move(s, dir) {
      const list = [...sections].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      const i = list.findIndex((x) => x.id === s.id); const j = i + dir;
      if (j < 0 || j >= list.length) return;
      const a = list[i]; const b = list[j];
      await Promise.all([db.entities.TaskSection.update(a.id, { sort_order: b.sort_order }), db.entities.TaskSection.update(b.id, { sort_order: a.sort_order })]);
      reload();
    },
    async remove(s) {
      if (!window.confirm(`見出し「${s.name}」を消しますか？（中のタスクは「${MODES[mode].noneLabel}」に移ります。タスクは消えません）`)) return;
      await db.entities.TaskSection.delete(s.id); reload();
    },
  };
  return { sections, ops, editId };
}

/** 期限で分けた一覧（ほかのメンバーのタスクを見るとき・「期限順」） */
function DueList({ list, data, today, onOpen, showAssignee }) {
  const writes = useTaskWrites();
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100" data-testid="due-list">
      {MY_GROUPS.map((g) => {
        const rows = list.filter((t) => myGroupOf(t, today) === g.key);
        if (!rows.length) return null;
        return (
          <section key={g.key}>
            <p className={`px-4 pt-3 pb-1 text-sm font-bold ${g.key === "overdue" ? "text-rose-600" : "text-slate-800"}`}>{g.label}<span className="ml-2 text-[11px] font-normal text-slate-400">{rows.length}</span></p>
            <ul>{rows.map((t) => (
              <li key={t.id} onClick={() => onOpen(t.id)} className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50 cursor-pointer border-t border-slate-100 first:border-t-0" data-testid="task-row">
                <TaskCheck done={t.completed} onToggle={(v) => writes.update(t, { completed: v, completed_at: v ? new Date().toISOString() : null })} size={17} />
                <span className="flex-1 truncate text-sm">{t.name}</span>
                <TaskPlaceChip task={t.parent_task_id ? data.byId.tasks.get(t.parent_task_id) || t : t} byId={data.byId} />
                <DueLabel task={t} today={today} className="w-20 text-right" />
                {showAssignee && <UserAvatar user={data.byId.users.get(t.assignee_id)} size={20} />}
              </li>
            ))}</ul>
          </section>
        );
      })}
      {list.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-400">タスクはありません</p>}
    </div>
  );
}

/** 表示の切り替え（リスト／ボード／期限順） */
function ViewSwitch({ value, onChange, options = ["list", "board", "due"] }) {
  const all = { list: [LayoutList, "リスト"], board: [Columns3, "ボード"], due: [CalendarClock, "期限順"] };
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5" data-testid="view-switch">
      {options.map((k) => { const [Icon, label] = all[k]; return (
        <button key={k} type="button" onClick={() => onChange(k)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${value === k ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-500 hover:text-slate-800"}`} data-testid={`view-${k}`}>
          <Icon className="w-3.5 h-3.5" />{label}
        </button>); })}
    </div>
  );
}

/** 上のまとめ（期限切れ・今日・今週・今週の予定時間） */
function Summary({ list, today }) {
  const sunday = addDays(weekStart(today), 6);
  const open = list.filter((t) => !t.completed);
  const overdue = open.filter((t) => dueOf(t) && dueOf(t) < today).length;
  const todayN = open.filter((t) => dueOf(t) === today).length;
  const week = open.filter((t) => dueOf(t) && dueOf(t) >= today && dueOf(t) <= sunday).length;
  const hours = open.filter((t) => dueOf(t) && dueOf(t) >= weekStart(today) && dueOf(t) <= sunday).reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  const Card = ({ label, value, tone }) => (
    <div className={`rounded-xl border px-4 py-2.5 bg-white ${tone}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="task-summary">
      <Card label="期限切れ" value={overdue} tone={overdue ? "border-rose-200 text-rose-700" : "border-slate-200 text-slate-800"} />
      <Card label="今日まで" value={todayN} tone="border-slate-200 text-emerald-700" />
      <Card label="今週まで" value={week} tone="border-slate-200 text-slate-800" />
      <Card label="今週の予定時間" value={`${Math.round(hours * 10) / 10}h`} tone="border-slate-200 text-slate-800" />
    </div>
  );
}

function MyTasksView({ data, me, today, onOpen }) {
  const writes = useTaskWrites();
  const [who, setWho] = useState(me.id);
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState(() => { try { return localStorage.getItem("cv.tasks.view") || "list"; } catch { return "list"; } });
  const changeView = (v) => { setView(v); try { localStorage.setItem("cv.tasks.view", v); } catch { /* noop */ } };
  const isMe = who === me.id;
  const list = myTasks(data.tasks, who, { showDone });
  const { sections, ops, editId } = useSections("my", me.id);
  const person = data.byId.users.get(who);
  const effective = isMe ? view : "due"; // 見出しは本人だけのものなので、ほかの人は期限順
  return (
    <div className="space-y-4">
      <Summary list={list} today={today} />
      <div className="flex flex-wrap items-center gap-2">
        {isMe && <ViewSwitch value={view} onChange={changeView} />}
        {me.role !== "guest" && (
          <select value={who} onChange={(e) => setWho(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm" data-testid="tasks-who">
            {data.users.filter((u) => u.role !== "guest" || u.id === me.id).map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? `自分（${userLabel(u)}）` : `${userLabel(u)}さんのタスク`}</option>)}
          </select>
        )}
        {!isMe && <span className="text-[11px] text-slate-500"><Lock className="inline w-3 h-3 mr-0.5" />{userLabel(person)}さんの「自分だけ」のタスクと見出しは出ません</span>}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />完了したタスクも出す</label>
      </div>
      {effective === "due"
        ? <DueList list={list} data={data} today={today} onOpen={onOpen} />
        : <TaskSectionList key={editId || "x"} mode="my" view={effective} tasks={list} sections={sections.map((s) => (s.id === editId ? { ...s, _edit: true } : s))} data={data} today={today} onOpen={onOpen} ops={ops}
            onMove={(t, sid, order) => writes.update(t, movePatch("my", sid, order))}
            onAdd={(sid, name, order) => writes.create({ name, assignee_id: me.id, project_id: null, internal_project_id: null, on_schedule: false, parties: [], status: "todo", start_date: today, end_date: today, ...movePatch("my", sid, order) })} />}
      {isMe && effective !== "due" && <p className="text-[11px] text-slate-400">見出しの名前は押すと直せます。タスクはドラッグで並べ替え・ほかの見出しへ移せます。足したタスクは最初「自分だけ」です（案件・社内プロジェクトに紐づけると共有されます）</p>}
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
  const [view, setView] = useState("list");
  const cur = data.byId.internal.get(sel) || active[0];
  const { sections, ops, editId } = useSections("internal", cur?.id);
  const rows = data.tasks.filter((t) => cur && t.internal_project_id === cur.id && !t.parent_task_id && (showDone || !t.completed));
  const addProject = async () => {
    const name = window.prompt("社内プロジェクトの名前（例: 校正・入稿・発注・請求・売上）");
    if (!name?.trim()) return;
    const r = await db.entities.TaskProject.create({ name: name.trim(), color: PROJECT_COLORS[data.internalProjects.length % PROJECT_COLORS.length], sort_order: data.internalProjects.length + 1 });
    qc.invalidateQueries({ queryKey: ["taskProjects"] }); setSel(r.id);
  };
  const patchProject = async (patch) => { await db.entities.TaskProject.update(cur.id, patch); qc.invalidateQueries({ queryKey: ["taskProjects"] }); };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[15rem_1fr] gap-4">
      <aside className="rounded-xl border border-slate-200 bg-white p-2 space-y-0.5 h-fit shadow-sm">
        <p className="px-2 py-1 text-[11px] text-slate-500">CV のメンバー全員に共有されます</p>
        {active.map((p) => {
          const n = data.tasks.filter((t) => t.internal_project_id === p.id && !t.parent_task_id && !t.completed).length;
          return (
            <button key={p.id} type="button" onClick={() => setSel(p.id)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-left ${cur?.id === p.id ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"}`} data-testid="internal-project">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: p.color || "#8b5cf6" }} /><span className="flex-1 truncate">{p.name}</span><span className="text-[10px] text-slate-400">{n}</span>
            </button>
          );
        })}
        <Button size="sm" variant="ghost" className="w-full justify-start gap-1 text-xs" onClick={addProject} data-testid="internal-project-add"><Plus className="w-3.5 h-3.5" />社内プロジェクトを作る</Button>
      </aside>
      {cur ? (
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-3 w-3 rounded" style={{ background: cur.color || "#8b5cf6" }} />
            <h2 className="text-lg font-bold">{cur.name}</h2>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { const n = window.prompt("名前を変える", cur.name); if (n?.trim()) patchProject({ name: n.trim() }); }} title="名前を変える"><Pencil className="w-3.5 h-3.5" /></Button>
            <ViewSwitch value={view} onChange={setView} options={["list", "board"]} />
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />完了も出す</label>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-slate-500" onClick={() => window.confirm(`「${cur.name}」をしまいますか？（タスクは残ります）`) && patchProject({ archived: true })}><Archive className="w-3.5 h-3.5" />しまう</Button>
          </div>
          <TaskSectionList key={`${cur.id}-${editId || "x"}`} mode="internal" view={view} tasks={rows} sections={sections.map((s) => (s.id === editId ? { ...s, _edit: true } : s))} data={data} today={today} onOpen={onOpen} ops={ops} showAssignee
            onMove={(t, sid, order) => writes.update(t, movePatch("internal", sid, order))}
            onAdd={(sid, name, order) => writes.create({ name, internal_project_id: cur.id, project_id: null, assignee_id: me.id, on_schedule: false, parties: [], status: "todo", ...movePatch("internal", sid, order) })} />
        </div>
      ) : <p className="text-sm text-slate-500 py-10 text-center">左の「社内プロジェクトを作る」から作ってください（例: 校正・入稿・発注・請求・売上／新規案件対応／CV_topics）</p>}
    </div>
  );
}

const TABS = [
  { key: "my", label: "マイタスク", icon: ListTodo, path: "/tasks" },
  { key: "internal", label: "社内プロジェクト", icon: Layers, path: "/tasks?tab=internal" },
  // タブからはこの画面の中で切り替える（サイドバーの「ワークロード」は /workload を開く）
  { key: "workload", label: "ワークロード", icon: BarChart3, path: "/tasks?tab=workload" },
];

/**
 * タスク（マイタスク・社内プロジェクト）とワークロード（/workload）。?task=ID でタスクの詳細を右に開く
 */
export default function Tasks() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const data = useTaskData();
  const today = todayYmd();
  const isGuest = user?.role === "guest";
  const tab = isGuest ? "my" : location.pathname.startsWith("/workload") || params.get("tab") === "workload" ? "workload" : params.get("tab") === "internal" ? "internal" : "my";
  const taskId = params.get("task");
  const openTask = (id) => { const n = new URLSearchParams(params); if (id) n.set("task", id); else n.delete("task"); setParams(n); };
  const me = useMemo(() => data.byId.users.get(user?.id) || user || {}, [data.byId, user]);
  const T = TABS.find((t) => t.key === tab);
  const sharedOpen = data.tasks.filter((t) => !t.completed && !isPrivateTask(t) && !t.parent_task_id).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          {tab === "my" ? <UserAvatar user={me} size={36} /> : <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><T.icon className="w-5 h-5" /></span>}
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-tight">{T.label}</h1>
            <p className="text-[11px] text-slate-500">{tab === "my" ? "担当のタスク（案件の工程表の工程も、担当者のタスクとしてここに出ます）" : tab === "internal" ? "クライアントの案件ではない、社内の共有の箱" : `共有のタスク ${sharedOpen} 件の作業時間を、メンバーごと・日ごとに`}</p>
          </div>
        </div>
        {!isGuest && (
          <nav className="ml-auto inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => navigate(t.path)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${tab === t.key ? "bg-primary text-primary-foreground font-semibold" : "text-slate-600 hover:bg-slate-50"}`} data-testid={`tab-${t.key}`}>
                <t.icon className="w-3.5 h-3.5" />{t.label}
              </button>
            ))}
          </nav>
        )}
      </div>
      {data.isLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto mt-10" /> : (
        <>
          {tab === "my" && <MyTasksView data={data} me={me} today={today} onOpen={openTask} />}
          {tab === "internal" && <InternalProjectsView data={data} me={me} today={today} onOpen={openTask} />}
          {tab === "workload" && <Workload data={data} today={today} onOpenTask={openTask} />}
        </>
      )}
      {taskId && data.byId.tasks.get(taskId) && <TaskPanel key={taskId} taskId={taskId} data={data} onClose={() => openTask(null)} onOpenTask={openTask} />}
    </div>
  );
}
