import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Plus, X } from "lucide-react";
import { PRINT_TYPES, PERSON_IN_CHARGE_OPTIONS } from "@/lib/constants";

export default function SpecForm({ data, onChange, showPersonInCharge = true }) {
  const [quantityInput, setQuantityInput] = useState("");

  const update = (field, value) => {
    onChange({ ...data, [field]: value });
  };

  const addQuantity = () => {
    const num = parseInt(quantityInput);
    if (num > 0) {
      const current = data.quantities || [];
      if (!current.includes(num)) {
        update("quantities", [...current, num].sort((a, b) => a - b));
      }
      setQuantityInput("");
    }
  };

  const removeQuantity = (q) => {
    update("quantities", (data.quantities || []).filter(v => v !== q));
  };

  const isDeliveryUrgent = () => {
    if (!data.desired_delivery_date) return false;
    const diff = new Date(data.desired_delivery_date) - new Date();
    return diff < 7 * 24 * 60 * 60 * 1000; // 7 days
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">印刷仕様</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Person in charge */}
        {showPersonInCharge && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">見積作成担当者</Label>
            <Select value={data.person_in_charge || ""} onValueChange={v => update("person_in_charge", v)}>
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
        )}

        {/* Print type */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">印刷物種別 <span className="text-destructive">*</span></Label>
          <Select value={data.print_type || ""} onValueChange={v => update("print_type", v)}>
            <SelectTrigger>
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {PRINT_TYPES.map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Size & Paper */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">サイズ</Label>
            <Input
              value={data.size || ""}
              onChange={e => update("size", e.target.value)}
              placeholder="例: A4, 100mm×80mm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">紙質・素材</Label>
            <Input
              value={data.paper_type || ""}
              onChange={e => update("paper_type", e.target.value)}
              placeholder="例: コート紙135kg、PETフィルム"
            />
          </div>
        </div>

        {/* Quantities */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">印刷枚数</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              value={quantityInput}
              onChange={e => setQuantityInput(e.target.value)}
              placeholder="枚数を入力"
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addQuantity())}
              className="max-w-[200px]"
            />
            <Button type="button" variant="outline" size="sm" onClick={addQuantity}>
              <Plus className="w-3.5 h-3.5 mr-1" /> 追加
            </Button>
          </div>
          {data.quantities?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {data.quantities.map(q => (
                <Badge key={q} variant="secondary" className="gap-1 pr-1">
                  {q.toLocaleString()}枚
                  <button onClick={() => removeQuantity(q)} className="hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Color count */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">印刷色数</Label>
          <Input
            value={data.color_count || ""}
            onChange={e => update("color_count", e.target.value)}
            placeholder="例: 4色(CMYK), 2色"
          />
        </div>

        {/* Delivery date - highlighted */}
        <div className={`space-y-1.5 p-3 rounded-lg border-2 ${
          !data.desired_delivery_date ? "border-destructive/50 bg-destructive/5" :
          isDeliveryUrgent() ? "border-warning/50 bg-warning/5" : "border-border bg-transparent"
        }`}>
          <Label className="text-xs font-medium flex items-center gap-1.5">
            希望納期 <span className="text-destructive">*</span>
            {!data.desired_delivery_date && (
              <span className="flex items-center gap-1 text-destructive text-[10px]">
                <AlertTriangle className="w-3 h-3" /> 必須項目です
              </span>
            )}
            {isDeliveryUrgent() && data.desired_delivery_date && (
              <span className="flex items-center gap-1 text-warning text-[10px]">
                <AlertTriangle className="w-3 h-3" /> 7日以内の短納期です
              </span>
            )}
          </Label>
          <Input
            type="date"
            value={data.desired_delivery_date || ""}
            onChange={e => update("desired_delivery_date", e.target.value)}
          />
        </div>

        {/* Usage & Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">用途</Label>
          <Textarea
            value={data.usage || ""}
            onChange={e => update("usage", e.target.value)}
            placeholder="用途を記述してください"
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">備考</Label>
          <Textarea
            value={data.additional_notes || ""}
            onChange={e => update("additional_notes", e.target.value)}
            placeholder="その他特記事項"
            rows={2}
          />
        </div>
      </CardContent>
    </Card>
  );
}
