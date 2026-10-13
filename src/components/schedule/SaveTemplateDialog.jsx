import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { taskRange, workdaysIn } from "@/lib/schedule";
import { stepsFromTasks } from "@/lib/scheduleTemplates";
import { useScheduleTemplates } from "./TemplatePanel";

/** いまの工程表をテンプレートとして保存する（日数は営業日で数え直す。同じ名前があれば上書き） */
export default function SaveTemplateDialog({ open, onOpenChange, tasks, parties, holidays, defaultName = "" }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: templates = [] } = useScheduleTemplates();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setName(defaultName); setKeywords(""); } }, [open, defaultName]);
  const same = templates.find((t) => t.name === name.trim());
  useEffect(() => { if (same) setKeywords((same.keywords || []).join("、")); }, [same]);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (same && !window.confirm(`「${n}」はもうあります。この工程表の内容で上書きしますか？`)) return;
    setSaving(true);
    try {
      const steps = stepsFromTasks(tasks, parties, (t) => { const r = taskRange(t); return r ? workdaysIn(r.start, r.end, holidays) : 1; });
      const kw = keywords.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
      if (same) await db.entities.ScheduleTemplate.update(same.id, { steps, keywords: kw });
      else await db.entities.ScheduleTemplate.create({ name: n, steps, keywords: kw, sort_order: (templates.length + 1) * 10, created_by: user?.full_name || user?.email || "" });
      qc.invalidateQueries({ queryKey: ["scheduleTemplates"] });
      toast.success(`テンプレート「${n}」を保存しました（${steps.length}件の工程）`);
      onOpenChange(false);
    } catch (err) {
      toast.error("保存できませんでした: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>この工程表をテンプレートに保存</DialogTitle>
          <DialogDescription className="text-xs">工程の並び・担当・日数（営業日）・前の工程を保存します。日付・完了・社内メモ・時間は保存しません。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1"><span className="text-xs font-medium">テンプレートの名前</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} list="tpl-names" placeholder="チラシ" />
            <datalist id="tpl-names">{templates.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            {same && <span className="text-[11px] text-amber-700">同じ名前のテンプレートを上書きします</span>}
          </label>
          <label className="block space-y-1"><span className="text-xs font-medium">案件名にこの言葉があれば候補に出す（、で区切る）</span>
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="チラシ、フライヤー" />
          </label>
          <p className="text-[11px] text-muted-foreground">{tasks.length}件の工程を保存します</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
