import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, MessageSquare, Send, Clock } from "lucide-react";
import { APPROVAL_CHECKLIST } from "@/lib/constants";
import { useAuth } from "@/lib/AuthContext";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export default function ReviewPanel({ estimate, onUpdate, onApprove, onReject }) {
  const { user } = useAuth();
  const [newComment, setNewComment] = useState("");
  const [commentField, setCommentField] = useState("全般");

  const checklist = estimate.approval_checklist || {};
  const comments = estimate.review_comments || [];
  const isReviewer = user?.role === "admin";

  const allChecked = APPROVAL_CHECKLIST.every(item => checklist[item.key]);

  const addComment = () => {
    if (!newComment.trim()) return;
    const updated = [
      ...comments,
      {
        field: commentField,
        comment: newComment,
        author: user?.full_name || "不明",
        author_id: user?.id,
        timestamp: new Date().toISOString(),
      },
    ];
    onUpdate({ review_comments: updated });
    setNewComment("");
  };

  const updateChecklist = (key, checked) => {
    onUpdate({
      approval_checklist: { ...checklist, [key]: checked },
    });
  };

  return (
    <div className="space-y-4">
      {/* Checklist */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">承認チェックリスト</CardTitle>
          {estimate.review_requested_to_name && (
            <p className="text-xs text-muted-foreground">
              相談先: <span className="font-medium text-foreground">{estimate.review_requested_to_name}</span>
              {estimate.review_requested_at && <span className="ml-1">（{format(new Date(estimate.review_requested_at), "M/d HH:mm", { locale: ja })} 相談）</span>}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {APPROVAL_CHECKLIST.map(item => (
            <div key={item.key} className="flex items-start gap-3">
              <Checkbox
                id={item.key}
                checked={!!checklist[item.key]}
                onCheckedChange={checked => updateChecklist(item.key, checked)}
                disabled={!isReviewer}
              />
              <Label htmlFor={item.key} className="text-sm leading-relaxed cursor-pointer">
                {item.label}
              </Label>
            </div>
          ))}
          <div className="pt-3 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {allChecked ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-600 font-medium">全チェック完了</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  <span>{APPROVAL_CHECKLIST.filter(i => checklist[i.key]).length} / {APPROVAL_CHECKLIST.length} 完了</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> レビューコメント
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {comments.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {comments.map((c, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/50 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs">{c.author}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0">{c.field}</Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {c.timestamp && format(new Date(c.timestamp), "M/d HH:mm", { locale: ja })}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{c.comment}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={commentField}
                onChange={e => setCommentField(e.target.value)}
                className="h-8 text-xs rounded-md border border-input bg-background px-2"
              >
                <option value="全般">全般</option>
                <option value="クライアント名">クライアント名</option>
                <option value="印刷仕様">印刷仕様</option>
                <option value="価格">価格</option>
                <option value="納期">納期</option>
                <option value="費用">費用</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="コメントを入力..."
                rows={2}
                className="text-sm"
              />
              <Button variant="outline" size="icon" className="shrink-0 h-auto" onClick={addComment}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Approve/Reject */}
      {isReviewer && (estimate.status === "review_pending" || estimate.status === "review_in_progress") && (
        <div className="flex gap-3">
          <Button
            className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700"
            disabled={!allChecked}
            onClick={onApprove}
          >
            <CheckCircle2 className="w-4 h-4" /> 承認
          </Button>
          <Button variant="destructive" className="flex-1 gap-2" onClick={onReject}>
            <XCircle className="w-4 h-4" /> 差し戻し
          </Button>
        </div>
      )}
    </div>
  );
}
