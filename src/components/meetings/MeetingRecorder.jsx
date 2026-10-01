import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Mic, Square, Pause, Play, Loader2, AlertTriangle, CloudUpload, Check } from "lucide-react";
import { fmtClock } from "@/lib/meetings";
import { useRecording, recordingSupported } from "@/lib/recording";

// ============================================================================
// 録音の画面。録音の実体はアプリ全体で持つ RecordingProvider（src/lib/recording.jsx）
// にあり、ここは表示と操作だけ。別の画面に移っても録音は続き、Layout の
// 「録音中」バーから戻ってこられる。
//
// props:
//   meetingId     録音先の議事録 ID（先に作っておく）
//   title         バーに出す名前
//   startSeq      すでに保存済みの断片数（続きを録るとき）
//   baseDuration  すでに録れている秒数（続きを録るとき）
//   onFinish({ totalSec })  終えたときに画面側で追加でやること（任意）
// ============================================================================

export default function MeetingRecorder({ meetingId, title = "", startSeq = 0, baseDuration = 0, onFinish }) {
  const rec = useRecording();
  const mine = rec.session?.meetingId === meetingId;
  const state = mine ? rec.state : "idle";
  const { elapsed, level, quiet, silentLong, segments, error, wakeLocked } = rec;

  if (!recordingSupported()) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        このブラウザでは録音できません。iPhone は Safari、Android は Chrome で開いてください。ボイスメモなどで録音した音声ファイルを選ぶこともできます。
      </div>
    );
  }

  // 別の議事録を録音中
  if (rec.session && !mine) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 space-y-2">
        <p className="font-semibold flex items-center gap-2"><Mic className="w-4 h-4" /> 別の議事録「{rec.session.title || "無題"}」を録音中です（{fmtClock(elapsed)}）</p>
        <p className="text-xs">そちらの録音を終えてから、こちらを録音してください。</p>
        <Link to={`/meetings/${rec.session.meetingId}`} className="inline-flex text-xs text-primary hover:underline">録音中の議事録を開く</Link>
      </div>
    );
  }

  const uploading = segments.filter((s) => s.status === "uploading").length;
  const failed = segments.filter((s) => s.status === "error").length;
  const start = () => rec.start({ meetingId, title, startSeq, baseDuration, onFinish });

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="rounded-2xl border bg-card p-6 flex flex-col items-center gap-4">
        <div className={`text-4xl font-bold tabular-nums ${state === "recording" ? "text-red-600" : "text-foreground"}`}>{fmtClock(mine ? elapsed : 0)}</div>
        <div className="w-full max-w-xs h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-red-500 transition-[width] duration-100" style={{ width: `${Math.round((mine ? level : 0) * 100)}%` }} />
        </div>
        {state === "recording" && silentLong && (
          <div className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 font-medium text-center">
            1分以上、音を拾えていません。マイクが塞がれていないか、スマホが話し手の近くにあるか確認してください
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          {state === "idle" && "赤いボタンを押すと録音が始まります"}
          {state === "recording" && (quiet ? "録音中（10秒以上、音が小さいままです。スマホを話し手に近づけてください）" : "録音中（音を拾っています）")}
          {state === "paused" && "一時停止中"}
          {state === "finishing" && "最後の録音を保存しています…"}
        </p>

        {state === "idle" && (
          <button type="button" onClick={start} aria-label="録音を始める" className="w-24 h-24 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg">
            <Mic className="w-10 h-10" />
          </button>
        )}
        {(state === "recording" || state === "paused") && (
          <div className="flex items-center gap-4">
            {state === "recording" ? (
              <Button type="button" variant="outline" size="lg" className="h-14 w-14 rounded-full p-0" onClick={rec.pause} aria-label="一時停止"><Pause className="w-6 h-6" /></Button>
            ) : (
              <Button type="button" variant="outline" size="lg" className="h-14 w-14 rounded-full p-0" onClick={rec.resume} aria-label="再開"><Play className="w-6 h-6" /></Button>
            )}
            <button type="button" onClick={rec.finish} aria-label="録音を終える" className="h-20 px-6 rounded-full bg-slate-800 hover:bg-slate-900 text-white flex items-center gap-2 font-bold shadow-lg">
              <Square className="w-5 h-5" /> 録音を終える
            </button>
          </div>
        )}
        {state === "finishing" && <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />}
      </div>

      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
        <p className="flex items-center gap-1.5"><CloudUpload className="w-3.5 h-3.5" /> 5分ごとに保存します。保存済み {(mine ? segments.filter((s) => s.status === "done").length : 0) + startSeq} 本{uploading > 0 && `・保存中 ${uploading} 本`}{failed > 0 && <span className="text-red-600">・失敗 {failed} 本</span>}</p>
        <p>{wakeLocked && mine ? <span className="inline-flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> 画面ロック防止が有効です</span> : "録音中は画面をロックしないでください（ロックすると録音が止まることがあります）"}</p>
        <p>録音中にアプリ内の別の画面へ移っても録音は続きます（画面上部の「録音中」バーから戻れます）。タブを閉じる・再読み込みすると止まります。</p>
        <p>相手には「議事録のために録音します」と一言伝えてから始めてください。</p>
      </div>
    </div>
  );
}
