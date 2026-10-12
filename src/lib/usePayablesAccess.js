import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/api/db";

// ============================================================================
// 支払い先まとめ・カード明細を見られる人（データベースの RLS と同じアドレス。0033_payables_access.sql）
//   画面で隠すのは見た目のため。実際に明細を読めるかはデータベース側で決まる。
// ============================================================================
export const PAYABLES_EMAILS = ["daichi@concept-village.co.jp", "hinako@concept-village.co.jp"];
export const PRIVATE_CARD_EMAILS = ["daichi@concept-village.co.jp"];

/** カードの種類 */
export const CARD_BRANDS = [
  { key: "mf", label: "MF ビジネスカード", short: "MF", cls: "bg-emerald-50 text-emerald-800 border-emerald-300" },
  { key: "jcb", label: "JCB カード", short: "JCB", cls: "bg-sky-50 text-sky-800 border-sky-300", private: true },
  { key: "visa", label: "VISA カード（紙の明細）", short: "VISA", cls: "bg-indigo-50 text-indigo-800 border-indigo-300", private: true },
];
export const brandOf = (key) => CARD_BRANDS.find((b) => b.key === key) || null;

export function usePayablesAccess() {
  const { user } = useAuth();
  const email = String(user?.email || "").toLowerCase();
  const canViewPayables = !!email && PAYABLES_EMAILS.includes(email);
  const canViewPrivateCards = canViewPayables && PRIVATE_CARD_EMAILS.includes(email);
  return { canViewPayables, canViewPrivateCards, brands: CARD_BRANDS.filter((b) => canViewPrivateCards || !b.private) };
}

/**
 * 売上粗利管理表・速報デイリー用: 支払い先まとめ（CV 分）とカード明細（CV 分）の月ごとの合計。
 *   明細は見せず、データベースの関数で合計だけ受け取る（誰が見ても同じ数字になる）。
 *   関数がまだ無い（SQL 未実行）ときは、これまでどおり明細を読んで数える。
 * @returns {{ payables: object[], cardCharges: object[] }}  buildSalesReport にそのまま渡せる形
 */
export function useCostTotals() {
  const { data: payables = [] } = useQuery({
    queryKey: ["payables", "monthlyTotals"],
    queryFn: async () => {
      try {
        const rows = await db.rpc("payables_cv_monthly");
        return (rows || []).map((r) => ({ pay_month: r.pay_month, amount_cv: Number(r.amount_cv) || 0, row_count: Number(r.row_count) || 0 }));
      } catch {
        return db.entities.Payable.listAll("pay_month");
      }
    },
    retry: false,
  });
  const { data: cardCharges = [] } = useQuery({
    queryKey: ["cardCharges", "monthlyTotals"],
    queryFn: async () => {
      try {
        const rows = await db.rpc("card_cv_monthly");
        return (rows || []).map((r) => ({ charge_month: r.charge_month, amount: Number(r.amount) || 0, entity: "cv", row_count: Number(r.row_count) || 0 }));
      } catch {
        return db.entities.CardCharge.listAll("charged_at");
      }
    },
    retry: false,
  });
  return { payables, cardCharges };
}
