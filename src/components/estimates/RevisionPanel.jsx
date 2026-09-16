import { useState } from "react";
import { db } from "@/api/db";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { GitBranch, Star, Loader2, Plus, ArrowRight, FolderKanban } from "lucide-react";
import { toast } from "sonner";
import { STATUS_MAP, getDealProbabilityColor, getPhaseColor } from "@/lib/constants";
import { generateEstimateNumber } from "@/lib/estimateNumber";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export default function RevisionPanel({ estimate, onUpdate, project = null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newRevisionOpen, setNewRevisionOpen] = useState(false);
  const [revisionLabel, setRevisionLabel] = useState("");

  const groupId = estimate.project_group_id || estimate.id;

  const { data: siblings = [] } = useQuery({
    queryKey: ["estimateRevisions", groupId],
    queryFn: () => db.entities.Estimate.filter({ project_group_id: groupId }),
    enabled: !!groupId,
  });

  // 自分自身を含めた全改訂版を作成日時順に並べ、最新版を判定
  const allRevisions = [...siblings].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
  const latestId = allRevisions.length > 0 ? allRevisions[allRevisions.length - 1].id : estimate.id;

  const createRevisionMutation = useMutation({
    mutationFn: async (label) => {
      const {
        id, created_date, updated_date, created_by_id, estimate_number, status,
        reviewer_id, reviewer_name, approved_date, review_comments, approval_checklist,
        freee_deal_id, freee_estimate_id, freee_status, is_final_submitted, ...rest
      } = estimate;
      return db.entities.Estimate.create({
        ...rest,
        estimate_number: await generateEstimateNumber(db),
        status: "draft",
        freee_status: "not_linked",
        review_comments: [],
        approval_checklist: {},
        project_group_id: groupId,
        parent_estimate_id: estimate.id,
        revision_label: label || "改訂版",
        is_final_submitted: false,
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["estimateRevisions", groupId] });
      toast.success("改訂版を作成しました");
      navigate(`/estimates/${created.id}`);
    },
  });

  const { dealProbabilityOptions, phaseOptions } = useSystemSettings();

  // 案件に紐付いている見積では、受注確度・フェーズは案件の属性として扱い、
  // 変更はその場で案件に保存する（見積の保存とは独立）。
  const projectUpdate = useMutation({
    mutationFn: (updates) => db.entities.Project.update(project.id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("案件の進捗を更新しました");
    },
    onError: (err) => toast.error("案件を更新できませんでした: " + (err?.message || "不明なエラー")),
  });

  const currentProbability = project ? project.deal_probability : (estimate.deal_probability || "B");
  const currentPhase = project ? project.phase : (estimate.phase || "未着手");
  const probabilityChoices = [...new Set([...dealProbabilityOptions, currentProbability].filter(Boolean))];
  const phaseChoices = [...new Set([...phaseOptions, currentPhase].filter(Boolean))];

  const toggleFinal = (value) => {
    onUpdate({ is_final_submitted: value });
    toast.info(value ? "最終提出版に設定しました（上部の「保存」で確定します）" : "最終提出版のマークを解除しました（上部の「保存」で確定します）");
  };

  const updateDealProbability = (v) => {
    if (project) {
      projectUpdate.mutate({ deal_probability: v, is_recurring: project.is_recurring || /定期/.test(v) });
      return;
    }
    onUpdate({ deal_probability: v, ...(v !== "失注" ? { lost_reason: "" } : {}) });
  };

  const updatePhase = (v) => {
    if (project) {
      projectUpdate.mutate({ phase: v });
      return;
    }
    onUpdate({ phase: v });
  };

  const updateLostReason = (reason) => {
    onUpdate({ lost_reason: reason });
  };

  const isLatest = estimate.id === latestId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitBranch className="w-4 h-4" /> バージョン・商談ステータス
          </CardTitle>
          <Button size="sm" variant="outline" className="text-xs h-8 gap-1.5" onClick={() => setNewRevisionOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> 改訂版を作成
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {estimate.revision_label || "初回"}
          </Badge>
          {isLatest && (
            <Badge className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100">最新版</Badge>
          )}
          {estimate.is_final_submitted && (
            <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1">
              <Star className="w-2.5 h-2.5 fill-current" /> 最終提出版
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">最終提出版フラグ</Label>
            <Button
              size="sm"
              variant={estimate.is_final_submitted ? "default" : "outline"}
              className="w-full gap-1.5 text-xs h-9"
              onClick={() => toggleFinal(!estimate.is_final_submitted)}
            >
              <Star className="w-3.5 h-3.5" />
              {estimate.is_final_submitted ? "設定済み" : "最終提出版にする"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">受注確度</Label>
            <Select
              value={currentProbability}
              onValueChange={updateDealProbability}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {probabilityChoices.map((label) => (
                  <SelectItem key={label} value={label} className="text-xs">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">フェーズ</Label>
            <Select
              value={currentPhase}
              onValueChange={updatePhase}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {phaseChoices.map((label) => (
                  <SelectItem key={label} value={label} className="text-xs">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!project && estimate.deal_probability === "失注" && (
          <div className="space-y-1.5">
            <Label className="text-xs">失注理由</Label>
            <Input
              defaultValue={estimate.lost_reason || ""}
              placeholder="例: 予算超過、他社決定 など"
              className="text-xs h-9"
              onBlur={(e) => updateLostReason(e.target.value)}
            />
          </div>
        )}

        {project ? (
          <p className="text-[10px] text-muted-foreground -mt-1 flex items-center gap-1 flex-wrap">
            <FolderKanban className="w-3 h-3" />
            受注確度・フェーズは案件
            <Link to={`/projects/${project.id}`} className="text-primary hover:underline">{project.project_number} {project.name}</Link>
            の属性です。変更するとすぐに案件へ保存されます
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground -mt-1">
            ※ この見積は案件に紐付いていません。受注確度・フェーズは見積の自動保存で確定します。選択肢は「システム設定」画面で編集できます
          </p>
        )}

        {allRevisions.length > 1 && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">改訂履歴（{allRevisions.length}件）</Label>
            <div className="space-y-1">
              {allRevisions.map((rev) => {
                const st = STATUS_MAP[rev.status] || STATUS_MAP.draft;
                const isSelf = rev.id === estimate.id;
                return (
                  <div
                    key={rev.id}
                    className={`flex items-center gap-2 p-2 rounded-md text-xs ${isSelf ? "bg-primary/5 border border-primary/20" : "hover:bg-muted/50 cursor-pointer"}`}
                    onClick={() => !isSelf && navigate(`/estimates/${rev.id}`)}
                  >
                    <Badge variant="outline" className="text-[9px] shrink-0">{rev.revision_label || "初回"}</Badge>
                    <span className="text-muted-foreground shrink-0">
                      {format(new Date(rev.created_date), "M/d HH:mm", { locale: ja })}
                    </span>
                    <Badge className={`text-[9px] ${st.color} shrink-0`}>{st.label}</Badge>
                    {rev.deal_probability && (
                      <Badge className={`text-[9px] ${getDealProbabilityColor(rev.deal_probability)} shrink-0`}>{rev.deal_probability}</Badge>
                    )}
                    {rev.phase && (
                      <Badge className={`text-[9px] ${getPhaseColor(rev.phase)} shrink-0`}>{rev.phase}</Badge>
                    )}
                    {rev.id === latestId && <Badge className="text-[9px] bg-blue-100 text-blue-700 shrink-0">最新版</Badge>}
                    {rev.is_final_submitted && <Badge className="text-[9px] bg-amber-100 text-amber-700 shrink-0">最終提出版</Badge>}
                    {isSelf && <span className="text-[9px] text-muted-foreground ml-auto shrink-0">（表示中）</span>}
                    {!isSelf && <ArrowRight className="w-3 h-3 text-muted-foreground/40 ml-auto shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={newRevisionOpen} onOpenChange={setNewRevisionOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>改訂版を作成</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">改訂版のラベル</Label>
            <Input
              value={revisionLabel}
              onChange={(e) => setRevisionLabel(e.target.value)}
              placeholder="例: B案、再提出、価格改定版"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              現在の内容をコピーして新しい見積として作成し、この見積と紐づけます。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewRevisionOpen(false)}>キャンセル</Button>
            <Button
              size="sm"
              onClick={() => createRevisionMutation.mutate(revisionLabel)}
              disabled={createRevisionMutation.isPending}
              className="gap-1.5"
            >
              {createRevisionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              作成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
