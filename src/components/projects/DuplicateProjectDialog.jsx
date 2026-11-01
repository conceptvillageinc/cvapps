import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/AuthContext";
import { todayString } from "@/lib/fiscal";
import { STATUS_MAP } from "@/lib/constants";
import SubmissionBadge from "@/components/estimates/SubmissionBadge";
import { duplicateProject, defaultDuplicateEstimateIds } from "@/lib/projectDuplicate";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

/**
 * 案件を複製する（過去とほぼ同じ内容の案件を作る）。
 *   見積は選んだものだけ写して新しい案件に紐づける。納品書・請求書などは写さない。
 */
export default function DuplicateProjectDialog({ open, onOpenChange, project, estimates = [] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [registeredAt, setRegisteredAt] = useState(todayString());
  const [dueDate, setDueDate] = useState("");
  const [copyNotes, setCopyNotes] = useState(true);
  const [picked, setPicked] = useState(() => new Set());

  useEffect(() => {
    if (!open || !project) return;
    setName(project.name || "");
    setRegisteredAt(todayString());
    setDueDate("");
    setCopyNotes(true);
    setPicked(new Set(defaultDuplicateEstimateIds(estimates)));
  }, [open, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPicked = estimates.length > 0 && estimates.every((e) => picked.has(e.id));

  const run = useMutation({
    mutationFn: () => duplicateProject(db, project, {
      name: name.trim(), registeredAt, dueDate, copyNotes,
      estimates: estimates.filter((e) => picked.has(e.id)),
      userId: user?.id || null,
    }),
    onSuccess: ({ project: created, estimates: copies }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success(`案件 ${created.project_number} を作成しました${copies.length ? `（見積 ${copies.length}件を複製）` : ""}`);
      onOpenChange(false);
      navigate(`/projects/${created.id}`);
    },
    onError: (err) => toast.error("複製できませんでした: " + (err?.message || "不明なエラー")),
  });

  if (!project) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !run.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-lg" data-testid="duplicate-project">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Copy className="w-4 h-4" /> 案件を複製</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {project.project_number}　{project.client_name} の案件をもとに、新しい案件を作ります。
            クライアント・受注確度・見込みの金額を写し、案件番号と登録日は新しくなります（フェーズは未着手）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">案件名</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" aria-label="案件名" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">登録日</Label>
              <Input type="date" value={registeredAt} onChange={(e) => setRegisteredAt(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">完了予定 <span className="text-muted-foreground font-normal">（あとでも入れられます）</span></Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
            </div>
          </div>
          {project.notes && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={copyNotes} onCheckedChange={(v) => setCopyNotes(!!v)} /> 案件メモも写す
            </label>
          )}

          <div className="rounded-md border">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <p className="text-xs font-medium">見積も複製する（チェックしたものだけ）</p>
              {estimates.length > 1 && (
                <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setPicked(allPicked ? new Set() : new Set(estimates.map((e) => e.id)))}>
                  {allPicked ? "すべて外す" : "すべて選ぶ"}
                </button>
              )}
            </div>
            {estimates.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">この案件には見積がありません</p>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y">
                {estimates.map((e) => {
                  const es = STATUS_MAP[e.status] || STATUS_MAP.draft;
                  return (
                    <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-muted/30" data-testid="duplicate-estimate-row">
                      <Checkbox checked={picked.has(e.id)} onCheckedChange={() => toggle(e.id)} aria-label={`${e.estimate_number}を複製する`} />
                      <span className="font-mono text-muted-foreground shrink-0">{e.estimate_number}</span>
                      <span className="flex-1 truncate">{e.estimate_title || e.print_type || "（件名なし）"}</span>
                      {e.revision_label && <span className="text-[10px] text-muted-foreground shrink-0">{e.revision_label}</span>}
                      <SubmissionBadge estimate={e} size="xs" />
                      <span className={`rounded px-1 text-[10px] shrink-0 ${es.color}`}>{es.label}</span>
                      <span className="tabular-nums shrink-0 w-20 text-right">{e.total_amount ? yen(e.total_amount) : "—"}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              複製した見積は、新しい見積番号の下書き（未提出）になり、新しい案件に紐づきます。
              {estimates.length > 1 && " 最初は、同じ見積の版が複数あるときは一番新しい版だけ、失注の見積は外してチェックしています。"}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">納品書・請求書・発注書・入稿記録・工程表・実績は複製しません（元の案件に残ります）。</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={run.isPending}>キャンセル</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending || !name.trim() || !registeredAt} className="gap-1.5" data-testid="duplicate-run">
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
            複製する{picked.size ? `（見積 ${picked.size}件も）` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
