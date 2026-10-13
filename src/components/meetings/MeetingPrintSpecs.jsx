import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { usePrintSpecAccess } from "@/lib/usePrintSpecAccess";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, TableProperties, Sparkles, ChevronRight } from "lucide-react";
import { expandPatterns } from "@/lib/printSpecList";

/**
 * 議事録の「印刷仕様の一覧（価格調べ）」の入口。
 *   議事録から印刷物を書き出して一覧にし、仕入を入れて社内見積の形で出力する画面（/print-specs/:id）へ。
 */
export default function MeetingPrintSpecs({ meeting }) {
  const { allowed } = usePrintSpecAccess();
  if (!allowed) return null;
  return <MeetingPrintSpecsCard meeting={meeting} />;
}

function MeetingPrintSpecsCard({ meeting }) {
  const { trial } = usePrintSpecAccess();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data: lists = [] } = useQuery({
    queryKey: ["printSpecLists", "meeting", meeting.id],
    queryFn: () => db.entities.PrintSpecList.filter({ meeting_id: meeting.id }, "-created_date"),
    retry: false,
  });

  const create = async () => {
    setCreating(true);
    try {
      const row = await db.entities.PrintSpecList.create({
        meeting_id: meeting.id, client_id: meeting.client_id || null, client_name: meeting.client_name || null, project_id: meeting.project_id || null,
        title: "", items: [], status: "draft", created_by: user?.full_name || user?.email || "",
      });
      navigate(`/print-specs/${row.id}?auto=1`);
    } catch (e) { toast.error("作れませんでした: " + e.message); setCreating(false); }
  };

  return (
    <Card className="border-primary/30" data-testid="meeting-print-specs">
      <CardContent className="pt-4 space-y-2">
        <p className="text-sm font-bold flex items-center gap-1.5"><TableProperties className="w-4 h-4 text-primary" /> 印刷仕様の一覧（価格調べ）{trial && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-normal text-amber-800">試験運用</span>}</p>
        <p className="text-[11px] text-muted-foreground">議事録から印刷物の仕様を一覧に書き出し、過不足を確かめてから、仕入を入れて社内見積の形で出力します（スプレッドシート・新しい見積・原価計算表）</p>
        {lists.map((l) => {
          const n = expandPatterns(l.items).length;
          const priced = expandPatterns(l.items).filter((it) => Number(it.cost_total) > 0).length;
          return (
            <Link key={l.id} to={`/print-specs/${l.id}`} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50">
              <span className="min-w-0 flex-1">
                <span className="block font-medium truncate">{l.title || "（件名なし）"}</span>
                <span className="text-muted-foreground">{l.status === "confirmed" ? "確定" : "確かめ中"}・{n} 件・仕入 {priced}/{n}{(l.outputs || []).length ? `・出力 ${l.outputs.length} 回` : ""}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Link>
          );
        })}
        <Button size="sm" variant={lists.length ? "outline" : "default"} className="w-full gap-1.5" onClick={create} disabled={creating} data-testid="meeting-print-specs-create">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} 議事録から印刷物を書き出す
        </Button>
      </CardContent>
    </Card>
  );
}
