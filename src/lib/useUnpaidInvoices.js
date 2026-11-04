// 未入金の請求書の件数（サイドバーの「入金確認」の数字）。送付済で、まだ入金されていない請求書だけを数える
//   （まだ送っていない下書き・入金済・取消は数えない）。件数だけを数える（行は読まない）。1 分ごとに読み直す
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";

export function useUnpaidInvoiceCount({ enabled = true } = {}) {
  const { data = 0 } = useQuery({
    queryKey: ["invoices", "unpaidCount"],
    enabled, staleTime: 60_000, refetchInterval: 60_000, retry: false,
    queryFn: () => db.entities.Invoice.count({ status: "sent" }),
  });
  return data;
}
