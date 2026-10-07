import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useMeetingSettings } from "@/lib/meetings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mic, Plus, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * 議事録の設定: 打ち合わせの種類、音声の保存日数、種類ごとの「確認すべき項目」
 */
export default function MeetingSettingsCard({ settings, upsertSetting }) {
  const queryClient = useQueryClient();
  const { types, retentionDays, recording } = useMeetingSettings();
  const [selectedType, setSelectedType] = useState(types[0]?.key || "spec");
  const [newType, setNewType] = useState("");
  const [newItem, setNewItem] = useState("");
  const [days, setDays] = useState(String(retentionDays));
  const [limits, setLimits] = useState({ idle_min: String(recording.idle_min), confirm_min: String(recording.confirm_min), max_hours: String(recording.max_hours) });
  const limitsChanged = ["idle_min", "confirm_min", "max_hours"].some((k) => String(recording[k]) !== limits[k]);

  const { data: checklist = [] } = useQuery({ queryKey: ["meetingChecklists"], queryFn: () => db.entities.MeetingChecklist.list("sort_order") });
  const items = checklist.filter((c) => c.meeting_type === selectedType).sort((a, b) => a.sort_order - b.sort_order);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["meetingChecklists"] }); queryClient.invalidateQueries({ queryKey: ["settings"] }); };

  const saveTypes = async (next) => {
    try { await upsertSetting(settings, "meeting_types", JSON.stringify(next), "議事録: 打ち合わせの種類"); refresh(); }
    catch (e) { toast.error("保存できませんでした: " + e.message); }
  };
  const addType = () => {
    const label = newType.trim();
    if (!label) return;
    const key = `t_${Date.now().toString(36)}`;
    saveTypes([...types, { key, label }]); setNewType("");
  };
  const removeType = (key) => {
    if (types.length <= 1) { toast.error("種類は1つ以上必要です"); return; }
    saveTypes(types.filter((t) => t.key !== key));
    if (selectedType === key) setSelectedType(types.find((t) => t.key !== key)?.key);
  };
  const renameType = (key, label) => saveTypes(types.map((t) => (t.key === key ? { ...t, label } : t)));

  const saveDays = async () => {
    const n = Number(days);
    if (!(n > 0 && n <= 3650)) { toast.error("1〜3650 の日数を入れてください"); return; }
    try { await upsertSetting(settings, "meeting_audio_retention_days", String(n), "議事録: 音声の保存日数"); refresh(); toast.success("保存しました"); }
    catch (e) { toast.error("保存できませんでした: " + e.message); }
  };

  const saveLimits = async () => {
    const v = { idle_min: Number(limits.idle_min), confirm_min: Number(limits.confirm_min), max_hours: Number(limits.max_hours) };
    if (!(v.idle_min >= 1 && v.idle_min <= 120)) { toast.error("無音の時間は 1〜120 分で入れてください"); return; }
    if (!(v.confirm_min >= 1 && v.confirm_min <= 30)) { toast.error("応答を待つ時間は 1〜30 分で入れてください"); return; }
    if (!(v.max_hours >= 0.5 && v.max_hours <= 12)) { toast.error("録音時間の上限は 0.5〜12 時間で入れてください"); return; }
    try { await upsertSetting(settings, "meeting_recording_limits", JSON.stringify(v), "議事録: 録音の止め忘れ対策"); refresh(); toast.success("保存しました（次に録音を始めたときから使います）"); }
    catch (e) { toast.error("保存できませんでした: " + e.message); }
  };

  const itemMutation = useMutation({
    mutationFn: async (op) => {
      if (op.type === "add") return db.entities.MeetingChecklist.create({ meeting_type: selectedType, key: `c_${Date.now().toString(36)}`, label: op.label, sort_order: (items[items.length - 1]?.sort_order || 0) + 10, is_active: true });
      if (op.type === "update") return db.entities.MeetingChecklist.update(op.id, op.data);
      if (op.type === "remove") return db.entities.MeetingChecklist.delete(op.id);
      if (op.type === "swap") { for (const u of op.updates) await db.entities.MeetingChecklist.update(u.id, u.data); }
    },
    onSuccess: refresh,
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });
  const move = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const order = items.map((it, i) => ({ id: it.id, pos: i }));
    order[idx].pos = target; order[target].pos = idx;
    itemMutation.mutate({ type: "swap", updates: order.map((o) => ({ id: o.id, data: { sort_order: o.pos * 10 } })) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Mic className="w-4 h-4" /> 議事録</CardTitle>
        <CardDescription className="text-xs">打ち合わせの種類と、種類ごとに AI が「確認できたか」を判定する項目。音声の保存日数と、録音の止め忘れ対策</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2">
          <Label className="text-xs font-semibold">音声の保存日数</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min="1" max="3650" value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-28" />
            <span className="text-xs text-muted-foreground">日（過ぎたら音声だけ削除。文字起こしと議事録は残ります）</span>
            <Button size="sm" variant="outline" className="text-xs" onClick={saveDays} disabled={String(retentionDays) === days}>保存</Button>
          </div>
        </section>

        <section className="space-y-2" data-testid="recording-limits">
          <Label className="text-xs font-semibold">録音の止め忘れ対策</Label>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
            <span>無音が</span>
            <Input type="number" min="1" max="120" value={limits.idle_min} onChange={(e) => setLimits({ ...limits, idle_min: e.target.value })} className="h-8 w-16 text-xs" aria-label="無音の時間（分）" />
            <span>分続いたとき、または録音が</span>
            <Input type="number" min="0.5" max="12" step="0.5" value={limits.max_hours} onChange={(e) => setLimits({ ...limits, max_hours: e.target.value })} className="h-8 w-16 text-xs" aria-label="録音時間の上限（時間）" />
            <span>時間に達したときに「録音を続けますか？」を出し、</span>
            <Input type="number" min="1" max="30" value={limits.confirm_min} onChange={(e) => setLimits({ ...limits, confirm_min: e.target.value })} className="h-8 w-16 text-xs" aria-label="応答を待つ時間（分）" />
            <span>分応答が無ければ自動で録音を終える</span>
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={saveLimits} disabled={!limitsChanged}>保存</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">無音で自動で終えたときは、無音になってからの部分は保存しません（文字起こしの時間と利用料がかかりません）。上限のときは「1 時間延ばして続ける」を選べます</p>
        </section>

        <section className="space-y-2">
          <Label className="text-xs font-semibold">打ち合わせの種類</Label>
          <div className="space-y-1.5">
            {types.map((t) => (
              <div key={t.key} className="flex items-center gap-2">
                <button type="button" onClick={() => setSelectedType(t.key)} className={`h-8 px-2.5 rounded-md border text-xs shrink-0 ${selectedType === t.key ? "bg-slate-800 text-white border-slate-800" : "bg-background"}`}>{checklist.filter((c) => c.meeting_type === t.key).length} 項目</button>
                <Input defaultValue={t.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.label) renameType(t.key, v); }} className="h-8 text-xs" />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeType(t.key)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="種類を追加（例: 動画制作）" className="h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter") addType(); }} />
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={addType}><Plus className="w-3.5 h-3.5" /> 追加</Button>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <Label className="text-xs font-semibold">「{types.find((t) => t.key === selectedType)?.label || ""}」で確認すべき項目</Label>
          <p className="text-[10px] text-muted-foreground">左の「◯ 項目」ボタンで種類を選びます。AI が文字起こしから、項目ごとに 確認済み／未確認／該当なし を判定します</p>
          {items.length === 0 ? <p className="text-xs text-muted-foreground">まだ項目がありません</p> : (
            <div className="space-y-1">
              {items.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-1.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0 || itemMutation.isPending} onClick={() => move(idx, -1)}><ArrowUp className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === items.length - 1 || itemMutation.isPending} onClick={() => move(idx, 1)}><ArrowDown className="w-3 h-3" /></Button>
                  <Input defaultValue={it.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.label) itemMutation.mutate({ type: "update", id: it.id, data: { label: v } }); }} className={`h-8 text-xs ${it.is_active ? "" : "opacity-50"}`} />
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap"><input type="checkbox" checked={it.is_active} onChange={(e) => itemMutation.mutate({ type: "update", id: it.id, data: { is_active: e.target.checked } })} /> 使う</label>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => itemMutation.mutate({ type: "remove", id: it.id })}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="項目を追加（例: 校正回数）" className="h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter" && newItem.trim()) { itemMutation.mutate({ type: "add", label: newItem.trim() }); setNewItem(""); } }} />
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={!newItem.trim() || itemMutation.isPending} onClick={() => { itemMutation.mutate({ type: "add", label: newItem.trim() }); setNewItem(""); }}>
              {itemMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 追加
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
