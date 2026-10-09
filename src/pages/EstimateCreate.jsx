import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { db } from "@/api/db";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { linesToEstimateItems, defaultSelectedRows, groupLabel, COST_SHEET_STATUS } from "@/lib/costSheets";
import CarryOverPanel from "@/components/estimates/CarryOverPanel";
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
import { conditionsToEstimate } from "@/lib/meetingConditions";
import { draftToLineItems, draftAmount, draftCost } from "@/lib/meetingChat";
import { linesFromOrder } from "@/lib/printOrders";
import { estimateQuery } from "@/lib/estimateQuery";

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
  const meetingId = searchParams.get("meeting");
  const { data: meeting } = useQuery({
    queryKey: ["meeting", meetingId],
    queryFn: () => db.entities.Meeting.get(meetingId),
    enabled: !!meetingId,
  });
  // 議事録から作るときは、議事録に紐づく案件をそのまま使う
  const lockedProjectId = searchParams.get("project") || meeting?.project_id || null;
  // クライアントカルテから来た場合: クライアント名の初期値と、複製元の見積
  const presetClient = searchParams.get("client") || "";
  const copyFromId = searchParams.get("copy_from");
  const costSheetId = searchParams.get("cost_sheet"); // クライアントカルテの「社内見積（原価計算表）」から
  const costSheetRows = (searchParams.get("rows") || "").split(",").map(Number).filter((n) => n > 0); // 選んだ行（シートの行番号）
  // 選んだ明細だけ複製するとき（カルテの「選択した明細を複製」）
  const copyLineIds = searchParams.get("lines");
  const chatId = searchParams.get("chat"); // 議事録の「AI に依頼」の見積のたたき台から
  const reorderId = searchParams.get("reorder"); // 入稿履歴の「この内容で追加印刷の見積を作る」から
  const { data: copyFrom } = useQuery(estimateQuery(copyFromId, { fresh: true }));
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

  // 議事録の見積条件から、クライアント・件名・印刷仕様・明細・予算を引き継ぐ
  useEffect(() => {
    if (!meeting) return;
    const from = conditionsToEstimate(meeting.estimate_conditions, meeting);
    setFormData(prev => ({
      ...prev,
      client_name: prev.client_name || (meeting.client_name && meeting.client_name !== "CV自社" ? meeting.client_name : ""),
      estimate_title: prev.estimate_title || from.estimate_title,
      desired_delivery_date: prev.desired_delivery_date || from.desired_delivery_date,
      meeting_id: meeting.id,
      meeting_budget: from.meeting_budget,
      // AI のたたき台から作るときは、明細はたたき台の方を使う（見積条件の印刷仕様・明細は入れない）
      ...(chatId ? {} : { print_specs: from.print_specs, line_items: from.line_items, total_amount: computeEstimateTotals(from.line_items).total }),
    }));
  }, [meeting]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: costSheet } = useQuery({ queryKey: ["costSheet", costSheetId], queryFn: () => db.entities.CostSheet.get(costSheetId), enabled: !!costSheetId });
  // 原価計算表（社内見積）の行を明細にする。カルテで選んだ行（無ければ初期選択と同じ行）。右の「引き継ぐ明細」で選び直せる
  const [costRows, setCostRows] = useState(null); // Set<行番号>
  useEffect(() => {
    if (!costSheet || costRows) return;
    setCostRows(new Set(costSheetRows.length ? costSheetRows : defaultSelectedRows(costSheet)));
    setFormData((prev) => ({ ...prev, client_name: prev.client_name || costSheet.client_name || "", estimate_title: prev.estimate_title || costSheet.title || "" }));
  }, [costSheet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!costSheet || !costRows) return;
    const items = costRows.size ? linesToEstimateItems(costSheet, [...costRows]) : [];
    setFormData((prev) => ({ ...prev, line_items: items, total_amount: computeEstimateTotals(items).total }));
  }, [costSheet, costRows]);

  // 議事録の「AI に依頼」の見積のたたき台。左の「引き継ぐ明細」で選び直せる
  const { data: chatMsg } = useQuery({ queryKey: ["meetingChatMessage", chatId], queryFn: () => db.entities.MeetingChatMessage.get(chatId), enabled: !!chatId });
  const chatDraft = chatMsg?.draft?.items?.length ? chatMsg.draft : null;
  const [chatKeys, setChatKeys] = useState(null); // Set<たたき台の行 key>
  useEffect(() => {
    if (!chatDraft || chatKeys) return;
    setChatKeys(new Set(chatDraft.items.map((it) => it.key)));
    setFormData((prev) => ({ ...prev, estimate_title: chatDraft.title || prev.estimate_title }));
  }, [chatDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chatDraft || !chatKeys) return;
    const items = draftToLineItems(chatDraft, [...chatKeys], `議事録の AI 依頼（${chatMsg.author_name || ""}）`);
    setFormData((prev) => ({ ...prev, line_items: items, total_amount: computeEstimateTotals(items).total }));
  }, [chatDraft, chatKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // 複製元の見積から件名・仕様・明細・備考を引き継ぐ（明細の id は振り直し、複製元を残す）。右の「引き継ぐ明細」で選び直せる
  const copySource = useMemo(() => (copyFrom?.schema_version === 2 ? (copyFrom.line_items || []) : []), [copyFrom]);
  const copyDefaultIds = useMemo(() => {
    const wanted = copyLineIds ? new Set(copyLineIds.split(",").filter(Boolean)) : null;
    return copySource.filter((li) => !wanted || wanted.has(li.id)).map((li) => li.id);
  }, [copySource, copyLineIds]);
  const [copyIds, setCopyIds] = useState(null); // Set<明細 id>
  useEffect(() => {
    if (!copyFrom || copyIds) return;
    setCopyIds(new Set(copyDefaultIds));
    setFormData(prev => ({
      ...prev,
      client_name: prev.client_name || copyFrom.client_name || "",
      estimate_title: prev.estimate_title || copyFrom.estimate_title || "",
      additional_notes: copyFrom.additional_notes || "",
      print_specs: (copyFrom.print_specs || []).map((sp) => ({ ...sp, id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` })),
      tax_inclusive: !!copyFrom.tax_inclusive,
    }));
  }, [copyFrom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!copyFrom || !copyIds) return;
    const uid = () => `li_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const items = copySource.filter((li) => copyIds.has(li.id))
      .map((li) => ({ ...li, id: uid(), ...(li.row_type !== "text" && li.row_type !== "subtotal" && li.source_type !== "rule" ? { copied_from: copyFrom.estimate_number, copied_from_id: copyFrom.id } : {}) }));
    setFormData(prev => ({ ...prev, line_items: items, total_amount: computeEstimateTotals(items, { taxInclusive: !!copyFrom.tax_inclusive }).total }));
  }, [copyFrom, copyIds, copySource]);

  // 右の「引き継ぐ明細」パネルに出す内容
  // 追加印刷: 入稿記録の明細を引き継ぐ（左の「引き継ぐ明細」で外せる）
  const { data: reorder } = useQuery({ queryKey: ["printOrder", reorderId], queryFn: () => db.entities.PrintOrder.get(reorderId), enabled: !!reorderId, retry: false });
  // 内訳のある入稿記録（社内見積の小見出しごとにまとめたもの）は、内訳の行ごとの明細にする
  const reorderLines = useMemo(() => (reorder ? linesFromOrder(reorder).map((li, i) => ({ ...li, _key: `r${i}` })) : null), [reorder]);
  const [reorderOn, setReorderOn] = useState(null); // Set<"r0" | "r1" …>
  useEffect(() => {
    if (!reorder || !reorderLines || reorderOn) return;
    setReorderOn(new Set(reorderLines.map((li) => li._key)));
    setFormData((prev) => ({ ...prev, client_name: prev.client_name || reorder.client_name || "", estimate_title: prev.estimate_title || `${reorder.name}（追加印刷）` }));
  }, [reorder]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reorderLines || !reorderOn) return;
    const items = reorderLines.filter((li) => reorderOn.has(li._key)).map(({ _key, ...li }) => li);
    setFormData((prev) => ({ ...prev, line_items: items, total_amount: computeEstimateTotals(items).total }));
  }, [reorderLines, reorderOn]);

  // このクライアントの前回の入稿（引き継ぐ明細が無いときに出す）
  const { data: clientOrders = [] } = useQuery({
    queryKey: ["printOrders", "recent", formData.client_name],
    queryFn: () => db.entities.PrintOrder.filter({ client_name: formData.client_name }, "-ordered_on", 3),
    enabled: !!formData.client_name && !reorderId,
    retry: false,
  });
  const recentOrders = reorderId ? [] : clientOrders;

  const carry = useMemo(() => {
    const toggleIn = (setter) => (key) => setter((prev) => { const t = new Set(prev || []); if (t.has(key)) t.delete(key); else t.add(key); return t; });
    if (costSheet && costRows) {
      const st = COST_SHEET_STATUS[costSheet.status]?.label || "";
      const rows = (costSheet.lines || []).map((l) => {
        const [it] = linesToEstimateItems(costSheet, [l.row]);
        return { key: l.row, label: it?.name || l.name || "（項目名なし）", sub: [groupLabel(l.group), l.vendor, l.final ? "✓最終納品" : ""].filter(Boolean).join("・"), qty: it?.quantity, unit: it?.unit, unitPrice: it?.unit_price, amount: it?.amount ?? 0, cost: it?.cost_price != null ? Number(it.cost_price) * (Number(it.quantity) || 1) : null };
      });
      return {
        title: `社内見積「${costSheet.title}」`, subtitle: [costSheet.period, st, (costSheet.authors || []).join("・")].filter(Boolean).join("・"),
        linkTo: costSheet.client_id ? `/clients/${costSheet.client_id}` : null, linkLabel: "クライアントカルテで開く",
        rows, selected: costRows, onToggle: toggleIn(setCostRows), onSetAll: (keys) => setCostRows(new Set(keys)), defaultKeys: defaultSelectedRows(costSheet), taxInclusive: false,
      };
    }
    if (reorder && reorderLines && reorderOn) {
      return {
        title: `前回の入稿「${reorder.name}」`, subtitle: [`入稿 ${String(reorder.ordered_on).replace(/-/g, "/")}`, reorder.vendor, reorder.estimate_number ? `見積 ${reorder.estimate_number}` : ""].filter(Boolean).join("・"),
        linkTo: reorder.estimate_id ? `/estimates/${reorder.estimate_id}` : null, linkLabel: "前回の見積を開く",
        rows: reorderLines.map((li, i) => ({ key: li._key, label: li.name, sub: i === 0 ? [reorder.source_url ? `入稿先 ${reorder.source_url}` : "", reorder.memo].filter(Boolean).join("・") : (li.source_url ? `入稿先 ${li.source_url}` : ""), qty: li.quantity, unit: li.unit, unitPrice: li.unit_price, amount: li.amount, cost: li.cost_price != null ? li.cost_price * li.quantity : null })),
        selected: reorderOn, onToggle: toggleIn(setReorderOn), onSetAll: (keys) => setReorderOn(new Set(keys)), defaultKeys: reorderLines.map((li) => li._key), taxInclusive: false,
      };
    }
    if (chatDraft && chatKeys) {
      const rows = chatDraft.items.map((it) => ({
        key: it.key, label: it.spec ? `${it.name}（${it.spec}）` : it.name,
        sub: [it.group, it.needs_check ? "要確認" : "", it.basis].filter(Boolean).join("・"),
        qty: it.quantity, unit: it.unit, unitPrice: it.unit_price, amount: draftAmount(it), cost: draftCost(it) || null,
      }));
      return {
        title: `AI の見積のたたき台${chatDraft.title ? `「${chatDraft.title}」` : ""}`, subtitle: [meeting?.title ? `議事録「${meeting.title}」` : "", chatMsg.author_name ? `${chatMsg.author_name} の依頼` : ""].filter(Boolean).join("・"),
        linkTo: meeting ? `/meetings/${meeting.id}` : null, linkLabel: "議事録を開く",
        rows, selected: chatKeys, onToggle: toggleIn(setChatKeys), onSetAll: (keys) => setChatKeys(new Set(keys)), defaultKeys: chatDraft.items.map((it) => it.key), taxInclusive: false,
      };
    }
    if (copyFrom && copyIds) {
      const rows = copySource.map((li) => ({
        key: li.id, kind: li.row_type, label: li.row_type === "text" ? (li.text || "（見出し）") : (li.name || "（項目名なし）"),
        sub: li.row_type === "text" ? "" : [li.category, li.source_ref].filter(Boolean).join("・"),
        qty: li.quantity, unit: li.unit, unitPrice: li.unit_price, amount: li.amount, cost: li.cost_price != null && li.cost_price !== "" ? Number(li.cost_price) * (Number(li.quantity) || 1) : null,
      }));
      return {
        title: `見積 ${copyFrom.estimate_number}「${copyFrom.estimate_title || copyFrom.print_type || ""}」`, subtitle: copyFrom.client_name || "",
        linkTo: `/estimates/${copyFrom.id}`, linkLabel: "元の見積を開く",
        rows, selected: copyIds, onToggle: toggleIn(setCopyIds), onSetAll: (keys) => setCopyIds(new Set(keys)), defaultKeys: copyDefaultIds, taxInclusive: !!copyFrom.tax_inclusive,
      };
    }
    return null;
  }, [costSheet, costRows, copyFrom, copyIds, copySource, copyDefaultIds, chatDraft, chatKeys, chatMsg, meeting, reorder, reorderLines, reorderOn]);

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
    // 議事録から作った場合は、議事録側にも見積を記録する
    if (meeting?.id) {
      try { await db.entities.Meeting.update(meeting.id, { estimate_id: created.id }); } catch (e) { console.error("議事録への紐づけに失敗しました", e); }
    }
    navigate(`/estimates/${created.id}`);
  };

  const form = (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">新規見積作成</h1>
            <p className="text-xs text-muted-foreground mt-0.5">案件を選んで基本情報を入力後、見積書画面で明細を追加します</p>
            {meeting && (
              <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-md px-3 py-1.5 mt-1 inline-block">
                {chatId
                  ? <>議事録「{meeting.title}」（{String(meeting.held_at || "").replace(/-/g, "/")}）の「AI に依頼」で作った見積のたたき台から作ります。要確認の行は作成後に確かめてください</>
                  : <>議事録「{meeting.title}」（{String(meeting.held_at || "").replace(/-/g, "/")}）の見積条件から作ります。印刷物は印刷仕様に、制作・開発は明細に入ります</>}
              </p>
            )}
            {reorder && (
              <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-md px-3 py-1.5 mt-1 inline-block">
                {String(reorder.ordered_on).replace(/-/g, "/")} に入稿した「{reorder.name}」の追加印刷として作ります。前回からの価格の変化は、作成後の「印刷費・仕入の価格確認」で確かめられます
              </p>
            )}
            {!carry && recentOrders.length > 0 && (
              <div className="mt-2 rounded-md border border-teal-200 bg-teal-50/50 px-3 py-2 text-xs space-y-1" data-testid="recent-orders">
                <p className="font-semibold text-teal-900">このクライアントの前回の入稿（追加印刷ならここから引き継げます）</p>
                {recentOrders.map((o) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground w-20 shrink-0">{String(o.ordered_on).replace(/-/g, "/")}</span>
                    <span className="truncate flex-1">{o.name}{o.quantity != null ? `　${Number(o.quantity).toLocaleString()}${o.unit || ""}` : ""}</span>
                    <Link to={`/estimates/new?reorder=${o.id}&client=${encodeURIComponent(o.client_name || "")}${o.project_id ? `&project=${o.project_id}` : ""}`} className="shrink-0 text-teal-800 font-semibold hover:underline">引き継ぐ</Link>
                  </div>
                ))}
              </div>
            )}
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
          <Save className="w-4 h-4" /> {carry ? `${formData.line_items.length} 行の明細で作成して明細入力へ` : "作成して明細入力へ"}
        </Button>
      </div>
    </div>
  );

  if (!carry) return <div className="max-w-2xl mx-auto">{form}</div>;
  // 社内見積・見積の複製から来たときは、左に「引き継ぐ明細」、右に入力欄を並べて確認しながら入力できるようにする
  // （狭い画面では入力欄が上）
  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-6 items-start">
      <div className="order-2 lg:order-1 min-w-0"><CarryOverPanel {...carry} items={formData.line_items} /></div>
      <div className="order-1 lg:order-2 min-w-0">{form}</div>
    </div>
  );
}
