// 受信トレイ（メンション・担当になった・コメント）。未読の数はサイドバーに出す（1 分ごとに読み直す）
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { PROOF_BADGE_KIND } from "@/lib/proofForms";

export const INBOX_KEY = ["notifications"];
export function useInbox({ enabled = true } = {}) {
  const { data: all = [], isLoading } = useQuery({
    queryKey: INBOX_KEY, enabled, refetchInterval: 60_000, retry: false,
    queryFn: () => db.entities.Notification.list("-created_at", 200),
  });
  // サイドバーの件数だけのお知らせ（校了フォームの回答。作った人以外の分）は受信トレイに出さない
  const items = all.filter((n) => n.kind !== PROOF_BADGE_KIND);
  return { items, all, unread: items.filter((n) => !n.read_at).length, proofUnread: unreadProofNotices(all).length, isLoading };
}

/** 校了フォームの回答のお知らせのうち、まだ読んでいないもの（formId を渡すとそのフォームの分だけ） */
export const unreadProofNotices = (items, formId = null) =>
  items.filter((n) => (n.kind === "proof_form" || n.kind === PROOF_BADGE_KIND) && !n.read_at && (!formId || String(n.link || "").endsWith(`form=${formId}`)));

export const NOTIFICATION_KIND = {
  mention: "あなたをメンションしました",
  assigned: "あなたを担当者にしました",
  comment: "担当のタスクにコメントしました",
  proof_form: "校了フォームに回答がありました",
};
