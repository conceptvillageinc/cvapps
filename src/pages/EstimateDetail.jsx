import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { db } from "@/api/db";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Send, Copy, Trash2, Loader2,
  FileText, Calculator, Mail, CheckSquare, AlertTriangle, Palette, FileOutput, CheckCircle2, ArrowRightLeft, Truck, Link2, UserCheck, FileDown, ChevronDown, ChevronRight
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import DocumentEmailDialog from "@/components/documents/DocumentEmailDialog";
import { openBlob, openPreviewTab, showBlobInTab } from "@/lib/documents";
import { toast } from "sonner";
import { STATUS_MAP } from "@/lib/constants";
import { useAuth } from "@/lib/AuthContext";
import { useSystemSettings } from "@/lib/useSystemSettings";
import SpecForm from "@/components/estimates/SpecForm";
import PriceTable from "@/components/estimates/PriceTable";
import CostCalculation from "@/components/estimates/CostCalculation";
import EmailPreview from "@/components/estimates/EmailPreview";
import ReviewPanel from "@/components/estimates/ReviewPanel";
import DesignFeeTable from "@/components/estimates/DesignFeeTable";
import RevisionPanel from "@/components/estimates/RevisionPanel";
import { convertLegacyEstimate, summarizeConversion } from "@/lib/convertLegacyEstimate";
import { generateEstimateNumber } from "@/lib/estimateNumber";
import EstimatePreview from "@/components/estimates/EstimatePreview";
import QuoteEditor from "@/components/estimates/QuoteEditor";
import VendorRequestCard from "@/components/estimates/VendorRequestCard";
import VendorRequestTool from "@/components/estimates/VendorRequestTool";
import ReviewStep from "@/components/estimates/ReviewStep";
import { autoChecks } from "@/components/estimates/ReviewStep";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { recomputeSubtotals, recomputeRuleRows, usePricingRules } from "@/lib/pricing";
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

  const { data: project } = useQuery({
    queryKey: ["project", estimate?.project_id],
    queryFn: () => db.entities.Project.get(estimate.project_id),
    enabled: !!estimate?.project_id,
  });

  const [formData, setFormData] = useState(null);
  // レビュー申請先を選ぶダイアログ
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const { data: appUsers = [] } = useQuery({ queryKey: ["users"], queryFn: () => db.entities.User.list("full_name") });
  const reviewerCandidates = appUsers.filter((u) => u.role === "admin" && u.id !== user?.id);

  // 見積書PDF（印影あり／なし）とクライアントへのメール送付
  const [pdfLoading, setPdfLoading] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const downloadPdf = async (withStamp, kind = "estimate") => {
    setPdfLoading(true);
    try {
      // 直前の編集が保存されてから生成する（自動保存は1秒待ち）
      await saveMutation.mutateAsync(formData);
      const blob = await db.documents.pdf(kind, estimateId, { stamp: withStamp });
      const clean = (s) => String(s || "").replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
      const label = kind === "purchase_order" ? "発注書" : "見積書";
      openBlob(blob, `【${clean(formData.client_name) || "クライアント"}】${label}_${clean(formData.estimate_title) || formData.estimate_number}.pdf`);
    } catch (err) {
      toast.error("PDFを作成できませんでした: " + err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  // 印刷用に新しいタブで開く（保存してから、PDFをそのままタブに表示する）
  const previewPdf = async (withStamp) => {
    const tab = openPreviewTab();
    setPdfLoading(true);
    try {
      await saveMutation.mutateAsync(formData);
      const blob = await db.documents.pdf("estimate", estimateId, { stamp: withStamp });
      const clean = (s) => String(s || "").replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
      showBlobInTab(tab, blob, `【${clean(formData.client_name) || "クライアント"}】見積書_${clean(formData.estimate_title) || formData.estimate_number}.pdf`);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      toast.error("PDFを作成できませんでした: " + err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  // 短いリンク（/e/見積番号）をクリップボードへ
  const copyLink = async () => {
    const url = `${window.location.origin}/e/${encodeURIComponent(formData.estimate_number)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("リンクをコピーしました", { description: url });
    } catch {
      window.prompt("このリンクをコピーしてください", url);
    }
  };
  const [activeTab, setActiveTab] = useState(null);
  // 新形式: ステップ（quote = 見積書を作る / review = レビュー・承認）と依頼ツール
  const [step, setStep] = useState("quote");
  const [toolOpen, setToolOpen] = useState(false);
  const [toolStep, setToolStep] = useState(null);
  const { rules: pricingRules } = usePricingRules();
  const { grossMarginTarget } = useSystemSettings();
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
    setReviewerId(formData.review_requested_to_id || reviewerCandidates[0]?.id || "");
    setReviewDialogOpen(true);
  };

  // 申請先を決めてレビュー待ちにする（申請先は管理者から選ぶ。誰にも指定しない申請も可）
  const submitReview = () => {
    const reviewer = reviewerCandidates.find((u) => u.id === reviewerId) || null;
    const updated = {
      ...formData,
      status: "review_pending",
      review_requested_to_id: reviewer?.id || null,
      review_requested_to_name: reviewer?.full_name || null,
      review_requested_at: new Date().toISOString(),
    };
    setFormData(updated);
    saveMutation.mutate(updated);
    setReviewDialogOpen(false);
    toast.success(reviewer ? `${reviewer.full_name} さんにレビューを申請しました` : "レビュー申請を送信しました");
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
    const estimateNumber = await generateEstimateNumber(db);
    const newEstimate = await db.entities.Estimate.create({
      ...rest,
      estimate_number: estimateNumber,
      // 複製したことが分かるように件名の先頭に印を付ける（後から書き換えてよい）
      estimate_title: /^copy of /i.test(rest.estimate_title || "") ? rest.estimate_title : `copy of ${rest.estimate_title || ""}`.trim(),
      project_group_id: estimateNumber,
      parent_estimate_id: null,
      revision_label: "初回",
      is_final_submitted: false,
      status: "draft",
      freee_status: "not_linked",
      review_comments: [],
      approval_checklist: {},
    });
    toast.success("見積を複製しました");
    navigate(`/estimates/${newEstimate.id}`);
  };

  // 旧形式 → 新形式（見積書タブ）へ変換する。旧形式の列は残す。
  const handleConvert = () => {
    const patch = convertLegacyEstimate(formData);
    const updated = { ...formData, ...patch };
    setFormData(updated);
    saveMutation.mutate(updated);
    setActiveTab("quote");
    const sum = summarizeConversion(patch);
    toast.success(`新形式に変換しました（印刷費${sum.print}行・デザイン費${sum.design}行・印刷仕様${sum.specs}件）。内容を確認してください`);
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
              {formData.status === "review_pending" && formData.review_requested_to_name && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-700"><UserCheck className="w-3 h-3" /> レビュー申請先: {formData.review_requested_to_name}</span>
              )}
              {project && (
                <>
                  {" · "}
                  <Link to={`/projects/${project.id}`} className="text-primary hover:underline">
                    案件 {project.project_number} {project.name}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {formData.schema_version === 2 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" disabled={pdfLoading}>
                    {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} PDF <ChevronDown className="w-3 h-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-xs" onClick={() => downloadPdf(true)}>電子印鑑あり（メール送付用）</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs" onClick={() => downloadPdf(false)}>電子印鑑なし（印刷して押印する用）</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs" onClick={() => downloadPdf(false, "purchase_order")}>発注書の雛形（クライアント記入用・宛先 CV）</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={async () => { await saveMutation.mutateAsync(formData); setMailOpen(true); }} className="gap-1.5 text-xs">
                <Mail className="w-3.5 h-3.5" /> 見積書を送付
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/delivery-notes/new?estimate=${estimateId}`)} className="gap-1.5 text-xs">
                <Truck className="w-3.5 h-3.5" /> 納品書を作成
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={copyLink} className="gap-1.5 text-xs" title="この見積の短いリンクをコピー（Asana やチャットに貼る用）">
            <Link2 className="w-3.5 h-3.5" /> リンクをコピー
          </Button>
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
          {formData.schema_version !== 2 && (formData.status === "draft" || formData.status === "rejected") ? (
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

      {/* 旧形式の見積: 新形式への変換 */}
      {formData.schema_version !== 2 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-sky-50 border border-sky-200">
          <div className="flex-1 text-xs text-sky-900">
            <p className="font-medium">この見積は旧形式（仕様・印刷費・デザイン費タブ）です。</p>
            <p className="mt-0.5">
              新形式に変換すると、印刷費・デザイン費・校正費が見積書タブの明細になり、仕様は「印刷仕様」タブに移ります。
              変換後は、自動計算行・ネット印刷取込・過去見積からの複製が使えます。
              {(() => {
                const sum = summarizeConversion(convertLegacyEstimate(formData));
                return `（変換後の見積金額: ¥${Number(sum.total || 0).toLocaleString()} 税込）`;
              })()}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" className="gap-1.5 text-xs shrink-0">
                <ArrowRightLeft className="w-3.5 h-3.5" /> 新形式に変換
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>新形式に変換しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  旧形式のタブ（仕様・印刷費・デザイン費・プレビュー）は表示されなくなり、見積書タブで編集する形になります。
                  旧形式の入力内容はデータとして残るため、元に戻したい場合はお知らせください。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={handleConvert}>変換する</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {formData.schema_version === 2 && (
        <DocumentEmailDialog
          open={mailOpen}
          onOpenChange={setMailOpen}
          type="estimate"
          doc={formData}
          onSent={() => queryClient.invalidateQueries({ queryKey: ["emailLogs", estimateId] })}
        />
      )}

      {/* レビュー申請先 */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>レビューを申請する</DialogTitle>
            <DialogDescription className="text-xs">誰にレビューを頼むかを選びます。申請先は見積の見出しと一覧に表示されます</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <p className="text-xs font-medium">レビュー申請先（管理者）</p>
            {reviewerCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">選べる管理者がいません（ユーザー管理で管理者を追加できます）。申請先なしで申請します</p>
            ) : (
              <Select value={reviewerId} onValueChange={setReviewerId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="申請先を選ぶ" /></SelectTrigger>
                <SelectContent>
                  {reviewerCandidates.map((u) => <SelectItem key={u.id} value={u.id} className="text-xs">{u.full_name || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>キャンセル</Button>
            <Button onClick={submitReview} className="gap-1.5"><Send className="w-4 h-4" /> 申請する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* バージョン・商談ステータス */}
      <RevisionPanel estimate={formData} onUpdate={handleUpdate} project={project} />

      {formData.schema_version === 2 ? (
        <>
          {/* ステップ表示: ① 見積書を作る → ② レビュー・承認 */}
          {(() => {
            const items = (formData.line_items || []).filter((li) => li.row_type !== "text" && li.row_type !== "subtotal");
            const totals = computeEstimateTotals(items, { taxInclusive: !!formData.tax_inclusive });
            const a = autoChecks(formData, grossMarginTarget);
            const reviewDone = formData.status === "approved";
            const reviewNote = reviewDone
              ? `承認済み（${formData.reviewer_name || ""}）`
              : formData.status === "review_pending" || formData.status === "review_in_progress"
                ? `${formData.review_requested_to_name ? `${formData.review_requested_to_name} さんに` : ""}申請中`
                : formData.status === "rejected" ? "差し戻し・直して再申請" : "未申請 ・ 明細ができたら申請する";
            return (
              <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5">
                <button type="button" onClick={() => setStep("quote")} className="flex items-center gap-3 flex-1 text-left">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${step === "quote" ? "bg-primary text-primary-foreground" : items.length > 0 ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}>
                    {step !== "quote" && items.length > 0 ? <CheckCircle2 className="w-4 h-4" /> : "1"}
                  </span>
                  <span>
                    <span className={`block text-sm ${step === "quote" ? "font-bold" : "font-medium text-muted-foreground"}`}>見積書を作る</span>
                    <span className="block text-[11px] text-muted-foreground">明細 {items.length}行 ・ 合計 ¥{totals.total.toLocaleString()}（税込）{a.cost > 0 ? ` ・ 粗利 ${Math.round(a.rate * 100)}%` : ""}</span>
                  </span>
                </button>
                <span className={`h-0.5 w-12 shrink-0 ${step === "review" || reviewDone ? "bg-primary" : "bg-border"}`} />
                <button type="button" onClick={() => setStep("review")} className="flex items-center gap-3 flex-1 text-left">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${step === "review" ? "bg-primary text-primary-foreground" : reviewDone ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}>
                    {reviewDone && step !== "review" ? <CheckCircle2 className="w-4 h-4" /> : "2"}
                  </span>
                  <span>
                    <span className={`block text-sm ${step === "review" ? "font-bold" : "font-medium text-muted-foreground"}`}>レビュー・承認</span>
                    <span className="block text-[11px] text-muted-foreground">{reviewNote}</span>
                  </span>
                </button>
                {step === "quote" ? (
                  <Button size="sm" className="gap-1.5 text-xs shrink-0" onClick={() => setStep("review")}>次へ：レビュー <ChevronRight className="w-3.5 h-3.5" /></Button>
                ) : (
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" onClick={() => setStep("quote")}><ArrowLeft className="w-3.5 h-3.5" /> 見積書に戻る</Button>
                )}
              </div>
            );
          })()}

          {step === "quote" ? (
            <div className="flex flex-col xl:flex-row gap-4">
              <div className="flex-1 min-w-0">
                <QuoteEditor estimate={formData} onUpdate={handleUpdate} onPreview={previewPdf} />
              </div>
              <div className="w-full xl:w-[300px] shrink-0 space-y-3">
                <VendorRequestCard estimate={formData} emailLogs={emailLogs} onOpen={(n) => { setToolStep(n); setToolOpen(true); }} />
                <div className="rounded-xl border bg-card p-4 space-y-1.5">
                  <p className="text-xs font-bold">履歴</p>
                  {emailLogs.filter((l) => l.status === "sent").length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">まだメールの送信はありません</p>
                  ) : (
                    <ul className="text-[11px] text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
                      {[...emailLogs].filter((l) => l.status === "sent").sort((x, y) => String(y.sent_at || "").localeCompare(String(x.sent_at || ""))).slice(0, 8).map((l) => (
                        <li key={l.id}><span className="tabular-nums">{new Date(l.sent_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}</span>　{l.recipient_company} へ{l.document_type ? "見積書を送付" : "依頼メール送信"}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <ReviewStep
              estimate={formData}
              emailLogs={emailLogs}
              onUpdate={handleUpdate}
              onApprove={handleApprove}
              onReject={handleReject}
              onRequestReview={handleSubmitReview}
              onOpenPdf={() => previewPdf(false)}
            />
          )}

          <VendorRequestTool
            open={toolOpen}
            onOpenChange={setToolOpen}
            initialStep={toolStep}
            estimate={formData}
            emailLogs={emailLogs}
            onUpdate={handleUpdate}
            onAddItems={(items) => {
              const uid = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const next = recomputeSubtotals(recomputeRuleRows([...(formData.line_items || []), ...items.map((it) => ({ id: uid(), row_type: "item", ...it }))], pricingRules));
              const t = computeEstimateTotals(next, { taxInclusive: !!formData.tax_inclusive });
              handleUpdate({ line_items: next, total_amount: t.total });
              toast.success(`${items.length}件の明細を見積書に追加しました`);
            }}
          />
        </>
      ) : (
      <Tabs value={activeTab || "spec"} onValueChange={setActiveTab} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="bg-muted/50 w-max">
            {(
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
              <Mail className="w-3.5 h-3.5" /> メール生成
            </TabsTrigger>
            <TabsTrigger value="review" className="gap-1.5 text-xs">
              <CheckSquare className="w-3.5 h-3.5" /> レビュー
            </TabsTrigger>
          </TabsList>
        </div>

        {(
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

        <TabsContent value="email" forceMount className="data-[state=inactive]:hidden">
          <EmailPreview
            estimate={formData}
            emailLogs={emailLogs}
            onEmailSent={() => queryClient.invalidateQueries({ queryKey: ["emailLogs", estimateId] })}
          />
        </TabsContent>

        <TabsContent value="review" forceMount className="data-[state=inactive]:hidden">
          <ReviewPanel
            estimate={formData}
            onUpdate={handleUpdate}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}
