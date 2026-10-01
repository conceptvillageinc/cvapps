import { Link, useLocation } from "react-router-dom";
import { Mic, Pause, Play, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtClock } from "@/lib/meetings";
import { useRecording } from "@/lib/recording";

/** 録音中に議事録以外の画面へ移ったとき、画面上部に出るバー（録音は続いている） */
export default function RecordingBar() {
  const rec = useRecording();
  const location = useLocation();
  if (!rec.session) return null;
  const target = `/meetings/${rec.session.meetingId}`;
  if (location.pathname === target) return null; // その議事録の画面では本体の録音欄がある
  const recording = rec.state === "recording";
  return (
    <div className="shrink-0 bg-red-600 text-white px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" role="status" aria-live="polite">
      <span className="inline-flex items-center gap-2 font-semibold">
        <span className={`inline-block w-2.5 h-2.5 rounded-full bg-white ${recording ? "animate-pulse" : "opacity-50"}`} />
        <Mic className="w-4 h-4" /> {rec.state === "finishing" ? "録音を保存中…" : recording ? "レコーディング中" : "一時停止中"}
        <span className="tabular-nums">{fmtClock(rec.elapsed)}</span>
      </span>
      <span className="truncate max-w-[40vw] text-white/90">{rec.session.title || "議事録"}</span>
      <span className="text-[11px] text-white/80">別の画面にいても録音は続いています</span>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5">
        {rec.state === "finishing" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            {recording ? (
              <Button type="button" size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={rec.pause}><Pause className="w-3.5 h-3.5" /> 一時停止</Button>
            ) : (
              <Button type="button" size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={rec.resume}><Play className="w-3.5 h-3.5" /> 再開</Button>
            )}
            <Button type="button" size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={rec.finish}><Square className="w-3.5 h-3.5" /> 録音を終える</Button>
          </>
        )}
        <Link to={target} className="inline-flex items-center h-7 px-2.5 rounded-md bg-white/15 hover:bg-white/25 text-xs font-medium">議事録に戻る</Link>
      </div>
    </div>
  );
}
