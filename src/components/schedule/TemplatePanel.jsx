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
import { toYmd, addDays, keyDatesOf, jpDate } from "@/lib/schedule";
import { draftFromTemplates, suggestTemplates } from "@/lib/scheduleTemplates";
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
  const suggested = useMemo(
    () => suggestTemplates(templates, [project.name, ...estimates.map((e) => e.estimate_title)]),
    [templates, estimates, project.name],
  );
  const deadlineDefault = keyDatesOf(project).find((k) => /納品|納期/.test(k.label))?.date || project.due_date || addDays(today, 30);

  const [selected, setSelected] = useState(null); // テンプレートの id の配列（null のあいだは候補を使う）
  const [mode, setMode] = useState("deadline");
  const [deadline, setDeadline] = useState(deadlineDefault);
  const [start, setStart] = useState(today);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (selected === null && suggested.length) setSelected([suggested[0].id]); }, [suggested, selected]);

  const chosen = (selected || []).map((id) => templates.find((t) => t.id === id)).filter(Boolean);
  const draft = useMemo(
    () => (chosen.length ? draftFromTemplates(chosen, { mode, date: mode === "deadline" ? deadline : start, holidays, parties, today }) : null),
    [selected, templates, mode, deadline, start, holidays, parties, today],
  );
  const range = draft?.tasks.length ? {
    from: draft.tasks.map((t) => t.start_date).sort()[0],
    to: draft.tasks.map((t) => t.end_date).sort().pop(),
  } : null;
  const toggle = (id) => setSelected((s) => ((s || []).includes(id) ? s.filter((x) => x !== id) : [...(s || []), id]));

  const create = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      // 担当の区分（印刷会社など）と、納期（大事な日）を案件の工程表の設定に入れる
      const settings = { ...(project.schedule_settings || {}) };
      let changed = false;
      if (draft.addedParties.length) { settings.parties = draft.parties; changed = true; }
      if (mode === "deadline" && !keyDatesOf(project).some((k) => /納品|納期/.test(k.label))) {
        settings.key_dates = [...keyDatesOf(project), { label: "納品期限", date: deadline }].sort((a, b) => a.date.localeCompare(b.date));
        changed = true;
      }
      if (changed) await db.entities.Project.update(project.id, { schedule_settings: settings });

      const created = await db.entities.ProjectTask.createMany(draft.tasks.map((t, i) => ({
        project_id: project.id, name: t.name, category: t.category, phase: t.phase, parties: t.parties,
        start_date: t.start_date, end_date: t.end_date, is_milestone: t.is_milestone, on_schedule: t.on_schedule,
        status: "todo", sort_order: existingCount + i, depends_on: [],
      })));
      const idOf = new Map(draft.tasks.map((t, i) => [t.id, created[i]?.id]));
      await Promise.all(draft.tasks.map((t, i) => {
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
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <p className="text-sm font-bold text-slate-800">{existingCount ? "テンプレートから工程を追加" : "テンプレートから工程表を作る"}</p>
          <span className="text-xs text-slate-500">{suggested.length ? `案件名から「${suggested[0].name}」を選んでいます。` : "案件名から合うテンプレートが見つかりませんでした。選んでください。"}下書きを確かめて「この内容で作る」で保存します</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {chosen.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-violet-200">
              {suggested.some((s) => s.id === t.id) && <span className="text-[10px] text-violet-500">おすすめ</span>}
              {t.name}
              <button onClick={() => toggle(t.id)} className="text-violet-400 hover:text-violet-700" title="外す"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {onImport && <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-xs text-violet-700" onClick={onImport} data-testid="import-open"><ScanText className="h-3.5 w-3.5" />いまある工程表（スプレッドシート・画像）から入れる</Button>}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1 bg-white text-xs" data-testid="template-picker"><Plus className="h-3.5 w-3.5" />{chosen.length ? "テンプレートを足す" : "テンプレートを選ぶ"}</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2 text-xs" align="start">
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">複数選ぶと組み合わせます（納品は 1 つにまとめます）</p>
              <div className="max-h-72 overflow-y-auto">
                {templates.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                    <Checkbox checked={(selected || []).includes(t.id)} onCheckedChange={() => toggle(t.id)} />
                    <span className="flex-1">{t.name}</span>
                    {suggested.some((s) => s.id === t.id) && <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">おすすめ</span>}
                    <span className="text-muted-foreground">{(t.steps || []).length}件</span>
                  </label>
                ))}
              </div>
              <Link to="/schedule-templates" className="mt-1 flex items-center gap-1 border-t px-2 pt-2 text-primary hover:underline"><Settings2 className="h-3 w-3" />テンプレートを編集する</Link>
            </PopoverContent>
          </Popover>
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
          <p className="text-xs text-slate-600">{draft ? `${draft.tasks.length}件の工程　${jpDate(range.from)} 〜 ${jpDate(range.to)}（土日・祝日・休業日をとばした営業日で計算）` : "テンプレートを選ぶと、ここに下書きが出ます"}</p>
          <div className="flex gap-2">
            {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>やめる</Button>}
            <Button size="sm" className="gap-1.5" disabled={!draft || saving} onClick={create} data-testid="template-create">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} この内容で作る
            </Button>
          </div>
        </div>
      </div>

      {draft && (
        <div className="relative">
          <span className="absolute right-3 top-2 z-30 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">下書き（まだ保存していません）</span>
          <ScheduleTimeline tasks={draft.tasks} parties={draft.parties} keyDates={mode === "deadline" ? [...keyDatesOf(project).filter((k) => !/納品|納期/.test(k.label)), { label: "納期", date: deadline }] : keyDatesOf(project)} holidays={holidays} scale={(new Date(range.to) - new Date(range.from)) / 86400000 > 24 ? "week" : "day"} columns="standard" today={today} />
        </div>
      )}
    </div>
  );
}
