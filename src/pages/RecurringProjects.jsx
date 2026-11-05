import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Pencil, Repeat, Loader2, ChevronsUpDown, Check, PlayCircle, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { generateRecurringProjects } from "@/lib/projectNumber";
import { todayString } from "@/lib/fiscal";
import { lineAmount } from "@/lib/constants";
import { useSalesCategories, classifySalesCategory } from "@/lib/salesCategory";
import MonthSelect, { PeriodEndSelect } from "@/components/ui/month-select";
import { Checkbox } from "@/components/ui/checkbox";
import ProjectFormDialog from "@/components/projects/ProjectFormDialog";
import { recurringStatus, RECURRING_STATUS, addMonths, ymLabel } from "@/lib/recurringStatus";
import { catchUpRecurringNotes } from "@/lib/projectNumber";

const yen = (n) => `¥${Math.round(Number(n || 0)).toLocaleString()}`;
const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
// "yyyy-MM" ↔ "yyyy-MM-01"
const toMonthInput = (d) => (d ? d.slice(0, 7) : "");
const fromMonthInput = (m) => (m ? `${m}-01` : null);
const monthLabel = (d) => (d ? `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月` : "");

const emptyForm = () => ({
  client_name: "",
  name: "",
  deal_probability: "A（定期売上）",
  phase: "受注済",
  expected_revenue: "",
  expected_cost: "",
  other_cost: "",
  start_month: todayString().slice(0, 7),
  end_month: "",
  is_active: true,
  notes: "",
  auto_delivery_note: false,
  line_items: [],
});

// 毎月の納品書の明細（品名の {年月} は「2026年10月分」に置き換わる）
const newTplLine = (patch = {}) => ({ key: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: "", quantity: 1, unit: "式", unit_price: "", tax_rate: 10, sales_category: "", ...patch });
const tplLinesTotal = (lines) => (lines || []).reduce((s, l) => s + lineAmount(toNumber(l.quantity) || 0, toNumber(l.unit_price)), 0);
const sampleMonthLabel = (m) => { const d = m || todayString().slice(0, 7); return `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月分`; };

/** 毎月の納品書の明細を編集する表 */
function TemplateLines({ lines, onChange, monthHint }) {
  const { active: categories } = useSalesCategories();
  const setLine = (key, patch) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-1.5" data-testid="tpl-lines">
      <div className="grid grid-cols-[minmax(13rem,1fr)_3.5rem_3.5rem_5.5rem_4.25rem_8rem_1.75rem] gap-1 text-[10px] text-muted-foreground px-0.5">
        <span>品名</span><span className="text-right">数量</span><span>単位</span><span className="text-right">単価（税抜）</span><span>税率</span><span>売上カテゴリー</span><span />
      </div>
      {lines.map((l) => {
        const auto = classifySalesCategory({ name: l.name });
        return (
          <div key={l.key} className="grid grid-cols-[minmax(13rem,1fr)_3.5rem_3.5rem_5.5rem_4.25rem_8rem_1.75rem] gap-1 items-center">
            <Input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="例: SNS運用サポート {年月}" className="h-8 text-xs" aria-label="品名" />
            <Input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className="h-8 text-xs text-right tabular-nums" aria-label="数量" />
            <Input value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} className="h-8 text-xs" aria-label="単位" />
            <Input inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} placeholder="0" className="h-8 text-xs text-right tabular-nums" aria-label="単価" />
            <select value={l.tax_rate} onChange={(e) => setLine(l.key, { tax_rate: Number(e.target.value) })} className="h-8 rounded-md border bg-background px-1.5 text-xs" aria-label="税率">
              <option value={10}>10%</option>
              <option value={8}>8%※</option>
            </select>
            <select value={l.sales_category || ""} onChange={(e) => setLine(l.key, { sales_category: e.target.value })} className="h-8 rounded-md border bg-background px-1.5 text-xs truncate" aria-label="売上カテゴリー">
              <option value="">自動（{categories.find((c) => c.key === auto)?.short || "—"}）</option>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}
            </select>
            <button type="button" className="grid place-items-center h-8 w-7 text-muted-foreground hover:text-destructive" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label="この行を消す"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onChange([...lines, newTplLine()])}><Plus className="w-3 h-3" /> 行を追加</Button>
        <span className="text-xs text-muted-foreground">合計（税抜） <strong className="text-foreground tabular-nums">{yen(tplLinesTotal(lines))}</strong></span>
      </div>
      <p className="text-[10px] text-muted-foreground">品名に <code className="rounded bg-muted px-1">{"{年月}"}</code> と書くと「{sampleMonthLabel(monthHint)}」のように、その月に置き換わります</p>
    </div>
  );
}

function TemplateDialog({ open, onOpenChange, template, clients }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { dealProbabilityOptions, phaseOptions } = useSystemSettings();
  const [form, setForm] = useState(emptyForm());
  const [clientOpen, setClientOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (template) {
      setForm({
        ...emptyForm(),
        ...Object.fromEntries(Object.entries(template).map(([k, v]) => [k, v ?? ""])),
        start_month: toMonthInput(template.start_month),
        end_month: toMonthInput(template.end_month),
        is_active: !!template.is_active,
        auto_delivery_note: !!template.auto_delivery_note,
        line_items: (template.line_items || []).map((l) => newTplLine({ ...l, unit_price: l.unit_price ?? "", sales_category: l.sales_category || "" })),
      });
    } else {
      setForm(emptyForm());
    }
  }, [open, template]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const uniqueClients = Array.from(new Map(clients.map((c) => [c.name, c])).values())
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const save = useMutation({
    mutationFn: async () => {
      const client = clients.find((c) => c.name === form.client_name);
      const payload = {
        client_id: client?.id || null,
        client_name: form.client_name.trim(),
        name: form.name.trim(),
        deal_probability: form.deal_probability,
        phase: form.phase,
        expected_revenue: toNumber(form.expected_revenue),
        expected_cost: toNumber(form.expected_cost),
        other_cost: toNumber(form.other_cost),
        start_month: fromMonthInput(form.start_month) || todayString().slice(0, 7) + "-01",
        end_month: fromMonthInput(form.end_month),
        is_active: !!form.is_active,
        notes: form.notes || null,
        auto_delivery_note: !!form.auto_delivery_note,
        line_items: form.line_items
          .filter((l) => l.name.trim())
          .map((l) => ({ name: l.name.trim(), quantity: toNumber(l.quantity) || 1, unit: (l.unit || "").trim() || "式", unit_price: toNumber(l.unit_price), tax_rate: Number(l.tax_rate) === 8 ? 8 : 10, sales_category: l.sales_category || null })),
      };
      if (template) return db.entities.RecurringProjectTemplate.update(template.id, payload);
      if (!client && payload.client_name) {
        try {
          const created = await db.entities.Client.create({ name: payload.client_name, quote_count: 0, has_recurring_billing: true });
          payload.client_id = created.id;
        } catch (e) {
          console.error("クライアントの自動登録に失敗しました", e);
        }
      }
      return db.entities.RecurringProjectTemplate.create({ ...payload, created_by: user?.id || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurringTemplates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] }); // ひな形を保存すると定期売上の案件にも反映される
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(template ? "ひな形を更新しました" : "ひな形を登録しました");
      onOpenChange(false);
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const canSave = form.client_name.trim() && form.name.trim() && form.start_month && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "ひな形を編集" : "定期売上のひな形を登録"}</DialogTitle>
          <DialogDescription className="text-xs">
            登録すると、この内容で定期売上の案件が 1 つできます（ひな形を直すと案件にも反映）。見積・納品書・請求書はその案件に紐づきます。明細を入れておくと、毎月1日にその月の納品書の下書きを案件の中に作ります。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">クライアント <span className="text-destructive">*</span></Label>
              <Popover open={clientOpen} onOpenChange={setClientOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9">
                    <span className="truncate">{form.client_name || "クライアントを検索・選択"}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="クライアント名を入力して検索" value={form.client_name} onValueChange={(v) => set("client_name", v)} />
                    <CommandList>
                      <CommandEmpty>一致するクライアントがありません（このまま新規登録されます）</CommandEmpty>
                      <CommandGroup>
                        {uniqueClients.map((c) => (
                          <CommandItem key={c.id} value={c.name} onSelect={() => { set("client_name", c.name); setClientOpen(false); }}>
                            <Check className={cn("mr-2 h-4 w-4", form.client_name === c.name ? "opacity-100" : "opacity-0")} />
                            {c.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">案件名 <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例: SNS運用サポート" className="h-9" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">受注確度</Label>
              <Select value={form.deal_probability} onValueChange={(v) => set("deal_probability", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...new Set([...dealProbabilityOptions, form.deal_probability].filter(Boolean))].map((o) => (
                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">フェーズ</Label>
              <Select value={form.phase} onValueChange={(v) => set("phase", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...new Set([...phaseOptions, form.phase].filter(Boolean))].map((o) => (
                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">受注見込（月額・税抜）</Label>
              <Input inputMode="numeric" value={form.expected_revenue} onChange={(e) => set("expected_revenue", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">発注見込</Label>
              <Input inputMode="numeric" value={form.expected_cost} onChange={(e) => set("expected_cost", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">その他費用</Label>
              <Input inputMode="numeric" value={form.other_cost} onChange={(e) => set("other_cost", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">開始月 <span className="text-destructive">*</span></Label>
              <MonthSelect value={form.start_month} onChange={(v) => set("start_month", v)} ariaLabel="開始月" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">終了月</Label>
              <PeriodEndSelect start={form.start_month} value={form.end_month} onChange={(v) => set("end_month", v)} ariaLabel="終了月" />
              <p className="text-[10px] text-muted-foreground">開始月から何か月分続けるかを選べます（「無期限」なら終わりを決めない）</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">状態</Label>
              <label className="flex items-center gap-2 h-9 text-xs cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
                有効（毎月生成する）
              </label>
            </div>
          </div>

          <div className={`rounded-lg border p-3 space-y-2.5 ${form.auto_delivery_note ? "border-teal-300 bg-teal-50/40" : ""}`}>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={form.auto_delivery_note} data-testid="auto-dn"
                onChange={(e) => setForm((f) => ({ ...f, auto_delivery_note: e.target.checked, line_items: e.target.checked && f.line_items.length === 0 ? [newTplLine({ name: f.name ? `${f.name} {年月}` : "", unit_price: f.expected_revenue || "" })] : f.line_items }))} />
              <span>
                <span className="font-semibold flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> 毎月の納品書（下書き）も作る</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">案件といっしょに、この明細で納品書の下書きを作ります（納品日はその月の末日）。月末に、同じクライアントのほかの納品書と 1 枚の請求書にまとめられます</span>
              </span>
            </label>
            {form.auto_delivery_note && (
              <>
                <TemplateLines lines={form.line_items} onChange={(v) => set("line_items", v)} monthHint={form.start_month} />
                {tplLinesTotal(form.line_items) !== toNumber(form.expected_revenue) && tplLinesTotal(form.line_items) > 0 && (
                  <p className="flex items-center gap-2 text-[11px] text-amber-800">
                    明細の合計と受注見込（{yen(toNumber(form.expected_revenue))}）が違います
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => set("expected_revenue", String(tplLinesTotal(form.line_items)))}>受注見込を明細の合計にする</button>
                  </p>
                )}
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">社内メモ（生成される案件にも入ります）</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={() => save.mutate()} disabled={!canSave} className="gap-2">
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {template ? "保存" : "登録"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RecurringProjects() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [month, setMonth] = useState(todayString().slice(0, 7));
  const [createOpen, setCreateOpen] = useState(false); // 定期売上の案件を新しく作る
  // 要対応（まもなく終了・終了月を過ぎた・見直しの時期）だけ／すべて。?filter=action で要対応から開く
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("filter") === "action" ? "action" : "all";
  const setFilter = (f) => setSearchParams((prev) => { const n = new URLSearchParams(prev); if (f === "action") n.set("filter", "action"); else n.delete("filter"); return n; }, { replace: true });
  const [renewing, setRenewing] = useState(null); // { template, mode: "renew" | "set_end" }
  const [renewEnd, setRenewEnd] = useState("");
  const [renewAmount, setRenewAmount] = useState(false);
  const [ending, setEnding] = useState(null); // 「更新しない（終了）」を確かめる定期売上
  const [removing, setRemoving] = useState(null); // 定期売上一覧から消すひな形
  const [removeProject, setRemoveProject] = useState(true);
  const { dealProbabilityOptions } = useSystemSettings();
  const recurringProbability = (dealProbabilityOptions || []).find((o) => /定期/.test(o));

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["recurringTemplates"],
    queryFn: () => db.entities.RecurringProjectTemplate.list("-created_date"),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });
  // ひな形ごとの定期売上の案件（1 つ）と、自動で作った納品書のいちばん新しい月
  const { data: parents = [] } = useQuery({
    queryKey: ["projects", "recurring"],
    queryFn: () => db.entities.Project.between("recurring_start_month", "1900-01-01", null),
  });
  const { data: autoNotes = [] } = useQuery({
    queryKey: ["deliveryNotes", "recurring"],
    queryFn: () => db.entities.DeliveryNote.between("recurring_month", "1900-01-01", null, "-recurring_month"),
  });
  const projectByTemplate = Object.fromEntries(parents.filter((p) => p.recurring_template_id).map((p) => [p.recurring_template_id, p]));
  const lastNoteByTemplate = {};
  for (const n of autoNotes) {
    const cur = lastNoteByTemplate[n.recurring_template_id];
    if (n.recurring_template_id && (!cur || String(n.recurring_month) > String(cur.recurring_month))) lastNoteByTemplate[n.recurring_template_id] = n;
  }

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }) => db.entities.RecurringProjectTemplate.update(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurringTemplates"] }),
  });

  const generate = useMutation({
    mutationFn: () => generateRecurringProjects(`${month}-01`),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] });
      toast.success(count > 0 ? `${monthLabel(month + "-01")}分の納品書の下書きを${count}件作りました` : `${monthLabel(month + "-01")}分の納品書は作成済みです（「毎月の納品書も作る」のひな形が対象です）`);
    },
    onError: (err) => toast.error(err?.message || "生成に失敗しました"),
  });

  // 定期売上一覧から消す（案件も消すときは、ひな形を先に消してから案件を消す。見積・納品書・請求書は残る）
  const remove = useMutation({
    mutationFn: async ({ template, project, withProject }) => {
      await db.entities.RecurringProjectTemplate.delete(template.id);
      if (withProject && project) await db.entities.Project.delete(project.id);
    },
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ["recurringTemplates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(v.withProject && v.project ? `定期売上一覧から削除し、案件 ${v.project.project_number || ""} も削除しました` : "定期売上一覧から削除しました");
      setRemoving(null);
    },
    onError: (err) => toast.error("削除できませんでした: " + (err?.message || "不明なエラー")),
  });
  const orphanCount = templates.filter((t) => !projectByTemplate[t.id]).length;

  // 終了・更新
  const statusOf = (t) => recurringStatus(t);
  const actionCount = templates.filter((t) => RECURRING_STATUS[statusOf(t).key].action).length;
  const shown = filter === "action"
    ? templates.filter((t) => RECURRING_STATUS[statusOf(t).key].action).sort((a, b) => (statusOf(a).endYm || statusOf(a).reviewYm || "").localeCompare(statusOf(b).endYm || statusOf(b).reviewYm || ""))
    : templates;
  const openRenew = (t, mode) => {
    const st = statusOf(t);
    const now = todayString().slice(0, 7);
    // 更新: 今の終了月の翌月から 12 か月（終了月を過ぎていても、続きの月から）。終了月を決める: 今月から
    setRenewEnd(mode === "renew" && st.endYm ? addMonths(st.endYm, 12) : addMonths(now, 11));
    setRenewAmount(false);
    setRenewing({ template: t, mode });
  };
  const patchTemplate = useMutation({
    mutationFn: async ({ template, patch, catchUpFrom }) => {
      await db.entities.RecurringProjectTemplate.update(template.id, patch);
      // 終了月を過ぎてから更新したときは、止まっていた月（前の終了月の翌月〜今月）の納品書もすぐ作る
      if (catchUpFrom && template.auto_delivery_note) return catchUpRecurringNotes(template.id, catchUpFrom, patch.end_month ? patch.end_month.slice(0, 7) : "");
      return 0;
    },
    onSuccess: (notes, v) => {
      queryClient.invalidateQueries({ queryKey: ["recurringTemplates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["deliveryNotes"] });
      toast.success(`${v.message}${notes ? `（止まっていた月の納品書の下書きを ${notes} 件作りました）` : ""}`);
      setRenewing(null); setEnding(null);
      if (v.reopenAmount && projectByTemplate[v.template.id]) navigate(`/projects/${projectByTemplate[v.template.id].id}?recurring=1`);
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const activeCount = templates.filter((t) => t.is_active).length;
  const monthlyTotal = templates.filter((t) => t.is_active).reduce((s, t) => s + Number(t.expected_revenue || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/projects")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Repeat className="w-5 h-5 text-teal-600" /> 定期売上一覧</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              有効なひな形 {activeCount}件 / 月額合計 {yen(monthlyTotal)}。ひな形ごとに案件が 1 つあり、毎月1日にその月の納品書の下書きを作ります
            </p>
          </div>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <Button className="gap-2 bg-rose-600 hover:bg-rose-700" onClick={() => setCreateOpen(true)} data-testid="recurring-new">
            <Plus className="w-4 h-4" /> 定期売上の案件を作成
          </Button>
          <p className="max-w-sm rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-900 leading-relaxed" data-testid="recurring-howto">
            <Repeat className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />案件を作ったら、見積を作って<strong>「定期売上にする」</strong>で登録します（すでにある案件・見積の画面からも登録できます）。見積の明細のうち毎月請求するものが、月額と毎月の納品書になります
          </p>
        </div>
      </div>

      {orphanCount > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="recurring-orphans">
          案件が削除された定期売上が <strong>{orphanCount}件</strong> あります（表の「案件なし」）。いらなければ右のごみ箱で定期売上一覧から削除してください
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">手動で作る</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">対象月</Label>
            <MonthSelect value={month} onChange={setMonth} ariaLabel="対象月" />
          </div>
          <Button variant="secondary" className="gap-2" onClick={() => generate.mutate()} disabled={!month || generate.isPending || activeCount === 0}>
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            この月の納品書の下書きを作る
          </Button>
          <p className="text-[10px] text-muted-foreground sm:pb-2">
            自動で動かなかったときに使います（2 回目以降の分。初回の納品書は案件の画面の「初回の納品書を作成」で作ります）。すでに作成済みの月は二重になりません
          </p>
        </CardContent>
      </Card>

      {/* 要対応だけ／すべて */}
      <div className="flex items-center gap-1 border-b">
        {[["action", `要対応（${actionCount}）`], ["all", `すべて（${templates.length}）`]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`px-3 py-2 text-sm border-b-2 -mb-px ${filter === k ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`recurring-filter-${k}`}>
            {l}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">終了月の 2 か月前から「まもなく終了」、無期限は 1 年ごとに「見直しの時期」として知らせます</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filter === "action" && shown.length === 0 && templates.length > 0 ? (
            <p className="text-center py-12 text-sm text-muted-foreground" data-testid="recurring-no-action">対応が必要な定期売上はありません</p>
          ) : templates.length === 0 ? (
            <div className="text-center py-16">
              <Repeat className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">定期売上はまだありません</p>
              <p className="text-xs text-muted-foreground mt-1">毎月請求する案件（運用サポート、保守など）は、案件または見積の画面の「定期売上にする」から登録してください</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    <TableHead className="text-xs text-white">クライアント</TableHead>
                    <TableHead className="text-xs text-white">案件名</TableHead>
                    <TableHead className="text-xs text-white text-right whitespace-nowrap">受注見込/月（税別）</TableHead>
                    <TableHead className="text-xs text-white text-right whitespace-nowrap">粗利見込/月（税別）</TableHead>
                    <TableHead className="text-xs text-white">期間</TableHead>
                    <TableHead className="text-xs text-white">終了・更新</TableHead>
                    <TableHead className="text-xs text-white">案件・最新の納品書</TableHead>
                    <TableHead className="text-xs text-white">状態</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((t) => (
                    <TableRow key={t.id} className={t.is_active ? "" : "opacity-60"}>
                      <TableCell className="text-sm font-medium">{t.client_name}</TableCell>
                      <TableCell className="text-sm">
                        {t.name}
                        {t.auto_delivery_note && (t.line_items || []).length > 0 && <Badge className="ml-1.5 text-[9px] font-normal bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-50" title={(t.line_items || []).map((l) => l.name).join(" / ")}><Truck className="w-2.5 h-2.5 mr-0.5" />納品書も作る（{t.line_items.length}行）</Badge>}
                        {t.notes && <div className="text-[10px] text-muted-foreground truncate max-w-[280px]">{t.notes}</div>}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{yen(t.expected_revenue)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{yen(Number(t.expected_revenue || 0) - Number(t.expected_cost || 0) - Number(t.other_cost || 0))}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{monthLabel(t.start_month)} 〜 {t.end_month ? monthLabel(t.end_month) : "無期限"}</TableCell>
                      <TableCell className="text-xs" data-testid="recurring-status">
                        {(() => {
                          const st = statusOf(t);
                          const def = RECURRING_STATUS[st.key];
                          return (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${def.cls}`}>{def.label}</span>
                                {st.note && <span className="text-[10px] text-muted-foreground">{st.note}</span>}
                              </div>
                              {def.action && (
                                <div className="flex flex-wrap gap-1">
                                  {st.key === "review" ? (
                                    <>
                                      <Button size="sm" className="h-6 px-2 text-[11px]" disabled={patchTemplate.isPending} onClick={() => patchTemplate.mutate({ template: t, patch: { last_reviewed_month: `${st.reviewYm}-01` }, message: `見直し済みにしました（次の見直しは ${ymLabel(addMonths(st.reviewYm, 12))}）` })} data-testid="recurring-reviewed">見直し済み（このまま継続）</Button>
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => openRenew(t, "set_end")}>終了月を決める</Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => openRenew(t, "renew")} data-testid="recurring-renew">更新する</Button>
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setEnding(t)} data-testid="recurring-end">更新しない（終了）</Button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {projectByTemplate[t.id] ? (
                          <Link to={`/projects/${projectByTemplate[t.id].id}`} className="text-primary hover:underline">{projectByTemplate[t.id].project_number || "案件を開く"}</Link>
                        ) : <span className="font-medium text-amber-700" title="案件が削除されています">案件なし（削除済み）</span>}
                        {lastNoteByTemplate[t.id] && (
                          <Link to={`/delivery-notes/${lastNoteByTemplate[t.id].id}`} className="ml-2 text-muted-foreground hover:underline">{monthLabel(lastNoteByTemplate[t.id].recurring_month)}分</Link>
                        )}
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleActive.mutate({ id: t.id, is_active: !t.is_active })} title="クリックで切り替え">
                          <Badge className={`text-[10px] whitespace-nowrap ${t.is_active ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}`}>
                            {t.is_active ? "有効" : "停止中"}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (projectByTemplate[t.id]) navigate(`/projects/${projectByTemplate[t.id].id}?recurring=1`); else { setEditing(t); setDialogOpen(true); } }} title="案件の画面で定期売上の設定を開きます">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => { setRemoveProject(true); setRemoving(t); }} title="定期売上一覧から削除" data-testid="recurring-remove">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* 表示中（絞り込みのあと）の件数と合計。停止中のひな形が入っていれば、有効な分だけの合計も出す */}
                  {(() => {
                    const rev = (t) => Number(t.expected_revenue || 0);
                    const gross = (t) => rev(t) - Number(t.expected_cost || 0) - Number(t.other_cost || 0);
                    const active = shown.filter((t) => t.is_active);
                    const hasStopped = active.length !== shown.length;
                    return (
                      <TableRow className="bg-muted/30 hover:bg-muted/30 font-medium" data-testid="list-total">
                        <TableCell colSpan={2} className="text-xs text-muted-foreground whitespace-nowrap">
                          表示中の合計（{shown.length}件）
                          {hasStopped && <span className="block text-[10px] font-normal">うち有効 {active.length}件</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">{yen(shown.reduce((a, t) => a + rev(t), 0))}{hasStopped && <span className="block text-[10px] font-normal text-muted-foreground">有効 {yen(active.reduce((a, t) => a + rev(t), 0))}</span>}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">{yen(shown.reduce((a, t) => a + gross(t), 0))}{hasStopped && <span className="block text-[10px] font-normal text-muted-foreground">有効 {yen(active.reduce((a, t) => a + gross(t), 0))}</span>}</TableCell>
                        <TableCell colSpan={5} />
                      </TableRow>
                    );
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TemplateDialog open={dialogOpen} onOpenChange={setDialogOpen} template={editing} clients={clients} />

      {/* 定期売上の案件を作る → 案件の画面で「定期売上にする」を開く（見積がまだなら、そこから見積を作る） */}
      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaults={recurringProbability ? { deal_probability: recurringProbability } : {}}
        onSaved={(row) => navigate(`/projects/${row.id}?recurring=1`)}
      />

      {/* 更新する（終了月を延ばす）／終了月を決める（無期限の見直し） */}
      <Dialog open={!!renewing} onOpenChange={(v) => !v && !patchTemplate.isPending && setRenewing(null)}>
        <DialogContent className="max-w-md" data-testid="recurring-renew-dialog">
          <DialogHeader>
            <DialogTitle>{renewing?.mode === "renew" ? "定期売上を更新する" : "終了月を決める"}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {renewing?.template.client_name}　{renewing?.template.name}（月額 {yen(renewing?.template.expected_revenue)}）
              {renewing?.mode === "renew" ? "の終了月を延ばします。同じ案件のまま、新しい終了月まで毎月の納品書を作ります。" : "の終了月を入れます。その月の分まで毎月の納品書を作ります。"}
            </DialogDescription>
          </DialogHeader>
          {renewing && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">新しい終了月</Label>
                <PeriodEndSelect
                  start={renewing.mode === "renew" && statusOf(renewing.template).endYm ? addMonths(statusOf(renewing.template).endYm, 1) : todayString().slice(0, 7)}
                  value={renewEnd} onChange={setRenewEnd} emptyLabel={renewing.mode === "renew" ? "無期限にする" : "（選んでください）"} ariaLabel="新しい終了月" className="w-full"
                />
              </div>
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <Checkbox checked={renewAmount} onCheckedChange={(v) => setRenewAmount(!!v)} className="mt-0.5" />
                <span>月額が変わる（保存のあと案件の画面で「定期売上を編集」を開き、新しい見積から月額を入れ直す）</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewing(null)} disabled={patchTemplate.isPending}>キャンセル</Button>
            <Button
              disabled={patchTemplate.isPending || (renewing?.mode === "set_end" && !renewEnd)}
              onClick={() => {
                const t = renewing.template;
                const st = statusOf(t);
                patchTemplate.mutate({
                  template: t,
                  patch: { end_month: renewEnd ? `${renewEnd}-01` : null, is_active: true, ended_confirmed_at: null },
                  catchUpFrom: st.key === "expired" ? st.endYm : null,
                  reopenAmount: renewAmount,
                  message: !renewEnd ? "無期限で更新しました" : renewing.mode === "renew" ? `${ymLabel(renewEnd)}分まで更新しました` : `${ymLabel(renewEnd)}分までにしました`,
                });
              }}
              data-testid="recurring-renew-save"
            >
              {patchTemplate.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} {renewing?.mode === "renew" ? "更新する" : "この月までにする"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 更新しない（終了）: 要対応から外す。終了月までは毎月の納品書を作る */}
      <Dialog open={!!ending} onOpenChange={(v) => !v && !patchTemplate.isPending && setEnding(null)}>
        <DialogContent className="max-w-md" data-testid="recurring-end-dialog">
          <DialogHeader>
            <DialogTitle>更新しないで終了にしますか？</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {ending?.client_name}　{ending?.name} を{ending?.end_month ? ` ${monthLabel(ending.end_month)}で` : ""}終了にします。
              {ending && statusOf(ending).key === "ending_soon" ? "終了月の分までは、これまでどおり毎月の納品書を作ります。" : ""}
              要対応の数字からは外れ、定期売上一覧には「終了」として残ります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnding(null)} disabled={patchTemplate.isPending}>キャンセル</Button>
            <Button disabled={patchTemplate.isPending} onClick={() => patchTemplate.mutate({ template: ending, patch: { ended_confirmed_at: new Date().toISOString() }, message: "更新しないで終了にしました" })} data-testid="recurring-end-save">
              {patchTemplate.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} 終了にする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(v) => !v && !remove.isPending && setRemoving(null)}>
        <DialogContent className="max-w-md" data-testid="recurring-remove-dialog">
          <DialogHeader>
            <DialogTitle>定期売上一覧から削除しますか？</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {removing?.client_name}　{removing?.name}（月額 {yen(removing?.expected_revenue)}）の定期売上の設定を削除します。これまでに作った納品書・請求書は残ります。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          {removing && projectByTemplate[removing.id] && (
            <label className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50/60 p-3 text-sm cursor-pointer">
              <Checkbox checked={removeProject} onCheckedChange={(v) => setRemoveProject(!!v)} className="mt-0.5" />
              <span>
                <span className="font-medium text-red-800">案件 {projectByTemplate[removing.id].project_number} も削除する</span>
                <span className="block text-xs text-muted-foreground mt-0.5">案件に紐づく見積・納品書・請求書は残り、案件との紐づけだけが外れます</span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={remove.isPending}>キャンセル</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate({ template: removing, project: projectByTemplate[removing.id] || null, withProject: removeProject })} data-testid="recurring-remove-run">
              {remove.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} 削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
