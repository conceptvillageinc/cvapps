import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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
import { ArrowLeft, Plus, Pencil, Repeat, Loader2, ChevronsUpDown, Check, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { generateRecurringProjects } from "@/lib/projectNumber";
import { todayString } from "@/lib/fiscal";

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
});

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
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(template ? "ひな形を更新しました" : "ひな形を登録しました");
      onOpenChange(false);
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const canSave = form.client_name.trim() && form.name.trim() && form.start_month && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "ひな形を編集" : "定期売上のひな形を登録"}</DialogTitle>
          <DialogDescription className="text-xs">
            毎月1日に、この内容で案件が1件作られます。案件名には「（2026年10月分）」のように月が自動で付きます。
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
              <Input type="month" value={form.start_month} onChange={(e) => set("start_month", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">終了月</Label>
              <Input type="month" value={form.end_month} onChange={(e) => set("end_month", e.target.value)} className="h-9" />
              <p className="text-[10px] text-muted-foreground">空欄なら無期限</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">状態</Label>
              <label className="flex items-center gap-2 h-9 text-xs cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
                有効（毎月生成する）
              </label>
            </div>
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

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["recurringTemplates"],
    queryFn: () => db.entities.RecurringProjectTemplate.list("-created_date"),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });
  // 生成済みの案件（ひな形ごとの最終生成月を出すため）
  const { data: generated = [] } = useQuery({
    queryKey: ["projects", "recurring"],
    queryFn: () => db.entities.Project.between("recurring_month", "1900-01-01", null, "-recurring_month"),
  });
  const lastMonthByTemplate = {};
  for (const p of generated) {
    if (p.recurring_template_id && !lastMonthByTemplate[p.recurring_template_id]) lastMonthByTemplate[p.recurring_template_id] = p.recurring_month;
  }

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }) => db.entities.RecurringProjectTemplate.update(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurringTemplates"] }),
  });

  const generate = useMutation({
    mutationFn: () => generateRecurringProjects(`${month}-01`),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(count > 0 ? `${monthLabel(month + "-01")}分の案件を${count}件作成しました` : `${monthLabel(month + "-01")}分は作成済みです（新しく作った案件はありません）`);
    },
    onError: (err) => toast.error(err?.message || "生成に失敗しました"),
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
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Repeat className="w-5 h-5 text-teal-600" /> 定期売上の設定</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              有効なひな形 {activeCount}件 / 月額合計 {yen(monthlyTotal)}。毎月1日に自動で案件が作られます
            </p>
          </div>
        </div>
        <Button className="gap-2" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4" /> ひな形を登録
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">手動で生成する</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">対象月</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
          </div>
          <Button variant="secondary" className="gap-2" onClick={() => generate.mutate()} disabled={!month || generate.isPending || activeCount === 0}>
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            この月の案件を生成
          </Button>
          <p className="text-[10px] text-muted-foreground sm:pb-2">
            自動生成が動かなかったときや、登録したばかりのひな形の今月分を作るときに使います。すでに作成済みの月は二重になりません
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : templates.length === 0 ? (
            <div className="text-center py-16">
              <Repeat className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">ひな形がまだありません</p>
              <p className="text-xs text-muted-foreground mt-1">毎月請求する案件（運用サポート、保守など）を登録してください</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    <TableHead className="text-xs text-white">クライアント</TableHead>
                    <TableHead className="text-xs text-white">案件名</TableHead>
                    <TableHead className="text-xs text-white text-right">受注見込/月</TableHead>
                    <TableHead className="text-xs text-white text-right">粗利見込/月</TableHead>
                    <TableHead className="text-xs text-white">期間</TableHead>
                    <TableHead className="text-xs text-white">最終生成</TableHead>
                    <TableHead className="text-xs text-white">状態</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id} className={t.is_active ? "" : "opacity-60"}>
                      <TableCell className="text-sm font-medium">{t.client_name}</TableCell>
                      <TableCell className="text-sm">
                        {t.name}
                        {t.notes && <div className="text-[10px] text-muted-foreground truncate max-w-[280px]">{t.notes}</div>}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{yen(t.expected_revenue)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{yen(Number(t.expected_revenue || 0) - Number(t.expected_cost || 0) - Number(t.other_cost || 0))}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{monthLabel(t.start_month)} 〜 {t.end_month ? monthLabel(t.end_month) : "無期限"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {lastMonthByTemplate[t.id] ? (
                          <Link to={`/projects?q=${encodeURIComponent(t.name)}`} className="text-primary hover:underline">{monthLabel(lastMonthByTemplate[t.id])}分</Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleActive.mutate({ id: t.id, is_active: !t.is_active })} title="クリックで切り替え">
                          <Badge className={`text-[10px] ${t.is_active ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}`}>
                            {t.is_active ? "有効" : "停止中"}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(t); setDialogOpen(true); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TemplateDialog open={dialogOpen} onOpenChange={setDialogOpen} template={editing} clients={clients} />
    </div>
  );
}
