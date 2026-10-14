import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles, Loader2, Plus, X, AlertTriangle, CalendarCheck, CalendarArrowDown, Settings2, ScanText } from "lucide-react";
import { toast } from "sonner";
import { toYmd, addDays, keyDatesOf, jpDate, shiftDependents, reorderTasks } from "@/lib/schedule";
import { draftFromTemplates, pickTemplates, COMMON_CATEGORY } from "@/lib/scheduleTemplates";
import ScheduleTimeline from "./ScheduleTimeline";

/** 工程表テンプレートの一覧（マスタ） */
export function useScheduleTemplates() {
  return useQuery({ queryKey: ["scheduleTemplates"], queryFn: () => db.entities.ScheduleTemplate.list("sort_order") });
}

/**
 * テンプレートから工程表の下書きを作り、確かめてから保存する。
 *   工程表が空の案件では、案件名・見積の件名から合うテンプレートを選んで、下書きを最初から表示する。
 *   日付の決め方: 納期から決める（逆算） / 指定した日から順に並べる。どちらも営業日で数える
 * @param {object} p
 * @param {object} p.project
 * @param {object[]} p.parties
 * @param {Set<string>} p.holidays
 * @param {number} [p.existingCount]  すでにある工程の数（追加するときは、その後ろに並べる）
 * @param {() => void} [p.onDone]
 * @param {() => void} [p.onCancel]
 */
export default function TemplatePanel({ project, parties, holidays, existingCount = 0, onDone, onCancel, onImport }) {
  const qc = useQueryClient();
  const today = toYmd(new Date());
  const { data: templates = [], isLoading } = useScheduleTemplates();
  const { data: estimates = [] } = useQuery({
    queryKey: ["estimates", "byProject", project.id],
    queryFn: () => db.entities.Estimate.filter({ project_id: project.id }, "-created_date"),
  });
  const suggested = useMemo(() => pickTemplates(templates, { project, estimates }), [templates, estimates, project]);
  const deadlineDefault = keyDatesOf(project).find((k) => /納品|納期/.test(k.label))?.date || project.due_date || addDays(today, 30);

  const [selected, setSelected] = useState(null); // テンプレートの id の配列（null のあいだは候補を使う）
  const [mode, setMode] = useState("deadline");
  const [deadline, setDeadline] = useState(deadlineDefault);
  const [start, setStart] = useState(today);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (selected === null && suggested.length) setSelected(suggested.map((t) => t.id)); }, [suggested, selected]);

  const chosen = (selected || []).map((id) => templates.find((t) => t.id === id)).filter(Boolean);
  const draft = useMemo(
    () => (chosen.length ? draftFromTemplates(chosen, { mode, date: mode === "deadline" ? deadline : start, holidays, parties, today }) : null),
    // 担当の区分・休業日は中身が変わったときだけ作り直す（手で直した下書きが消えないように）
    [selected, templates, mode, deadline, start, JSON.stringify(parties), holidays?.size, today],
  );
  // 下書きの工程（ここで足す・外す・名前を直す・日付を動かす。テンプレートや日付の決め方を変えると作り直す）
  const [rows, setRows] = useState([]);
  const [edited, setEdited] = useState(false);
  const [editingId, setEditingId] = useState(null);
  useEffect(() => { setRows(draft ? draft.tasks : []); setEdited(false); }, [draft]);
  const allParties = draft?.parties || parties;
  const range = rows.length ? {
    from: rows.map((t) => t.start_date).filter(Boolean).sort()[0],
    to: rows.map((t) => t.end_date).filter(Boolean).sort().pop(),
  } : null;
  const rename = (id, name) => { setRows((rs) => rs.map((t) => (t.id === id ? { ...t, name } : t))); setEdited(true); setEditingId(null); };
  const remove = (id) => {
    setRows((rs) => {
      const gone = rs.find((t) => t.id === id);
      return rs.filter((t) => t.id !== id).map((t) => (t.depends_on.includes(id) ? { ...t, depends_on: [...new Set([...t.depends_on.filter((d) => d !== id), ...(gone?.depends_on || [])])] } : t));
    });
    setEdited(true);
  };
  const move = (id, patch) => {
    setRows((rs) => {
      const next = rs.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const shifts = new Map(shiftDependents(next, [id], { holidays }).map((x) => [x.id, x]));
      return next.map((t) => (shifts.has(t.id) ? { ...t, ...shifts.get(t.id) } : t));
    });
    setEdited(true);
  };
  const addRow = () => {
    const body = rows.filter((t) => !(t.category === COMMON_CATEGORY && t.is_milestone));
    const last = body[body.length - 1];
    const cat = last?.category || "その他";
    const idx = rows.lastIndexOf(last);
    // 日付はまだ入れない（下書きの行を横にドラッグして期間を引く）
    const row = { id: `new_${Date.now()}`, category: cat, name: "新しい工程", phase: null, parties: ["cv"], start_date: null, end_date: null, is_milestone: false, on_schedule: true, depends_on: last ? [last.id] : [], completed: false, member_ids: [] };
    setRows((rs) => [...rs.slice(0, idx + 1), row, ...rs.slice(idx + 1)]);
    setEditingId(row.id);
    setEdited(true);
  };
  // 行をドラッグして並びを変える／空いているところをドラッグして工程を足す
  const reorderRow = (id, to, category) => { setRows((rs) => reorderTasks(rs, id, to, category)); setEdited(true); };
  const drawRow = ({ category, afterId, start: s, end: e }) => {
    const row = { id: `new_${Date.now()}`, category: category || "その他", name: "新しい工程", phase: null, parties: ["cv"], start_date: s, end_date: e, is_milestone: false, on_schedule: true, depends_on: [], completed: false, member_ids: [] };
    setRows((rs) => { const i = rs.findIndex((t) => t.id === afterId); return i < 0 ? [...rs, row] : [...rs.slice(0, i + 1), row, ...rs.slice(i + 1)]; });
    setEditingId(row.id);
    setEdited(true);
  };
  const toggle = (id) => setSelected((s) => ((s || []).includes(id) ? s.filter((x) => x !== id) : [...(s || []), id]));

  const create = async () => {
    if (!rows.length) return;
    setSaving(true);
    try {
      // 担当の区分（印刷会社など）と、納期（大事な日）を案件の工程表の設定に入れる
      const settings = { ...(project.schedule_settings || {}) };
      let changed = false;
      if (draft?.addedParties.length) { settings.parties = draft.parties; changed = true; }
      if (mode === "deadline" && !keyDatesOf(project).some((k) => /納品|納期/.test(k.label))) {
        settings.key_dates = [...keyDatesOf(project), { label: "納品期限", date: deadline }].sort((a, b) => a.date.localeCompare(b.date));
        changed = true;
      }
      if (changed) await db.entities.Project.update(project.id, { schedule_settings: settings });

      const created = await db.entities.ProjectTask.createMany(rows.map((t, i) => ({
        project_id: project.id, name: t.name, category: t.category, phase: t.phase, parties: t.parties,
        start_date: t.start_date, end_date: t.end_date, is_milestone: t.is_milestone, on_schedule: t.on_schedule,
        status: "todo", sort_order: existingCount + i, depends_on: [],
      })));
      const idOf = new Map(rows.map((t, i) => [t.id, created[i]?.id]));
      await Promise.all(rows.map((t, i) => {
        const deps = t.depends_on.map((d) => idOf.get(d)).filter(Boolean);
        return deps.length && created[i] ? db.entities.ProjectTask.update(created[i].id, { depends_on: deps }) : null;
      }));
      qc.invalidateQueries({ queryKey: ["projectTasks", project.id] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success(`工程を ${created.length} 件入れました。ドラッグや入力で調整できます`);
      onDone?.();
    } catch (err) {
      toast.error("工程を入れられませんでした: " + (err?.message || "不明なエラー"));
      qc.invalidateQueries({ queryKey: ["projectTasks", project.id] });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!templates.length) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        工程表テンプレートがまだありません。<Link to="/schedule-templates" className="text-primary hover:underline">工程表テンプレート</Link>で作るか、「工程を追加」から入れてください。
      </div>
    );
  }

  const seg = (on) => `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${on ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`;
  return (
    <div className="space-y-3" data-testid="template-panel">
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <p className="text-sm font-bold text-slate-800">{existingCount ? "テンプレートから工程を追加" : "テンプレートから工程表を作る"}</p>
          <span className="text-xs text-slate-500">{suggested.length ? `案件名と見積書から${suggested.map((t) => `「${t.name}」`).join("")}を選んでいます。` : "案件名と見積書から合うテンプレートが見つかりませんでした。選んでください。"}下書きを確かめて「この内容で作る」で保存します</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {chosen.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-blue-800 ring-1 ring-blue-200">
              {suggested.some((s) => s.id === t.id) && <span className="text-[10px] font-semibold text-blue-500">Pick up</span>}
              {t.name}
              <button onClick={() => toggle(t.id)} className="text-blue-400 hover:text-blue-700" title="外す"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {onImport && <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 border-blue-300 bg-white text-xs text-blue-700 shadow-sm hover:bg-blue-50 hover:text-blue-800" onClick={onImport} data-testid="import-open"><ScanText className="h-3.5 w-3.5" />今ある工程表（スプレッドシート・画像）から入れる</Button>}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1 bg-white text-xs hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" data-testid="template-picker"><Plus className="h-3.5 w-3.5" />{chosen.length ? "テンプレートを足す" : "テンプレートを選ぶ"}</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2 text-xs" align="start">
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">複数選ぶと組み合わせます（納品は 1 つにまとめます）</p>
              <div className="max-h-72 overflow-y-auto">
                {templates.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                    <Checkbox checked={(selected || []).includes(t.id)} onCheckedChange={() => toggle(t.id)} />
                    <span className="flex-1">{t.name}</span>
                    {suggested.some((s) => s.id === t.id) && <span className="rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700">Pick up</span>}
                    <span className="text-muted-foreground">{(t.steps || []).length}件</span>
                  </label>
                ))}
              </div>
              <Link to="/schedule-templates" className="mt-1 flex items-center gap-1 border-t px-2 pt-2 text-primary hover:underline"><Settings2 className="h-3 w-3" />テンプレートを編集する</Link>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" className="h-7 gap-1 bg-white text-xs hover:bg-blue-50 hover:text-blue-800" onClick={addRow} data-testid="draft-add"><Plus className="h-3.5 w-3.5" />工程を追加</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
            <button className={seg(mode === "deadline")} onClick={() => setMode("deadline")}><CalendarCheck className="h-3.5 w-3.5" />納期から決める</button>
            <button className={seg(mode === "start")} onClick={() => setMode("start")}><CalendarArrowDown className="h-3.5 w-3.5" />今日から順に並べる</button>
          </div>
          {mode === "deadline" ? (
            <label className="flex items-center gap-2 text-xs">納期<Input type="date" value={deadline} onChange={(e) => e.target.value && setDeadline(e.target.value)} className="h-8 w-40 bg-white text-xs" data-testid="template-deadline" /><span className="text-slate-500">この日に納品が終わるように、前へさかのぼって決めます</span></label>
          ) : (
            <label className="flex items-center gap-2 text-xs">開始日<Input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className="h-8 w-40 bg-white text-xs" /><span className="text-slate-500">この日から順に並べます</span></label>
          )}
        </div>
        {draft?.warnings.map((w) => <p key={w} className="flex items-center gap-1.5 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{w}</p>)}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs text-slate-600">
            {rows.length && range ? `${rows.length}件の工程　${jpDate(range.from)} 〜 ${jpDate(range.to)}（土日・祝日・休業日をとばした営業日で計算）` : "テンプレートを選ぶか「＋工程を追加」で、ここに下書きが出ます"}
            {rows.length > 0 && <span className="ml-2 text-slate-400">工程名はクリックで直せます。行の × で外せます。左端 ⋮⋮ をつかむと並べ替え、空いているところを横にドラッグすると工程を足せます。{edited ? "テンプレートや納期を変えると、手で直したところは元に戻ります" : ""}</span>}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>やめる</Button>}
            <Button size="sm" className="gap-1.5" disabled={!rows.length || saving} onClick={create} data-testid="template-create">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} この内容で作る
            </Button>
          </div>
        </div>
      </div>

      {rows.length > 0 && range && (
        <div className="relative">
          <span className="absolute right-3 top-2 z-30 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">下書き（まだ保存していません）</span>
          <ScheduleTimeline tasks={rows} parties={allParties} editable onChange={move} onRename={rename} onDelete={remove} onReorder={reorderRow} onCreate={drawRow} editingId={editingId} keyDates={mode === "deadline" ? [...keyDatesOf(project).filter((k) => !/納品|納期/.test(k.label)), { label: "納期", date: deadline }] : keyDatesOf(project)} holidays={holidays} scale={(new Date(range.to) - new Date(range.from)) / 86400000 > 24 ? "week" : "day"} columns="standard" today={today} />
        </div>
      )}
    </div>
  );
}
