import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Calculator } from "lucide-react";
import { getMarkupRate } from "@/lib/constants";
import { useEffect } from "react";
import NumericField from "@/components/estimates/NumericField";

export default function CostCalculation({ estimate, onUpdate }) {
  const costPrice = estimate.cost_price || 0;
  const markupRate = getMarkupRate(estimate.print_type);
  const sellingPrice = estimate.selling_price || 0;
  const proofreadingFee = estimate.proofreading_fee || 0;
  const otherFees = estimate.other_fees || 0;
  const designFeeTotal = estimate.design_fee_total || 0;
  const grossProfit = sellingPrice - costPrice;
  const totalAmount = sellingPrice + proofreadingFee + otherFees + designFeeTotal;
  const profitRate = sellingPrice > 0 ? ((grossProfit / sellingPrice) * 100).toFixed(1) : 0;

  const isCostOverSelling = costPrice > 0 && sellingPrice > 0 && costPrice >= sellingPrice;

  useEffect(() => {
    if (estimate.gross_profit !== grossProfit || estimate.total_amount !== totalAmount) {
      onUpdate({ gross_profit: grossProfit, total_amount: totalAmount });
    }
  }, [grossProfit, totalAmount, designFeeTotal]);

  const recalculate = () => {
    if (costPrice > 0) {
      const newSellingPrice = Math.ceil(costPrice * markupRate);
      onUpdate({
        selling_price: newSellingPrice,
        gross_profit: newSellingPrice - costPrice,
        total_amount: newSellingPrice + proofreadingFee + otherFees,
        markup_rate: markupRate,
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="w-4 h-4" /> 見積計算
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            掛け率: ×{markupRate}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cost price warning */}
        {isCostOverSelling && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-xs text-destructive font-medium">
              原価が出し値を上回っています。確認してください。
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Cost price */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">原価</Label>
            <NumericField
              value={costPrice || null}
              onCommit={(cost) => {
                const selling = Math.ceil(cost * markupRate);
                onUpdate({
                  cost_price: cost,
                  selling_price: selling,
                  gross_profit: selling - cost,
                  total_amount: selling + proofreadingFee + otherFees,
                  markup_rate: markupRate,
                });
              }}
              className="text-sm"
            />
          </div>

          {/* Selling price */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">出し値（販売価格）</Label>
            <NumericField
              value={sellingPrice || null}
              onCommit={(selling) => {
                onUpdate({
                  selling_price: selling,
                  gross_profit: selling - costPrice,
                  total_amount: selling + proofreadingFee + otherFees,
                });
              }}
              className={`text-sm ${isCostOverSelling ? "border-destructive" : ""}`}
            />
          </div>

          {/* Gross profit */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">粗利</Label>
            <div className={`h-9 px-3 rounded-md border flex items-center text-sm font-medium ${
              grossProfit > 0 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
              grossProfit < 0 ? "text-destructive bg-destructive/5 border-destructive/30" :
              "text-muted-foreground bg-muted"
            }`}>
              ¥{grossProfit.toLocaleString()}
              {sellingPrice > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({profitRate}%)</span>
              )}
            </div>
          </div>
        </div>

        {/* Additional fees */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">校正費</Label>
            <NumericField
              value={proofreadingFee || null}
              onCommit={(fee) => {
                onUpdate({
                  proofreading_fee: fee,
                  total_amount: sellingPrice + fee + otherFees + designFeeTotal,
                });
              }}
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">その他費用</Label>
            <NumericField
              value={otherFees || null}
              onCommit={(fee) => {
                onUpdate({
                  other_fees: fee,
                  total_amount: sellingPrice + proofreadingFee + fee + designFeeTotal,
                });
              }}
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground font-semibold">合計金額</Label>
            <div className="h-9 px-3 rounded-md bg-primary/10 border border-primary/20 flex items-center text-sm font-bold text-primary">
              ¥{totalAmount.toLocaleString()}
            </div>
          </div>
        </div>
        {designFeeTotal > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1 border-t pt-3 mt-1">
            <span>内訳: 印刷費 ¥{(sellingPrice + proofreadingFee + otherFees).toLocaleString()} ＋ デザイン費 ¥{designFeeTotal.toLocaleString()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
