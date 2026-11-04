// 受信トレイ（メンション・担当になった・コメント）。未読の数はサイドバーに出す（1 分ごとに読み直す）
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";

export const INBOX_KEY = ["notifications"];
export function useInbox({ enabled = true } = {}) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: INBOX_KEY, enabled, refetchInterval: 60_000, retry: false,
    queryFn: () => db.entities.Notification.list("-created_at", 200),
  });
  return { items, unread: items.filter((n) => !n.read_at).length, isLoading };
}

export const NOTIFICATION_KIND = {
  mention: "あなたをメンションしました",
  assigned: "あなたを担当者にしました",
  comment: "担当のタスクにコメントしました",
  proof_form: "校了フォームに回答がありました",
};
