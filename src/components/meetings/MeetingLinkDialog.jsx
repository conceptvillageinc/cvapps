import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import ClientCombobox, { normalizeClientName } from "@/components/clients/ClientCombobox";
import ClientFormDialog from "@/components/clients/ClientFormDialog";
import { INTERNAL_CLIENT, useMeetingSettings } from "@/lib/meetings";

const OWN_COMPANY = /コンセプト・?ヴィレッジ|concept-?village|cv\s*digital|cool\s*agri|クールアグリ/i;

/** 議事録の本文に名前が出てくるクライアント（出てくる回数の多い順） */
export function clientsMentioned(meeting, clients, limit = 3) {
  const s = meeting?.summary || {};
  const text = normalizeClientName([
    meeting?.title, s.overview, s.notes,
    ...(s.decisions || []), ...(s.open_items || []),
    ...(meeting?.transcript || []).slice(0, 400).map((t) => t.text),
  ].filter((v) => typeof v === "string").join(" "));
  if (!text) return [];
  const out = [];
  for (const c of clients) {
    if (c.name === INTERNAL_CLIENT || OWN_COMPANY.test(c.name)) continue; // 自社の名前は会社紹介で必ず出るので候補にしない
    const n = normalizeClientName(c.name);
    if (n.length < 2) continue;
    const count = text.split(n).length - 1;
    if (count > 0) out.push({ c, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit).map((x) => x.c);
}

const fmtDate = (d) => String(d || "").replace(/-/g, "/");

/**
 * 議事録のクライアント・案件をあとから設定する（録音・文字起こしのあとでも）。
 *   本文に名前が出てくるクライアントを候補に出す。タイトルにクライアント名が無ければ付け直せる。
 */
export default function MeetingLinkDialog({ open, onOpenChange, meeting }) {
  const queryClient = useQueryClient();
  const { typeLabel } = useMeetingSettings();
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => db.entities.Client.list("name"), enabled: open });
  const { data: projects = [] } = useQuery({ queryKey: ["projects", "all"], queryFn: () => db.entities.Project.list("-registered_at"), enabled: open });
  const uniqueClients = useMemo(() => [...new Map(clients.map((c) => [c.name, c])).values()], [clients]);
  const mentioned = useMemo(() => clientsMentioned(meeting, uniqueClients), [meeting, uniqueClients]);

  const [clientName, setClientName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [renameTitle, setRenameTitle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);

  useEffect(() => {
    if (!open || !meeting) return;
    setClientName(meeting.client_name || "");
    setProjectId(meeting.project_id || "");
    setTitle(meeting.title || "");
  }, [open, meeting]);

  const isInternal = clientName === INTERNAL_CLIENT;
  const typeDate = `${typeLabel(meeting?.meeting_type)} ${fmtDate(meeting?.held_at)}`.trim();
  const suggestedTitle = clientName ? `${isInternal ? "社内" : clientName} ${typeDate}` : "";
  // タイトルが「種類 日付」のまま（クライアント名が入っていない）なら、付け直すのを最初からオンに
  useEffect(() => {
    if (!open || !meeting) return;
    const t = String(meeting.title || "").trim();
    setRenameTitle(!!clientName && (t === "" || t === typeDate || !t.includes(isInternal ? "社内" : clientName)) && t !== suggestedTitle);
  }, [open, clientName]);

  const projectOptions = useMemo(() => {
    const list = projects.filter((p) => p.id === projectId || p.status === "open" || p.status === undefined);
    const forClient = clientName && !isInternal ? list.filter((p) => p.client_name === clientName || p.id === projectId) : list;
    return forClient.slice(0, 300);
  }, [projects, projectId, clientName, isInternal]);

  // 案件を選んだら、クライアントが空ならその案件のクライアントを入れる
  const pickProject = (id) => {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p && !clientName && p.client_name) setClientName(p.client_name);
  };
  // クライアントを変えて、選んでいた案件が別のクライアントのものなら外す
  const pickClient = (name) => {
    setClientName(name);
    const p = projects.find((x) => x.id === projectId);
    if (p && name && name !== INTERNAL_CLIENT && p.client_name !== name) setProjectId("");
  };

  const unregistered = clientName && !isInternal && !uniqueClients.some((c) => c.name === clientName.trim());

  const save = async () => {
    setSaving(true);
    try {
      const client = uniqueClients.find((c) => c.name === clientName.trim());
      const patch = {
        client_id: client?.id || null,
        client_name: clientName.trim() || null,
        project_id: projectId || null,
        title: (renameTitle && suggestedTitle ? suggestedTitle : title.trim()) || meeting.title,
      };
      await db.entities.Meeting.update(meeting.id, patch);
      queryClient.setQueryData(["meeting", meeting.id], (cur) => (cur ? { ...cur, ...patch } : cur));
      queryClient.invalidateQueries({ queryKey: ["meeting", meeting.id] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("クライアント・案件を設定しました");
      onOpenChange(false);
    } catch (e) { toast.error("保存できませんでした: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
        <DialogContent className="max-w-lg" data-testid="meeting-link-dialog">
          <DialogHeader><DialogTitle>クライアント・案件を設定</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            {mentioned.length > 0 && !isInternal && (
              <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 space-y-1.5" data-testid="meeting-link-suggest">
                <p className="text-[11px] text-sky-900 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> 議事録に名前が出てくるクライアント</p>
                <div className="flex flex-wrap gap-1.5">
                  {mentioned.map((c) => (
                    <button key={c.id} type="button" onClick={() => pickClient(c.name)} className={`rounded-full border px-2.5 py-0.5 text-xs ${clientName === c.name ? "bg-sky-700 text-white border-sky-700" : "bg-white hover:bg-sky-100 border-sky-300 text-sky-900"}`}>{c.name}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">クライアント</Label>
                <button type="button" onClick={() => pickClient(isInternal ? "" : INTERNAL_CLIENT)} className={`text-[11px] px-2 py-0.5 rounded-full border ${isInternal ? "bg-slate-800 text-white border-slate-800" : "bg-muted/40 hover:bg-muted"}`}>
                  {isInternal ? "✓ 社内の打ち合わせ（CV自社）" : "社内の打ち合わせ（CV自社）"}
                </button>
              </div>
              {isInternal ? (
                <Input value="社内の打ち合わせ（CV自社）" readOnly className="h-10 bg-muted/40" />
              ) : (
                <ClientCombobox
                  value={clientName}
                  onChange={pickClient}
                  clients={uniqueClients.filter((c) => c.name !== INTERNAL_CLIENT)}
                  onRegister={() => setClientDialogOpen(true)}
                  registerHint="登録すると議事録がそのクライアントのカルテに出ます（登録しなくても名前だけ付けられます）"
                  placeholder="クライアント名で検索（一部でも可）"
                />
              )}
              {unregistered && <p className="text-[11px] text-amber-700">「{clientName}」はクライアント一覧にありません。名前だけ付けるか、新規登録してください</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">案件（任意）</Label>
              <select value={projectId} onChange={(e) => pickProject(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label="案件">
                <option value="">（紐づけない）</option>
                {projectOptions.map((p) => <option key={p.id} value={p.id}>{(!clientName || isInternal) && p.client_name ? `${p.client_name}｜` : ""}{p.project_number} {p.name}{p.status && p.status !== "open" ? "（終了）" : ""}</option>)}
              </select>
              {clientName && !isInternal && projectOptions.length === 0 && <p className="text-[11px] text-muted-foreground">このクライアントの進行中の案件はありません</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">タイトル</Label>
              {suggestedTitle && suggestedTitle !== (meeting?.title || "") && (
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={renameTitle} onChange={(e) => setRenameTitle(e.target.checked)} />
                  「{suggestedTitle}」に付け直す
                </label>
              )}
              <Input value={renameTitle && suggestedTitle ? suggestedTitle : title} onChange={(e) => { setRenameTitle(false); setTitle(e.target.value); }} className="h-10" aria-label="タイトル" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>キャンセル</Button>
            <Button onClick={save} disabled={saving} className="gap-1.5" data-testid="meeting-link-save">{saving && <Loader2 className="w-4 h-4 animate-spin" />} 保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ClientFormDialog
        open={clientDialogOpen}
        onOpenChange={setClientDialogOpen}
        initialName={clientName}
        onSaved={(row) => { if (row?.name) pickClient(row.name); queryClient.invalidateQueries({ queryKey: ["clients"] }); toast.success("クライアントを登録しました"); }}
      />
    </>
  );
}
