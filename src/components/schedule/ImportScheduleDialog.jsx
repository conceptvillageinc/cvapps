import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUp, Link2, Loader2, ScanText, AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { toYmd, keyDatesOf, jpDate } from "@/lib/schedule";
import { readXlsx } from "@/lib/xlsxRead";
import { gridToText, parseCsv, importPrompt, IMPORT_SCHEMA, draftFromImport, stepsFromImport } from "@/lib/scheduleImport";
import ScheduleTimeline from "./ScheduleTimeline";

const ACCEPT = ".xlsx,.csv,.tsv,.txt,image/png,image/jpeg,image/webp,image/gif,application/pdf";

/**
 * スプレッドシート・Excel・CSV・画像・PDF から工程表を読み取る。
 *   mode="template": 読み取った内容をテンプレートとして保存する（日数は営業日に直す）
 *   mode="project": 読み取った日付のまま、案件の工程表に入れる
 */
export default function ImportScheduleDialog({ open, onOpenChange, mode, project = null, parties, holidays, existingCount = 0, templatesCount = 0, onSaved }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [sheetChoices, setSheetChoices] = useState(null); // Excel の複数シート
  const [sheetIdx, setSheetIdx] = useState(0);
  const [stage, setStage] = useState("");
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const today = toYmd(new Date());

  useEffect(() => {
    if (!open) return;
    setUrl(""); setFile(null); setSheetChoices(null); setSheetIdx(0); setStage(""); setDraft(null); setName(""); setKeywords("");
  }, [open]);

  const pick = async (f) => {
    setFile(f); setSheetChoices(null); setDraft(null);
    if (f && /\.xlsx$/i.test(f.name)) {
      try {
        const { sheets } = await readXlsx(f);
        setSheetChoices(sheets); setSheetIdx(0);
      } catch { toast.error("Excel ファイルを開けませんでした（.xlsx の形式か確認してください）"); setFile(null); }
    }
  };

  const read = async () => {
    setDraft(null);
    try {
      let grid = ""; let fileUrls = []; let source = "表";
      if (file && sheetChoices) {
        const sh = sheetChoices[sheetIdx];
        grid = gridToText(sh.rows, sh.fills);
        source = `Excel の表（シート「${sh.name}」）`;
      } else if (file && /\.(csv|tsv|txt)$/i.test(file.name)) {
        grid = gridToText(parseCsv(await file.text()));
        source = "CSV の表";
      } else if (file) {
        setStage("ファイルを送っています…");
        const up = await db.integrations.Core.UploadFile({ file });
        fileUrls = [up.file_url];
        source = file.type === "application/pdf" ? "PDF" : "画像";
      } else if (url.trim()) {
        setStage("スプレッドシートを読んでいます…");
        const { data } = await db.functions.invoke("readSheet", { url: url.trim(), with_fills: true });
        grid = gridToText(data.rows || [], data.fills || []);
        source = `Google スプレッドシート「${data.title}」のシート「${data.sheet_title}」`;
      } else return;
      if (!grid && !fileUrls.length) { toast.error("表が空でした"); return; }
      setStage("AI が工程を読み取っています…（30 秒ほど）");
      const result = await db.integrations.Core.InvokeLLM({
        prompt: importPrompt({ today, clientName: project?.client_name || "", source, grid }),
        file_urls: fileUrls,
        response_json_schema: IMPORT_SCHEMA,
      });
      const d = draftFromImport(result, { parties });
      if (!d.tasks.length) { toast.error("工程を読み取れませんでした。別の形（表やはっきりした画像）で試してください"); return; }
      setDraft(d);
      setName(d.title || (file?.name || "").replace(/\.[^.]+$/, "") || "読み取ったテンプレート");
    } catch (err) {
      toast.error("読み取れませんでした: " + (err?.message || "不明なエラー"));
    } finally {
      setStage("");
    }
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      const steps = stepsFromImport(draft, holidays);
      const row = await db.entities.ScheduleTemplate.create({
        name: name.trim(), steps, keywords: keywords.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean),
        sort_order: (templatesCount + 1) * 10, created_by: user?.full_name || user?.email || "",
      });
      await qc.invalidateQueries({ queryKey: ["scheduleTemplates"] });
      toast.success(`テンプレート「${name.trim()}」を作りました（${steps.length}件）。日数や担当を確かめてください`);
      onSaved?.(row);
      onOpenChange(false);
    } catch (err) {
      toast.error("保存できませんでした: " + (/duplicate|unique/i.test(err.message) ? "同じ名前のテンプレートがあります" : err.message));
    } finally { setSaving(false); }
  };

  const saveProject = async () => {
    setSaving(true);
    try {
      const settings = { ...(project.schedule_settings || {}) };
      let changed = false;
      if (draft.addedParties.length) { settings.parties = draft.parties; changed = true; }
      const have = keyDatesOf(project);
      const newKeys = draft.keyDates.filter((k) => !have.some((h) => h.label === k.label && h.date === k.date));
      if (newKeys.length) { settings.key_dates = [...have, ...newKeys].sort((a, b) => a.date.localeCompare(b.date)); changed = true; }
      if (!settings.title && draft.title && existingCount === 0) { settings.title = draft.title; changed = true; }
      if (changed) await db.entities.Project.update(project.id, { schedule_settings: settings });
      const created = await db.entities.ProjectTask.createMany(draft.tasks.map((t, i) => ({
        project_id: project.id, name: t.name, category: t.category, phase: t.phase, parties: t.parties,
        start_date: t.start_date, end_date: t.end_date, is_milestone: t.is_milestone, on_schedule: true,
        completed: !!t.completed, completed_at: t.completed ? new Date().toISOString() : null, status: t.completed ? "done" : "todo", sort_order: existingCount + i, depends_on: [],
      })));
      const idOf = new Map(draft.tasks.map((t, i) => [t.id, created[i]?.id]));
      await Promise.all(draft.tasks.map((t, i) => {
        const deps = t.depends_on.map((d) => idOf.get(d)).filter(Boolean);
        return deps.length && created[i] ? db.entities.ProjectTask.update(created[i].id, { depends_on: deps }) : null;
      }));
      qc.invalidateQueries({ queryKey: ["projectTasks", project.id] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success(`工程を ${created.length} 件入れました`);
      onOpenChange(false);
    } catch (err) {
      toast.error("入れられませんでした: " + err.message);
      qc.invalidateQueries({ queryKey: ["projectTasks", project.id] });
    } finally { setSaving(false); }
  };

  const busy = !!stage;
  const canRead = !busy && (file || url.trim());
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && !saving && onOpenChange(v)}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanText className="h-4 w-4" />{mode === "template" ? "スプレッドシート・画像からテンプレートを作る" : "スプレッドシート・画像から工程表に入れる"}</DialogTitle>
          <DialogDescription className="text-xs">
            いまある工程表（Google スプレッドシート・Excel・CSV・画像・PDF）を AI が読み取り、工程にします。読み取った結果を確かめてから保存します。
            {mode === "template" ? "テンプレートでは、日数を営業日（土日・祝日をとばす）に直します。" : "読み取った日付のまま入れます。"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5 rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><Link2 className="h-3.5 w-3.5" />Google スプレッドシートの URL</p>
            <Input value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) { setFile(null); setSheetChoices(null); } }} placeholder="https://docs.google.com/spreadsheets/d/…" className="text-xs" data-testid="import-url" />
            <p className="text-[11px] text-muted-foreground">ご自分のアカウントで開けるシートを読みます。開いているタブ（URL の gid）を読みます</p>
          </div>
          <div className="space-y-1.5 rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><FileUp className="h-3.5 w-3.5" />ファイル（Excel・CSV・画像・PDF）</p>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setUrl(""); pick(f); } }} data-testid="import-file" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => fileRef.current?.click()}>ファイルを選ぶ</Button>
              {file && <span className="text-xs">{file.name}</span>}
              {sheetChoices?.length > 1 && (
                <select value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))} className="h-8 rounded border px-1 text-xs">
                  {sheetChoices.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                </select>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">画像・PDF は工程表のスクリーンショットや書き出しでも読めます（細かい日付は確かめてください）</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{stage}</p>
          <Button size="sm" className="gap-1.5" disabled={!canRead} onClick={read} data-testid="import-read">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}読み取る
          </Button>
        </div>

        {draft && (
          <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3" data-testid="import-result">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold">{draft.tasks.length}件の工程を読み取りました</span>
              {draft.keyDates.map((k) => <span key={k.label + k.date} className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700 ring-1 ring-red-200">{k.label} {jpDate(k.date)}</span>)}
              {draft.addedParties.length > 0 && <span className="text-slate-600">担当を足します: {draft.addedParties.map((p) => p.label).join("・")}</span>}
            </div>
            {(draft.notes || draft.missingDates > 0) && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{draft.missingDates > 0 ? `${draft.missingDates}件は日付を読めませんでした${mode === "template" ? "（日数 1 日にします）" : "（入れたあとで日付を入れてください）"}。` : ""}{draft.notes}</span>
              </p>
            )}
            {mode === "template" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1"><span className="text-xs font-medium">テンプレートの名前</span><Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white" /></label>
                <label className="space-y-1"><span className="text-xs font-medium">案件名や見積にこの言葉があれば候補に出す（、で区切る）</span><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="bg-white" placeholder="展示会、パネル" /></label>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>読み直す</Button>
              {mode === "template"
                ? <Button size="sm" onClick={saveTemplate} disabled={saving || !name.trim()} data-testid="import-save">{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}テンプレートとして保存</Button>
                : <Button size="sm" onClick={saveProject} disabled={saving} data-testid="import-save">{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}この内容で工程表に入れる</Button>}
            </div>
            <ScheduleTimeline tasks={draft.tasks} parties={draft.parties} keyDates={draft.keyDates} holidays={holidays} scale={draft.tasks.length > 0 && spanDays(draft.tasks) > 24 ? "week" : "day"} columns="standard" today={today} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function spanDays(tasks) {
  const ds = tasks.flatMap((t) => [t.start_date, t.end_date]).filter(Boolean).sort();
  if (!ds.length) return 0;
  return (new Date(ds[ds.length - 1]) - new Date(ds[0])) / 86400000;
}
