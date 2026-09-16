import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Pencil, Trash2, Plus, FileText, Loader2, Repeat, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { getDealProbabilityColor, getPhaseColor, PROJECT_STATUS_MAP, STATUS_MAP, INVOICE_DELIVERY_METHODS } from "@/lib/constants";
import ProjectFormDialog from "@/components/projects/ProjectFormDialog";

const yen = (n) => (n === null || n === undefined ? "—" : `¥${Math.round(Number(n)).toLocaleString()}`);

function Field({ label, children, className = "" }) {
  return (
    <div className={`space-y-0.5 ${className}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dealProbabilityOptions, phaseOptions } = useSystemSettings();
  const [editOpen, setEditOpen] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.entities.Project.get(id),
    enabled: !!id,
  });

  const { data: estimates = [] } = useQuery({
    queryKey: ["estimates", "byProject", id],
    queryFn: () => db.entities.Estimate.filter({ project_id: id }, "-created_date"),
    enabled: !!id,
  });

  const { data: client } = useQuery({
    queryKey: ["client", project?.client_id],
    queryFn: () => db.entities.Client.get(project.client_id),
    enabled: !!project?.client_id,
  });

  const quickUpdate = useMutation({
    mutationFn: (updates) => db.entities.Project.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err) => toast.error("更新できませんでした: " + (err?.message || "不明なエラー")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => db.entities.Project.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("案件を削除しました");
      navigate("/projects");
    },
    onError: (err) => toast.error("削除できませんでした: " + (err?.message || "不明なエラー")),
  });

  if (isLoading || !project) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const st = PROJECT_STATUS_MAP[project.status] || PROJECT_STATUS_MAP.open;
  const legacy = project.legacy_data || null;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/projects")} className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-mono text-muted-foreground">{project.project_number}</p>
            <h1 className="text-xl font-bold tracking-tight leading-tight break-words">{project.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{project.client_name}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <Badge className={`text-[10px] ${st.color}`}>{st.label}</Badge>
              <Badge className={`text-[10px] ${getDealProbabilityColor(project.deal_probability)}`}>{project.deal_probability}</Badge>
              <Badge className={`text-[10px] ${getPhaseColor(project.phase)}`}>{project.phase}</Badge>
              {project.is_recurring && (
                <Badge className="text-[10px] bg-teal-100 text-teal-700 hover:bg-teal-100 gap-1"><Repeat className="w-2.5 h-2.5" /> 定期売上</Badge>
              )}
              {project.recurring_template_id && (
                <Link to="/projects/recurring" className="text-[10px] text-teal-700 hover:underline">ひな形から自動生成</Link>
              )}
              {legacy && <Badge variant="outline" className="text-[10px] font-normal">freee販売から取込</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setEditOpen(true)}>
            <Pencil className="w-3.5 h-3.5" /> 編集
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" /> 削除
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>案件を削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  紐付いている見積（{estimates.length}件）は削除されず、案件との紐付けだけが外れます。この操作は取り消せません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-destructive text-destructive-foreground">削除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* 進捗（その場で変更できる） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">進捗</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">受注確度</p>
            <Select value={project.deal_probability} onValueChange={(v) => quickUpdate.mutate({ deal_probability: v, is_recurring: project.is_recurring || /定期/.test(v) })}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Set([...dealProbabilityOptions, project.deal_probability].filter(Boolean))].map((o) => (
                  <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">フェーズ</p>
            <Select value={project.phase} onValueChange={(v) => quickUpdate.mutate({ phase: v })}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Set([...phaseOptions, project.phase].filter(Boolean))].map((o) => (
                  <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">状態</p>
            <Select value={project.status} onValueChange={(v) => quickUpdate.mutate({ status: v })}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PROJECT_STATUS_MAP).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 金額 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">金額（税抜）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">見込</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="受注見込"><span className="tabular-nums font-medium">{yen(project.expected_revenue)}</span></Field>
                <Field label="発注見込"><span className="tabular-nums">{yen(project.expected_cost)}</span></Field>
                <Field label="その他費用"><span className="tabular-nums">{yen(project.other_cost)}</span></Field>
                <Field label="粗利見込">
                  <span className={`tabular-nums font-medium ${Number(project.expected_gross_profit) < 0 ? "text-destructive" : "text-emerald-700"}`}>{yen(project.expected_gross_profit)}</span>
                  {Number(project.expected_revenue) > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      {Math.round((Number(project.expected_gross_profit) / Number(project.expected_revenue)) * 100)}%
                    </span>
                  )}
                </Field>
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-[10px] text-muted-foreground mb-1.5">実績</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="受注合計"><span className="tabular-nums font-medium">{yen(project.confirmed_revenue)}</span></Field>
                <Field label="発注合計"><span className="tabular-nums">{yen(project.confirmed_cost)}</span></Field>
                <Field label="粗利（実績）" className="col-span-2">
                  <span className="tabular-nums font-medium">{yen(project.actual_gross_profit)}</span>
                </Field>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">実績は今後、納品書・請求書の登録から自動で集計します。</p>
            </div>
          </CardContent>
        </Card>

        {/* 日程・クライアント */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">日程・クライアント</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Field label="案件登録日">{project.registered_at}</Field>
              <Field label="完了予定日">{project.due_date || "—"}</Field>
              <Field label="入金予定日">{project.payment_due_date || "—"}</Field>
              <Field label="仕入先 支払予定日">{project.vendor_payment_date || "—"}</Field>
            </div>
            <div className="border-t pt-3 space-y-2">
              <Field label="クライアント">
                {client ? (
                  <Link to="/clients" className="hover:underline inline-flex items-center gap-1">{client.name} <ExternalLink className="w-3 h-3 text-muted-foreground" /></Link>
                ) : (
                  <span>{project.client_name} <span className="text-[10px] text-muted-foreground">（マスタ未登録）</span></span>
                )}
              </Field>
              {client && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="請求書送付">
                    {INVOICE_DELIVERY_METHODS[client.invoice_delivery_method] || "—"}
                    {client.has_recurring_billing && <span className="text-[10px] text-teal-700 ml-1">定期あり</span>}
                  </Field>
                  <Field label="担当者">{client.contact_person || "—"}</Field>
                  {client.invoice_delivery_notes && (
                    <Field label="送付の補足" className="col-span-2"><span className="text-amber-700">{client.invoice_delivery_notes}</span></Field>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* メモ */}
      {project.notes && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">社内メモ</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap break-words">{project.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* 見積 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> 見積（{estimates.length}件）</CardTitle>
            <Button size="sm" className="gap-1.5 text-xs h-8" onClick={() => navigate(`/estimates/new?project=${project.id}`)}>
              <Plus className="w-3.5 h-3.5" /> この案件の見積を作成
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {estimates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">まだ見積がありません</p>
          ) : (
            <div className="divide-y">
              {estimates.map((e) => {
                const es = STATUS_MAP[e.status] || STATUS_MAP.draft;
                return (
                  <Link key={e.id} to={`/estimates/${e.id}`} className="flex items-center gap-3 py-2.5 hover:bg-muted/40 -mx-2 px-2 rounded">
                    <span className="text-xs font-mono text-muted-foreground w-28 shrink-0">{e.estimate_number}</span>
                    <span className="text-sm flex-1 truncate">{e.estimate_title || e.print_type || "（件名なし）"}</span>
                    {e.revision_label && <Badge variant="outline" className="text-[9px] font-normal">{e.revision_label}</Badge>}
                    {e.is_final_submitted && <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100">最終提出版</Badge>}
                    <Badge className={`text-[9px] ${es.color}`}>{es.label}</Badge>
                    <span className="text-sm tabular-nums w-28 text-right">{e.total_amount ? yen(e.total_amount) : "—"}</span>
                    <span className="text-[10px] text-muted-foreground w-12 text-right">{format(new Date(e.created_date), "M/d")}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 取込元 */}
      {legacy && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">freee販売の元データを表示</summary>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 rounded-md border p-3">
            {Object.entries(legacy).filter(([, v]) => v !== "" && v !== null).map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <span className="shrink-0 w-32 text-muted-foreground/70">{k}</span>
                <span className="break-all whitespace-pre-wrap">{String(v)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={project} />
    </div>
  );
}
