import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LayoutTemplate, Plus, Copy, Trash2, Save, Loader2, ArrowUp, ArrowDown, Diamond, Link2 } from "lucide-react";
import { toast } from "sonner";
import { PHASES, toYmd, partiesOf } from "@/lib/schedule";
import { normalizeSteps, draftFromTemplates, COMMON_CATEGORY } from "@/lib/scheduleTemplates";
import { useScheduleTemplates } from "@/components/schedule/TemplatePanel";
import ScheduleTimeline from "@/components/schedule/ScheduleTimeline";
import EditableCell from "@/components/schedule/EditableCell";

const newKey = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const blankStep = (category = "") => ({ key: newKey(), category, name: "", phase: "", parties: ["cv"], days: 1, after: null, is_milestone: false, on_schedule: true });

/**
 * 工程表テンプレート（マスタ）
 *   チラシ・パンフレット・Web など、案件の種類ごとの工程の並び。案件の工程表が空のとき、案件名から選んで下書きを出す
 *   日数は営業日。前の工程を空にすると、その工程は最初から始まる（並行して進める）
 */
export default function ScheduleTemplateMaster() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { companyHolidays } = useSystemSettings();
  const { data: templates = [], isLoading } = useScheduleTemplates();
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!selectedId && templates.length) setSelectedId(templates[0].id); }, [templates, selectedId]);
  useEffect(() => {
    const t = templates.find((x) => x.id === selectedId);
    if (!t) return;
    setForm({ id: t.id, name: t.name, keywords: (t.keywords || []).join("、"), notes: t.notes || "", steps: normalizeSteps(t.steps) });
    setDirty(false);
  }, [selectedId, templates]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setStep = (i, patch) => set({ steps: form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveStep = (i, d) => { const j = i + d; if (j < 0 || j >= form.steps.length) return; const st = [...form.steps]; [st[i], st[j]] = [st[j], st[i]]; set({ steps: st }); };
  const removeStep = (i) => { const key = form.steps[i].key; set({ steps: form.steps.filter((_, j) => j !== i).map((s) => ({ ...s, after: s.after.filter((k) => k !== key) })) }); };
  const addStep = () => {
    const last = form.steps[form.steps.length - 1];
    const s = blankStep(last && last.category !== COMMON_CATEGORY ? last.category : "");
    // 最後が「納品」などの節目なら、その手前に入れて、節目の前の工程にする
    if (last?.is_milestone) {
      const st = [...form.steps.slice(0, -1), { ...s, after: last.after }, { ...last, after: [s.key] }];
      set({ steps: st });
    } else set({ steps: [...form.steps, { ...s, after: last ? [last.key] : [] }] });
  };

  const choose = (id) => {
    if (dirty && !window.confirm("保存していない変更があります。切り替えますか？")) return;
    setSelectedId(id);
  };
  const save = async () => {
    if (!form.name.trim()) { toast.error("名前を入れてください"); return; }
    setSaving(true);
    try {
      const patch = { name: form.name.trim(), keywords: form.keywords.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean), notes: form.notes || null, steps: normalizeSteps(form.steps) };
      await db.entities.ScheduleTemplate.update(form.id, patch);
      await qc.invalidateQueries({ queryKey: ["scheduleTemplates"] });
      setDirty(false);
      toast.success("保存しました");
    } catch (err) {
      toast.error("保存できませんでした: " + err.message);
    } finally {
      setSaving(false);
    }
  };
  const createNew = async (from = null) => {
    try {
      const row = await db.entities.ScheduleTemplate.create({
        name: from ? `${from.name}（コピー）` : "新しいテンプレート",
        keywords: from ? from.keywords || [] : [],
        steps: from ? from.steps || [] : normalizeSteps([{ ...blankStep("制作物"), name: "ヒアリング・打ち合わせ", phase: "打ち合わせ", parties: ["cv", "client"] }, { ...blankStep(COMMON_CATEGORY), name: "納品", phase: "納品", is_milestone: true, days: 0 }]),
        sort_order: (templates.length + 1) * 10,
        created_by: user?.full_name || user?.email || "",
      });
      await qc.invalidateQueries({ queryKey: ["scheduleTemplates"] });
      setSelectedId(row.id);
    } catch (err) { toast.error("作れませんでした: " + err.message); }
  };
  const remove = async () => {
    if (!window.confirm(`「${form.name}」を削除しますか？（案件の工程表はそのまま残ります）`)) return;
    await db.entities.ScheduleTemplate.delete(form.id);
    setSelectedId(null);
    qc.invalidateQueries({ queryKey: ["scheduleTemplates"] });
  };

  const today = toYmd(new Date());
  const parties = useMemo(() => partiesOf({ client_name: "クライアント" }).map((p) => (p.key === "client" ? { ...p, label: "クライアント" } : p)), []);
  const preview = useMemo(() => {
    if (!form?.steps.length) return null;
    try { return draftFromTemplates([{ name: form.name, steps: form.steps }], { mode: "start", date: today, holidays: companyHolidays, parties, today }); } catch { return null; }
  }, [form, today, companyHolidays, parties]);
  const categories = [...new Set(form?.steps.map((s) => s.category).filter(Boolean) || [])];
  const totalDays = preview?.tasks.length ? preview.tasks.map((t) => t.end_date).sort().pop() : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><LayoutTemplate className="h-6 w-6" /> 工程表テンプレート</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">案件の工程表が空のとき、案件名からテンプレートを選んで下書きを出します。日数は営業日（土日・祝日・会社の休業日をとばす）です</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-sm">テンプレート（{templates.length}）<Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => createNew()}><Plus className="h-3.5 w-3.5" />新規</Button></CardTitle></CardHeader>
          <CardContent className="p-1.5">
            {isLoading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : templates.map((t) => (
              <button key={t.id} onClick={() => choose(t.id)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm ${t.id === selectedId ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`} data-testid="template-item">
                <span className="break-words leading-snug">{t.name}</span><span className="shrink-0 text-[11px] text-muted-foreground">{(t.steps || []).length}件</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {form && (
          <div className="min-w-0 space-y-4">
            <Card>
              <CardContent className="space-y-3 pt-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1"><span className="text-xs font-medium">名前</span><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
                  <label className="space-y-1"><span className="text-xs font-medium">案件名にこの言葉があれば候補に出す（、で区切る）</span><Input value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="チラシ、フライヤー" /></label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{form.steps.length}件の工程{totalDays ? `　今日から始めると ${totalDays.slice(5).replace("-", "/")} に終わります` : ""}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => createNew(templates.find((t) => t.id === form.id))}><Copy className="h-3.5 w-3.5" />複製</Button>
                    <Button size="sm" variant="ghost" className="gap-1 text-xs text-destructive" onClick={remove}><Trash2 className="h-3.5 w-3.5" />削除</Button>
                    <Button size="sm" className="gap-1.5" onClick={save} disabled={!dirty || saving} data-testid="template-save">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
              <table className="w-full min-w-[940px] table-fixed text-xs">
                <thead><tr className="border-b text-[11px] text-slate-500">
                  <th className="w-12" /><th className="w-8 py-2 font-normal">No.</th><th className="w-[110px] px-2 text-left font-normal">カテゴリー</th><th className="w-[190px] px-2 text-left font-normal">タスク名</th><th className="w-[84px] px-2 text-left font-normal">工程</th>
                  <th className="w-[190px] px-2 text-left font-normal">担当</th><th className="w-14 px-1 font-normal" title="営業日">日数</th><th className="w-[120px] px-2 text-left font-normal">前の工程</th><th className="w-8 font-normal" title="節目">◆</th><th className="w-12 font-normal leading-tight">表に<br />出す</th><th className="w-8" />
                </tr></thead>
                <tbody>
                  {form.steps.map((s, i) => (
                    <tr key={s.key} className="border-b border-slate-100 hover:bg-slate-50/70" data-testid="template-step">
                      <td className="whitespace-nowrap px-1 text-center">
                        <button className="text-muted-foreground disabled:opacity-20" disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUp className="h-3 w-3" /></button>
                        <button className="ml-0.5 text-muted-foreground disabled:opacity-20" disabled={i === form.steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown className="h-3 w-3" /></button>
                      </td>
                      <td className="text-center tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-1 py-1"><EditableCell value={s.category} list="tpl-categories" onCommit={(v) => setStep(i, { category: v })} /></td>
                      <td className="px-1 py-1"><EditableCell value={s.name} placeholder="タスク名" onCommit={(v) => setStep(i, { name: v })} /></td>
                      <td className="px-1 py-1"><EditableCell value={s.phase} list="tpl-phases" onCommit={(v) => setStep(i, { phase: v })} /></td>
                      <td className="px-1 py-1"><PartiesCell step={s} onChange={(parties) => setStep(i, { parties })} /></td>
                      <td className="px-1 py-1"><Input type="number" min="0" value={s.is_milestone ? 0 : s.days} disabled={s.is_milestone} onChange={(e) => setStep(i, { days: Math.max(1, Number(e.target.value) || 1) })} className="h-7 px-1 text-right text-xs" /></td>
                      <td className="px-1 py-1"><AfterCell step={s} steps={form.steps} onChange={(after) => setStep(i, { after })} /></td>
                      <td className="text-center"><button onClick={() => setStep(i, { is_milestone: !s.is_milestone, days: s.is_milestone ? 1 : 0 })} className={s.is_milestone ? "text-fuchsia-600" : "text-muted-foreground/40 hover:text-muted-foreground"}><Diamond className="h-3.5 w-3.5" fill={s.is_milestone ? "currentColor" : "none"} /></button></td>
                      <td className="text-center"><Checkbox checked={s.on_schedule} onCheckedChange={(v) => setStep(i, { on_schedule: !!v })} /></td>
                      <td className="px-1"><button onClick={() => removeStep(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-2"><Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addStep}><Plus className="h-3.5 w-3.5" />工程を追加</Button></div>
              <datalist id="tpl-phases">{PHASES.map((p) => <option key={p} value={p} />)}</datalist>
              <datalist id="tpl-categories">{[...categories, COMMON_CATEGORY].map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <p className="text-[11px] text-muted-foreground">カテゴリー「{COMMON_CATEGORY}」の工程（納品など）は、テンプレートを組み合わせたときに 1 つにまとめます。前の工程を外すと、その工程は最初から並行して進みます。</p>

            {preview && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-600">見え方（今日から順に並べた場合）</p>
                <ScheduleTimeline tasks={preview.tasks} parties={preview.parties} holidays={companyHolidays} scale={preview.tasks.length > 14 ? "week" : "day"} columns="standard" today={today} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 担当: CV・クライアント・その他（名前。印刷会社など） */
function PartiesCell({ step, onChange }) {
  const has = (k) => step.parties.includes(k);
  const others = step.parties.filter((k) => k.startsWith("other:")).map((k) => k.slice(6));
  const toggle = (k) => onChange(has(k) ? step.parties.filter((x) => x !== k) : [...step.parties, k]);
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-1"><Checkbox checked={has("cv")} onCheckedChange={() => toggle("cv")} />CV</label>
      <label className="flex items-center gap-1 whitespace-nowrap"><Checkbox checked={has("client")} onCheckedChange={() => toggle("client")} /><span className="text-[11px]">クライアント</span></label>
      <div className="min-w-[64px] flex-1"><EditableCell value={others.join("、")} placeholder="その他"
        onCommit={(v) => onChange([...step.parties.filter((k) => !k.startsWith("other:")), ...v.split(/[、,]/).map((x) => x.trim()).filter(Boolean).map((x) => `other:${x}`)])} /></div>
    </div>
  );
}

/** 前の工程（これが終わってから始める）。空なら最初から始める */
function AfterCell({ step, steps, onChange }) {
  const no = new Map(steps.map((s, i) => [s.key, i + 1]));
  const label = step.after.length ? step.after.map((k) => `No.${no.get(k)}`).join("・") : "最初から";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex min-h-7 w-full items-center gap-1 rounded border px-1.5 py-1 text-left hover:bg-muted/40"><Link2 className="h-3 w-3 shrink-0 text-muted-foreground" /><span className="break-words leading-snug">{label}</span></button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2 text-xs" align="start">
        <p className="px-1 pb-1 font-semibold">前の工程（これが終わってから始める）</p>
        <div className="max-h-64 overflow-y-auto">
          {steps.filter((s) => s.key !== step.key).map((s) => (
            <label key={s.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
              <Checkbox checked={step.after.includes(s.key)} onCheckedChange={() => onChange(step.after.includes(s.key) ? step.after.filter((k) => k !== s.key) : [...step.after, s.key])} />
              <span className="w-8 text-muted-foreground">No.{no.get(s.key)}</span><span className="break-words leading-snug">{s.category ? `${s.category}／` : ""}{s.name}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
