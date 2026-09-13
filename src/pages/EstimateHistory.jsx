import { db } from "@/api/db";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ArrowRight, Loader2, History, Copy } from "lucide-react";
import { PRINT_TYPES } from "@/lib/constants";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function EstimateHistory() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["estimates-history"],
    queryFn: () => db.entities.Estimate.list("-created_date", 200),
  });

  const approvedEstimates = estimates.filter(e =>
    e.status === "approved" || e.status === "sent_to_freee"
  );

  const filtered = approvedEstimates.filter(est => {
    const matchSearch = !search ||
      est.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      est.print_type?.includes(search);
    const matchType = typeFilter === "all" || est.print_type === typeFilter;
    const matchDateFrom = !dateFrom || est.created_date >= dateFrom;
    const matchDateTo = !dateTo || est.created_date <= dateTo + "T23:59:59";
    return matchSearch && matchType && matchDateFrom && matchDateTo;
  });

  const handleDuplicate = async (est) => {
    const { id, created_date, updated_date, created_by_id, estimate_number, status,
            reviewer_id, reviewer_name, approved_date, review_comments, approval_checklist,
            freee_deal_id, freee_estimate_id, freee_status, ...rest } = est;
    const newEstimate = await db.entities.Estimate.create({
      ...rest,
      estimate_number: `CV-${Date.now().toString(36).toUpperCase()}`,
      status: "draft",
      freee_status: "not_linked",
      review_comments: [],
      approval_checklist: {},
    });
    toast.success("見積を複製しました");
    navigate(`/estimates/${newEstimate.id}`);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="w-6 h-6" /> 提出見積履歴
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">承認済みの見積を検索・閲覧できます</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="クライアント名・印刷物名で検索"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="印刷物種別" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全種別</SelectItem>
            {PRINT_TYPES.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="w-40"
          placeholder="開始日"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="w-40"
          placeholder="終了日"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <History className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">該当する見積履歴がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs">見積日</TableHead>
                    <TableHead className="text-xs">クライアント</TableHead>
                    <TableHead className="text-xs">印刷物種別</TableHead>
                    <TableHead className="text-xs">採用会社</TableHead>
                    <TableHead className="text-xs text-right">原価</TableHead>
                    <TableHead className="text-xs text-right">出し値</TableHead>
                    <TableHead className="text-xs text-right">粗利</TableHead>
                    <TableHead className="text-xs">納期</TableHead>
                    <TableHead className="text-xs">承認者</TableHead>
                    <TableHead className="text-xs w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(est => (
                    <TableRow key={est.id} className="group">
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(est.created_date).toLocaleDateString("ja-JP")}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{est.client_name}</TableCell>
                      <TableCell className="text-sm">{est.print_type}</TableCell>
                      <TableCell className="text-sm">{est.selected_vendor || "—"}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {est.cost_price ? `¥${est.cost_price.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {est.selling_price ? `¥${est.selling_price.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium text-emerald-600">
                        {est.gross_profit ? `¥${est.gross_profit.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{est.desired_delivery_date || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{est.reviewer_name || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleDuplicate(est)}
                          >
                            <Copy className="w-3 h-3" /> 複製
                          </Button>
                          <Link to={`/estimates/${est.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs">
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
