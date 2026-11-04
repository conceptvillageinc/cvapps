// 未入金の請求書の件数（サイドバーの「入金確認」の数字）。請求書一覧の「未入金」と同じ数え方（送付済・下書き）
//   件数だけを数える（行は読まない）。1 分ごとに読み直す
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";

export function useUnpaidInvoiceCount({ enabled = true } = {}) {
  const { data = 0 } = useQuery({
    queryKey: ["invoices", "unpaidCount"],
    enabled, staleTime: 60_000, refetchInterval: 60_000, retry: false,
    queryFn: async () => {
      const [sent, draft] = await Promise.all([db.entities.Invoice.count({ status: "sent" }), db.entities.Invoice.count({ status: "draft" })]);
      return sent + draft;
    },
  });
  return data;
}
