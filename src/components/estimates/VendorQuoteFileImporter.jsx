import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, FileUp, AlertTriangle, Check, X, Sparkles } from "lucide-react";
import { db } from "@/api/db";
import { toast } from "sonner";
import NumericField from "@/components/estimates/NumericField";

// 日本の印刷会社の見積書は「商品名 × 印刷方式 × 数量」で単価・金額が枝分かれする
// 複雑な表形式が多いため、行単位（line_items）で抽出する。
const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    vendor_name: {
      type: "string",
      description: "この見積書・価格表を発行した会社名。レターヘッドのロゴ、社印、フッターの住所・電話番号の近くに記載されている社名を採用する。「◯◯様」「◯◯御中」と書かれている宛先（発注元＝コンセプト・ヴィレッジ等）は発行元ではないので除外する。",
    },
    delivery_date: {
      type: "string",
      description: "納期。日付がわかる場合はYYYY-MM-DD、日数のみの場合は「3営業日」等の文字列でよい。「別途お打合せ」等、記載がなければ空文字でよい。",
    },
    line_items: {
      type: "array",
      description: "見積書の明細行。商品名・印刷方式・数量ごとに単価や金額が分かれている場合は、それぞれを別の行として全て抽出する（結合しない）。",
      items: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "商品名・仕様（例:「たこ飯の素 オモテ 特色3色」のように、商品名と方式・面などを結合して分かりやすく）" },
          quantity: { type: "number", description: "数量（枚数など）。わかる場合のみ" },
          unit_price: { type: "number", description: "単価（1枚あたりなど）。わかる場合のみ" },
          amount: { type: "number", description: "その数量における合計金額・ケース単価。単価×数量が明示されていればそれを優先" },
        },
      },
    },
    notes: { type: "string", description: "送料・支払条件・見積有効期限など特記事項があれば簡潔に（50文字程度）" },
  },
};

const EXTRACT_PROMPT = `添付した印刷会社・仕入先の見積書・価格表（PDFまたは画像）をよく読み取り、内容を正確にJSONで抽出してください。

【会社名の判別】
この書類を発行した側（レターヘッドのロゴ、社印、フッターの住所・電話番号の近くに記載されている社名）を vendor_name として採用してください。
「〜様」「〜御中」と書かれている宛先（発注元＝コンセプト・ヴィレッジ等）は発行元ではないので除外してください。

【明細行の抽出】
商品名・印刷方式（例：特色3色/デジタル印刷）・面（オモテ/ウラ）・数量ごとに単価や金額が分かれている場合は、結合せずそれぞれを別の行として全て抽出してください（表のセルが結合されて空白に見える場合は、直前の商品名・方式を引き継ぐこと）。
item_name には商品名と方式・面などを結合して分かりやすく記載してください（例：「たこ飯の素 オモテ 特色3色の場合」）。
金額にカンマ区切り（例: 27,900.00）があっても、数値のみの普通の数字（27900）として返してください。
「ケース単価」など合計金額に相当する列があれば amount に、単枚の単価は unit_price に入れてください。

【その他】
納期は日付が分かれば YYYY-MM-DD、「別途お打合せ」のように日付不明ならそのままの文字列で返してください。
送料・支払条件・見積有効期限など特記事項があれば notes に簡潔にまとめてください。
読み取れない項目は無理に埋めず空欄・0などにしてください。`;

function lineLabel(item) {
  const qty = item.quantity != null ? `${item.quantity}枚` : "";
  return [item.item_name, qty].filter(Boolean).join(" / ") || "（商品名不明）";
}

function lineAmount(item) {
  if (item.amount) return item.amount;
  if (item.unit_price && item.quantity) return item.unit_price * item.quantity;
  return item.unit_price || 0;
}

export default function VendorQuoteFileImporter({ estimate, onImported }) {
  const [loading, setLoading] = useState(false);
  const [extracted, setExtracted] = useState(null);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const openEditPanel = (result) => {
    const lineItems = result?.line_items && result.line_items.length > 0
      ? result.line_items
      : [{ item_name: "", quantity: null, unit_price: null, amount: 0 }];

    setExtracted({
      vendor_name: result?.vendor_name || "",
      delivery_date: result?.delivery_date || "",
      lineItems,
      notes: result?.notes || "",
      selectedIdx: 0,
    });

    if (!result?.vendor_name && (!result?.line_items || result.line_items.length === 0)) {
      setWarning("自動読み取りができませんでした。内容を確認のうえ、下の欄に手入力してください。");
    } else if (!result?.vendor_name || !result?.line_items || result.line_items.length === 0) {
      setWarning("一部の項目のみ読み取れました。不足分は手入力で補ってください。");
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    setExtracted(null);

    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      const result = await db.integrations.Core.InvokeLLM({
        prompt: EXTRACT_PROMPT,
        file_urls: [file_url],
        response_json_schema: EXTRACT_SCHEMA,
      });
      openEditPanel(result);
    } catch (err) {
      setError("読み取りに失敗しました: " + err.message);
      // 失敗しても手入力できるよう空の編集パネルは開いておく
      openEditPanel(null);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateExtracted = (field, value) => {
    setExtracted(prev => ({ ...prev, [field]: value }));
  };

  const updateLineItem = (idx, field, value) => {
    setExtracted(prev => ({
      ...prev,
      lineItems: prev.lineItems.map((li, i) => i === idx ? { ...li, [field]: value } : li),
    }));
  };

  const addLineItem = () => {
    setExtracted(prev => ({
      ...prev,
      lineItems: [...prev.lineItems, { item_name: "", quantity: null, unit_price: null, amount: 0 }],
      selectedIdx: prev.lineItems.length,
    }));
  };

  const applyImport = () => {
    if (!extracted || !extracted.vendor_name) {
      toast.error("会社名を入力してください");
      return;
    }
    const selected = extracted.lineItems[extracted.selectedIdx] || extracted.lineItems[0];
    const price = Number(lineAmount(selected)) || 0;

    const otherLinesText = extracted.lineItems.length > 1
      ? `全明細: ${extracted.lineItems.map(li => `${lineLabel(li)} ¥${lineAmount(li).toLocaleString()}`).join("、")} `
      : "";
    const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(extracted.delivery_date);
    const newEntry = {
      vendor_name: extracted.vendor_name,
      price,
      delivery_date: isIsoDate ? extracted.delivery_date : "",
      notes: `${selected?.item_name ? `適用行: ${lineLabel(selected)} ` : ""}${otherLinesText}${extracted.delivery_date && !isIsoDate ? `納期: ${extracted.delivery_date} ` : ""}${extracted.notes || ""}（書類から自動取込・要確認）`.trim(),
      is_selected: false,
    };

    const existing = estimate.vendor_prices || [];
    onImported([...existing, newEntry]);
    toast.success(`${extracted.vendor_name}の見積を追加しました`);
    setExtracted(null);
    setWarning(null);
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileUp className="w-4 h-4 text-primary" />
          見積書PDF・スクショから取込
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          メールで届いた見積PDFや、ネット印刷サイトの画面スクショをアップロードすると、AIが会社名・価格・納期を読み取ります
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs h-8"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
          {loading ? "読み取り中..." : "PDF・画像を選択"}
        </Button>

        {error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-red-50 border border-red-200">
            <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {extracted && (
          <div className="space-y-3 p-3 rounded-md bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Sparkles className="w-3.5 h-3.5" /> 読み取り結果（内容を確認・修正してから追加してください）
            </div>

            {warning && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">{warning}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">会社名 <span className="text-destructive">*</span></label>
                <Input
                  value={extracted.vendor_name}
                  onChange={e => updateExtracted("vendor_name", e.target.value)}
                  className="h-8 text-sm bg-white"
                  placeholder="例: 寺岡システム"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">納期</label>
                <Input
                  value={extracted.delivery_date}
                  onChange={e => updateExtracted("delivery_date", e.target.value)}
                  className="h-8 text-sm bg-white"
                  placeholder="例: 2026-07-20 または 3営業日"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground">明細（適用する行を選択・必要に応じて修正）</label>
              <div className="space-y-1.5">
                {extracted.lineItems.map((li, i) => (
                  <div
                    key={i}
                    className={`p-2 rounded border text-sm ${
                      extracted.selectedIdx === i ? "border-primary bg-white" : "border-transparent bg-white/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <button
                        type="button"
                        onClick={() => updateExtracted("selectedIdx", i)}
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          extracted.selectedIdx === i ? "border-primary bg-primary" : "border-muted-foreground/30"
                        }`}
                      >
                        {extracted.selectedIdx === i && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </button>
                      <Input
                        value={li.item_name || ""}
                        onChange={e => updateLineItem(i, "item_name", e.target.value)}
                        className="h-7 text-xs flex-1"
                        placeholder="商品名・仕様"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 pl-6">
                      <div>
                        <label className="text-[9px] text-muted-foreground">数量</label>
                        <NumericField
                          value={li.quantity ?? null}
                          onCommit={(q) => updateLineItem(i, "quantity", q)}
                          className="h-7 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-muted-foreground">単価</label>
                        <NumericField
                          value={li.unit_price ?? null}
                          onCommit={(p) => updateLineItem(i, "unit_price", p)}
                          className="h-7 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-muted-foreground">金額（適用価格）</label>
                        <NumericField
                          value={li.amount ?? 0}
                          onCommit={(a) => updateLineItem(i, "amount", a)}
                          className="h-7 text-xs font-medium"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={addLineItem} className="text-xs h-7 gap-1">
                + 明細行を追加
              </Button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">備考</label>
              <Input
                value={extracted.notes}
                onChange={e => updateExtracted("notes", e.target.value)}
                className="h-8 text-sm bg-white"
              />
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={applyImport} className="gap-1.5 text-xs h-8 flex-1">
                <Check className="w-3.5 h-3.5" /> 選択した行を価格テーブルに追加
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setExtracted(null); setWarning(null); }} className="gap-1.5 text-xs h-8">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              ※ AIによる読み取りのため誤りが含まれる場合があります。金額は必ず元の書類と照合してください。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
