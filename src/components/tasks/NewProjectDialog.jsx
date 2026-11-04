import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Building2, Layers, Search, Check, Loader2, FolderKanban } from "lucide-react";

export const PROJECT_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

/**
 * 新規プロジェクト（タスク管理）
 *   クライアントのプロジェクト … クライアントを選ぶと、名前はクライアント名。そのクライアントの案件がプロジェクトの中に並ぶ
 *   社内のプロジェクト         … 名前を自由に入れる（校正・入稿・発注・請求・売上 など）
 *   すでにそのクライアントのプロジェクトがあるときは、新しく作らずにそれを開く
 */
export default function NewProjectDialog({ open, onOpenChange, clients, projects, taskProjects, onCreate, onOpenExisting }) {
  const [kind, setKind] = useState("client");
  const [q, setQ] = useState("");
  const [client, setClient] = useState(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setKind("client"); setQ(""); setClient(null); setName(""); setColor(PROJECT_COLORS[taskProjects.length % PROJECT_COLORS.length]); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // クライアントごとの進行中の案件の数（多い順に上へ）
  const openCount = useMemo(() => {
    const m = new Map();
    for (const p of projects || []) if (p.client_id && p.status === "open") m.set(p.client_id, (m.get(p.client_id) || 0) + 1);
    return m;
  }, [projects]);
  const existing = useMemo(() => new Map((taskProjects || []).filter((p) => p.client_id && !p.archived).map((p) => [p.client_id, p])), [taskProjects]);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (clients || [])
      .filter((c) => !k || [c.name, c.name_kana].filter(Boolean).join(" ").toLowerCase().includes(k))
      .sort((a, b) => (openCount.get(b.id) || 0) - (openCount.get(a.id) || 0) || String(a.name_kana || a.name || "").localeCompare(String(b.name_kana || b.name || ""), "ja"))
      .slice(0, 50);
  }, [clients, q, openCount]);

  const pick = (c) => { setClient(c); setName(c.name || ""); };
  const dup = client ? existing.get(client.id) : null;
  const canCreate = kind === "client" ? !!client && !!name.trim() && !dup : !!name.trim();
  const submit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try { await onCreate({ name: name.trim(), color, client_id: kind === "client" ? client.id : null }); onOpenChange(false); }
    catch (e) { toast.error("作れませんでした: " + (e?.message || "")); }
    finally { setBusy(false); }
  };

  const Tab = ({ value, icon: Icon, label, sub }) => (
    <button type="button" onClick={() => setKind(value)} className={`flex-1 rounded-xl border p-3 text-left transition ${kind === value ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-slate-200 hover:bg-slate-50"}`} data-testid={`np-kind-${value}`}>
      <span className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="w-4 h-4" />{label}</span>
      <span className="mt-0.5 block text-[11px] text-slate-500">{sub}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="new-project-dialog">
        <DialogHeader>
          <DialogTitle>新規プロジェクト</DialogTitle>
          <DialogDescription>プロジェクトはメンバー全員に共有されます</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Tab value="client" icon={Building2} label="クライアントで作る" sub="そのクライアントの案件とタスクがまとまります" />
            <Tab value="internal" icon={Layers} label="社内で作る" sub="校正・入稿・発注・請求・売上 など" />
          </div>

          {kind === "client" ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="クライアント名・ふりがなで探す" className="h-9 w-full rounded-lg border pl-8 pr-2 text-sm" data-testid="np-search" />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border divide-y">
                {list.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-400">見つかりません（クライアント一覧に登録してから作れます）</p>}
                {list.map((c) => {
                  const n = openCount.get(c.id) || 0; const ex = existing.get(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => pick(c)} className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm ${client?.id === c.id ? "bg-primary/5" : "hover:bg-slate-50"}`} data-testid="np-client">
                      <span className="w-4">{client?.id === c.id && <Check className="w-4 h-4 text-primary" />}</span>
                      <span className="flex-1 truncate">{c.name}</span>
                      {ex ? <span className="text-[10px] text-slate-400">プロジェクトあり</span> : n > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-700"><FolderKanban className="w-3 h-3" />進行中の案件 {n}</span>}
                    </button>
                  );
                })}
              </div>
              {dup && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  「{client.name}」のプロジェクトはもうあります
                  <Button size="sm" variant="outline" className="ml-auto h-7 text-xs bg-white" onClick={() => { onOpenExisting(dup); onOpenChange(false); }}>そのプロジェクトを開く</Button>
                </div>
              )}
              {client && !dup && (
                <label className="block space-y-1">
                  <span className="block text-xs text-slate-500">プロジェクト名（最初はクライアント名。あとで変えられます）</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full rounded-lg border px-3 text-sm" data-testid="np-name" />
                </label>
              )}
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="block text-xs text-slate-500">プロジェクト名</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) submit(); }} placeholder="例: 校正・入稿・発注・請求・売上" className="h-9 w-full rounded-lg border px-3 text-sm" data-testid="np-name" />
            </label>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">色</span>
            {PROJECT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={`h-6 w-6 rounded-md ring-offset-2 ${color === c ? "ring-2 ring-slate-500" : ""}`} style={{ background: c }} aria-label={`色 ${c}`} />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>やめる</Button>
          <Button onClick={submit} disabled={!canCreate || busy} data-testid="np-create">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}作成する</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
