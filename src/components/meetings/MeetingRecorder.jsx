import { useEffect, useRef, useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Mic, Square, Pause, Play, Loader2, AlertTriangle, CloudUpload, Check } from "lucide-react";
import { fmtClock } from "@/lib/meetings";

// ============================================================================
// アプリ内の録音。
//   - 5 分ごとに録音を区切り（MediaRecorder を止めて再開）、断片をその都度アップロードする。
//     途中で電話や電波切れがあっても、それまでの断片は残る。
//   - 画面ロック防止（Wake Lock）。
//   - 一時停止・再開、経過時間、音量の目安。
// 断片は uploads バケットの meetings/<meetingId>/seg-<seq>.<ext> に保存し、
// meeting_segments に 1 行ずつ記録する。
// ============================================================================

const SEGMENT_SEC = 5 * 60;

function pickMime() {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  return "";
}
const extOf = (mime) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

/**
 * props:
 *   meetingId      録音先の議事録 ID（先に作っておく）
 *   startSeq       すでに保存済みの断片数（再開時）
 *   onSegment(seg) 断片を保存したとき
 *   onFinish({ totalSec, segments })  「録音を終える」を押して最後の断片を保存したとき
 */
export default function MeetingRecorder({ meetingId, startSeq = 0, onSegment, onFinish }) {
  const [state, setState] = useState("idle"); // idle | recording | paused | finishing
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [quiet, setQuiet] = useState(false); // 10 秒以上ずっと小さい音のときだけ true（会話の間で点滅させない）
  const [silentLong, setSilentLong] = useState(false); // 60 秒以上音が無い（マイクが塞がれている・離れすぎ等）
  const lastLoudRef = useRef(Date.now());
  const buzzedRef = useRef(false);
  const [segments, setSegments] = useState([]); // { seq, status: uploading|done|error, sec }
  const [error, setError] = useState(null);
  const [wakeLocked, setWakeLocked] = useState(false);

  const streamRef = useRef(null);
  const recRef = useRef(null);
  const seqRef = useRef(startSeq);
  const segStartRef = useRef(0); // この断片の開始時点の elapsed
  const elapsedRef = useRef(0);
  const tickRef = useRef(null);
  const lastTickRef = useRef(0);
  const mimeRef = useRef("");
  const finishingRef = useRef(false);
  const wakeRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const uploadsRef = useRef([]);

  const supported = typeof window !== "undefined" && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanup = () => {
    clearInterval(tickRef.current);
    cancelAnimationFrame(rafRef.current);
    try { recRef.current?.state !== "inactive" && recRef.current?.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wakeRef.current?.release?.().catch(() => {});
  };

  const requestWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeRef.current = await navigator.wakeLock.request("screen");
        setWakeLocked(true);
        wakeRef.current.addEventListener("release", () => setWakeLocked(false));
      }
    } catch { setWakeLocked(false); }
  };

  // 再表示されたら画面ロック防止を取り直す
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && (state === "recording" || state === "paused")) requestWakeLock(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [state]);

  const startTicker = () => {
    lastTickRef.current = Date.now();
    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const now = Date.now();
      elapsedRef.current += (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setElapsed(elapsedRef.current);
      // 5 分ごとに区切る
      if (elapsedRef.current - segStartRef.current >= SEGMENT_SEC && recRef.current?.state === "recording") rotate();
    }, 500);
  };

  const meter = () => {
    const a = analyserRef.current;
    if (!a) return;
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
    const lv = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    setLevel(lv);
    const now = Date.now();
    if (lv > 0.02) lastLoudRef.current = now;
    const isQuiet = now - lastLoudRef.current > 10000;
    setQuiet((prev) => (prev === isQuiet ? prev : isQuiet));
    const isLong = now - lastLoudRef.current > 60000;
    setSilentLong((prev) => (prev === isLong ? prev : isLong));
    if (isLong && !buzzedRef.current) {
      buzzedRef.current = true;
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* 対応していない端末 */ }
    }
    if (!isLong) buzzedRef.current = false;
    rafRef.current = requestAnimationFrame(meter);
  };

  /** 断片 1 本分の MediaRecorder を作って開始する */
  const startRecorder = () => {
    const rec = new MediaRecorder(streamRef.current, mimeRef.current ? { mimeType: mimeRef.current, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
    const chunks = [];
    const seq = seqRef.current;
    const from = segStartRef.current;
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      const sec = Math.max(0, elapsedRef.current - from);
      const blob = new Blob(chunks, { type: rec.mimeType || mimeRef.current || "audio/webm" });
      if (blob.size > 0) uploadsRef.current.push(upload(seq, blob, sec));
      if (finishingRef.current) finalize();
    };
    rec.start(1000);
    recRef.current = rec;
    seqRef.current = seq + 1;
  };

  const rotate = () => {
    // 今の断片を止めて（onstop でアップロード）、次の断片を始める
    segStartRef.current = elapsedRef.current;
    const prev = recRef.current;
    startRecorder();
    try { prev.stop(); } catch { /* noop */ }
  };

  const upload = async (seq, blob, sec) => {
    setSegments((s) => [...s, { seq, status: "uploading", sec }]);
    const ext = extOf(blob.type || mimeRef.current);
    const path = `meetings/${meetingId}/seg-${String(seq).padStart(3, "0")}.${ext}`;
    const file = new File([blob], `seg-${seq}.${ext}`, { type: blob.type || "audio/webm" });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await db.integrations.Core.UploadFile({ file, path });
        const row = await db.entities.MeetingSegment.create({ meeting_id: meetingId, seq, storage_path: path, mime_type: file.type, duration_sec: Math.round(sec * 10) / 10, size: blob.size });
        setSegments((s) => s.map((x) => (x.seq === seq ? { ...x, status: "done" } : x)));
        onSegment?.(row);
        return;
      } catch (err) {
        if (attempt === 2) {
          setSegments((s) => s.map((x) => (x.seq === seq ? { ...x, status: "error", message: err.message } : x)));
          setError(`断片 ${seq + 1} の保存に失敗しました: ${err.message}`);
        } else {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      mimeRef.current = pickMime();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analyserRef.current = an;
      lastLoudRef.current = Date.now();
      rafRef.current = requestAnimationFrame(meter);
      segStartRef.current = elapsedRef.current;
      startRecorder();
      startTicker();
      await requestWakeLock();
      setState("recording");
    } catch (err) {
      setError(err.name === "NotAllowedError" ? "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください" : `録音を始められませんでした: ${err.message}`);
    }
  };

  const pause = () => {
    try { recRef.current?.pause(); } catch { /* noop */ }
    clearInterval(tickRef.current);
    setState("paused");
  };
  const resume = () => {
    try { recRef.current?.resume(); } catch { /* noop */ }
    startTicker();
    setState("recording");
  };

  const finish = () => {
    finishingRef.current = true;
    setState("finishing");
    clearInterval(tickRef.current);
    try {
      if (recRef.current?.state === "paused") recRef.current.resume();
      recRef.current?.stop();
    } catch { finalize(); }
  };

  const finalize = async () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wakeRef.current?.release?.().catch(() => {});
    await Promise.all(uploadsRef.current);
    onFinish?.({ totalSec: elapsedRef.current });
  };

  if (!supported) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        このブラウザでは録音できません。iPhone は Safari、Android は Chrome で開いてください。ボイスメモなどで録音した音声ファイルを選ぶこともできます。
      </div>
    );
  }

  const uploading = segments.filter((s) => s.status === "uploading").length;
  const failed = segments.filter((s) => s.status === "error").length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="rounded-2xl border bg-card p-6 flex flex-col items-center gap-4">
        <div className={`text-4xl font-bold tabular-nums ${state === "recording" ? "text-red-600" : "text-foreground"}`}>{fmtClock(elapsed)}</div>
        <div className="w-full max-w-xs h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-red-500 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
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
              <Button type="button" variant="outline" size="lg" className="h-14 w-14 rounded-full p-0" onClick={pause} aria-label="一時停止"><Pause className="w-6 h-6" /></Button>
            ) : (
              <Button type="button" variant="outline" size="lg" className="h-14 w-14 rounded-full p-0" onClick={resume} aria-label="再開"><Play className="w-6 h-6" /></Button>
            )}
            <button type="button" onClick={finish} aria-label="録音を終える" className="h-20 px-6 rounded-full bg-slate-800 hover:bg-slate-900 text-white flex items-center gap-2 font-bold shadow-lg">
              <Square className="w-5 h-5" /> 録音を終える
            </button>
          </div>
        )}
        {state === "finishing" && <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />}
      </div>

      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
        <p className="flex items-center gap-1.5"><CloudUpload className="w-3.5 h-3.5" /> 5分ごとに保存します。保存済み {segments.filter((s) => s.status === "done").length + startSeq} 本{uploading > 0 && `・保存中 ${uploading} 本`}{failed > 0 && <span className="text-red-600">・失敗 {failed} 本</span>}</p>
        <p>{wakeLocked ? <span className="inline-flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> 画面ロック防止が有効です</span> : "録音中は画面をロックせず、このタブを開いたままにしてください（ロックすると録音が止まることがあります）"}</p>
        <p>相手には「議事録のために録音します」と一言伝えてから始めてください。</p>
      </div>
    </div>
  );
}
