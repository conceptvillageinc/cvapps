import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { RangeCalendarButton } from "@/components/tasks/RangeCalendar";

/**
 * 新しいタスクを作る（右上の「タスクを作成」）。名前・期日・見出しを入れて「作成して開く」で、作ったタスクの詳細を開く
 *   sections: 入れられる見出し（[{ id, name }]。先頭の空 id は見出しなし）
 */
export default function NewTaskDialog({ open, onOpenChange, sections = [], noneLabel, today, hint, onCreate }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setStart(today); setEnd(today); setSection(""); } }, [open, today]);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onCreate({ name: name.trim(), start_date: start || null, end_date: end || start || null, sectionId: section || null }); onOpenChange(false); }
    catch (e) { toast.error("作れませんでした: " + (e?.message || "")); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md [&>*]:min-w-0" data-testid="new-task-dialog">
        <DialogHeader>
          <DialogTitle>タスクを作成</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="block text-xs text-slate-500">タスク名</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              placeholder="例: 豚々ジャッキー 名刺の入稿チェック" className="h-10 w-full rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" data-testid="new-task-name" />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block space-y-1"><span className="block text-xs text-slate-500">開始日</span>
              <input type="date" value={start || ""} onChange={(e) => { setStart(e.target.value); if (end && e.target.value > end) setEnd(e.target.value); }} className="h-9 w-[9.5rem] rounded-lg border px-2 text-sm" /></label>
            <span className="pb-2 text-slate-400">〜</span>
            <label className="block space-y-1"><span className="block text-xs text-slate-500">期限</span>
              <input type="date" value={end || ""} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="h-9 w-[9.5rem] rounded-lg border px-2 text-sm" /></label>
            {/* カレンダーで 開始日〜期限 を選ぶ */}
            <RangeCalendarButton start={start} end={end} today={today} onChange={({ start_date, end_date }) => { setStart(start_date); setEnd(end_date); }} className="h-9 w-9 rounded-lg" testId="new-task-calendar" />
          </div>
          {sections.length > 0 && (
            <label className="block space-y-1">
              <span className="block text-xs text-slate-500">入れる見出し</span>
              <select value={section} onChange={(e) => setSection(e.target.value)} className="h-9 w-full rounded-lg border px-2 text-sm" data-testid="new-task-section">
                <option value="">{noneLabel}</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <p className="text-[11px] text-slate-400">担当者・紐づけ先・優先度・説明などは、作成したあとに開くタスクの詳細で入れられます</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>やめる</Button>
          <Button onClick={submit} disabled={!name.trim() || busy} data-testid="new-task-create">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}作成して開く</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
