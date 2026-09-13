import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Globe, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { db } from "@/api/db";
import { toast } from "sonner";
import { WEB_PRINT_TYPES, WEB_VENDORS } from "@/lib/constants";

const VENDOR_URLS = {
  "グラフィック": "https://www.graphic.jp/",
  "マツダプリント": "https://www.suteki.co.jp/",
  "ラクスル": "https://raksul.com/",
  "プリントパック": "https://www.printpac.co.jp/",
};

export default function WebPriceCollector({ estimate, onPricesCollected }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [failed, setFailed] = useState([]);

  const isWebType = WEB_PRINT_TYPES.includes(estimate.print_type);

  const collectPrices = async () => {
    setLoading(true);
    setResults(null);
    setFailed([]);

    try {
      const response = await db.functions.invoke("collectWebPrices", {
        print_type: estimate.print_type,
        quantities: estimate.quantities,
        size: estimate.size,
        desired_delivery_date: estimate.desired_delivery_date,
      });

      const data = response.data;
      setResults(data.results || []);
      setFailed(data.failed || []);

      if (data.results && data.results.length > 0) {
        toast.success(`${data.results.length}社の価格情報を収集しました`);
      }
      if (data.failed && data.failed.length > 0) {
        toast.warning(`${data.failed.length}社の収集に失敗しました`);
      }
    } catch (err) {
      toast.error("価格収集に失敗しました: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyToTable = () => {
    if (!results || results.length === 0) return;

    const existingVendors = estimate.vendor_prices || [];
    const newEntries = results
      .filter(r => !existingVendors.some(v => v.vendor_name === r.vendor_name))
      .map(r => ({
        vendor_name: r.vendor_name,
        price: r.price,
        delivery_date: "",
        notes: `${r.delivery_days ? `納期目安: ${r.delivery_days}日` : ""}${r.notes ? " " + r.notes : ""}（AI推定値）`.trim(),
        is_selected: false,
      }));

    const updatedEntries = existingVendors.map(v => {
      const found = results.find(r => r.vendor_name === v.vendor_name);
      if (found) {
        return {
          ...v,
          price: found.price,
          notes: `${found.delivery_days ? `納期目安: ${found.delivery_days}日` : ""}${found.notes ? " " + found.notes : ""}（AI推定値）`.trim(),
        };
      }
      return v;
    });

    onPricesCollected([...updatedEntries, ...newEntries]);
    toast.success("価格テーブルに反映しました");
  };

  if (!isWebType) {
    return null;
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            ネット印刷4社 自動価格収集
          </CardTitle>
          <div className="flex items-center gap-2">
            {results && (
              <Button variant="outline" size="sm" onClick={collectPrices} disabled={loading} className="gap-1.5 text-xs h-7">
                <RefreshCw className="w-3 h-3" /> 再収集
              </Button>
            )}
            <Button
              size="sm"
              onClick={collectPrices}
              disabled={loading}
              className="gap-1.5 text-xs h-7"
            >
              {loading ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> 収集中...</>
              ) : (
                <><Globe className="w-3 h-3" /> 価格を自動収集</>
              )}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          グラフィック・マツダプリント・ラクスル・プリントパックの価格をAIで推定収集します
        </p>
      </CardHeader>

      {(results || failed.length > 0 || loading) && (
        <CardContent className="space-y-3">
          {loading && (
            <div className="space-y-2">
              {WEB_VENDORS.map(name => (
                <div key={name} className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{name} を収集中...</span>
                </div>
              ))}
            </div>
          )}

          {results && results.length > 0 && (
            <>
              <div className="space-y-2">
                {results.map(r => (
                  <div key={r.vendor_name} className="flex items-center justify-between p-2 rounded-md bg-white border text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="font-medium">{r.vendor_name}</span>
                      <a
                        href={VENDOR_URLS[r.vendor_name]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">¥{r.price.toLocaleString()}</span>
                      {r.delivery_days && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {r.delivery_days}日
                        </Badge>
                      )}
                      <Badge className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0">推定値</Badge>
                    </div>
                  </div>
                ))}
              </div>

              {failed.length > 0 && (
                <div className="space-y-1">
                  {failed.map(f => (
                    <div key={f.vendor_name} className="flex items-center gap-2 text-xs text-destructive">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{f.vendor_name}: 収集失敗</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-2 p-2 rounded-md bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  価格はAIによる推定値です。実際の発注前に各社サイトで必ず確認してください。
                </p>
              </div>

              <Button onClick={applyToTable} className="w-full gap-1.5 text-xs h-8">
                価格テーブルに反映する
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
