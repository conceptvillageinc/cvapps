import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertTriangle, Check, FolderKanban, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import ProjectFormDialog from "@/components/projects/ProjectFormDialog";
import { PROJECT_STATUS_MAP } from "@/lib/constants";
import { normalizeClientName } from "@/components/clients/ClientCombobox";

// ============================================================================
// 見積をあとから案件に紐づける（案件を選ばずに作った見積・別の案件に付けてしまった見積）
//   同じ見積の版（第2版など）もまとめて紐づける。
//   この見積から作った納品書・請求書・入稿記録・連携先への発注書・議事録で、案件が無いもの
//   （または前の案件のもの）も、チェックを入れておけば一緒に紐づけ直す。
//   案件の金額（受注見込など）は変えない。
// ============================================================================

/**
 * @param {object} p
 * @param {object} p.estimate    今の見積
 * @param {object|null} p.current  今紐づいている案件
 * @param {(project: object|null) => void} p.onLinked
 */
export default function ProjectLinkDialog({ open, onOpenChange, estimate, current = null, onLinked }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState(null);
  const [withDocs, setWithDocs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const groupId = estimate.project_group_id || estimate.id;

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", "all", "link"],
    queryFn: () => db.entities.Project.list("-registered_at"),
    enabled: open,
  });
  // 同じ見積の版
  const { data: revisions = [] } = useQuery({
    queryKey: ["estimateRevisions", groupId],
    queryFn: () => db.entities.Estimate.filter({ project_group_id: groupId }),
    enabled: open,
  });
  const estimates = useMemo(() => {
    const list = revisions.length ? revisions : [estimate];
    return list.some((e) => e.id === estimate.id) ? list : [...list, estimate];
  }, [revisions, estimate]);
  const estimateIds = useMemo(() => estimates.map((e) => e.id), [estimates]);

  // この見積から作った帳票など（案件が無いもの・前の案件のもの）
  const { data: related = { delivery: [], invoice: [], printOrder: [], partnerOrder: [], meeting: [] } } = useQuery({
    queryKey: ["estimateRelatedDocs", estimateIds.join(",")],
    enabled: open && estimateIds.length > 0,
    queryFn: async () => {
      const safe = (p) => p.catch(() => []);
      const per = async (entity) => (await Promise.all(estimateIds.map((id) => safe(db.entities[entity].filter({ estimate_id: id }))))).flat();
      const [delivery, printOrder, partnerOrder, meeting] = await Promise.all([per("DeliveryNote"), per("PrintOrder"), per("PartnerOrder"), per("Meeting")]);
      const invoiceIds = [...new Set(delivery.map((d) => d.invoice_id).filter(Boolean))];
      const invoice = (await Promise.all(invoiceIds.map((id) => db.entities.Invoice.get(id).catch(() => null)))).filter(Boolean);
      return { delivery, invoice, printOrder, partnerOrder, meeting };
    },
  });
  const movable = (row) => !row.project_id || (current && row.project_id === current.id);
  const docs = {
    delivery: related.delivery.filter(movable),
    invoice: related.invoice.filter(movable),
    printOrder: related.printOrder.filter(movable),
    partnerOrder: related.partnerOrder.filter(movable),
    meeting: related.meeting.filter(movable),
  };
  const docLabels = [["delivery", "納品書"], ["invoice", "請求書"], ["printOrder", "入稿記録"], ["partnerOrder", "連携先への発注書"], ["meeting", "議事録"]]
    .filter(([k]) => docs[k].length > 0).map(([k, label]) => `${label} ${docs[k].length}件`);

  // 同じクライアントの案件を先に、進行中・完了を先に
  const sameClient = (p) => !!estimate.client_name && normalizeClientName(p.client_name) === normalizeClientName(estimate.client_name);
  const ordered = useMemo(() => {
    const rank = (p) => (sameClient(p) ? 0 : 2) + (p.status === "open" || p.status === "completed" ? 0 : 1);
    return [...projects].filter((p) => p.id !== current?.id).sort((a, b) => rank(a) - rank(b));
  }, [projects, current, estimate.client_name]);
  const mismatch = picked && estimate.client_name && picked.client_name && !sameClient(picked);

  const close = (v) => { if (!saving) { onOpenChange(v); if (!v) setPicked(null); } };

  const link = async (project) => {
    setSaving(true);
    try {
      const pid = project?.id || null;
      for (const e of estimates) {
        if (e.project_id === pid) continue;
        if (e.project_id && current && e.project_id !== current.id) continue; // 別の案件に付いている版は触らない
        await db.entities.Estimate.update(e.id, { project_id: pid });
      }
      if (withDocs && project) {
        const upd = async (entity, rows) => { for (const r of rows) await db.entities[entity].update(r.id, { project_id: pid }); };
        await upd("DeliveryNote", docs.delivery);
        await upd("Invoice", docs.invoice);
        await upd("PrintOrder", docs.printOrder);
        await upd("PartnerOrder", docs.partnerOrder);
        await upd("Meeting", docs.meeting);
      }
      for (const key of ["estimate", "estimates", "estimateRevisions", "projects", "project", "deliveryNotes", "deliveryNote", "invoices", "invoice", "printOrders", "partnerOrders", "meetings", "estimateRelatedDocs"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(project ? `案件 ${project.project_number} ${project.name} に紐づけました` : "案件から外しました");
      onLinked?.(project);
      setPicked(null);
      onOpenChange(false);
    } catch (e) {
      toast.error("紐づけできませんでした: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-xl" data-testid="project-link-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FolderKanban className="w-5 h-5" /> {current ? "紐づける案件を変える" : "案件に紐づける"}</DialogTitle>
            <DialogDescription className="text-xs">
              見積 {estimate.estimate_number}{estimates.length > 1 ? `（第1版〜第${estimates.length}版の ${estimates.length} 件をまとめて）` : ""}を案件に紐づけます。案件の金額（受注見込など）は変わりません
            </DialogDescription>
          </DialogHeader>

          {current && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex items-center gap-2">
              <span className="text-muted-foreground">今の案件</span>
              <span className="font-mono">{current.project_number}</span>
              <span className="truncate">{current.name}</span>
              <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs text-destructive" onClick={() => link(null)} disabled={saving}>案件から外す</Button>
            </div>
          )}

          <div className="rounded-md border">
            <Command>
              <CommandInput placeholder="案件番号・クライアント名・案件名で検索" />
              <CommandList className="max-h-72">
                {isLoading ? (
                  <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div>
                ) : (
                  <>
                    <CommandEmpty>該当する案件がありません。下のボタンから新しく作れます</CommandEmpty>
                    <CommandGroup heading={estimate.client_name ? `${estimate.client_name} の案件を先に表示` : undefined}>
                      {ordered.map((p) => {
                        const st = PROJECT_STATUS_MAP[p.status] || PROJECT_STATUS_MAP.open;
                        return (
                          <CommandItem key={p.id} value={`${p.project_number} ${p.client_name} ${p.name}`} onSelect={() => setPicked(p)} className={`data-[selected=true]:bg-muted data-[selected=true]:text-foreground ${picked?.id === p.id ? "bg-sky-50" : ""}`} data-testid="project-option">
                            <Check className={`w-3.5 h-3.5 shrink-0 ${picked?.id === p.id ? "opacity-100 text-primary" : "opacity-0"}`} />
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-mono text-muted-foreground">{p.project_number} · {p.registered_at}</div>
                              <div className="text-sm truncate">{p.name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{p.client_name}</div>
                            </div>
                            <span className={`text-[10px] rounded px-1.5 py-0.5 ${st.color}`}>{st.label}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </div>

          {picked && (
            <div className="space-y-2 text-xs">
              <p>紐づける案件：<b className="font-mono">{picked.project_number}</b> {picked.name}<span className="text-muted-foreground">（{picked.client_name}）</span></p>
              {mismatch && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-900">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  見積のクライアント（{estimate.client_name}）と案件のクライアント（{picked.client_name}）が違います。このままでよければ紐づけてください（見積のクライアント名は変わりません）
                </p>
              )}
              {docLabels.length > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox checked={withDocs} onCheckedChange={(v) => setWithDocs(!!v)} className="mt-0.5" />
                  <span>この見積から作った {docLabels.join("・")} も、同じ案件に紐づける</span>
                </label>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setCreateOpen(true)} disabled={saving}><Plus className="w-3.5 h-3.5" /> 新しい案件を作って紐づける</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => close(false)} disabled={saving}>キャンセル</Button>
              <Button type="button" size="sm" className="gap-1" onClick={() => link(picked)} disabled={!picked || saving} data-testid="project-link-save">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderKanban className="w-3.5 h-3.5" />} この案件に紐づける
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaults={{ client_name: estimate.client_name, name: estimate.estimate_title, due_date: estimate.desired_delivery_date }}
        onSaved={(row) => { setCreateOpen(false); setPicked(row); }}
      />
    </>
  );
}
