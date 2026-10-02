import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { toast } from "sonner";

// ============================================================================
// 議事録の録音をアプリ全体で持つ。
//   録音の実体（マイク・MediaRecorder・断片のアップロード）はここにあり、画面を
//   移っても止まらない。議事録の画面は useRecording() で状態と操作を受け取って
//   表示するだけ。別の画面にいる間は Layout の「録音中」バーに出る。
//   - 5 分ごとに録音を区切り、断片をその都度アップロードする
//   - 画面ロック防止（Wake Lock）
//   - 「録音を終える」で最後の断片を保存し、議事録を「処理待ち（uploaded）」にして
//     その議事録の画面へ移る
// ============================================================================

const SEGMENT_SEC = 5 * 60;

function pickMime() {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  return "";
}
const extOf = (mime) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

export const recordingSupported = () => typeof window !== "undefined" && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;

const Ctx = createContext(null);

export function RecordingProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  const queryClient = useQueryClient();

  // 画面に出す状態
  const [session, setSession] = useState(null); // { meetingId, title, startSeq, baseDuration } | null
  const [state, setState] = useState("idle"); // idle | recording | paused | finishing
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [silentLong, setSilentLong] = useState(false);
  const [segments, setSegments] = useState([]); // { seq, status: uploading|done|error, sec }
  const [error, setError] = useState(null);
  const [wakeLocked, setWakeLocked] = useState(false);

  // 録音の実体
  const sessionRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const seqRef = useRef(0);
  const segStartRef = useRef(0);
  const elapsedRef = useRef(0);
  const tickRef = useRef(null);
  const lastTickRef = useRef(0);
  const mimeRef = useRef("");
  const finishingRef = useRef(false);
  const wakeRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const uploadsRef = useRef([]);
  const lastLoudRef = useRef(Date.now());
  const buzzedRef = useRef(false);
  const onFinishRef = useRef(null);
  const stateRef = useRef("idle");
  const heartbeatRef = useRef(null);

  // 録音中の合図: 1 分ごとに meetings.recording_heartbeat_at を更新する（一覧の「レコーディング中」の帯に使う）
  const beat = async () => {
    const id = sessionRef.current?.meetingId;
    if (!id) return;
    try { await db.entities.Meeting.update(id, { recording_heartbeat_at: new Date().toISOString() }); } catch { /* 合図が送れなくても録音は続ける */ }
  };
  const startHeartbeat = () => { clearInterval(heartbeatRef.current); beat(); heartbeatRef.current = setInterval(beat, 60 * 1000); };
  const stopHeartbeat = () => { clearInterval(heartbeatRef.current); heartbeatRef.current = null; };
  const setStateBoth = (s) => { stateRef.current = s; setState(s); };

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeRef.current = await navigator.wakeLock.request("screen");
        setWakeLocked(true);
        wakeRef.current.addEventListener("release", () => setWakeLocked(false));
      }
    } catch { setWakeLocked(false); }
  }, []);

  // タブに戻ってきたら画面ロック防止を取り直す
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && (stateRef.current === "recording" || stateRef.current === "paused")) requestWakeLock(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [requestWakeLock]);

  // 録音中はタブを閉じる・再読み込みの前に確認を出す
  useEffect(() => {
    const onUnload = (e) => {
      if (stateRef.current === "recording" || stateRef.current === "paused" || stateRef.current === "finishing") { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const startTicker = () => {
    lastTickRef.current = Date.now();
    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const now = Date.now();
      elapsedRef.current += (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setElapsed(elapsedRef.current);
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

  const upload = async (seq, blob, sec) => {
    const meetingId = sessionRef.current?.meetingId;
    setSegments((s) => [...s, { seq, status: "uploading", sec }]);
    const ext = extOf(blob.type || mimeRef.current);
    const path = `meetings/${meetingId}/seg-${String(seq).padStart(3, "0")}.${ext}`;
    const file = new File([blob], `seg-${seq}.${ext}`, { type: blob.type || "audio/webm" });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await db.integrations.Core.UploadFile({ file, path });
        await db.entities.MeetingSegment.create({ meeting_id: meetingId, seq, storage_path: path, mime_type: file.type, duration_sec: Math.round(sec * 10) / 10, size: blob.size });
        setSegments((s) => s.map((x) => (x.seq === seq ? { ...x, status: "done" } : x)));
        queryClient.invalidateQueries({ queryKey: ["meetingSegments", meetingId] });
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
    segStartRef.current = elapsedRef.current;
    const prev = recRef.current;
    startRecorder();
    try { prev.stop(); } catch { /* noop */ }
  };

  const releaseHardware = () => {
    clearInterval(tickRef.current);
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch { /* noop */ }
    ctxRef.current = null;
    analyserRef.current = null;
    wakeRef.current?.release?.().catch(() => {});
    wakeRef.current = null;
  };

  /**
   * 録音を始める。
   *   meetingId     録音先の議事録（先に作っておく）
   *   title         バーに出す名前
   *   startSeq      すでに保存済みの断片数（続きを録るとき）
   *   baseDuration  すでに録れている秒数（続きを録るとき）
   *   onFinish      終えたときに画面側で追加でやること（任意）
   */
  const start = useCallback(async ({ meetingId, title = "", startSeq = 0, baseDuration = 0, onFinish = null }) => {
    if (sessionRef.current) { toast.error("別の議事録を録音中です。先にそちらを終えてください"); return false; }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      sessionRef.current = { meetingId, title, startSeq, baseDuration };
      setSession(sessionRef.current);
      onFinishRef.current = onFinish;
      streamRef.current = stream;
      mimeRef.current = pickMime();
      seqRef.current = startSeq;
      elapsedRef.current = 0;
      setElapsed(0);
      setSegments([]);
      uploadsRef.current = [];
      finishingRef.current = false;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analyserRef.current = an;
      lastLoudRef.current = Date.now();
      rafRef.current = requestAnimationFrame(meter);
      segStartRef.current = 0;
      startRecorder();
      startTicker();
      await requestWakeLock();
      setStateBoth("recording");
      startHeartbeat();
      return true;
    } catch (err) {
      sessionRef.current = null;
      setSession(null);
      setError(err.name === "NotAllowedError" ? "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください" : `録音を始められませんでした: ${err.message}`);
      return false;
    }
  }, [requestWakeLock]); // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => {
    try { recRef.current?.pause(); } catch { /* noop */ }
    clearInterval(tickRef.current);
    setStateBoth("paused");
  }, []);

  const resume = useCallback(() => {
    try { recRef.current?.resume(); } catch { /* noop */ }
    startTicker();
    setStateBoth("recording");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(() => {
    if (!sessionRef.current || finishingRef.current) return;
    finishingRef.current = true;
    setStateBoth("finishing");
    clearInterval(tickRef.current);
    try {
      if (recRef.current?.state === "paused") recRef.current.resume();
      recRef.current?.stop();
    } catch { finalize(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finalize = async () => {
    const s = sessionRef.current;
    releaseHardware();
    await Promise.all(uploadsRef.current);
    const totalSec = elapsedRef.current;
    stopHeartbeat();
    try {
      await db.entities.Meeting.update(s.meetingId, { status: "uploaded", audio_duration_sec: Math.round((Number(s.baseDuration) || 0) + totalSec), recording_heartbeat_at: null });
    } catch (err) {
      toast.error("録音の保存に失敗しました: " + err.message);
    }
    queryClient.invalidateQueries({ queryKey: ["meetings"] });
    queryClient.invalidateQueries({ queryKey: ["meeting", s.meetingId] });
    queryClient.invalidateQueries({ queryKey: ["meetingSegments", s.meetingId] });
    try { await onFinishRef.current?.({ totalSec }); } catch { /* 画面側の後処理の失敗は録音の結果に影響しない */ }
    sessionRef.current = null;
    onFinishRef.current = null;
    setSession(null);
    setStateBoth("idle");
    setElapsed(0);
    setLevel(0);
    // 議事録の画面に移って処理を始める（その画面にいればそのまま）
    const target = `/meetings/${s.meetingId}`;
    if (locationRef.current.pathname !== target) navigate(target);
  };

  const value = useMemo(() => ({
    session, state, elapsed, level, quiet, silentLong, segments, error, wakeLocked,
    start, pause, resume, finish, clearError: () => setError(null),
  }), [session, state, elapsed, level, quiet, silentLong, segments, error, wakeLocked, start, pause, resume, finish]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecording() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRecording は RecordingProvider の中で使ってください");
  return v;
}
