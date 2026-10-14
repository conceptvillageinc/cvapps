import { useAuth } from "@/lib/AuthContext";

// ============================================================================
// 印刷仕様の一覧（価格調べ・グラフィックで調べる）。
//   TRIAL_EMAILS: 使える人を絞るときだけアドレスを並べる（null なら CV のメンバー全員）。
//   SHOW_TRIAL_BADGE: 「試験運用」の印を出すか（全員に出したあとも、しばらくは印を残す）。
// ============================================================================
const TRIAL_EMAILS = null;
const SHOW_TRIAL_BADGE = true;

export function usePrintSpecAccess() {
  const { user } = useAuth();
  const email = String(user?.email || "").toLowerCase();
  return { allowed: TRIAL_EMAILS === null ? !!user : (!!email && TRIAL_EMAILS.includes(email)), trial: SHOW_TRIAL_BADGE };
}
