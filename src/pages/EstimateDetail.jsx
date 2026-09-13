import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/db";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Send, Copy, Trash2, Loader2,
  FileText, Calculator, Mail, CheckSquare, AlertTriangle, Palette, FileOutput, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { STATUS_MAP } from "@/lib/constants";
import { useAuth } from "@/lib/AuthContext";
import SpecForm from "@/components/estimates/SpecForm";
import PriceTable from "@/components/estimates/PriceTable";
import CostCalculation from "@/components/estimates/CostCalculation";
import EmailPreview from "@/components/estimates/EmailPreview";
import ReviewPanel from "@/components/estimates/ReviewPanel";
import DesignFeeTable from "@/components/estimates/DesignFeeTable";
import RevisionPanel from "@/components/estimates/RevisionPanel";
import EstimatePreview from "@/components/estimates/EstimatePreview";
import QuoteEditor from "@/components/estimates/QuoteEditor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function EstimateDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const estimateId = window.location.pathname.split("/estimates/")[1];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: estimate, isLoading } = useQuery({
    queryKey: ["estimate", estimateId],
    queryFn: () => db.entities.Estimate.filter({ id: estimateId }),
    select: (data) => data[0],
    enabled: !!estimateId,
  });

  const { data: emailLogs = [] } = useQuery({
    queryKey: ["emailLogs", estimateId],
    queryFn: () => db.entities.EmailLog.filter({ estimate_id: estimateId }),
    enabled: !!estimateId,
  });

  const [formData, setFormData] = useState(null);
  const skipAutosave = useRef(true);

  useEffect(() => {
    if (estimate && !formData) {
      setFormData({ ...estimate });
    }
  }, [estimate]);

  const saveMutation = useMutation({
    mutationFn: (data) => db.entities.Estimate.update(estimateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estimate", estimateId] });
    },
    onError: (err) => {
      toast.error("自動保存に失敗しました: " + (err?.message || "不明なエラー"));
    },
  });

  // 入力が落ち着いたら自動保存（読み込み直後の初回セットはスキップ）
  useEffect(() => {
    if (!formData) return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    const t = setTimeout(() => {
      saveMutation.mutate(formData);
    }, 1000);
    return () => clearTimeout(t);
  }, [formData]);

  const handleUpdate = (updates) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const handleSubmitReview = () => {
    if (formData.schema_version !== 2 && formData.cost_price > 0 && formData.selling_price > 0 && formData.cost_price >= formData.selling_price) {
      toast.error("原価が出し値を上回っています。修正してからレビュー申請してください。");
      return;
    }
    const updated = { ...formData, status: "review_pending" };
    setFormData(updated);
    saveMutation.mutate(updated);
    toast.success("レビュー申請を送信しました");
  };

  const handleApprove = () => {
    const updated = {
      ...formData,
      status: "approved",
      reviewer_id: user?.id,
      reviewer_name: user?.full_name,
      approved_date: new Date().toISOString(),
    };
    setFormData(updated);
    saveMutation.mutate(updated);
    toast.success("見積を承認しました");
  };

  const handleReject = () => {
    const updated = { ...formData, status: "rejected" };
    setFormData(updated);
    saveMutation.mutate(updated);
    toast.info("見積を差し戻しました");
  };

  const handleDuplicate = async () => {
    const { id, created_date, updated_date, created_by_id, estimate_number, status,
            reviewer_id, reviewer_name, approved_date, review_comments, approval_checklist,
            freee_deal_id, freee_estimate_id, freee_status, ...rest } = formData;
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

  const handleDelete = async () => {
    await db.entities.Estimate.delete(estimateId);
    toast.success("見積を削除しました");
    navigate("/estimates");
  };

  if (isLoading || !formData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = STATUS_MAP[formData.status] || STATUS_MAP.draft;

  return (
    <div className={`mx-auto space-y-5 ${formData.schema_version === 2 ? "max-w-[1800px]" : "max-w-5xl"}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/estimates")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{formData.client_name}</h1>
              <Badge className={`text-[10px] ${status.color}`}>{status.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {formData.estimate_number} · {formData.print_type}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDuplicate} className="gap-1.5 text-xs">
            <Copy className="w-3.5 h-3.5" /> 複製
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" /> 削除
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>見積を削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>この操作は取り消せません。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                  削除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {formData.status === "draft" || formData.status === "rejected" ? (
            <Button size="sm" variant="outline" onClick={handleSubmitReview} className="gap-1.5 text-xs">
              <Send className="w-3.5 h-3.5" /> レビュー申請
            </Button>
          ) : null}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-1">
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 保存中...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> 自動保存されます
              </>
            )}
          </div>
        </div>
      </div>

      {/* Cost over selling warning (旧方式のみ) */}
      {formData.schema_version !== 2 && formData.cost_price > 0 && formData.selling_price > 0 && formData.cost_price >= formData.selling_price && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive font-medium">
            原価が出し値を上回っています。修正が必要です。
          </p>
        </div>
      )}

      {/* バージョン・商談ステータス */}
      <RevisionPanel estimate={formData} onUpdate={handleUpdate} />

      {/* Tabs */}
      <Tabs defaultValue={formData.schema_version === 2 ? "quote" : "spec"} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="bg-muted/50 w-max">
            {formData.schema_version === 2 ? (
              <TabsTrigger value="quote" className="gap-1.5 text-xs">
                <FileOutput className="w-3.5 h-3.5" /> 見積書
              </TabsTrigger>
            ) : (
              <>
                <TabsTrigger value="spec" className="gap-1.5 text-xs">
                  <FileText className="w-3.5 h-3.5" /> 仕様
                </TabsTrigger>
                <TabsTrigger value="price" className="gap-1.5 text-xs">
                  <Calculator className="w-3.5 h-3.5" /> 印刷費
                </TabsTrigger>
                <TabsTrigger value="design" className="gap-1.5 text-xs">
                  <Palette className="w-3.5 h-3.5" /> デザイン費
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1.5 text-xs">
                  <FileOutput className="w-3.5 h-3.5" /> プレビュー
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="email" className="gap-1.5 text-xs">
              <Mail className="w-3.5 h-3.5" /> メール
            </TabsTrigger>
            <TabsTrigger value="review" className="gap-1.5 text-xs">
              <CheckSquare className="w-3.5 h-3.5" /> レビュー
            </TabsTrigger>
          </TabsList>
        </div>

        {formData.schema_version === 2 ? (
          <TabsContent value="quote">
            <QuoteEditor estimate={formData} onUpdate={handleUpdate} />
          </TabsContent>
        ) : (
          <>
            <TabsContent value="spec">
              <SpecForm data={formData} onChange={setFormData} />
            </TabsContent>

            <TabsContent value="price" className="space-y-4">
              <PriceTable estimate={formData} onUpdate={handleUpdate} />
              <CostCalculation estimate={formData} onUpdate={handleUpdate} />
            </TabsContent>

            <TabsContent value="design">
              <DesignFeeTable estimate={formData} onUpdate={handleUpdate} />
            </TabsContent>

            <TabsContent value="preview">
              <EstimatePreview estimate={formData} />
            </TabsContent>
          </>
        )}

        <TabsContent value="email">
          <EmailPreview
            estimate={formData}
            emailLogs={emailLogs}
            onEmailSent={() => queryClient.invalidateQueries({ queryKey: ["emailLogs", estimateId] })}
          />
        </TabsContent>

        <TabsContent value="review">
          <ReviewPanel
            estimate={formData}
            onUpdate={handleUpdate}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
