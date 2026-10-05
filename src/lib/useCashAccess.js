import { useAuth } from "@/lib/AuthContext";
import { useSystemSettings } from "@/lib/useSystemSettings";

/**
 * 経営数字（資金繰り表・売上粗利管理表の案件の積み上げ）を見られるか。
 * システム設定 cashflow_allowed_emails のアドレスだけ。
 */
export function useCashAccess() {
  const { user } = useAuth();
  const { cashflowAllowedEmails, isLoading } = useSystemSettings();
  const email = String(user?.email || "").toLowerCase();
  return { allowed: !!email && cashflowAllowedEmails.includes(email), isLoading };
}
