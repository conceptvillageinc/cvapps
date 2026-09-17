import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Copy, Trash2, Printer, AlertTriangle, ChevronDown, ChevronRight, Mail } from "lucide-react";
import { PRINT_TYPES } from "@/lib/constants";
import { newPrintSpec, specLabel, specMissing } from "@/lib/printSpecs";

function QuantityEditor({ values, onChange }) {
  const [input, setInput] = useState("");
  const add = () => {
    const n = parseInt(input, 10);
    if (n > 0 && !(values || []).includes(n)) onChange([...(values || []), n].sort((a, b) => a - b));
    setInput("");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          type="number"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="枚数"
          className="h-9 max-w-[140px]"
        />
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={add}>
          <Plus className="w-3.5 h-3.5 mr-1" /> 追加
        </Button>
      </div>
      {(values || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((q) => (
            <Badge key={q} variant="secondary" className="gap-1 pr-1">
              {q.toLocaleString()}枚
              <button onClick={() => onChange(values.filter((v) => v !== q))} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function SpecCard({ spec, index, onChange, onDuplicate, onRemove, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const missing = specMissing(spec);
  const set = (k, v) => onChange({ ...spec, [k]: v });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <Printer className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm flex-1 truncate">{specLabel(spec, index)}</CardTitle>
          {missing.length > 0 ? (
            <span className="text-[10px] text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {missing.join("・")}が未入力</span>
          ) : (
            <span className="text-[10px] text-emerald-700">依頼できます</span>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" title="複製" onClick={onDuplicate}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="削除" onClick={onRemove}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">名称（省略可）</Label>
              <Input value={spec.label || ""} onChange={(e) => set("label", e.target.value)} placeholder="例: A4チラシ（表面）" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">印刷物種別 <span className="text-destructive">*</span></Label>
              <Select value={spec.print_type || ""} onValueChange={(v) => set("print_type", v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="選択してください" /></SelectTrigger>
                <SelectContent>
                  {PRINT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">サイズ</Label>
              <Input value={spec.size || ""} onChange={(e) => set("size", e.target.value)} placeholder="例: A4, 100mm×80mm" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">紙質・素材</Label>
              <Input value={spec.paper_type || ""} onChange={(e) => set("paper_type", e.target.value)} placeholder="例: コート紙135kg、PETフィルム" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">印刷色数</Label>
              <Input value={spec.color_count || ""} onChange={(e) => set("color_count", e.target.value)} placeholder="例: 4色(CMYK)、両面4色" className="h-9" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">印刷枚数 <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal">（複数パターン可）</span></Label>
              <QuantityEditor values={spec.quantities} onChange={(v) => set("quantities", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">希望納期 <span className="text-destructive">*</span></Label>
              <Input type="date" value={spec.desired_delivery_date || ""} onChange={(e) => set("desired_delivery_date", e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">加工・オプション</Label>
              <Input value={spec.finishing || ""} onChange={(e) => set("finishing", e.target.value)} placeholder="例: PP加工、折り加工（二つ折り）、角丸" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">用途</Label>
              <Input value={spec.usage || ""} onChange={(e) => set("usage", e.target.value)} placeholder="例: 店頭配布、商品貼付" className="h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">備考（印刷会社への伝達事項）</Label>
            <Textarea value={spec.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="例: 入稿データはIllustrator。送料込みで見積ください" />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * 印刷仕様タブ。1つの見積に複数の印刷物の仕様を持つ。
 * 変更は estimate.print_specs に入り、見積の自動保存で保存される。
 */
export default function PrintSpecsPanel({ estimate, onUpdate, onGoToEmail }) {
  const specs = estimate.print_specs || [];
  const commit = (next) => onUpdate({ print_specs: next });

  const addSpec = () => {
    commit([...specs, newPrintSpec({ desired_delivery_date: estimate.desired_delivery_date || "" })]);
  };
  const updateSpec = (id, next) => commit(specs.map((sp) => (sp.id === id ? next : sp)));
  const duplicateSpec = (sp) => {
    const copy = newPrintSpec({ ...sp, label: sp.label ? `${sp.label}（複製）` : "" });
    const idx = specs.findIndex((x) => x.id === sp.id);
    commit([...specs.slice(0, idx + 1), copy, ...specs.slice(idx + 1)]);
  };
  const removeSpec = (id) => commit(specs.filter((sp) => sp.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">印刷仕様（{specs.length}件）</p>
          <p className="text-xs text-muted-foreground">
            印刷会社に見積を依頼する内容です。仕様を入力 → 「メール」タブで依頼 → 届いた見積書を見積書タブの「仕入先見積から読込」で明細にします
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {specs.length > 0 && onGoToEmail && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onGoToEmail}>
              <Mail className="w-3.5 h-3.5" /> 依頼メールへ
            </Button>
          )}
          <Button size="sm" className="gap-1.5 text-xs" onClick={addSpec}>
            <Plus className="w-3.5 h-3.5" /> 印刷仕様を追加
          </Button>
        </div>
      </div>

      {specs.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Printer className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">まだ印刷仕様がありません</p>
            <p className="text-xs text-muted-foreground mt-1">チラシ・ラベルなど、印刷物ごとに1件ずつ追加してください</p>
            <Button size="sm" className="gap-1.5 text-xs mt-4" onClick={addSpec}>
              <Plus className="w-3.5 h-3.5" /> 印刷仕様を追加
            </Button>
          </CardContent>
        </Card>
      ) : (
        specs.map((sp, i) => (
          <SpecCard
            key={sp.id}
            spec={sp}
            index={i}
            defaultOpen={specs.length === 1 || i === specs.length - 1}
            onChange={(next) => updateSpec(sp.id, next)}
            onDuplicate={() => duplicateSpec(sp)}
            onRemove={() => removeSpec(sp.id)}
          />
        ))
      )}
    </div>
  );
}
