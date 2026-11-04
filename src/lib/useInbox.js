// 受信トレイ（メンション・担当になった・コメント）。未読の数はサイドバーに出す（1 分ごとに読み直す）
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";

export const INBOX_KEY = ["notifications"];
export function useInbox({ enabled = true } = {}) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: INBOX_KEY, enabled, refetchInterval: 60_000, retry: false,
    queryFn: () => db.entities.Notification.list("-created_at", 200),
  });
  const unreadItems = items.filter((n) => !n.read_at);
  return { items, unread: unreadItems.length, proofUnread: unreadItems.filter((n) => n.kind === "proof_form").length, isLoading };
}

/** 校了フォームの回答のお知らせのうち、まだ読んでいないもの（formId を渡すとそのフォームの分だけ） */
export const unreadProofNotices = (items, formId = null) =>
  items.filter((n) => n.kind === "proof_form" && !n.read_at && (!formId || String(n.link || "").endsWith(`form=${formId}`)));

export const NOTIFICATION_KIND = {
  mention: "あなたをメンションしました",
  assigned: "あなたを担当者にしました",
  comment: "担当のタスクにコメントしました",
  proof_form: "校了フォームに回答がありました",
};
