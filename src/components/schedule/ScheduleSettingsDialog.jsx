import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { partiesOf, keyDatesOf, newPartyColor } from "@/lib/schedule";

/**
 * 工程表の設定。ツールバーの「大事な日」「担当の区分」から、それぞれの画面として開く（タイトルは工程表の上で直接直す）。
 * @param {"keyDates"|"parties"} p.section
 */
export default function ScheduleSettingsDialog({ open, section = "keyDates", onOpenChange, project, onSave, saving }) {
  const [keyDates, setKeyDates] = useState([]);
  const [parties, setParties] = useState([]);
  useEffect(() => {
    if (!open) return;
    setKeyDates(keyDatesOf(project).map((k) => ({ ...k })));
    setParties(partiesOf(project).map((p) => ({ ...p })));
  }, [open, project]);

  const setParty = (i, patch) => setParties((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addParty = () => setParties((ps) => [...ps, { key: `other:${Date.now().toString(36)}`, label: "", color: newPartyColor(ps) }]);
  const save = () => onSave({
    ...(project.schedule_settings || {}),
    ...(section === "keyDates"
      ? { key_dates: keyDates.filter((k) => k.date && k.label.trim()).map((k) => ({ label: k.label.trim(), date: k.date })).sort((a, b) => a.date.localeCompare(b.date)) }
      : { parties: parties.filter((p) => p.label.trim()).map((p) => ({ key: p.key, label: p.label.trim(), color: p.color })) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{section === "keyDates" ? "大事な日" : "担当の区分"}</DialogTitle></DialogHeader>
        <div className="space-y-5 text-sm">
          {section === "keyDates" && <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">納品期限・使用日など。工程表に赤い点線と赤いラベルで出ます</p>
            {keyDates.map((k, i) => (
              <div key={i} className="flex gap-2">
                <Input value={k.label} onChange={(e) => setKeyDates((ks) => ks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="納品期限" className="flex-1" />
                <Input type="date" value={k.date} onChange={(e) => setKeyDates((ks) => ks.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} className="w-40" />
                <Button variant="ghost" size="icon" onClick={() => setKeyDates((ks) => ks.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1 hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" onClick={() => setKeyDates((ks) => [...ks, { label: "", date: "" }])}><Plus className="w-3.5 h-3.5" /> 大事な日を追加</Button>
          </div>}

          {section === "parties" && <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">CV・クライアント様のほかに、印刷会社などを案件ごとに足せます。色は工程表の棒の色です</p>
            {parties.map((p, i) => (
              <div key={p.key} className="flex gap-2 items-center">
                <input type="color" value={p.color} onChange={(e) => setParty(i, { color: e.target.value })} className="h-9 w-10 rounded border p-0.5 cursor-pointer" />
                <Input value={p.label} onChange={(e) => setParty(i, { label: e.target.value })} placeholder="印刷会社・エフコム など" className="flex-1" />
                {p.key === "cv" || p.key === "client"
                  ? <span className="w-9 text-[10px] text-muted-foreground text-center">固定</span>
                  : <Button variant="ghost" size="icon" onClick={() => setParties((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1 hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" onClick={addParty}><Plus className="w-3.5 h-3.5" /> その他の担当を追加</Button>
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="hover:bg-blue-50 hover:text-blue-800 data-[state=open]:bg-blue-50 data-[state=open]:text-blue-800" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={save} disabled={saving}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
