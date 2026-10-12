import { useAuth } from "@/lib/AuthContext";

// ============================================================================
// 印刷仕様の一覧（価格調べ・グラフィックで調べる）は試験運用中。ここに書いたアドレスの人だけに出す。
//   全員に出すときは TRIAL_EMAILS を null にする。
// ============================================================================
const TRIAL_EMAILS = ["daichi@concept-village.co.jp"];

export function usePrintSpecAccess() {
  const { user } = useAuth();
  const email = String(user?.email || "").toLowerCase();
  return { allowed: TRIAL_EMAILS === null || (!!email && TRIAL_EMAILS.includes(email)), trial: TRIAL_EMAILS !== null };
}
