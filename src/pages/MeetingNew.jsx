import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { useMeetingSettings, INTERNAL_CLIENT } from "@/lib/meetings";
import { todayString } from "@/lib/fiscal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Mic, FileUp, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import MeetingRecorder from "@/components/meetings/MeetingRecorder";
import ClientFormDialog from "@/components/clients/ClientFormDialog";
import LiveRecordingBanner from "@/components/meetings/LiveRecordingBanner";
import { useLiveRecordings } from "@/lib/liveRecordings";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/**
 * 新しい議事録: 基本情報 → 録音（主）／音声ファイル（補助）→ 処理へ
 * ?client=名前&project=ID で初期値を入れられる（カルテ・案件から）
 */
export default function MeetingNew() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { types, typeLabel } = useMeetingSettings();
  const fileRef = useRef(null);

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => db.entities.Client.list("name") });
  const { data: projects = [] } = useQuery({ queryKey: ["projects", "open"], queryFn: () => db.entities.Project.filter({ status: "open" }, "-registered_at", 300) });
  const { data: appUsers = [] } = useQuery({ queryKey: ["appUsers"], queryFn: () => db.entities.User.list("full_name") });

  const [form, setForm] = useState({
    title: "", held_at: todayString(), meeting_type: "spec",
    client_name: params.get("client") || "", project_id: params.get("project") || "",
    participants: "",
  });
  const [mode, setMode] = useState(null); // null | 'record' | 'upload'
  const [meeting, setMeeting] = useState(null); // 録音先として作った議事録
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 案件を選んだらクライアント名を引き継ぐ
  const selectedProject = projects.find((p) => p.id === form.project_id);
  useEffect(() => {
    if (selectedProject && !form.client_name) setForm((f) => ({ ...f, client_name: selectedProject.client_name || "" }));
    // 社内（CV自社）のまま案件だけ紐づけた場合は、クライアント名は CV自社 のままにする
  }, [selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // 出席者の初期値: ログイン中の本人
  useEffect(() => {
    if (user?.full_name && !form.participants) setForm((f) => ({ ...f, participants: user.full_name }));
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const uniqueClients = useMemo(() => [...new Map(clients.map((c) => [c.name, c])).values()], [clients]);
  const clientMatched = useMemo(() => uniqueClients.find((c) => c.name === form.client_name.trim()) || null, [uniqueClients, form.client_name]);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const defaultTitle = `${form.client_name === INTERNAL_CLIENT ? "社内 " : form.client_name ? `${form.client_name} ` : ""}${typeLabel(form.meeting_type)} ${form.held_at.replace(/-/g, "/")}`;

  const buildPayload = (source) => {
    const client = uniqueClients.find((c) => c.name === form.client_name);
    return {
      title: form.title.trim() || defaultTitle,
      held_at: form.held_at || todayString(),
      meeting_type: form.meeting_type,
      client_id: client?.id || null,
      client_name: form.client_name || null,
      project_id: form.project_id || null,
      participants: form.participants.split(/[、,]/).map((s) => s.trim()).filter(Boolean),
      source,
      status: "recording",
      created_by: user?.full_name || user?.email || "",
    };
  };

  // ほかのメンバーが録音中なら、録音を始める前に確認する（同じ打ち合わせなら合流して録音しない）
  const { live } = useLiveRecordings();
  const others = live.filter((m) => (m.created_by || "") !== (user?.full_name || user?.email || ""));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const sameAsInput = (m) => (form.project_id && m.project_id === form.project_id) || (form.client_name && form.client_name !== INTERNAL_CLIENT && m.client_name === form.client_name);
  const onRecordClick = () => { if (others.length > 0) setConfirmOpen(true); else startRecording(); };
  const joinLive = async (m) => {
    const me = user?.full_name || user?.email || "";
    const participants = Array.isArray(m.participants) ? m.participants : [];
    try {
      if (me && !participants.includes(me)) await db.entities.Meeting.update(m.id, { participants: [...participants, me] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success(`「${m.title || "議事録"}」に出席者として加わりました（録音は始めません）`);
      navigate(`/meetings/${m.id}`);
    } catch (err) {
      toast.error("加われませんでした: " + err.message);
    }
  };

  const startRecording = async () => {
    setConfirmOpen(false);
    setCreating(true);
    try {
      const m = await db.entities.Meeting.create(buildPayload("record"));
      setMeeting(m);
      setMode("record");
    } catch (err) {
      toast.error("議事録を作成できませんでした: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  const kickProcessing = async (m) => {
    await db.entities.Meeting.update(m.id, { status: "uploaded" });
    queryClient.invalidateQueries({ queryKey: ["meetings"] });
    navigate(`/meetings/${m.id}`);
  };

  // 録音を終えたときの保存（処理待ちにする・議事録の画面へ移る）は RecordingProvider が行う
  const onRecordFinish = async () => {
    queryClient.invalidateQueries({ queryKey: ["meetings"] });
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) { toast.error("200MB までの音声ファイルを選んでください"); return; }
    setUploading(true);
    try {
      const m = await db.entities.Meeting.create(buildPayload("upload"));
      const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || [".m4a"])[0].toLowerCase();
      const path = `meetings/${m.id}/audio${ext}`;
      await db.integrations.Core.UploadFile({ file, path });
      await db.entities.Meeting.update(m.id, { audio_path: path, audio_size: file.size });
      await kickProcessing(m);
    } catch (err) {
      toast.error("アップロードに失敗しました: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/meetings")} disabled={mode === "record"}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">新しい議事録</h1>
          <p className="text-xs text-muted-foreground">{mode === "record" ? "録音中は画面をロックせず、このタブを開いたままにしてください" : "基本情報を入れて、録音するか音声ファイルを選びます"}</p>
        </div>
      </div>

      {mode !== "record" && (
        <LiveRecordingBanner highlight={{ client_name: form.client_name !== INTERNAL_CLIENT ? form.client_name : "", project_id: form.project_id }} />
      )}

      {mode !== "record" && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">クライアント</Label>
              <button type="button" onClick={() => setForm({ ...form, client_name: form.client_name === INTERNAL_CLIENT ? "" : INTERNAL_CLIENT })} className={`text-[11px] px-2 py-0.5 rounded-full border ${form.client_name === INTERNAL_CLIENT ? "bg-slate-800 text-white border-slate-800" : "bg-muted/40 hover:bg-muted"}`}>
                {form.client_name === INTERNAL_CLIENT ? "✓ 社内の打ち合わせ（CV自社）" : "社内の打ち合わせ（CV自社）"}
              </button>
            </div>
            <Input list="meeting-client-options" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="クライアント名（社内なら「CV自社」）" className="h-10" />
            <datalist id="meeting-client-options">
              <option value={INTERNAL_CLIENT}>社内の打ち合わせ</option>
              {uniqueClients.filter((c) => c.name !== INTERNAL_CLIENT).map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
            {form.client_name && form.client_name !== INTERNAL_CLIENT && !clientMatched && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                <span>「{form.client_name}」はクライアント一覧にありません。</span>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1 bg-white" onClick={() => setClientDialogOpen(true)}><UserPlus className="w-3.5 h-3.5" /> クライアント一覧に新規登録する</Button>
                <span className="text-[11px] text-amber-700">登録すると議事録がそのクライアントに紐づきます（登録しなくても議事録は作れます）</span>
              </div>
            )}
            {clientMatched && form.client_name !== INTERNAL_CLIENT && <p className="text-[11px] text-emerald-700">クライアント一覧の「{clientMatched.name}」に紐づきます</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">案件（任意）{form.client_name === INTERNAL_CLIENT && <span className="text-muted-foreground font-normal">　社内の打ち合わせでも、対象のクライアント案件を紐づけられます</span>}</Label>
            <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">（紐づけない）</option>
              {projects
                .filter((p) => !form.client_name || form.client_name === INTERNAL_CLIENT || p.client_name === form.client_name)
                .map((p) => <option key={p.id} value={p.id}>{form.client_name === INTERNAL_CLIENT && p.client_name ? `${p.client_name}｜` : ""}{p.project_number} {p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">ミーティングタイトル</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={defaultTitle} className="h-10" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">日付</Label>
              <Input type="date" value={form.held_at} onChange={(e) => setForm({ ...form, held_at: e.target.value })} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">種類</Label>
              <Select value={form.meeting_type} onValueChange={(v) => setForm({ ...form, meeting_type: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">出席者（「、」区切り）</Label>
            <Input value={form.participants} onChange={(e) => setForm({ ...form, participants: e.target.value })} placeholder="例: 馬場、佐藤様" className="h-10" />
            <div className="flex flex-wrap gap-1 pt-1">
              {appUsers.filter((u) => u.full_name && !String(u.full_name).includes("@") && !form.participants.includes(u.full_name)).map((u) => (
                <button key={u.id} type="button" onClick={() => setForm({ ...form, participants: [form.participants, u.full_name].filter(Boolean).join("、") })} className="text-[11px] px-2 py-0.5 rounded-full border bg-muted/40 hover:bg-muted">+ {u.full_name}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === null && (
        <div className="space-y-3">
          <Button onClick={onRecordClick} disabled={creating} className="w-full h-14 text-base gap-2 bg-red-600 hover:bg-red-700">
            {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />} 録音する
          </Button>
          <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac" className="hidden" onChange={onFile} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full h-12 gap-2">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} 音声ファイルを選ぶ（ボイスメモなど）
          </Button>
          <p className="text-[11px] text-muted-foreground">録音は 5 分ごとに保存されるので、途中で切れてもそれまでの分は残ります。音声ファイルは 200MB まで（60 分で 30〜60MB が目安。Wi-Fi 推奨）。</p>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Mic className="w-4 h-4 text-red-600" /> ほかのメンバーが録音中です</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>同じ打ち合わせなら録音は 1 本で十分です。合流すると、その議事録の出席者に加わります。</p>
                <div className="space-y-1.5">
                  {others.map((m) => (
                    <div key={m.id} className={`rounded-md border px-3 py-2 ${sameAsInput(m) ? "border-red-400 bg-red-50" : "border-border"}`}>
                      <p className="text-sm font-semibold text-foreground">{m.created_by || "メンバー"} が「{m.title || "議事録"}」を録音中{sameAsInput(m) && <span className="ml-2 text-[11px] text-red-700 font-semibold">いま入力している案件・クライアントと同じ</span>}</p>
                      <p className="text-[11px] text-muted-foreground">{[m.client_name, (m.participants || []).length ? `出席: ${m.participants.join("、")}` : null].filter(Boolean).join(" ｜ ")}</p>
                      <Button type="button" size="sm" className="mt-1.5 h-8 text-xs gap-1" onClick={() => joinLive(m)}><UserPlus className="w-3.5 h-3.5" /> 同じ打ち合わせなので合流する（録音しない）</Button>
                    </div>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={startRecording}>別の打ち合わせなので録音する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClientFormDialog
        open={clientDialogOpen}
        onOpenChange={setClientDialogOpen}
        initialName={form.client_name}
        onSaved={(row) => { setForm((f) => ({ ...f, client_name: row?.name || f.client_name })); toast.success("クライアントを登録しました"); }}
      />

      {mode === "record" && meeting && (
        <MeetingRecorder meetingId={meeting.id} title={meeting.title || ""} onFinish={onRecordFinish} />
      )}
    </div>
  );
}
