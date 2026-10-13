import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, CalendarRange, Sheet, ExternalLink, Loader2, Link2, Settings2, List, GanttChart } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { addDays, toYmd, taskRange, partiesOf, keyDatesOf, shiftDependents, crossedKeyDates, memberShortName, scheduleTitle, jpDate } from "@/lib/schedule";
import ScheduleTimeline from "./ScheduleTimeline";
import ScheduleList from "./ScheduleList";
import ShareDialog from "./ShareDialog";
import ScheduleSettingsDialog from "./ScheduleSettingsDialog";

const VIEW_KEY = "cv.schedule.view";
const readPref = () => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch { return {}; } };
const writePref = (v) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } };

const sortTasks = (rows) => [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_date || "").localeCompare(String(b.created_date || "")));

/** 案件の工程表（リスト／タイムライン、日・週、前の工程、担当の区分、共有リンク、スプレッドシート出力） */
export default function ScheduleTab({ project }) {
  const qc = useQueryClient();
  const key = ["projectTasks", project.id];
  const { companyHolidays } = useSystemSettings();
  const [pref, setPref] = useState(() => ({ view: "timeline", scale: "day", ...readPref() }));
  const setView = (patch) => setPref((p) => { const n = { ...p, ...patch }; writePref(n); return n; });
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const today = toYmd(new Date());

  const { data: rows = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => db.entities.ProjectTask.filter({ project_id: project.id }, "sort_order"),
  });
  const tasks = useMemo(() => sortTasks(rows), [rows]);
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => db.entities.User.list("full_name") });
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const memberName = (id) => memberShortName(userMap.get(id));
  const parties = partiesOf(project);
  const keyDates = keyDatesOf(project);
  const categories = useMemo(() => [...new Set(tasks.map((t) => t.category).filter(Boolean))], [tasks]);

  const setRows = (fn) => qc.setQueryData(key, (old) => fn(old || []));
  const fail = (err) => { toast.error("保存できませんでした: " + (err?.message || "不明なエラー")); qc.invalidateQueries({ queryKey: key }); };

  /** 1 つの工程を変える。日付・前の工程が変わったら、後ろの工程もずらす */
  const save = async (id, patch) => {
    const next = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    const touchesDates = "start_date" in patch || "end_date" in patch || "depends_on" in patch;
    const shifts = touchesDates ? shiftDependents(next, [id], { holidays: companyHolidays }) : [];
    const crossed = crossedKeyDates(tasks, shifts, keyDates);
    const byId = new Map(shifts.map((s) => [s.id, s]));
    setRows((old) => old.map((t) => (t.id === id ? { ...t, ...patch } : byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t)));
    try {
      await db.entities.ProjectTask.update(id, patch);
      await Promise.all(shifts.map((s) => db.entities.ProjectTask.update(s.id, { start_date: s.start_date, end_date: s.end_date })));
      if (crossed.length) toast.warning(`後ろの工程 ${shifts.length} 件をずらした結果、${crossed.map((c) => `「${c.name}」が${c.key.label} ${jpDate(c.key.date)}`).join("、")}を過ぎています`, { duration: 10000 });
      else if (shifts.length) toast.success(`前の工程に合わせて、後ろの工程 ${shifts.length} 件をずらしました（土日・祝日はとばしています）`);
    } catch (err) { fail(err); }
  };

  const create = useMutation({
    mutationFn: async ({ category = null, after = null } = {}) => {
      const pos = after ? tasks.indexOf(after) + 1 : tasks.length;
      const prev = after || tasks[tasks.length - 1];
      const pr = prev && taskRange(prev);
      const start = pr ? addDays(pr.end, 1) : today;
      // 入れる場所より後ろの並び順を 1 つずつ下げる
      await Promise.all(tasks.slice(pos).map((t, i) => db.entities.ProjectTask.update(t.id, { sort_order: pos + i + 1 })));
      return db.entities.ProjectTask.create({ project_id: project.id, name: "新しい工程", category, status: "todo", parties: ["cv"], start_date: start, end_date: start, sort_order: pos });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: fail,
  });

  const remove = async (t) => {
    if (!window.confirm(`「${t.name}」を削除しますか？`)) return;
    const dependents = tasks.filter((x) => (x.depends_on || []).includes(t.id));
    setRows((old) => old.filter((x) => x.id !== t.id).map((x) => (dependents.some((d) => d.id === x.id) ? { ...x, depends_on: x.depends_on.filter((p) => p !== t.id) } : x)));
    try {
      await Promise.all(dependents.map((d) => db.entities.ProjectTask.update(d.id, { depends_on: d.depends_on.filter((p) => p !== t.id) })));
      await db.entities.ProjectTask.delete(t.id);
    } catch (err) { fail(err); }
  };

  const move = async (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= tasks.length) return;
    const order = [...tasks];
    [order[i], order[j]] = [order[j], order[i]];
    setRows(() => order.map((t, k) => ({ ...t, sort_order: k })));
    try {
      await Promise.all(order.map((t, k) => (t.sort_order === k ? null : db.entities.ProjectTask.update(t.id, { sort_order: k }))));
    } catch (err) { fail(err); }
  };

  const saveSettings = useMutation({
    mutationFn: (settings) => db.entities.Project.update(project.id, { schedule_settings: settings }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", project.id] }); setSettingsOpen(false); toast.success("工程表の設定を保存しました"); },
    onError: (err) => toast.error("保存できませんでした: " + err.message),
  });

  const exportSheet = async (share) => {
    setExporting(true);
    try {
      const { data } = await db.functions.invoke("exportScheduleSheet", { project_id: project.id, share_with_client: share });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success(`工程表をスプレッドシートに出力しました（${data.rows}行）${data.shared_with ? `。${data.shared_with} に共有しました` : ""}`);
      if (data.sheet_url) window.open(data.sheet_url, "_blank");
    } catch (err) {
      toast.error(err.message);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    } finally {
      setExporting(false);
    }
  };

  const done = tasks.filter((t) => t.completed).length;
  const late = tasks.filter((t) => !t.completed && taskRange(t)?.end < today).length;

  return (
    <Card data-testid="schedule-tab">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-sm flex items-center gap-2"><CalendarRange className="w-4 h-4" /> 工程表（{tasks.length}件）</CardTitle>
            <p className="text-xs mt-1 font-semibold">{scheduleTitle(project)}</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {keyDates.map((k) => <span key={k.date + k.label} className="rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">{k.label} {jpDate(k.date)}</span>)}
              {keyDates.length === 0 && <button className="text-[11px] text-primary hover:underline" onClick={() => setSettingsOpen(true)}>納品期限などの大事な日を入れる</button>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="inline-flex rounded-md border p-0.5">
              <button onClick={() => setView({ view: "timeline" })} className={`px-2 py-1 text-xs rounded inline-flex items-center gap-1 ${pref.view === "timeline" ? "bg-primary text-primary-foreground" : ""}`}><GanttChart className="w-3.5 h-3.5" />タイムライン</button>
              <button onClick={() => setView({ view: "list" })} className={`px-2 py-1 text-xs rounded inline-flex items-center gap-1 ${pref.view === "list" ? "bg-primary text-primary-foreground" : ""}`}><List className="w-3.5 h-3.5" />リスト</button>
            </div>
            {pref.view === "timeline" && (
              <div className="inline-flex rounded-md border p-0.5">
                {[["day", "日"], ["week", "週"]].map(([v, l]) => <button key={v} onClick={() => setView({ scale: v })} className={`px-2 py-1 text-xs rounded ${pref.scale === v ? "bg-slate-700 text-white" : ""}`}>{l}</button>)}
              </div>
            )}
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setSettingsOpen(true)}><Settings2 className="w-3.5 h-3.5" /> 設定</Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setShareOpen(true)}><Link2 className="w-3.5 h-3.5" /> 共有リンク</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={exporting || tasks.length === 0}>
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5" />} スプレッドシート
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportSheet(false)}>スプレッドシートに出力</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportSheet(true)}>出力してクライアントに閲覧共有</DropdownMenuItem>
                {project.schedule_sheet_url && <DropdownMenuItem asChild><a href={project.schedule_sheet_url} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1.5" />出力済みのシートを開く</a></DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => create.mutate({ category: tasks[tasks.length - 1]?.category || null })} disabled={create.isPending}><Plus className="w-3.5 h-3.5" /> 工程を追加</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span>完了 {done}/{tasks.length}</span>
          {late > 0 && <span className="text-red-600 font-semibold">終了日を過ぎた未完了 {late}件</span>}
          <span className="flex items-center gap-2">担当の色:{parties.map((p) => <span key={p.key} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</span>)}</span>
          {pref.view === "timeline" && <span>棒をドラッグで日付を移動（端をつかむと開始日・終了日だけ）</span>}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">工程がありません。「工程を追加」から入れてください</p>
        ) : pref.view === "timeline" ? (
          <ScheduleTimeline tasks={tasks} parties={parties} keyDates={keyDates} holidays={companyHolidays} scale={pref.scale} columns="standard" editable onChange={save} memberName={memberName} today={today} />
        ) : (
          <ScheduleList tasks={tasks} parties={parties} users={users} categories={categories} onChange={save} onDelete={remove} onMove={move} memberName={memberName}
            onAddInCategory={(category, after) => create.mutate({ category: category || null, after })} />
        )}
      </CardContent>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} project={project} />
      <ScheduleSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} project={project} onSave={(s) => saveSettings.mutate(s)} saving={saveSettings.isPending} />
    </Card>
  );
}
