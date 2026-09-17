import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, FileUp, AlertTriangle, X, Check } from "lucide-react";
import { toast } from "sonner";
import NumericField from "@/components/estimates/NumericField";
import { LINE_ITEM_CATEGORIES, applyMarkup } from "@/lib/constants";
import { usePricingRules, markupRateFor } from "@/lib/pricing";
import { extractVendorQuote, costPerUnit, lineName } from "@/lib/vendorQuote";

// ============================================================================
// 仕入先の見積書（PDF／画像）から、新形式の明細行を作る。
//
// 旧形式では「各社見積価格」の比較表に入れていたが、新形式に比較表は無い。
// 代わりに、読み取った金額を各行の【原価】として取り込み、掛け率を掛けた額を
// 出し値（単価）にする。粗利の計算がそのまま効くようにするための設計。
// ============================================================================

const IMPORTABLE_CATEGORIES = LINE_ITEM_CATEGORIES.filter(c => c.key !== "design");

export default function VendorQuoteImport({ onAdd, onClose }) {
  const { rules } = usePricingRules();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [draft, setDraft] = useState(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const { result } = await extractVendorQuote(file);
      openDraft(result);
    } catch (err) {
      setError(`読み取りに失敗しました: ${err.message}`);
      // 失敗しても手入力で進められるよう、空の編集欄は開いておく
      openDraft(null);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openDraft = (result) => {
    const rows = (result?.line_items || []).map((item, idx) => ({
      key: idx,
      selected: true,
      name: item.item_name || "",
      quantity: Number(item.quantity) || 1,
      cost: Math.round(costPerUnit(item) * 100) / 100,
    }));

    setDraft({
      vendorName: result?.vendor_name || "",
      category: "print_paper",
      markupRate: markupRateFor(rules, result?.vendor_name),
      notes: result?.notes || "",
      rows: rows.length > 0 ? rows : [{ key: 0, selected: true, name: "", quantity: 1, cost: 0 }],
    });

    if (!result?.vendor_name && rows.length === 0) {
      setWarning("自動読み取りができませんでした。内容を確認のうえ、下の欄に手入力してください。");
    } else if (!result?.vendor_name || rows.length === 0) {
      setWarning("一部の項目のみ読み取れました。不足分は手入力で補ってください。");
    }
  };

  const patchDraft = (patch) => setDraft(prev => ({ ...prev, ...patch }));

  const patchRow = (key, patch) =>
    setDraft(prev => ({
      ...prev,
      rows: prev.rows.map(r => (r.key === key ? { ...r, ...patch } : r)),
    }));

  const sellingPrice = (cost) => applyMarkup(cost, draft.markupRate);

  const submit = () => {
    const chosen = draft.rows.filter(r => r.selected && r.name.trim());
    if (chosen.length === 0) {
      toast.error("追加する行を選んでください（名称が空の行は追加できません）");
      return;
    }

    const categoryLabel = IMPORTABLE_CATEGORIES.find(c => c.key === draft.category)?.label;

    onAdd(chosen.map(row => {
      const quantity = Number(row.quantity) || 1;
      const cost = Number(row.cost) || 0;
      const unitPrice = sellingPrice(cost);
      return {
        category: categoryLabel,
        name: lineName({ item_name: row.name }, draft.vendorName),
        quantity,
        unit: "枚",
        unit_price: unitPrice,
        amount: unitPrice * quantity,
        cost_price: cost,
        markup_rate: Number(draft.markupRate) || 1,
        source_type: "vendor_quote",
        source_ref: draft.vendorName || undefined,
      };
    }));

    toast.success(`${chosen.length}件の明細を追加しました`);
    onClose();
  };

  // --- ファイル選択前 ---------------------------------------------------------
  if (!draft) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          仕入先の見積書・価格表（PDFまたは画像）を選ぶと、明細をAIが読み取ります。
          読み取った金額は<strong>原価</strong>として取り込み、掛け率を掛けた額が単価になります。
        </p>

        {error && (
          <p className="text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={loading} onClick={() => fileInputRef.current?.click()} className="gap-1.5 text-xs">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
            {loading ? "読み取り中…（数十秒かかります）" : "ファイルを選ぶ"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="text-xs">
            キャンセル
          </Button>
        </div>
      </div>
    );
  }

  // --- 読み取り結果の確認・編集 -----------------------------------------------
  return (
    <div className="space-y-4">
      {warning && (
        <p className="text-sm text-amber-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">仕入先</Label>
          <Input
            value={draft.vendorName}
            onChange={(e) => patchDraft({ vendorName: e.target.value })}
            placeholder="例: 寺岡システム"
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">大カテゴリ</Label>
          <Select value={draft.category} onValueChange={(v) => patchDraft({ category: v })}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMPORTABLE_CATEGORIES.map(c => (
                <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">掛け率</Label>
          <NumericField
            value={draft.markupRate}
            onCommit={(v) => patchDraft({ markupRate: v })}
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-xs">
              <th className="w-10 px-2 py-2"></th>
              <th className="text-left px-3 py-2 font-medium">名称</th>
              <th className="text-right px-3 py-2 font-medium w-24">数量</th>
              <th className="text-right px-3 py-2 font-medium w-28">原価（単価）</th>
              <th className="text-right px-3 py-2 font-medium w-28">単価（出し値）</th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map(row => (
              <tr key={row.key} className={`border-t ${row.selected ? "" : "opacity-40"}`}>
                <td className="px-2 py-2 text-center">
                  <Checkbox
                    checked={row.selected}
                    onCheckedChange={(v) => patchRow(row.key, { selected: !!v })}
                    aria-label="この行を追加する"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={row.name}
                    onChange={(e) => patchRow(row.key, { name: e.target.value })}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <NumericField value={row.quantity} onCommit={(v) => patchRow(row.key, { quantity: v })} className="h-8 text-sm text-right" />
                </td>
                <td className="px-3 py-2">
                  <NumericField value={row.cost} onCommit={(v) => patchRow(row.key, { cost: v })} className="h-8 text-sm text-right" />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  ¥{sellingPrice(row.cost).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft.notes && (
        <p className="text-xs text-muted-foreground">
          読み取った特記事項: {draft.notes}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} className="gap-1.5 text-xs">
          <Check className="w-3.5 h-3.5" /> 選択した行を明細に追加
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} className="gap-1.5 text-xs">
          <X className="w-3.5 h-3.5" /> キャンセル
        </Button>
      </div>
    </div>
  );
}
