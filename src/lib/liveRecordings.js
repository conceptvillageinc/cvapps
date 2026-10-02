// いま録音中の議事録（ほかのメンバーの分も含む）。
// 状態が録音中で、録音の合図（recording_heartbeat_at）が 5 分以内のものだけを「レコーディング中」と見なす。
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";

export const LIVE_WINDOW_MS = 5 * 60 * 1000;

export function isLiveRecording(m, now = Date.now()) {
  if (m?.status !== "recording" || !m.recording_heartbeat_at) return false;
  const t = new Date(m.recording_heartbeat_at).getTime();
  return Number.isFinite(t) && now - t <= LIVE_WINDOW_MS;
}

export const startedAt = (m) => {
  const raw = m.created_date || m.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) || d.getTime() < 946684800000 ? null : d; // 2000 年より前は無効扱い
};
export const fmtTime = (d) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "");
export const elapsedMin = (d, now = Date.now()) => (d ? Math.max(0, Math.round((now - d.getTime()) / 60000)) : 0);

/** 30 秒ごとに更新。 { live, isLoading } */
export function useLiveRecordings() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["meetings", "live"],
    queryFn: () => db.entities.Meeting.filter({ status: "recording" }, "-created_date", 50),
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
  const live = useMemo(() => {
    const now = Date.now();
    return data.filter((m) => isLiveRecording(m, now));
  }, [data]);
  return { live, isLoading };
}
