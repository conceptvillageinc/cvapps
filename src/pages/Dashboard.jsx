import { db } from "@/api/db";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, Plus, Clock, CheckCircle2, AlertTriangle,
  ArrowRight
} from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

const STATUS_MAP = {
  draft: { label: "下書き", color: "bg-muted text-muted-foreground" },
  collecting: { label: "価格収集中", color: "bg-blue-100 text-blue-700" },
  calculating: { label: "計算中", color: "bg-purple-100 text-purple-700" },
  review_pending: { label: "レビュー待ち", color: "bg-amber-100 text-amber-700" },
  review_in_progress: { label: "レビュー中", color: "bg-orange-100 text-orange-700" },
  approved: { label: "承認済み", color: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "差し戻し", color: "bg-red-100 text-red-700" },
  sent_to_freee: { label: "freee連携済", color: "bg-teal-100 text-teal-700" },
};

export default function Dashboard() {
  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["estimates"],
    queryFn: () => db.entities.Estimate.list("-created_date", 50),
  });

  const stats = {
    total: estimates.length,
    drafts: estimates.filter(e => e.status === "draft").length,
    pendingReview: estimates.filter(e => ["review_pending", "review_in_progress"].includes(e.status)).length,
    approved: estimates.filter(e => e.status === "approved" || e.status === "sent_to_freee").length,
  };

  const recentEstimates = estimates.slice(0, 5);

  const StatCard = ({ icon: Icon, label, value, color, to }) => (
    <Link to={to}>
      <Card className="hover:shadow-md transition-all duration-200 cursor-pointer group">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
              <p className="text-2xl font-bold tracking-tight">{value}</p>
            </div>
            <div className={`p-2.5 rounded-xl ${color} transition-transform group-hover:scale-105`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
          <p className="text-sm text-muted-foreground mt-0.5">印刷見積管理システム</p>
        </div>
        <Link to="/estimates/new">
          <Button className="gap-2 shadow-sm">
            <Plus className="w-4 h-4" />
            新規見積作成
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="全見積数" value={stats.total} color="bg-primary" to="/estimates" />
        <StatCard icon={Clock} label="下書き" value={stats.drafts} color="bg-muted-foreground" to="/estimates" />
        <StatCard icon={AlertTriangle} label="レビュー待ち" value={stats.pendingReview} color="bg-accent" to="/estimates" />
        <StatCard icon={CheckCircle2} label="承認済み" value={stats.approved} color="bg-success" to="/estimates" />
      </div>

      {/* Recent estimates */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">最近の見積</CardTitle>
            <Link to="/estimates" className="text-xs text-primary hover:underline flex items-center gap-1">
              すべて表示 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : recentEstimates.length === 0 ? (
            <div className="text-center py-10">
              <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">見積がまだありません</p>
              <Link to="/estimates/new">
                <Button variant="outline" size="sm" className="mt-3 gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> 最初の見積を作成
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentEstimates.map(est => {
                const status = STATUS_MAP[est.status] || STATUS_MAP.draft;
                return (
                  <Link
                    key={est.id}
                    to={`/estimates/${est.id}`}
                    className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium truncate">{est.client_name}</span>
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${status.color}`}>
                          {status.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{est.print_type}</span>
                        {est.estimate_number && <span>#{est.estimate_number}</span>}
                        <span>{format(new Date(est.created_date), "M/d", { locale: ja })}</span>
                      </div>
                    </div>
                    {est.total_amount && (
                      <span className="text-sm font-semibold tabular-nums">
                        ¥{est.total_amount.toLocaleString()}
                      </span>
                    )}
                    <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
