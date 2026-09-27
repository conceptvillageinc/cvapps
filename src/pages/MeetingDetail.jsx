import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useMeetingSettings, MEETING_STATUS, PROCESSING, fmtClock, meetingToText } from "@/lib/meetings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, CheckCircle2, Copy, Trash2, RefreshCw, Search, Play, Plus, X, AlertTriangle, Mic, Save } from "lucide-react";
import { toast } from "sonner";
import MeetingRecorder from "@/components/meetings/MeetingRecorder";

const CHECK_STYLE = {
  confirmed: { label: "確認済み", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  unconfirmed: { label: "未確認", cls: "border-red-200 bg-red-50 text-red-800" },
  n_a: { label: "該当なし", cls: "border-border bg-muted/30 text-muted-foreground" },
};

/** 議事録の詳細（編集・確定・文字起こし・音声） */
export default function MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { typeLabel } = useMeetingSettings();
  const audioRef = useRef(null);
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState(null); // 編集中の議事録
  const [checkpoints, setCheckpoints] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [segmentUrls, setSegmentUrls] = useState([]);
  const [resumeRecording, setResumeRecording] = useState(false);

  const { data: meeting, isLoading } = useQuery({
    queryKey: ["meeting", id],
    queryFn: () => db.entities.Meeting.get(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && PROCESSING.has(q.state.data.status) ? 5000 : false),
  });
  const { data: segments = [] } = useQuery({
    queryKey: ["meetingSegments", id],
    queryFn: () => db.entities.MeetingSegment.filter({ meeting_id: id }, "seq"),
    enabled: !!id,
  });

  useEffect(() => {
    if (!meeting || dirty) return;
    setSummary(meeting.summary || { overview: "", decisions: [], todos: [], open_items: [], notes: "" });
    setCheckpoints(meeting.checkpoints || []);
  }, [meeting, dirty]);

  // 音声（署名付きURL）
  useEffect(() => {
    let alive = true;
    if (meeting?.audio_path) db.storage.signedUrl(meeting.audio_path, 3600).then((u) => alive && setAudioUrl(u)).catch(() => {});
    else setAudioUrl(null);
    return () => { alive = false; };
  }, [meeting?.audio_path]);
  useEffect(() => {
    let alive = true;
    Promise.all(segments.filter((s) => s.storage_path).map((s) => db.storage.signedUrl(s.storage_path, 3600).then((u) => ({ seq: s.seq, url: u, duration: Number(s.duration_sec) || 0 })).catch(() => null)))
      .then((list) => alive && setSegmentUrls(list.filter(Boolean)));
    return () => { alive = false; };
  }, [segments]);

  // 処理の続きを回す（処理中なら done になるまで呼ぶ）
  const runProcessing = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      for (let i = 0; i < 20; i++) {
        const { data } = await db.functions.invoke("meetingProcess", { meeting_id: id });
        queryClient.invalidateQueries({ queryKey: ["meeting", id] });
        if (data.done) break;
      }
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    } catch (err) {
      toast.error("処理に失敗しました: " + err.message);
      queryClient.invalidateQueries({ queryKey: ["meeting", id] });
    } finally {
      setProcessing(false);
    }
  };
  useEffect(() => {
    if (meeting && PROCESSING.has(meeting.status) && !processing) runProcessing();
  }, [meeting?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (patch) => db.entities.Meeting.update(id, patch),
    onSuccess: () => { setDirty(false); queryClient.invalidateQueries({ queryKey: ["meeting", id] }); queryClient.invalidateQueries({ queryKey: ["meetings"] }); },
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });
  const saveSummary = (extra = {}) => save.mutate({ summary, checkpoints, ...extra }, { onSuccess: () => toast.success(extra.status === "finalized" ? "確定しました" : "保存しました") });

  const remove = useMutation({
    mutationFn: async () => {
      const paths = [meeting.audio_path, ...segments.map((s) => s.storage_path)].filter(Boolean);
      await db.entities.Meeting.delete(id);
      // 音声は消せる範囲で消す（失敗しても議事録の削除は成立）
      await db.storage.remove(paths).catch(() => {});
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["meetings"] }); toast.success("削除しました"); navigate("/meetings"); },
    onError: (e) => toast.error("削除できませんでした: " + e.message),
  });

  const upd = (patch) => { setSummary((s) => ({ ...s, ...patch })); setDirty(true); };
  const updList = (key, idx, value) => upd({ [key]: summary[key].map((x, i) => (i === idx ? value : x)) });
  const addTo = (key, value) => upd({ [key]: [...(summary[key] || []), value] });
  const removeFrom = (key, idx) => upd({ [key]: summary[key].filter((_, i) => i !== idx) });
  const setCheck = (key, status) => { setCheckpoints((c) => c.map((x) => (x.key === key ? { ...x, status } : x))); setDirty(true); };

  const transcript = useMemo(() => (meeting?.transcript || meeting?.transcript_raw || []), [meeting]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? transcript.filter((t) => t.text.toLowerCase().includes(q)) : transcript;
  }, [transcript, search]);

  // 指定秒から再生（断片録音は該当する断片に切り替える）
  const playAt = (sec) => {
    const a = audioRef.current;
    if (!a) return;
    if (audioUrl) { a.src = audioUrl; a.currentTime = Math.max(0, sec - 3); a.play(); return; }
    let offset = 0;
    for (const s of segmentUrls) {
      if (sec < offset + s.duration || s === segmentUrls[segmentUrls.length - 1]) { a.src = s.url; a.currentTime = Math.max(0, sec - offset - 3); a.play(); return; }
      offset += s.duration;
    }
  };

  const copyText = async () => {
    try { await navigator.clipboard.writeText(meetingToText({ ...meeting, summary }, typeLabel)); toast.success("議事録をコピーしました"); } catch { toast.error("コピーできませんでした"); }
  };

  if (isLoading || !meeting || !summary) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const st = MEETING_STATUS[meeting.status] || MEETING_STATUS.draft;
  const isProcessing = PROCESSING.has(meeting.status);
  const progress = meeting.progress || {};

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/meetings")} className="shrink-0"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight truncate">{meeting.title || "（件名なし）"}</h1>
            <Badge className={`text-[10px] ${st.color} hover:${st.color}`}>{st.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            <span>{meeting.held_at ? String(meeting.held_at).replace(/-/g, "/") : ""}</span>
            <span>{typeLabel(meeting.meeting_type)}</span>
            {meeting.client_name && (meeting.client_id ? <Link to={`/clients/${meeting.client_id}`} className="text-primary hover:underline">{meeting.client_name}</Link> : <span>{meeting.client_name}</span>)}
            {meeting.project_id && <Link to={`/projects/${meeting.project_id}`} className="text-primary hover:underline">案件</Link>}
            {(meeting.participants || []).length > 0 && <span>出席: {meeting.participants.join("、")}</span>}
            {meeting.audio_duration_sec > 0 && <span>{fmtClock(meeting.audio_duration_sec)}</span>}
            {meeting.created_by && <span>作成 {meeting.created_by}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={copyText}><Copy className="w-3.5 h-3.5" /> コピー</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="outline" size="sm" className="text-xs gap-1 text-destructive hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /> 削除</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>議事録を削除しますか？</AlertDialogTitle><AlertDialogDescription>音声・文字起こし・議事録をすべて削除します。取り消せません。</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => remove.mutate()}>削除する</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* 録音が途中で終わっている（続きを録る／このまま処理する） */}
      {meeting.status === "recording" && (
        <Card className="border-red-200">
          <CardContent className="pt-4 space-y-3">
            {resumeRecording ? (
              <MeetingRecorder meetingId={meeting.id} startSeq={segments.length} onFinish={async ({ totalSec }) => { await db.entities.Meeting.update(id, { status: "uploaded", audio_duration_sec: Math.round((Number(meeting.audio_duration_sec) || 0) + totalSec) }); setResumeRecording(false); queryClient.invalidateQueries({ queryKey: ["meeting", id] }); }} />
            ) : (
              <>
                <p className="text-sm font-semibold flex items-center gap-2"><Mic className="w-4 h-4 text-red-600" /> 録音が途中で終わっています</p>
                <p className="text-xs text-muted-foreground">保存済みの断片: {segments.length} 本（約 {fmtClock(segments.reduce((s, x) => s + (Number(x.duration_sec) || 0), 0))}）。続きを録るか、このまま議事録を作れます。</p>
                <div className="flex gap-2">
                  <Button className="bg-red-600 hover:bg-red-700 gap-1.5" onClick={() => setResumeRecording(true)}><Mic className="w-4 h-4" /> 続きを録る</Button>
                  <Button variant="outline" onClick={async () => { if (segments.length === 0) { toast.error("保存済みの録音がありません"); return; } await db.entities.Meeting.update(id, { status: "uploaded" }); queryClient.invalidateQueries({ queryKey: ["meeting", id] }); }} disabled={segments.length === 0}>このまま議事録を作る</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isProcessing && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="pt-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">{st.label}…</p>
              <p className="text-xs text-muted-foreground">
                {progress.phase === "transcribing" && progress.total ? `文字起こし ${progress.finished || 0} / ${progress.total} 本` : "数分かかります。この画面を閉じても、次に開いたときに続きから進みます"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {meeting.status === "error" && (
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="pt-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <p className="font-semibold">処理に失敗しました</p>
              <p className="text-xs text-muted-foreground">{meeting.error_message}</p>
            </div>
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={async () => { await db.entities.Meeting.update(id, { status: "uploaded", error_message: null }); queryClient.invalidateQueries({ queryKey: ["meeting", id] }); }}><RefreshCw className="w-3.5 h-3.5" /> もう一度処理する</Button>
          </CardContent>
        </Card>
      )}

      {(meeting.status === "draft" || meeting.status === "finalized") && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4">
          {/* 議事録（編集） */}
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">議事録</p>
                  <div className="flex items-center gap-1.5">
                    {dirty && <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => saveSummary()} disabled={save.isPending}><Save className="w-3.5 h-3.5" /> 保存</Button>}
                    {meeting.status === "draft" ? (
                      <Button size="sm" className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => saveSummary({ status: "finalized", finalized_at: new Date().toISOString() })} disabled={save.isPending}><CheckCircle2 className="w-3.5 h-3.5" /> 確定</Button>
                    ) : (
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => save.mutate({ status: "draft", finalized_at: null })}>下書きに戻す</Button>
                    )}
                  </div>
                </div>

                <Section title="概要">
                  <Textarea value={summary.overview || ""} onChange={(e) => upd({ overview: e.target.value })} rows={4} className="text-sm" />
                </Section>

                <Section title="決定事項" onAdd={() => addTo("decisions", "")}>
                  {(summary.decisions || []).map((d, i) => (
                    <Row key={i} onRemove={() => removeFrom("decisions", i)}><Input value={d} onChange={(e) => updList("decisions", i, e.target.value)} className="h-9 text-sm" /></Row>
                  ))}
                </Section>

                <Section title="ToDo" onAdd={() => addTo("todos", { text: "", owner: "", due: "", side: "unknown", done: false })}>
                  {(summary.todos || []).map((t, i) => (
                    <Row key={i} onRemove={() => removeFrom("todos", i)}>
                      <div className="flex-1 grid grid-cols-[auto_minmax(0,1fr)_110px_120px] gap-1.5 items-center">
                        <input type="checkbox" checked={!!t.done} onChange={(e) => updList("todos", i, { ...t, done: e.target.checked })} className="w-4 h-4" />
                        <Input value={t.text} onChange={(e) => updList("todos", i, { ...t, text: e.target.value })} className={`h-9 text-sm ${t.done ? "line-through text-muted-foreground" : ""}`} placeholder="内容" />
                        <Input value={t.owner || ""} onChange={(e) => updList("todos", i, { ...t, owner: e.target.value })} className="h-9 text-xs" placeholder="担当" />
                        <Input value={t.due || ""} onChange={(e) => updList("todos", i, { ...t, due: e.target.value })} className="h-9 text-xs" placeholder="期限" />
                      </div>
                    </Row>
                  ))}
                </Section>

                <Section title="保留・次回までの確認事項" onAdd={() => addTo("open_items", "")}>
                  {(summary.open_items || []).map((o, i) => (
                    <Row key={i} onRemove={() => removeFrom("open_items", i)}><Input value={o} onChange={(e) => updList("open_items", i, e.target.value)} className="h-9 text-sm" /></Row>
                  ))}
                </Section>

                <Section title="補足メモ">
                  <Textarea value={summary.notes || ""} onChange={(e) => upd({ notes: e.target.value })} rows={4} className="text-sm" placeholder="部数・サイズ・納期・予算など、見積に関わる数字" />
                </Section>
              </CardContent>
            </Card>

            {/* 文字起こし */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold">文字起こし <span className="text-xs font-normal text-muted-foreground">{transcript.length} 発話</span></p>
                  <div className="relative w-56">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="文字起こしを検索" className="h-8 pl-8 text-xs" />
                  </div>
                </div>
                {(audioUrl || segmentUrls.length > 0) ? (
                  <audio ref={audioRef} controls className="w-full h-9" src={audioUrl || segmentUrls[0]?.url} />
                ) : meeting.audio_deleted_at ? (
                  <p className="text-[11px] text-muted-foreground">音声は保存期限を過ぎたため削除されています（文字起こしと議事録は残っています）</p>
                ) : null}
                {(summary.speakers || []).some((s) => s.guess) && (
                  <p className="text-[11px] text-muted-foreground">話者の推定: {summary.speakers.filter((s) => s.guess).map((s) => `${s.label}＝${s.guess}`).join("、")}</p>
                )}
                <div className="max-h-[420px] overflow-y-auto divide-y text-sm">
                  {filtered.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">{search ? "該当なし" : "文字起こしがありません"}</p>}
                  {filtered.map((t, i) => (
                    <div key={i} className="py-1.5 flex gap-2">
                      <button type="button" onClick={() => playAt(t.start)} className="shrink-0 text-[11px] text-primary tabular-nums hover:underline inline-flex items-center gap-0.5 w-14" title="ここから再生"><Play className="w-3 h-3" /> {fmtClock(t.start)}</button>
                      <span className="shrink-0 text-[11px] text-muted-foreground w-14 truncate">{t.speaker}</span>
                      <span className="flex-1 leading-relaxed">{t.text}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 確認事項・指標 */}
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-4 space-y-2">
                <p className="text-sm font-bold">確認事項（{typeLabel(meeting.meeting_type)}）</p>
                {checkpoints.length === 0 ? (
                  <p className="text-xs text-muted-foreground">この種類には確認すべき項目が設定されていません（システム設定で追加できます）</p>
                ) : checkpoints.map((c) => {
                  const s = CHECK_STYLE[c.status] || CHECK_STYLE.unconfirmed;
                  return (
                    <div key={c.key} className={`rounded-md border px-2.5 py-2 ${s.cls}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{c.label}</span>
                        <select value={c.status} onChange={(e) => setCheck(c.key, e.target.value)} className="h-6 rounded border bg-background px-1 text-[10px] text-foreground">
                          <option value="confirmed">確認済み</option><option value="unconfirmed">未確認</option><option value="n_a">該当なし</option>
                        </select>
                      </div>
                      {c.evidence && <p className="text-[10px] mt-1 opacity-80 line-clamp-2">「{c.evidence}」</p>}
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground">未確認の項目は「保留・次回までの確認事項」に入っています</p>
              </CardContent>
            </Card>

            {meeting.analysis && (
              <Card>
                <CardContent className="pt-4 space-y-1.5 text-[11px]">
                  <p className="text-sm font-bold">この打ち合わせの指標</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                    <span>所要時間</span><span className="text-foreground tabular-nums">{fmtClock(meeting.analysis.duration_sec)}</span>
                    <span>発話数</span><span className="text-foreground tabular-nums">{meeting.analysis.utterances}</span>
                    <span>質問の数</span><span className="text-foreground tabular-nums">{meeting.analysis.question_count}</span>
                    <span>決定事項</span><span className="text-foreground tabular-nums">{meeting.analysis.decision_count}</span>
                    <span>ToDo（担当未定）</span><span className="text-foreground tabular-nums">{meeting.analysis.todo_count}（{meeting.analysis.unassigned_todos}）</span>
                    <span>未確認の項目</span><span className="text-foreground tabular-nums">{meeting.analysis.checkpoints_unconfirmed} / {meeting.analysis.checkpoints_total}</span>
                  </div>
                  {meeting.analysis.talk_ratio && (
                    <div className="pt-1">
                      <p className="text-muted-foreground mb-1">発話の比率</p>
                      {Object.entries(meeting.analysis.talk_ratio).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 mb-0.5"><span className="w-16 truncate">{k}</span><div className="flex-1 h-1.5 bg-muted rounded"><div className="h-full bg-primary/60 rounded" style={{ width: `${v}%` }} /></div><span className="w-8 text-right tabular-nums">{v}%</span></div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground pt-1">件数が溜まったら、種類ごとの傾向や確認漏れの多い項目を分析します</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="pt-4 space-y-1 text-[11px] text-muted-foreground">
                <p className="text-sm font-bold text-foreground">音声の保存</p>
                <p>{meeting.audio_deleted_at ? "音声は削除済みです" : meeting.retention_until ? `${String(meeting.retention_until).replace(/-/g, "/")} まで保存し、以降は音声だけ削除します` : "処理が終わると保存期限が付きます"}</p>
                <p>録音の断片: {segments.length} 本</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, onAdd, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">{title}</p>
        {onAdd && <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px] gap-1 px-2" onClick={onAdd}><Plus className="w-3 h-3" /> 追加</Button>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ children, onRemove }) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="削除"><X className="w-3.5 h-3.5" /></Button>
    </div>
  );
}
