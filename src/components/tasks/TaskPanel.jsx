import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { X, Link2, MoreHorizontal, Trash2, Paperclip, Loader2, Plus, Lock, FolderKanban, Send, FileImage, ScanEye, UserRound, CalendarDays, Flag, CircleDot, Timer, AlignLeft, ListChecks, MessageSquare } from "lucide-react";
import { PRIORITY, REVIEW_STATUS, isPrivateTask, subtasksOf, nextPinNo, mentionsIn, userLabel } from "@/lib/tasks";
import { useTaskWrites, TASK_TEMPLATES } from "@/lib/useTaskData";
import { UserAvatar, TaskCheck, TaskPlaceChip, PinBadge, DueLabel } from "@/components/tasks/parts";
import ProofViewer, { useAttachmentImage } from "@/components/tasks/ProofViewer";
import PlacePicker, { moveTaskPlace } from "@/components/tasks/PlacePicker";

const fmtAt = (s) => { if (!s) return ""; const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const FIELD_ICONS = { 担当者: UserRound, 期日: CalendarDays, 紐づけ先: FolderKanban, 優先度: Flag, 確認の状態: CircleDot, 作業時間数: Timer };
function Field({ label, children }) {
  const Icon = FIELD_ICONS[label];
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-2 min-h-9 rounded-lg px-1 -mx-1 hover:bg-slate-50">
      <span className="flex items-center gap-1.5 text-xs text-slate-500">{Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AttachmentThumb({ att, onOpen }) {
  const { data } = useAttachmentImage(att, 1);
  return (
    <button type="button" onClick={onOpen} className="group relative w-28 h-24 rounded border bg-slate-50 overflow-hidden" title={`${att.file_name || "添付"}（クリックで校正の画面を開く）`} data-testid="task-attachment">
      {data?.src ? <img src={data.src} alt="" className="w-full h-full object-cover" /> : <FileImage className="w-6 h-6 text-slate-400 m-auto" />}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 text-[9px] text-white truncate">{att.file_name}</span>
      <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/30 text-white text-[10px] gap-1"><ScanEye className="w-3.5 h-3.5" />校正する</span>
    </button>
  );
}

/** コメント欄（@ で利用者を選べる） */
function CommentComposer({ users, onSend }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [suggest, setSuggest] = useState(null); // 入力中の @ の後ろ
  const ref = useRef(null);
  const onChange = (e) => {
    const v = e.target.value; setText(v);
    const before = v.slice(0, e.target.selectionStart);
    const m = before.match(/[@＠]([^\s@＠]*)$/);
    setSuggest(m ? m[1] : null);
  };
  const candidates = suggest === null ? [] : users.filter((u) => [u.full_name, u.short_name, u.email].filter(Boolean).some((n) => n.toLowerCase().includes(suggest.toLowerCase()))).slice(0, 6);
  const insert = (u) => {
    const el = ref.current; const pos = el.selectionStart;
    const before = text.slice(0, pos).replace(/[@＠][^\s@＠]*$/, `@${userLabel(u)} `);
    setText(before + text.slice(pos)); setSuggest(null);
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = before.length; }, 0);
  };
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try { await onSend(text.trim()); setText(""); } finally { setSending(false); }
  };
  return (
    <div className="relative rounded-lg border bg-white">
      <textarea ref={ref} value={text} onChange={onChange} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} rows={3}
        placeholder="コメントを追加（@ でメンバーを呼ぶと、その人の受信トレイに届きます。Ctrl+Enter で送信）" className="w-full resize-none rounded-lg px-3 py-2 text-sm focus:outline-none" data-testid="comment-input" />
      {candidates.length > 0 && (
        <div className="absolute left-2 bottom-full mb-1 w-64 rounded-lg border bg-white shadow-lg py-1 z-10" data-testid="mention-list">
          {candidates.map((u) => (
            <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); insert(u); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted text-left">
              <UserAvatar user={u} size={18} />{userLabel(u)}{u.role === "guest" && <span className="text-[10px] text-orange-700">ゲスト</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end border-t px-2 py-1.5">
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={!text.trim() || sending} onClick={send} data-testid="comment-send">{sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}送信</Button>
      </div>
    </div>
  );
}

const highlight = (body, users) => {
  const names = users.flatMap((u) => [u.full_name, u.short_name].filter(Boolean)).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!names.length) return body;
  const re = new RegExp(`([@＠](?:${names.join("|")}))`, "g");
  return String(body).split(re).map((part, i) => (re.test(part) ? <span key={i} className="rounded bg-blue-50 px-0.5 font-medium text-blue-700">{part}</span> : part));
};

/**
 * タスクの詳細（右から開く）。紐づけ先（先頭）・担当者・期日・優先度・確認の状態・作業時間・説明・サブタスク・添付・コメント
 */
export default function TaskPanel({ taskId, data, onClose, onOpenTask }) {
  const { tasks, users, projects, internalProjects, byId } = data;
  const task = byId.tasks.get(taskId);
  const { user } = useAuth();
  const writes = useTaskWrites();
  const qc = useQueryClient();
  const [name, setName] = useState(task?.name || "");
  const [desc, setDesc] = useState(task?.description || "");
  const [newSub, setNewSub] = useState("");
  const [subOpen, setSubOpen] = useState(false); // サブタスクの入力欄を開いているか
  const [proof, setProof] = useState(null); // 開いている添付の id
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { setName(task?.name || ""); setDesc(task?.description || ""); }, [taskId]);  
  useEffect(() => { const h = (e) => { if (e.key === "Escape" && !proof) onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose, proof]);

  const { data: attachments = [] } = useQuery({ queryKey: ["taskAttachments", taskId], enabled: !!taskId, queryFn: () => db.entities.TaskAttachment.filter({ task_id: taskId }, "-created_at") });
  const { data: comments = [] } = useQuery({ queryKey: ["taskComments", taskId], enabled: !!taskId, queryFn: () => db.entities.TaskComment.filter({ task_id: taskId }, "created_at") });
  if (!task) return null;
  const subs = subtasksOf(tasks, task.id);
  const parent = task.parent_task_id ? byId.tasks.get(task.parent_task_id) : null;
  const assignee = byId.users.get(task.assignee_id);
  const save = (patch) => writes.update(task, patch).catch((e) => toast.error("保存できませんでした: " + (e?.message || "")));
  const place = { project_id: task.project_id || null, internal_project_id: task.internal_project_id || null };
  const setPlace = (patch) => moveTaskPlace(writes, task, tasks, patch);
  const addSubtask = async (text, extra = {}) => writes.create({
    ...place, parent_task_id: task.id, name: text, assignee_id: extra.assignee_id ?? task.assignee_id ?? null,
    on_schedule: false, parties: [], status: "todo", sort_order: subs.length + 1, ...extra,
  });
  const applyTemplate = async (tpl) => {
    if (!desc.trim()) { setDesc(tpl.description); await save({ description: tpl.description }); }
    for (const [i, s] of tpl.subtasks.entries()) await addSubtask(s, { sort_order: subs.length + i + 1 });
    toast.success(`ひな形「${tpl.label}」を入れました`);
  };
  const upload = async (files) => {
    setUploading(true);
    try {
      for (const f of files) {
        const ext = (f.name.match(/\.[a-zA-Z0-9]+$/) || [".bin"])[0].toLowerCase();
        const path = `tasks/${task.id}/${crypto.randomUUID()}${ext}`;
        await db.integrations.Core.UploadFile({ file: f, path });
        await db.entities.TaskAttachment.create({ task_id: task.id, path, file_name: f.name, mime_type: f.type, size: f.size });
      }
      qc.invalidateQueries({ queryKey: ["taskAttachments", task.id] });
    } catch (e) { toast.error("添付できませんでした: " + (e?.message || "")); } finally { setUploading(false); }
  };
  const sendComment = async (body) => {
    await db.entities.TaskComment.create({ task_id: task.id, body, mentions: mentionsIn(body, users) });
    qc.invalidateQueries({ queryKey: ["taskComments", task.id] });
  };
  const addPin = async ({ attachment, page, x, y, text }) => {
    const no = nextPinNo(subs);
    const sub = await addSubtask(text, { pin: { attachment_id: attachment.id, page, x, y, no } });
    await db.entities.TaskComment.create({ task_id: task.id, body: `【指摘 ${no}】${text}`, mentions: [], pin_task_id: sub.id, attachment_ids: [attachment.id] });
    qc.invalidateQueries({ queryKey: ["taskComments", task.id] });
  };
  const copyLink = () => { navigator.clipboard?.writeText(`${window.location.origin}/tasks?task=${task.id}`); toast.success("タスクのリンクをコピーしました"); };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 w-[min(680px,100vw)] bg-white shadow-2xl border-l flex flex-col" data-testid="task-panel">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Button size="sm" variant={task.completed ? "default" : "outline"} className={`h-8 gap-1.5 text-xs ${task.completed ? "bg-emerald-600 hover:bg-emerald-700" : ""}`} onClick={() => save({ completed: !task.completed, completed_at: task.completed ? null : new Date().toISOString() })} data-testid="task-complete">
            <TaskCheck done={task.completed} size={14} />{task.completed ? "完了済み" : "完了にする"}
          </Button>
          {isPrivateTask(task) && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Lock className="w-3 h-3" />自分だけ（作った人と担当者だけが見られます）</span>}
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={copyLink} title="タスクのリンクをコピー"><Link2 className="w-4 h-4" /></Button>
            {/* ボタン一つで削除（少しのあいだ「元に戻す」を出す） */}
            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={async () => { if (await writes.removeWithUndo(task, tasks)) onClose(); }} title="このタスクを削除" data-testid="panel-delete"><Trash2 className="w-4 h-4" /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-xs text-destructive gap-2" onClick={async () => { if (await writes.removeWithUndo(task, tasks)) onClose(); }}><Trash2 className="w-3.5 h-3.5" />タスクを削除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="閉じる"><X className="w-4 h-4" /></Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* 紐づけ先（先頭に 1 つだけ。押すと選べる。サブタスクは親と同じ紐づけ先なので、親の紐づけ先と親のタスクを出す） */}
          <div data-testid="task-place-head">
            <Field label="紐づけ先">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                {parent
                  ? <><TaskPlaceChip task={parent} byId={byId} /><span>›</span><button type="button" className="hover:underline" onClick={() => onOpenTask(parent.id)}>{parent.name}</button></>
                  : <PlacePicker task={task} projects={projects} internalProjects={internalProjects} byId={byId} onChange={setPlace} />}
              </div>
            </Field>
          </div>
          <textarea value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== task.name && save({ name: name.trim() })} rows={1}
            className={`w-full resize-none text-xl font-bold leading-snug focus:outline-none rounded px-1 -mx-1 hover:bg-muted/40 ${task.completed ? "line-through text-muted-foreground" : ""}`} data-testid="task-name" />

          <div className="space-y-1.5">
            <Field label="担当者">
              <div className="flex items-center gap-2">
              <select value={task.assignee_id || ""} onChange={(e) => save({ assignee_id: e.target.value || null, my_section_id: null, my_sort_order: null })} /* 担当が変わったら、新しい担当者の「新しく割り当てられたタスク」に入る */ className="h-8 rounded border px-2 text-sm" data-testid="task-assignee">
                <option value="">（担当者なし）</option>
                {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}{u.role === "guest" ? "（ゲスト）" : ""}</option>)}
              </select>
              {assignee && <UserAvatar user={assignee} size={22} />}
              </div>
            </Field>
            <Field label="期日">
              <div className="flex items-center gap-1.5">
                <input type="date" value={task.start_date || ""} onChange={(e) => save({ start_date: e.target.value || null, ...(task.end_date && e.target.value > task.end_date ? { end_date: e.target.value } : {}) })} className="h-8 rounded border px-2 text-sm" aria-label="開始日" />
                <span className="text-muted-foreground">〜</span>
                <input type="date" value={task.end_date || ""} onChange={(e) => save({ end_date: e.target.value || null })} className="h-8 rounded border px-2 text-sm" aria-label="期限" />
              </div>
            </Field>
            <Field label="優先度">
              <div className="flex gap-1">
                {Object.entries(PRIORITY).map(([k, v]) => <button key={k} type="button" onClick={() => save({ priority: task.priority === k ? null : k })} className={`rounded px-2 text-xs leading-6 ring-1 ${task.priority === k ? v.cls : "ring-slate-200 text-muted-foreground hover:bg-muted"}`}>{v.label}</button>)}
              </div>
            </Field>
            <Field label="確認の状態">
              <div className="flex gap-1">
                {Object.entries(REVIEW_STATUS).map(([k, v]) => <button key={k} type="button" onClick={() => save({ review_status: task.review_status === k ? null : k })} className={`rounded px-2 text-xs leading-6 ring-1 ${task.review_status === k ? v.cls : "ring-slate-200 text-muted-foreground hover:bg-muted"}`}>{v.label}</button>)}
              </div>
            </Field>
            <Field label="作業時間数">
              <div className="flex items-center gap-1.5">
                <input type="number" step="0.25" min="0" defaultValue={task.estimated_hours ?? ""} key={`h-${task.id}-${task.estimated_hours}`} onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== (task.estimated_hours ?? null)) save({ estimated_hours: v }); }}
                  className="h-8 w-24 rounded border px-2 text-sm text-right" data-testid="task-hours" />
                <span className="text-xs text-muted-foreground">時間（期間の営業日に均等に割り振って、ワークロードに数えます{isPrivateTask(task) ? "。自分だけのタスクは数えません" : ""}）</span>
              </div>
            </Field>
          </div>

          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800"><AlignLeft className="w-4 h-4 text-slate-400" />説明</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="text-[11px] text-primary hover:underline" data-testid="task-template">ひな形を使う</button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {TASK_TEMPLATES.map((tpl) => <DropdownMenuItem key={tpl.key} className="text-xs" onClick={() => applyTemplate(tpl)}>{tpl.label}（説明とチェック項目のサブタスク {tpl.subtasks.length} 件）</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (task.description || "") && save({ description: desc })} rows={Math.min(14, Math.max(3, desc.split("\n").length + 1))}
              placeholder="作業の内容・入稿情報・注意点など" className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30" data-testid="task-description" />
          </section>

          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800"><Paperclip className="w-4 h-4 text-slate-400" />添付<span className="text-xs font-normal text-slate-400">{attachments.length}</span></h3>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}ファイルを添付</Button>
              <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={(e) => { upload([...e.target.files]); e.target.value = ""; }} />
            </div>
            {attachments.length === 0 ? <p className="text-[11px] text-muted-foreground">資料・デザインデータ・構築画面（PNG・JPG・PDF）を添付すると、直してほしい場所にピンを打ってコメントできます。</p> : (
              <div className="flex flex-wrap gap-2">{attachments.map((a) => <AttachmentThumb key={a.id} att={a} onOpen={() => setProof(a.id)} />)}</div>
            )}
          </section>

          <section className="space-y-1">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800"><ListChecks className="w-4 h-4 text-slate-400" />サブタスク<span className="text-xs font-normal text-slate-400">{subs.filter((s) => s.completed).length}/{subs.length}</span>
              {subs.length > 0 && <span className="ml-2 h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-emerald-500" style={{ width: `${Math.round((subs.filter((s) => s.completed).length / subs.length) * 100)}%` }} /></span>}
            </h3>
            <ul className="divide-y rounded-lg border">
              {subs.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40" data-testid="subtask-row">
                  <TaskCheck done={s.completed} onToggle={(v) => writes.update(s, { completed: v, completed_at: v ? new Date().toISOString() : null })} size={16} />
                  {s.pin && <PinBadge no={s.pin.no} done={s.completed} size={16} />}
                  <button type="button" className={`flex-1 text-left text-sm truncate ${s.completed ? "line-through text-muted-foreground" : ""}`} onClick={() => (s.pin ? setProof(s.pin.attachment_id) : onOpenTask(s.id))}>{s.name}</button>
                  <DueLabel task={s} today={new Date().toISOString().slice(0, 10)} />
                  <UserAvatar user={byId.users.get(s.assignee_id)} size={18} />
                </li>
              ))}
              {/* サブタスクの追加: 名前を入れて Enter（または「追加」）で 1 件足して閉じる。続けて入力の欄は出さない */}
              {subOpen ? (
              <li className="flex items-center gap-2 px-3 py-1.5 bg-blue-50/40">
                <TaskCheck done={false} size={16} />
                <input autoFocus value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="サブタスク名" className="flex-1 text-sm bg-transparent focus:outline-none" data-testid="subtask-input"
                  onBlur={() => { if (!newSub.trim()) setSubOpen(false); }}
                  onKeyDown={async (e) => {
                    if (e.key === "Escape") { setNewSub(""); setSubOpen(false); }
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && newSub.trim()) { e.preventDefault(); const v = newSub.trim(); setNewSub(""); setSubOpen(false); await addSubtask(v); }
                  }} />
                <button type="button" onMouseDown={(e) => e.preventDefault()} disabled={!newSub.trim()} onClick={async () => { const v = newSub.trim(); if (!v) return; setNewSub(""); setSubOpen(false); await addSubtask(v); }} className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40" data-testid="subtask-save">追加</button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setNewSub(""); setSubOpen(false); }} className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100">やめる</button>
              </li>
              ) : (
              <li>
                <button type="button" onClick={() => setSubOpen(true)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-700" data-testid="subtask-add"><Plus className="w-4 h-4" />サブタスクを追加</button>
              </li>
              )}
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800"><MessageSquare className="w-4 h-4 text-slate-400" />コメント<span className="text-xs font-normal text-slate-400">{comments.length}</span></h3>
            <ul className="space-y-3">
              {comments.map((c) => {
                const a = byId.users.get(c.author_id);
                const pinSub = c.pin_task_id ? byId.tasks.get(c.pin_task_id) : null;
                return (
                  <li key={c.id} className="flex gap-2.5" data-testid="comment-row">
                    <UserAvatar user={a} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs"><span className="font-semibold">{userLabel(a)}</span><span className="ml-2 text-muted-foreground">{fmtAt(c.created_at)}</span></p>
                      <div className="mt-0.5 text-sm whitespace-pre-wrap break-words leading-relaxed">
                        {pinSub && <PinBadge no={pinSub.pin?.no} done={pinSub.completed} size={16} className="mr-1 align-text-bottom" />}
                        {highlight(c.body, users)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <CommentComposer users={users.filter((u) => u.id !== user?.id)} onSend={sendComment} />
          </section>
        </div>
      </aside>
      {proof && (
        <ProofViewer open={!!proof} onOpenChange={(v) => !v && setProof(null)} attachments={attachments} initialId={proof} subtasks={subs} byId={byId}
          onAddPin={addPin} onToggle={(s, v) => writes.update(s, { completed: v, completed_at: v ? new Date().toISOString() : null })} />
      )}
    </>
  );
}
