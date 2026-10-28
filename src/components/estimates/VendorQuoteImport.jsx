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
import { usePricingRules, markupForText } from "@/lib/pricing";
import { extractVendorQuote, costPerUnit, lineName } from "@/lib/vendorQuote";

// ============================================================================
// 仕入先の見積書（PDF／画像）から、新形式の明細行を作る。
//
// 旧形式では「各社見積価格」の比較表に入れていたが、新形式に比較表は無い。
// 代わりに、読み取った金額を各行の【原価】として取り込み、掛け率を掛けた額を
// 出し値（単価）にする。粗利の計算がそのまま効くようにするための設計。
// ============================================================================

const IMPORTABLE_CATEGORIES = LINE_ITEM_CATEGORIES.filter(c => c.key !== "design");

/**
 * props:
 *   onAdd(items)     読み取った明細を追加する
 *   onClose()
 *   defaultVendor    会社名の初期値（依頼ツールから「◯◯の見積書を読み込む」で開いたとき）
 */
export default function VendorQuoteImport({ onAdd, onClose, defaultVendor = "" }) {
  const { rules } = usePricingRules();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [draft, setDraft] = useState(null);
  const [bulkKey, setBulkKey] = useState(0); // 「まとめて変える」の欄を、入れたあと空に戻す

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

  // 掛け率は行ごとに、明細の名前（なければ仕入先名）から決める。例: 「ラベル」が入っていればパッケージの掛け率。
  // 手で直した行（markupAuto: false）は、名前を直しても変えない
  const autoMarkup = (name, vendorName) => markupForText(rules, name, vendorName);
  const withAutoMarkup = (row, vendorName) => {
    if (row.markupAuto === false) return row;
    const m = autoMarkup(row.name, vendorName);
    return { ...row, markupRate: m.rate, markupWord: m.word, markupAuto: true };
  };

  const openDraft = (result) => {
    // 依頼ツールから会社名付きで開いたときは、その会社名を優先する（読み取り結果の表記ゆれを避ける）
    const vendorName = defaultVendor || result?.vendor_name || "";
    const rows = (result?.line_items || []).map((item, idx) => withAutoMarkup({
      key: idx,
      selected: true,
      name: item.item_name || "",
      quantity: Number(item.quantity) || 1,
      cost: Math.round(costPerUnit(item) * 100) / 100,
    }, vendorName));

    setDraft({
      vendorName,
      category: "print_paper",
      notes: result?.notes || "",
      rows: rows.length > 0 ? rows : [withAutoMarkup({ key: 0, selected: true, name: "", quantity: 1, cost: 0 }, vendorName)],
    });

    if (!result?.vendor_name && rows.length === 0) {
      setWarning("自動読み取りができませんでした。内容を確認のうえ、下の欄に手入力してください。");
    } else if (!result?.vendor_name || rows.length === 0) {
      setWarning("一部の項目のみ読み取れました。不足分は手入力で補ってください。");
    }
  };

  const patchDraft = (patch) => setDraft(prev => {
    const next = { ...prev, ...patch };
    // 仕入先名を直したら、自動の掛け率を決め直す
    if ("vendorName" in patch) next.rows = next.rows.map(r => withAutoMarkup(r, next.vendorName));
    return next;
  });

  const patchRow = (key, patch) =>
    setDraft(prev => ({
      ...prev,
      rows: prev.rows.map(r => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        return "name" in patch ? withAutoMarkup(next, prev.vendorName) : next;
      }),
    }));

  // 全部の行の掛け率をまとめて変える（手で決めた扱い）
  const setAllMarkup = (rate) => {
    setBulkKey(k => k + 1);
    if (!(Number(rate) > 0)) return;
    setDraft(prev => ({ ...prev, rows: prev.rows.map(r => ({ ...r, markupRate: Number(rate), markupWord: "", markupAuto: false })) }));
  };
  // 名前から決め直す（手で直した分も戻す）
  const resetAutoMarkup = () =>
    setDraft(prev => ({ ...prev, rows: prev.rows.map(r => withAutoMarkup({ ...r, markupAuto: true }, prev.vendorName)) }));

  const sellingPrice = (row) => applyMarkup(row.cost, row.markupRate);

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
      const unitPrice = sellingPrice(row);
      return {
        category: categoryLabel,
        name: lineName({ item_name: row.name }, draft.vendorName),
        quantity,
        unit: "枚",
        unit_price: unitPrice,
        amount: unitPrice * quantity,
        cost_price: cost,
        markup_rate: Number(row.markupRate) || 1,
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
          <Label className="text-xs">掛け率（まとめて変える）</Label>
          <div className="flex items-center gap-1.5">
            <NumericField
              key={bulkKey}
              value=""
              onCommit={setAllMarkup}
              placeholder={`例: ${rules.markup.package}`}
              className="h-9 text-sm"
            />
            <Button type="button" size="sm" variant="ghost" className="h-9 px-2 text-xs shrink-0" onClick={resetAutoMarkup} title="明細の名前から掛け率を決め直します">名前から決め直す</Button>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2" data-testid="markup-rule">
        掛け率は行ごとに、明細の名前から自動で決めています。「{rules.package_words.join("・")}」が入っていればパッケージの掛け率 ×{rules.markup.package}、それ以外は ×{rules.markup.other}（システム設定の値付けルールで変えられます）。
      </p>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-xs">
              <th className="w-10 px-2 py-2"></th>
              <th className="text-left px-3 py-2 font-medium">名称</th>
              <th className="text-right px-3 py-2 font-medium w-24">数量</th>
              <th className="text-right px-3 py-2 font-medium w-28">原価（単価）</th>
              <th className="text-right px-3 py-2 font-medium w-28">掛け率</th>
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
                <td className="px-3 py-2 align-top">
                  <NumericField
                    value={row.markupRate}
                    onCommit={(v) => patchRow(row.key, { markupRate: Number(v) || 1, markupWord: "", markupAuto: false })}
                    className="h-8 text-sm text-right"
                    aria-label={`${row.name || "この行"}の掛け率`}
                  />
                  <p className={`mt-0.5 text-right text-[10px] whitespace-nowrap ${row.markupAuto ? (row.markupWord ? "text-blue-700" : "text-muted-foreground") : "text-amber-700"}`} data-testid="markup-reason">
                    {!row.markupAuto ? "手で変更" : row.markupWord ? `「${row.markupWord}」→ パッケージ` : "パッケージ以外"}
                  </p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  ¥{sellingPrice(row).toLocaleString()}
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
