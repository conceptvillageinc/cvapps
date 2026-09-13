import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERSON_IN_CHARGE_OPTIONS, EMAIL_TO_PERSON_MAP, DEFAULT_VALIDITY_MONTHS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Save, ArrowLeft, ChevronsUpDown, Check } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { generateEstimateNumber } from "@/lib/estimateNumber";

export default function EstimateCreate() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => base44.entities.Client.list("-name"),
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
    client_name: "",
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

  const handleSave = async () => {
    if (!formData.client_name || !formData.desired_delivery_date) {
      toast.error("クライアント名、希望納期は必須です");
      return;
    }
    setSaving(true);
    const estimateNumber = await generateEstimateNumber(base44);
    const created = await base44.entities.Estimate.create({
      ...formData,
      estimate_number: estimateNumber,
      project_group_id: estimateNumber,
      revision_label: "初回",
      deal_probability: "B",
      phase: "未着手",
    });

    // 見積作成頻度をクライアント一覧の表示順に反映させるため、quote_countを更新
    try {
      const matchedClient = clients.find(c => c.name === formData.client_name);
      if (matchedClient) {
        await base44.entities.Client.update(matchedClient.id, {
          quote_count: (matchedClient.quote_count || 0) + 1,
        });
      } else {
        // クライアント一覧にない新規名前で作成された場合は、Clientを新規登録
        await base44.entities.Client.create({ name: formData.client_name, quote_count: 1 });
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
            <p className="text-xs text-muted-foreground mt-0.5">基本情報を入力後、見積書画面で明細を追加します</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" /> 作成して明細入力へ
        </Button>
      </div>

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
    </div>
  );
}
