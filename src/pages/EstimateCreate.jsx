import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { db } from "@/api/db";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERSON_IN_CHARGE_OPTIONS, EMAIL_TO_PERSON_MAP, DEFAULT_VALIDITY_MONTHS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Save, ArrowLeft, ChevronsUpDown, Check, Plus, FolderKanban } from "lucide-react";
import ProjectFormDialog from "@/components/projects/ProjectFormDialog";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { generateEstimateNumber } from "@/lib/estimateNumber";

export default function EstimateCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [project, setProject] = useState(null);

  // 案件詳細の「この案件の見積を作成」から来た場合は、その案件を固定する
  const lockedProjectId = searchParams.get("project");
  // クライアントカルテから来た場合: クライアント名の初期値と、複製元の見積
  const presetClient = searchParams.get("client") || "";
  const copyFromId = searchParams.get("copy_from");
  // 選んだ明細だけ複製するとき（カルテの「選択した明細を複製」）
  const copyLineIds = searchParams.get("lines");
  const { data: copyFrom } = useQuery({
    queryKey: ["estimate", copyFromId],
    queryFn: () => db.entities.Estimate.get(copyFromId),
    enabled: !!copyFromId,
  });
  const { data: lockedProject } = useQuery({
    queryKey: ["project", lockedProjectId],
    queryFn: () => db.entities.Project.get(lockedProjectId),
    enabled: !!lockedProjectId,
  });

  // 進行中の案件（新しい順）。件名・クライアントの初期値に使う。
  const { data: openProjects = [] } = useQuery({
    queryKey: ["projects", "open"],
    queryFn: () => db.entities.Project.filter({ status: "open" }, "-registered_at", 300),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });

  // freeeインポートの重複登録対策として、同一名前は1件に集約して表示
  // 見積作成回数（quote_count）の多い順で並べる（同一件数の場合は名前順）
  const uniqueClients = Array.from(
    new Map(clients.map(c => [c.name, c])).values()
  ).sort((a, b) => {
    const diff = (b.quote_count || 0) - (a.quote_count || 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, "ja");
  });

  const [formData, setFormData] = useState({
    client_name: presetClient,
    estimate_title: "",
    desired_delivery_date: "",
    estimate_date: format(new Date(), "yyyy-MM-dd"),
    validity_period_months: DEFAULT_VALIDITY_MONTHS,
    additional_notes: "",
    status: "draft",
    freee_status: "not_linked",
    schema_version: 2,
    line_items: [],
    // ログイン中のメールアドレスから見積作成担当者の初期値を自動選択（プルダウンから変更可能）
    person_in_charge: EMAIL_TO_PERSON_MAP[user?.email] || "",
  });

  // 認証情報の読み込みが遅れるケース（直接URLアクセス等）に備え、ログイン情報確定後にもデフォルト値を補完
  useEffect(() => {
    const defaultName = EMAIL_TO_PERSON_MAP[user?.email];
    if (defaultName) {
      setFormData(prev => prev.person_in_charge ? prev : { ...prev, person_in_charge: defaultName });
    }
  }, [user]);

  // 案件を選んだら、クライアント名と件名の初期値を案件から引き継ぐ
  const applyProject = (p) => {
    setProject(p);
    if (!p) return;
    setFormData(prev => ({
      ...prev,
      client_name: p.client_name || prev.client_name,
      estimate_title: prev.estimate_title || p.name || "",
      desired_delivery_date: prev.desired_delivery_date || p.due_date || "",
    }));
  };

  useEffect(() => {
    if (lockedProject) applyProject(lockedProject);
     
  }, [lockedProject?.id]);

  // 複製元の見積から件名・仕様・明細・備考を引き継ぐ（明細の id は振り直し、複製元を残す）
  useEffect(() => {
    if (!copyFrom) return;
    const uid = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const wanted = copyLineIds ? new Set(copyLineIds.split(",").filter(Boolean)) : null;
    const source = (copyFrom.schema_version === 2 ? (copyFrom.line_items || []) : [])
      // 選択複製のときは選んだ行だけ（見出し行・小計・自動計算行は付けない）
      .filter((li) => !wanted || wanted.has(li.id));
    const items = source.map((li) => ({ ...li, id: uid(), ...(li.row_type !== "text" && li.row_type !== "subtotal" && li.source_type !== "rule" ? { copied_from: copyFrom.estimate_number, copied_from_id: copyFrom.id } : {}) }));
    setFormData(prev => ({
      ...prev,
      client_name: prev.client_name || copyFrom.client_name || "",
      estimate_title: prev.estimate_title || copyFrom.estimate_title || "",
      additional_notes: copyFrom.additional_notes || "",
      print_specs: (copyFrom.print_specs || []).map((sp) => ({ ...sp, id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` })),
      line_items: items,
      tax_inclusive: !!copyFrom.tax_inclusive,
      total_amount: computeEstimateTotals(items, { taxInclusive: !!copyFrom.tax_inclusive }).total,
    }));
  }, [copyFrom, copyLineIds]);

  const handleSave = async () => {
    if (!project) {
      toast.error("案件を選択するか、新しく作成してください");
      return;
    }
    if (!formData.client_name || !formData.desired_delivery_date) {
      toast.error("クライアント名、希望納期は必須です");
      return;
    }
    setSaving(true);
    let created;
    try {
      const estimateNumber = await generateEstimateNumber(db);
      created = await db.entities.Estimate.create({
        ...formData,
        estimate_number: estimateNumber,
        project_group_id: estimateNumber,
        project_id: project.id,
        revision_label: "初回",
        // 受注確度・フェーズは案件の属性。見積側には表示用の写しを持つ
        deal_probability: project.deal_probability || "A",
        phase: project.phase || "引き合い",
      });
    } catch (err) {
      setSaving(false);
      toast.error("見積を作成できませんでした: " + (err?.message || "不明なエラー"));
      return;
    }

    // 見積作成頻度をクライアント一覧の表示順に反映させるため、quote_countを更新
    try {
      const matchedClient = clients.find(c => c.name === formData.client_name);
      if (matchedClient) {
        await db.entities.Client.update(matchedClient.id, {
          quote_count: (matchedClient.quote_count || 0) + 1,
        });
      } else {
        // クライアント一覧にない新規名前で作成された場合は、Clientを新規登録
        await db.entities.Client.create({ name: formData.client_name, quote_count: 1 });
      }
    } catch (e) {
      // 頻度更新の失敗は見積作成自体を妨げない
      console.error("quote_countの更新に失敗しました", e);
    }

    toast.success("見積を作成しました");
    navigate(`/estimates/${created.id}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">新規見積作成</h1>
            <p className="text-xs text-muted-foreground mt-0.5">案件を選んで基本情報を入力後、見積書画面で明細を追加します</p>
            {copyFrom && (
              <p className="text-xs text-primary mt-1">見積 {copyFrom.estimate_number}「{copyFrom.estimate_title || copyFrom.print_type || ""}」の{copyLineIds ? "選んだ明細" : "件名・仕様・明細・備考"}を複製して作ります（作成後に見積書画面で直せます）</p>
            )}
          </div>
        </div>
      </div>

      {/* 案件 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2"><FolderKanban className="w-4 h-4" /> 案件 <span className="text-destructive text-xs font-normal">*</span></CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {project ? (
            <div className="flex items-start justify-between gap-3 rounded-md border p-3 bg-muted/20">
              <div className="min-w-0">
                <p className="text-xs font-mono text-muted-foreground">{project.project_number}</p>
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground truncate">{project.client_name}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link to={`/projects/${project.id}`} className="text-xs text-primary hover:underline">詳細</Link>
                {!lockedProjectId && (
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setProject(null)}>変更</Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="flex-1 justify-between font-normal">
                    進行中の案件から選ぶ
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="案件番号・クライアント名・案件名で検索" />
                    <CommandList>
                      <CommandEmpty>該当する案件がありません。右のボタンから新規作成できます</CommandEmpty>
                      <CommandGroup>
                        {openProjects.map(p => (
                          <CommandItem
                            key={p.id}
                            value={`${p.project_number} ${p.client_name} ${p.name}`}
                            onSelect={() => { applyProject(p); setProjectPopoverOpen(false); }}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-mono text-muted-foreground">{p.project_number} · {p.registered_at}</div>
                              <div className="text-sm truncate">{p.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{p.client_name}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Button variant="secondary" className="gap-1.5" onClick={() => setProjectDialogOpen(true)}>
                <Plus className="w-4 h-4" /> 新規案件を作成
              </Button>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            見積は案件に紐付けて管理します。受注確度・フェーズ・入金予定は案件側で持ちます
          </p>
        </CardContent>
      </Card>

      <ProjectFormDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        defaults={{ client_name: formData.client_name, name: formData.estimate_title, due_date: formData.desired_delivery_date }}
        onSaved={(row) => applyProject(row)}
      />

      {/* 基本情報 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">クライアント名 <span className="text-destructive">*</span></Label>
            <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={clientPopoverOpen}
                  className="w-full justify-between font-normal"
                >
                  {formData.client_name || "クライアントを検索・選択"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput
                    placeholder="クライアント名を入力して検索"
                    value={formData.client_name || ""}
                    onValueChange={value => setFormData(prev => ({ ...prev, client_name: value }))}
                  />
                  <CommandList>
                    <CommandEmpty>一致するクライアントがありません（このまま新規入力として使用できます）</CommandEmpty>
                    <CommandGroup>
                      {uniqueClients.map(c => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => { setFormData(prev => ({ ...prev, client_name: c.name })); setClientPopoverOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", formData.client_name === c.name ? "opacity-100" : "opacity-0")} />
                          <div>
                            <div>{c.name}</div>
                            {c.contact_person && <div className="text-xs text-muted-foreground">{c.contact_person}</div>}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">見積作成担当者</Label>
            <Select
              value={formData.person_in_charge || ""}
              onValueChange={value => setFormData(prev => ({ ...prev, person_in_charge: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="担当者を選択" />
              </SelectTrigger>
              <SelectContent>
                {PERSON_IN_CHARGE_OPTIONS.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">件名</Label>
            <Input
              value={formData.estimate_title}
              onChange={e => setFormData(prev => ({ ...prev, estimate_title: e.target.value }))}
              placeholder="例: チラシ制作費"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">希望納期 <span className="text-destructive">*</span></Label>
            <Input
              type="date"
              value={formData.desired_delivery_date}
              onChange={e => setFormData(prev => ({ ...prev, desired_delivery_date: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* 操作ボタンは入力の流れの最後（右下）に置く */}
      <div className="flex items-center justify-end gap-2 pb-6">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={saving}>キャンセル</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-2" size="lg">
          <Save className="w-4 h-4" /> 作成して明細入力へ
        </Button>
      </div>
    </div>
  );
}
