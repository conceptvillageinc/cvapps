import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, CalendarRange, Sheet, ExternalLink, Loader2, Link2, Settings2, List, GanttChart, LayoutTemplate, Sparkles, BookmarkPlus, ScanText, Check, Flag, Users, HelpCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { nextWorkday, addDays, toYmd, taskRange, partiesOf, keyDatesOf, shiftDependents, crossedKeyDates, memberShortName, scheduleTitle, jpDate, reorderTasks } from "@/lib/schedule";
import ScheduleTimeline from "./ScheduleTimeline";
import ScheduleList from "./ScheduleList";
import ShareDialog from "./ShareDialog";
import ScheduleSettingsDialog from "./ScheduleSettingsDialog";
import EditableCell from "./EditableCell";
import TemplatePanel from "./TemplatePanel";
import SaveTemplateDialog from "./SaveTemplateDialog";
import ImportScheduleDialog from "./ImportScheduleDialog";

const VIEW_KEY = "cv.schedule.view";
const readPref = () => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch { return {}; } };
const writePref = (v) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } };

const sortTasks = (rows) => [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_date || "").localeCompare(String(b.created_date || "")));

/** 案件の工程表（リスト／タイムライン、日・週、前の工程、担当の区分、共有リンク、スプレッドシート出力） */
export default function ScheduleTab({ project, fullPage = false }) {
  const qc = useQueryClient();
  const key = ["projectTasks", project.id];
  const { companyHolidays } = useSystemSettings();
  const [pref, setPref] = useState(() => ({ view: "timeline", scale: "day", ...readPref() }));
  const setView = (patch) => setPref((p) => { const n = { ...p, ...patch }; writePref(n); return n; });
  const [shareOpen, setShareOpen] = useState(false);
  const [addTplOpen, setAddTplOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // 足したばかりの工程（名前をすぐ入れられるように）
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
  const memberAvatar = (id) => userMap.get(id)?.avatar_url || "";
  const parties = partiesOf(project);
  const keyDates = keyDatesOf(project);
  const categories = useMemo(() => [...new Set(tasks.map((t) => t.category).filter(Boolean))], [tasks]);

  const setRows = (fn) => qc.setQueryData(key, (old) => fn(old || []));
  // 自動で保存したことを小さく知らせる（保存中… → 保存しました）
  const [pending, setPending] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef(null);
  const track = async (fn) => {
    setPending((n) => n + 1);
    try {
      const r = await fn();
      setSavedFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2500);
      return r;
    } finally { setPending((n) => n - 1); }
  };
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
      await track(async () => {
        await db.entities.ProjectTask.update(id, patch);
        await Promise.all(shifts.map((s) => db.entities.ProjectTask.update(s.id, { start_date: s.start_date, end_date: s.end_date })));
      });
      if (crossed.length) toast.warning(`後ろの工程 ${shifts.length} 件をずらした結果、${crossed.map((c) => `「${c.name}」が${c.key.label} ${jpDate(c.key.date)}`).join("、")}を過ぎています`, { duration: 10000 });
      else if (shifts.length) toast.success(`前の工程に合わせて、後ろの工程 ${shifts.length} 件をずらしました（土日・祝日はとばしています）`);
    } catch (err) { fail(err); }
  };

  const create = useMutation({
    // start / end を渡したとき（タイムラインの空いているところをドラッグしたとき）はその期間で、前の工程はつながない。
    // dateless のとき（タイムラインで「工程を追加」）は日付を入れず、行を横にドラッグして期間を引いてもらう
    mutationFn: ({ category = null, after = null, start: s0 = null, end: e0 = null, dateless = false } = {}) => track(async () => {
      const pos = after ? tasks.indexOf(after) + 1 : tasks.length;
      const prev = after || tasks[tasks.length - 1];
      const pr = prev && taskRange(prev);
      const start = s0 || (dateless ? null : nextWorkday(pr ? addDays(pr.end, 1) : today, companyHolidays));
      const end = e0 || start;
      // 入れる場所より後ろの並び順を 1 つずつ下げる
      await Promise.all(tasks.slice(pos).map((t, i) => db.entities.ProjectTask.update(t.id, { sort_order: pos + i + 1 })));
      return db.entities.ProjectTask.create({ project_id: project.id, name: "新しい工程", category, status: "todo", parties: ["cv"], start_date: start, end_date: end, sort_order: pos, depends_on: after && !s0 ? [after.id] : [] });
    }),
    onSuccess: (row) => { if (row?.id) setEditingId(row.id); qc.invalidateQueries({ queryKey: key }); },
    onError: fail,
  });

  const remove = async (t) => {
    if (!window.confirm(`「${t.name}」を削除しますか？`)) return;
    const dependents = tasks.filter((x) => (x.depends_on || []).includes(t.id));
    setRows((old) => old.filter((x) => x.id !== t.id).map((x) => (dependents.some((d) => d.id === x.id) ? { ...x, depends_on: x.depends_on.filter((p) => p !== t.id) } : x)));
    try {
      await track(async () => {
        await Promise.all(dependents.map((d) => db.entities.ProjectTask.update(d.id, { depends_on: d.depends_on.filter((p) => p !== t.id) })));
        await db.entities.ProjectTask.delete(t.id);
      });
    } catch (err) { fail(err); }
  };

  // 行をドラッグして並びを変える（別のカテゴリーに入れたらカテゴリーも移す）
  const reorder = async (id, toIndex, category) => {
    const order = reorderTasks(tasks, id, toIndex, category);
    const before = new Map(tasks.map((t) => [t.id, t]));
    const patches = order.map((t, k) => {
      const o = before.get(t.id);
      const patch = {};
      if (o.sort_order !== k) patch.sort_order = k;
      if ((o.category ?? null) !== (t.category ?? null)) patch.category = t.category ?? null;
      return [t.id, patch];
    }).filter(([, p]) => Object.keys(p).length);
    if (!patches.length) return;
    setRows(() => order.map((t, k) => ({ ...t, sort_order: k })));
    try {
      await track(() => Promise.all(patches.map(([tid, p]) => db.entities.ProjectTask.update(tid, p))));
    } catch (err) { fail(err); }
  };
  const createAt = ({ category, afterId, start, end }) => create.mutate({ category, after: tasks.find((t) => t.id === afterId) || null, start, end });

  // タイトルはその場で直せる（空にすると「〇〇様　案件名 スケジュール」に戻る）
  const saveTitle = async (v) => {
    const settings = { ...(project.schedule_settings || {}) };
    const fallback = scheduleTitle({ ...project, schedule_settings: { ...settings, title: "" } });
    settings.title = v && v !== fallback ? v : "";
    qc.setQueryData(["project", project.id], (old) => (old ? { ...old, schedule_settings: settings } : old));
    try {
      await track(() => db.entities.Project.update(project.id, { schedule_settings: settings }));
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    } catch (err) { toast.error("保存できませんでした: " + (err?.message || "不明なエラー")); qc.invalidateQueries({ queryKey: ["project", project.id] }); }
  };
  const saveSettings = useMutation({
    mutationFn: (settings) => track(() => db.entities.Project.update(project.id, { schedule_settings: settings })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", project.id] }); setSettingsOpen(false); toast.success(settingsOpen === "parties" ? "担当の区分を保存しました" : "大事な日を保存しました"); },
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
      <CardHeader className="pb-2 space-y-2">
        {/* 1 段目: 見出し・タイトル・大事な日 ／ 右に「新しいタブで開く」 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <CardTitle className="text-sm flex shrink-0 items-center gap-2"><CalendarRange className="w-4 h-4" /> 工程表（{tasks.length}件）</CardTitle>
          <div className="min-w-[14rem] max-w-[30rem]" title="クリックしてタイトルを直す">
            <EditableCell value={scheduleTitle(project)} onCommit={saveTitle} className="h-7 text-xs font-semibold" textClassName="font-semibold text-slate-900" testId="schedule-title" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {keyDates.map((k) => <span key={k.date + k.label} className="rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">{k.label} {jpDate(k.date)}</span>)}
            {keyDates.length === 0 && <button className="text-[11px] text-primary hover:underline" onClick={() => setSettingsOpen("keyDates")}>納品期限などの大事な日を入れる</button>}
          </div>
          {!fullPage && <Button size="sm" className="ml-auto h-8 gap-1.5 text-xs" asChild title="工程表だけを新しいタブで大きく開く"><a href={`/projects/${project.id}/schedule`} target="_blank" rel="noopener noreferrer" data-testid="open-schedule-tab"><ExternalLink className="w-3.5 h-3.5" /> 新しいタブで開く</a></Button>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            <button onClick={() => setView({ view: "timeline" })} className={`px-2 py-1 text-xs rounded-md inline-flex items-center gap-1 ${pref.view === "timeline" ? "bg-white shadow-sm font-semibold text-slate-900" : "text-slate-500"}`}><GanttChart className="w-3.5 h-3.5" />タイムライン</button>
            <button onClick={() => setView({ view: "list" })} className={`px-2 py-1 text-xs rounded-md inline-flex items-center gap-1 ${pref.view === "list" ? "bg-white shadow-sm font-semibold text-slate-900" : "text-slate-500"}`}><List className="w-3.5 h-3.5" />リスト</button>
          </div>
          {pref.view === "timeline" && (
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {[["day", "日"], ["week", "週"], ["dekad", "上中下"]].map(([v, l]) => <button key={v} onClick={() => setView({ scale: v })} className={`px-2 py-1 text-xs rounded-md ${pref.scale === v ? "bg-white shadow-sm font-semibold text-slate-900" : "text-slate-500"}`}>{l}</button>)}
            </div>
          )}
          <span className="mx-0.5 h-5 w-px bg-slate-200" />
          {["keyDates", "parties"].map((sec) => (
            <ScheduleSettingsDialog key={sec} open={settingsOpen === sec} section={sec} onOpenChange={(v) => setSettingsOpen(v ? sec : false)} project={project} onSave={(st) => saveSettings.mutate(st)} saving={saveSettings.isPending}>
              <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 text-xs hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" data-testid={sec === "keyDates" ? "keydates-button" : "parties-button"}>
                {sec === "keyDates" ? <><Flag className="w-3.5 h-3.5" /> 大事な日</> : <><Users className="w-3.5 h-3.5" /> 担当の区分</>}
              </Button>
            </ScheduleSettingsDialog>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 text-xs hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" data-testid="template-menu"><LayoutTemplate className="w-3.5 h-3.5" /> テンプレート</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="focus:bg-blue-50 focus:text-blue-800" onClick={() => setAddTplOpen(true)}><Sparkles className="w-3.5 h-3.5 mr-1.5" />テンプレートから工程を追加</DropdownMenuItem>
              <DropdownMenuItem className="focus:bg-blue-50 focus:text-blue-800" onClick={() => setImportOpen(true)}><ScanText className="w-3.5 h-3.5 mr-1.5" />スプレッドシート・画像から入れる</DropdownMenuItem>
              <DropdownMenuItem className="focus:bg-blue-50 focus:text-blue-800" disabled={tasks.length === 0} onClick={() => setSaveTplOpen(true)}><BookmarkPlus className="w-3.5 h-3.5 mr-1.5" />この工程表をテンプレートに保存</DropdownMenuItem>
              <DropdownMenuItem className="focus:bg-blue-50 focus:text-blue-800" asChild><a href="/schedule-templates" target="_blank" rel="noopener noreferrer"><Settings2 className="w-3.5 h-3.5 mr-1.5" />テンプレートを編集する</a></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 text-xs hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" disabled={exporting || tasks.length === 0}>
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5" />} スプレッドシート
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="focus:bg-blue-50 focus:text-blue-800" onClick={() => exportSheet(false)}>スプレッドシートに出力</DropdownMenuItem>
              <DropdownMenuItem className="focus:bg-blue-50 focus:text-blue-800" onClick={() => exportSheet(true)}>出力してクライアントに閲覧共有</DropdownMenuItem>
              {project.schedule_sheet_url && <DropdownMenuItem className="focus:bg-blue-50 focus:text-blue-800" asChild><a href={project.schedule_sheet_url} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1.5" />出力済みのシートを開く</a></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 text-xs hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" onClick={() => setShareOpen(true)}><Link2 className="w-3.5 h-3.5" /> 共有リンク</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></span>完了 {done}/{tasks.length}</span>
          {late > 0 && <span className="text-red-600 font-semibold">終了日を過ぎた未完了 {late}件</span>}
          <span className="flex items-center gap-2">担当の色:{parties.map((p) => <span key={p.key} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</span>)}</span>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-slate-500 hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" data-testid="schedule-help"><HelpCircle className="h-3.5 w-3.5" />操作のしかた</button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3 text-xs leading-relaxed">
              <ul className="list-disc space-y-1 pl-4 text-slate-700">
                {pref.view === "timeline" && <>
                  <li>棒をドラッグで日付を移動（端をつかむと開始日・終了日だけ）</li>
                  <li>空いているところを横にドラッグで工程を足す</li>
                  <li>担当のアイコンを押すと担当を変えられます</li>
                </>}
                <li>行の左端 ⋮⋮ をつかんで上下に並べ替え（別のカテゴリーに入れるとカテゴリーも移ります）</li>
                <li>工程名・タイトルはクリックで直せます</li>
              </ul>
            </PopoverContent>
          </Popover>
          {pending > 0
            ? <span className="inline-flex items-center gap-1 text-[11px] font-normal text-slate-400" data-testid="save-status"><Loader2 className="h-3 w-3 animate-spin" />保存中…</span>
            : <span className={`inline-flex items-center gap-1 text-[11px] font-normal text-emerald-600 transition-opacity duration-500 ${savedFlash ? "opacity-100" : "opacity-0"}`} data-testid="save-status" aria-live="polite"><Check className="h-3 w-3" strokeWidth={3} />保存しました</span>}
          {/* 工程を足す入口（テンプレートから／1 件ずつ） */}
          {tasks.length > 0 && (
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="h-8 gap-1 border-blue-200 bg-blue-50/60 text-xs text-blue-800 hover:bg-blue-100 hover:text-blue-900" onClick={() => setAddTplOpen(true)} data-testid="add-template"><Plus className="h-3.5 w-3.5" />テンプレートを足す</Button>
              <Button size="sm" variant="outline" className="h-8 gap-1 border-blue-200 bg-blue-50/60 text-xs text-blue-800 hover:bg-blue-100 hover:text-blue-900" onClick={() => { const body = tasks.filter((t) => !(t.category === "全制作物" && t.is_milestone)); const last = body[body.length - 1]; create.mutate({ category: last?.category || null, after: last || null, dateless: pref.view === "timeline" }); }} disabled={create.isPending} data-testid="add-task"><Plus className="h-3.5 w-3.5" />工程を追加</Button>
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : tasks.length === 0 ? (
          <TemplatePanel project={project} parties={parties} holidays={companyHolidays} onImport={() => setImportOpen(true)} />
        ) : (
          <div className="space-y-2">
            {pref.view === "timeline" ? (
          <ScheduleTimeline tasks={tasks} parties={parties} keyDates={keyDates} holidays={companyHolidays} scale={pref.scale} columns="standard" barStyle={pref.bar || "line"} editable onChange={save} onRename={(id, name) => { setEditingId(null); save(id, { name }); }} onDelete={(id) => { const t = tasks.find((x) => x.id === id); if (t) remove(t); }} editingId={editingId} onReorder={reorder} onCreate={createAt} users={users} fitHeight={fullPage} memberName={memberName} memberAvatar={memberAvatar} alwaysMembers today={today} />
        ) : (
          <ScheduleList tasks={tasks} parties={parties} users={users} categories={categories} onChange={save} onDelete={remove} onReorder={reorder} memberName={memberName}
            onAddInCategory={(category, after) => create.mutate({ category: category || null, after })} />
            )}
          </div>
        )}
      </CardContent>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} project={project} />
      <Dialog open={addTplOpen} onOpenChange={setAddTplOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto [&>*]:min-w-0">
          <DialogHeader><DialogTitle>テンプレートから工程を追加</DialogTitle></DialogHeader>
          {addTplOpen && <TemplatePanel project={project} parties={parties} holidays={companyHolidays} existingCount={tasks.length} onDone={() => setAddTplOpen(false)} onCancel={() => setAddTplOpen(false)} />}
        </DialogContent>
      </Dialog>
      <ImportScheduleDialog open={importOpen} onOpenChange={setImportOpen} mode="project" project={project} parties={parties} holidays={companyHolidays} existingCount={tasks.length} />
      <SaveTemplateDialog open={saveTplOpen} onOpenChange={setSaveTplOpen} tasks={tasks} parties={parties} holidays={companyHolidays} defaultName={tasks[0]?.category && tasks[0].category !== "全制作物" ? tasks[0].category : ""} />
    </Card>
  );
}
