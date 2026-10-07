// 議事録の共通定義
import { useMemo } from "react";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { formatOverview, formatNotes } from "@/lib/meetingText";

export const DEFAULT_MEETING_TYPES = [
  { key: "first", label: "初回ヒアリング" },
  { key: "spec", label: "仕様確認" },
  { key: "proof", label: "校正・納品" },
  { key: "regular", label: "定例" },
  { key: "other", label: "その他" },
];

/** 社内の打ち合わせ（クライアントなし）を表す名前 */
export const INTERNAL_CLIENT = "CV自社";

export const MEETING_STATUS = {
  recording: { label: "レコーディング中", color: "bg-red-100 text-red-700" },
  uploaded: { label: "処理待ち", color: "bg-muted text-muted-foreground" },
  transcribing: { label: "文字起こし中", color: "bg-blue-100 text-blue-700" },
  summarizing: { label: "議事録を作成中", color: "bg-blue-100 text-blue-700" },
  draft: { label: "下書き", color: "bg-amber-100 text-amber-700" },
  finalized: { label: "確定", color: "bg-emerald-100 text-emerald-700" },
  error: { label: "エラー", color: "bg-red-100 text-red-700" },
};

export const PROCESSING = new Set(["uploaded", "transcribing", "summarizing"]);

/**
 * 録音の止め忘れ対策（システム設定 meeting_recording_limits）
 *   idle_min     無音がこの分数続いたら「録音を続けますか？」を出す
 *   confirm_min  確認を出してから、この分数応答が無ければ自動で録音を終える
 *   max_hours    録音時間の上限（達したら同じ確認を出す。「続ける」で 1 時間延ばす）
 */
export const DEFAULT_RECORDING_LIMITS = { idle_min: 10, confirm_min: 2, max_hours: 3 };
export function recordingLimits(settings) {
  const row = (settings || []).find((s) => s.setting_key === "meeting_recording_limits");
  let v = {};
  try { v = row ? JSON.parse(row.setting_value) || {} : {}; } catch { v = {}; }
  const pos = (x, d) => (Number(x) > 0 ? Number(x) : d);
  return {
    idle_min: pos(v.idle_min, DEFAULT_RECORDING_LIMITS.idle_min),
    confirm_min: pos(v.confirm_min, DEFAULT_RECORDING_LIMITS.confirm_min),
    max_hours: pos(v.max_hours, DEFAULT_RECORDING_LIMITS.max_hours),
  };
}

/** 打ち合わせの種類と音声の保存日数（システム設定から） */
export function useMeetingSettings() {
  const { settings } = useSystemSettings();
  return useMemo(() => {
    const t = settings.find((s) => s.setting_key === "meeting_types");
    let types = DEFAULT_MEETING_TYPES;
    try {
      const v = t ? JSON.parse(t.setting_value) : null;
      if (Array.isArray(v) && v.length > 0 && v.every((x) => x.key && x.label)) types = v;
    } catch { /* 既定のまま */ }
    const r = settings.find((s) => s.setting_key === "meeting_audio_retention_days");
    const retentionDays = r && Number(r.setting_value) > 0 ? Number(r.setting_value) : 30;
    return { types, retentionDays, recording: recordingLimits(settings), typeLabel: (key) => types.find((x) => x.key === key)?.label || key || "" };
  }, [settings]);
}

export const fmtClock = (sec) => {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/** 議事録をプレーンテキストにする（コピー・メール用） */
export function meetingToText(m, typeLabel) {
  const s = m.summary || {};
  const lines = [
    `【議事録】${m.title || ""}`,
    `日時: ${m.held_at || ""}　種類: ${typeLabel(m.meeting_type)}`,
    m.client_name ? `クライアント: ${m.client_name}` : "",
    (m.participants || []).length ? `出席者: ${(m.participants || []).join("、")}` : "",
    "",
    "■ 概要", formatOverview(s.overview),
    "",
    "■ 打ち合わせメモ", formatNotes(s.notes),
    "",
    "■ 決定事項", ...(s.decisions || []).map((d) => `・${d}`),
    "",
    "■ ToDo", ...(s.todos || []).map((t) => `・${t.done ? "[済] " : ""}${t.text}${t.owner ? `（担当: ${t.owner}）` : ""}${t.due ? `（期限: ${t.due}）` : ""}`),
    "",
    "■ 保留・次回までの確認事項", ...(s.open_items || []).map((o) => `・${o}`),
    ...((s.attachments || []).length ? ["", "■ 参考資料", ...s.attachments.map((a) => `・${a.caption ? `${a.caption}（${a.name}）` : a.name}`)] : []),
  ];
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}
