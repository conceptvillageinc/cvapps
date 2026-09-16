import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { generateProjectNumber } from "@/lib/projectNumber";
import { nextMonthEnd, todayString } from "@/lib/fiscal";
import { PROJECT_STATUS_MAP } from "@/lib/constants";

// 数値入力: 空は 0、カンマ入りも受け付ける
const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const yen = (n) => `¥${Math.round(n).toLocaleString()}`;

function emptyForm(defaults = {}) {
  return {
    client_name: "",
    name: "",
    deal_probability: "A",
    phase: "引き合い",
    status: "open",
    expected_revenue: "",
    expected_cost: "",
    other_cost: "",
    confirmed_revenue: "",
    confirmed_cost: "",
    registered_at: todayString(),
    due_date: "",
    payment_due_date: "",
    vendor_payment_date: "",
    is_recurring: false,
    notes: "",
    ...defaults,
  };
}

/**
 * 案件の作成・編集ダイアログ。
 *
 * props:
 *   open / onOpenChange
 *   project        編集対象（省略時は新規作成）
 *   defaults       新規作成時の初期値（例: { client_name }）
 *   onSaved(row)   保存後に呼ばれる
 */
export default function ProjectFormDialog({ open, onOpenChange, project = null, defaults = {}, onSaved }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { dealProbabilityOptions, phaseOptions } = useSystemSettings();
  const [form, setForm] = useState(() => emptyForm(defaults));
  const [clientOpen, setClientOpen] = useState(false);
  // 入金予定日を手で変えた後は、完了予定日を変えても自動で上書きしない
  const [paymentDueTouched, setPaymentDueTouched] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
    enabled: open,
  });
  const uniqueClients = Array.from(new Map(clients.map((c) => [c.name, c])).values())
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  useEffect(() => {
    if (!open) return;
    if (project) {
      setForm({
        ...emptyForm(),
        ...Object.fromEntries(
          Object.entries(project).map(([k, v]) => [k, v === null || v === undefined ? "" : v])
        ),
        is_recurring: !!project.is_recurring,
      });
      setPaymentDueTouched(!!project.payment_due_date);
    } else {
      setForm(emptyForm(defaults));
      setPaymentDueTouched(false);
    }
    // defaults はオブジェクトなので中身で比較する
     
  }, [open, project?.id, JSON.stringify(defaults)]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const setDueDate = (value) => {
    setForm((f) => ({
      ...f,
      due_date: value,
      payment_due_date: paymentDueTouched ? f.payment_due_date : nextMonthEnd(value),
    }));
  };

  const expectedGross = toNumber(form.expected_revenue) - toNumber(form.expected_cost) - toNumber(form.other_cost);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const client = clients.find((c) => c.name === form.client_name);
      const payload = {
        client_id: client?.id || null,
        client_name: form.client_name.trim(),
        name: form.name.trim(),
        deal_probability: form.deal_probability,
        phase: form.phase,
        status: form.status,
        expected_revenue: toNumber(form.expected_revenue),
        expected_cost: toNumber(form.expected_cost),
        other_cost: toNumber(form.other_cost),
        confirmed_revenue: toNumber(form.confirmed_revenue),
        confirmed_cost: toNumber(form.confirmed_cost),
        registered_at: form.registered_at || todayString(),
        due_date: form.due_date || null,
        payment_due_date: form.payment_due_date || null,
        vendor_payment_date: form.vendor_payment_date || null,
        is_recurring: !!form.is_recurring || /定期/.test(form.deal_probability),
        notes: form.notes || null,
      };

      if (project) {
        return db.entities.Project.update(project.id, payload);
      }

      // クライアントが未登録なら作る（見積作成と同じ挙動）
      if (!client && payload.client_name) {
        try {
          const created = await db.entities.Client.create({ name: payload.client_name, quote_count: 0 });
          payload.client_id = created.id;
        } catch (e) {
          console.error("クライアントの自動登録に失敗しました", e);
        }
      }

      return db.entities.Project.create({
        ...payload,
        project_number: await generateProjectNumber(payload.registered_at),
        created_by: user?.id || null,
      });
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", row.id] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(project ? "案件を更新しました" : `案件 ${row.project_number} を作成しました`);
      onOpenChange(false);
      onSaved?.(row);
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const canSave = form.client_name.trim() && form.name.trim() && !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project ? `案件を編集（${project.project_number}）` : "新規案件"}</DialogTitle>
          <DialogDescription className="text-xs">
            案件は見積・納品書・請求書の親になります。金額は税抜で入力してください。
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
                    <CommandInput
                      placeholder="クライアント名を入力して検索"
                      value={form.client_name}
                      onValueChange={(v) => set("client_name", v)}
                    />
                    <CommandList>
                      <CommandEmpty>一致するクライアントがありません（このまま新規登録されます）</CommandEmpty>
                      <CommandGroup>
                        {uniqueClients.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => { set("client_name", c.name); setClientOpen(false); }}
                          >
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
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例: 会社案内パンフレット制作" className="h-9" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
            <div className="space-y-1.5">
              <Label className="text-xs">状態</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_STATUS_MAP).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">定期売上</Label>
              <label className="flex items-center gap-2 h-9 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.is_recurring || /定期/.test(form.deal_probability)}
                  disabled={/定期/.test(form.deal_probability)}
                  onChange={(e) => set("is_recurring", e.target.checked)}
                />
                毎月発生する
              </label>
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs font-medium">見込（税抜）</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">受注見込</Label>
                <Input inputMode="numeric" value={form.expected_revenue} onChange={(e) => set("expected_revenue", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">発注見込（仕入）</Label>
                <Input inputMode="numeric" value={form.expected_cost} onChange={(e) => set("expected_cost", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">その他費用</Label>
                <Input inputMode="numeric" value={form.other_cost} onChange={(e) => set("other_cost", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">粗利見込</Label>
                <div className={`h-9 flex items-center justify-end px-3 rounded-md bg-muted/40 text-sm font-medium tabular-nums ${expectedGross < 0 ? "text-destructive" : ""}`}>
                  {yen(expectedGross)}
                </div>
              </div>
            </div>
            {project && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t">
                <div className="space-y-1.5 pt-2">
                  <Label className="text-xs">受注合計（実績）</Label>
                  <Input inputMode="numeric" value={form.confirmed_revenue} onChange={(e) => set("confirmed_revenue", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
                </div>
                <div className="space-y-1.5 pt-2">
                  <Label className="text-xs">発注合計（実績）</Label>
                  <Input inputMode="numeric" value={form.confirmed_cost} onChange={(e) => set("confirmed_cost", e.target.value)} placeholder="0" className="h-9 text-right tabular-nums" />
                </div>
                <div className="space-y-1.5 pt-2 col-span-2">
                  <Label className="text-xs">粗利（実績）</Label>
                  <div className="h-9 flex items-center justify-end px-3 rounded-md bg-muted/40 text-sm font-medium tabular-nums">
                    {yen(toNumber(form.confirmed_revenue) - toNumber(form.confirmed_cost))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">案件登録日</Label>
              <Input type="date" value={form.registered_at} onChange={(e) => set("registered_at", e.target.value)} className="h-9" disabled={!!project} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">完了予定日</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">入金予定日</Label>
              <Input
                type="date"
                value={form.payment_due_date}
                onChange={(e) => { setPaymentDueTouched(true); set("payment_due_date", e.target.value); }}
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground">既定: 完了予定日の翌月末</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">仕入先 支払予定日</Label>
              <Input type="date" value={form.vendor_payment_date} onChange={(e) => set("vendor_payment_date", e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">社内メモ</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="予算の根拠、関連URL、注意点など" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSave} className="gap-2">
            {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {project ? "保存" : "作成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
