import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { PRICE_READ_NOTES, PRICE_TAX_MODES, toTaxExcluded, vendorTaxMode } from "@/lib/priceTax";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Link2, FileUp, AlertTriangle, Check, Globe, Save } from "lucide-react";
import { toast } from "sonner";
import { PRINT_TYPES, WEB_VENDORS, applyMarkup } from "@/lib/constants";
import { usePricingRules, markupRateFor } from "@/lib/pricing";
import { todayString } from "@/lib/fiscal";

// URL/スクショ取込用の抽出スキーマ（価格マスタ画面と同じ形）
const GRID_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    spec_summary: { type: "string", description: "仕様の要約（紙質・厚さ・面など）。わかる場合のみ" },
    price_grid: {
      type: "array",
      description: "縦=枚数・横=納期の価格表。ページに記載の枚数パターンをすべて行にし、それぞれの納期パターンと価格をcellsに入れる",
      items: {
        type: "object",
        properties: {
          quantity: { type: "number" },
          cells: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, price: { type: "number" } },
            },
          },
        },
      },
    },
    notes: { type: "string", description: "特記事項があれば簡潔に" },
  },
};

// URLのドメインから参照メーカーを推定する
const VENDOR_BY_HOST = [
  ["graphic.jp", "グラフィック"],
  ["raksul.com", "ラクスル"],
  ["printpac.co.jp", "プリントパック"],
  ["matsuda-print", "マツダプリント"],
];
function guessVendor(url) {
  try {
    const host = new URL(url).hostname;
    return VENDOR_BY_HOST.find(([h]) => host.includes(h))?.[1] || "";
  } catch {
    return "";
  }
}

const PAPER_GROUP_BY_TYPE = {
  "パッケージラベル印刷": "紙以外", "ラベル印刷": "紙以外", "のぼり旗印刷": "紙以外", "パネル印刷": "紙以外", "ユニフォーム": "紙以外",
};

/**
 * ネット印刷のページ（URL または スクショ/PDF）から価格表を読み取り、
 * その場で価格マスタに登録しつつ、選んだセルを見積の明細に入れる。
 *
 * props:
 *   defaultCategory  印刷仕様タブの種別などから渡す初期値
 *   onAdd(items)     明細に追加
 *   onClose()
 */
export default function WebPriceImport({ defaultCategory = "", onAdd, onClose }) {
  const queryClient = useQueryClient();
  const { rules } = usePricingRules();
  const fileInputRef = useRef(null);

  const [url, setUrl] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [vendorName, setVendorName] = useState("");
  const [specSummary, setSpecSummary] = useState("");
  const [grid, setGrid] = useState([]);
  const [screenshotPath, setScreenshotPath] = useState("");
  const [loading, setLoading] = useState(null); // 'url' | 'file' | 'save'
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState([]); // [{ rowIdx, cellIdx }]
  const [taxMode, setTaxMode] = useState(null); // null = メーカーの設定に従う

  const { data: printVendors = [] } = useQuery({
    queryKey: ["printVendors"],
    queryFn: () => db.entities.PrintVendor.list("name"),
  });
  const { data: masters = [] } = useQuery({
    queryKey: ["priceMaster"],
    queryFn: () => db.entities.PriceMaster.list("-last_updated"),
  });

  const vendorOptions = useMemo(() => {
    const fromMaster = printVendors.filter((v) => v.vendor_type === "web").map((v) => v.name);
    return [...new Set([...fromMaster, ...WEB_VENDORS])];
  }, [printVendors]);

  // 同じURLの価格マスタがあれば、新規作成ではなく更新する
  const existing = useMemo(
    () => (url ? masters.find((m) => m.source_url && m.source_url.trim() === url.trim()) : null),
    [masters, url],
  );

  const columns = useMemo(() => {
    const seen = [];
    for (const row of grid) for (const c of row.cells || []) if (!seen.includes(c.label)) seen.push(c.label);
    return seen;
  }, [grid]);

  const applyResult = (data) => {
    setGrid(data.price_grid || []);
    if (data.spec_summary && !specSummary) setSpecSummary(data.spec_summary);
    setPicked([]);
    toast.success(`価格表を${(data.price_grid || []).length}行読み取りました。使うセルを選んでください`);
  };

  const runUrl = async () => {
    if (!url.trim()) { toast.error("URLを入力してください"); return; }
    setLoading("url"); setError(null);
    if (!vendorName) setVendorName(guessVendor(url));
    try {
      const res = await db.functions.invoke("fetchPriceFromUrl", { url: url.trim(), spec_summary: specSummary });
      if (res?.data?.error) setError(res.data.error);
      else if (!res?.data?.price_grid?.length) setError("URLから価格表を読み取れませんでした。スクショをお試しください。");
      else applyResult(res.data);
    } catch (err) {
      setError("読み取りに失敗しました: " + err.message);
    } finally {
      setLoading(null);
    }
  };

  const runFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading("file"); setError(null);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      setScreenshotPath(file_url);
      const res = await db.integrations.Core.InvokeLLM({
        prompt: `添付した印刷価格ページのスクリーンショットを読み取り、縦(枚数)×横(納期)の価格表全体と、紙質・厚さ・面などの仕様を抽出してください。価格は表示どおりの数値のみで返してください。${PRICE_READ_NOTES}`,
        file_urls: [file_url],
        response_json_schema: GRID_EXTRACT_SCHEMA,
      });
      if (!res?.price_grid?.length) setError("画像から価格表を読み取れませんでした。");
      else applyResult(res);
    } catch (err) {
      setError("読み取りに失敗しました: " + err.message);
    } finally {
      setLoading(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const isPicked = (r, c) => picked.some((p) => p.rowIdx === r && p.cellIdx === c);
  const togglePick = (r, c) => setPicked((prev) =>
    isPicked(r, c) ? prev.filter((p) => !(p.rowIdx === r && p.cellIdx === c)) : [...prev, { rowIdx: r, cellIdx: c }]
  );

  const markup = markupRateFor(rules, category);
  // ページの金額が税込表示なら、原価は税別に直して持つ（グラフィックなどは税込表示）
  const effectiveTaxMode = taxMode || vendorTaxMode(printVendors, vendorName.trim());
  const pickedCells = picked.map(({ rowIdx, cellIdx }) => {
    const row = grid[rowIdx]; const cell = row.cells[cellIdx];
    const costPerUnit = toTaxExcluded(cell.price, effectiveTaxMode) / (Number(row.quantity) || 1);
    const unitPrice = applyMarkup(costPerUnit, markup);
    return { quantity: Number(row.quantity) || 1, label: cell.label, price: Number(cell.price) || 0, costPerUnit, unitPrice, amount: unitPrice * (Number(row.quantity) || 1) };
  });

  const save = async () => {
    if (!category) { toast.error("大カテゴリ（印刷物種別）を選んでください"); return; }
    if (!vendorName.trim()) { toast.error("参照メーカーを入力してください"); return; }
    if (picked.length === 0) { toast.error("明細に入れるセルを1つ以上選んでください"); return; }
    setLoading("save");
    try {
      // 選んだセルに selected を立てた価格表を作る（既存マスタの選択は残す）
      const newGrid = grid.map((row, r) => ({
        quantity: row.quantity,
        cells: (row.cells || []).map((c, ci) => ({ label: c.label, price: c.price, selected: isPicked(r, ci) })),
      }));
      let mergedGrid = newGrid;
      if (existing) {
        const oldSel = new Set((existing.price_grid || []).flatMap((row) => (row.cells || []).filter((c) => c.selected).map((c) => `${row.quantity}|${c.label}`)));
        mergedGrid = newGrid.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, selected: c.selected || oldSel.has(`${row.quantity}|${c.label}`) })) }));
      }
      const payload = {
        category,
        paper_type_group: PAPER_GROUP_BY_TYPE[category] || "紙",
        vendor_name: vendorName.trim(),
        spec_summary: specSummary,
        price_grid: mergedGrid,
        last_updated: todayString(),
        source_url: url.trim() || (existing?.source_url ?? null),
        price_tax_mode: effectiveTaxMode,
        ...(screenshotPath ? { screenshot_url: screenshotPath } : {}),
      };
      const master = existing
        ? await db.entities.PriceMaster.update(existing.id, payload)
        : await db.entities.PriceMaster.create(payload);
      queryClient.invalidateQueries({ queryKey: ["priceMaster"] });

      onAdd(pickedCells.map((c) => ({
        category: payload.paper_type_group === "紙以外" ? "印刷費（紙以外）" : "印刷費（紙）",
        name: `${category}（${vendorName.trim()}・${c.label}納期）`,
        quantity: c.quantity,
        unit: "枚",
        unit_price: c.unitPrice,
        amount: c.amount,
        cost_price: Math.round(c.costPerUnit * 100) / 100,
        markup_rate: markup,
        source_type: "price_master",
        source_ref: master.id,
        source_url: payload.source_url || null,
      })));
      toast.success(existing ? "価格マスタを更新し、明細に追加しました" : "価格マスタに登録し、明細に追加しました");
      onClose();
    } catch (err) {
      toast.error("登録できませんでした: " + err.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        ネット印刷の価格ページを読み取り、価格マスタに登録しながら明細に入れます。URLは価格の根拠として残り、後日「価格マスタ」画面から更新できます。
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs">価格ページのURL</Label>
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.graphic.jp/price/..." className="h-9" />
          <Button size="sm" variant="outline" className="h-9 gap-1.5 text-xs shrink-0" onClick={runUrl} disabled={!!loading}>
            {loading === "url" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} URLから読込
          </Button>
          <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={runFile} />
          <Button size="sm" variant="outline" className="h-9 gap-1.5 text-xs shrink-0" onClick={() => fileInputRef.current?.click()} disabled={!!loading}>
            {loading === "file" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />} スクショ/PDF
          </Button>
        </div>
        {existing && (
          <p className="text-[10px] text-primary">このURLは価格マスタに登録済み（{existing.category}・{existing.vendor_name}）。読み取り結果で更新します</p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-red-50 border border-red-200">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">大カテゴリ（印刷物種別） *</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="選択" /></SelectTrigger>
            <SelectContent>
              {PRINT_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">参照メーカー *</Label>
          <Input list="web-vendor-options" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="例: グラフィック" className="h-9 text-xs" />
          <datalist id="web-vendor-options">
            {vendorOptions.map((v) => <option key={v} value={v} />)}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">仕様（紙質・厚さ・面など）</Label>
          <Input value={specSummary} onChange={(e) => setSpecSummary(e.target.value)} placeholder="例: 両面・コート紙135kg" className="h-9 text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">ページの金額表示</Label>
          <select value={effectiveTaxMode} onChange={(e) => setTaxMode(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-xs">
            {Object.entries(PRICE_TAX_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground">税込表示なら原価は税別（÷1.1）に直して登録します。初期値は印刷所マスタの設定</p>
        </div>
      </div>

      {grid.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">読み取った価格表（クリックで選択・複数可）<span className="text-muted-foreground font-normal">　掛け率 ×{markup}</span></p>
          <div className="overflow-x-auto border rounded-md">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">枚数</th>
                  {columns.map((c) => <th key={c} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, r) => (
                  <tr key={r} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap">{Number(row.quantity).toLocaleString()}枚</td>
                    {columns.map((col) => {
                      const ci = (row.cells || []).findIndex((c) => c.label === col);
                      const cell = ci >= 0 ? row.cells[ci] : null;
                      const on = ci >= 0 && isPicked(r, ci);
                      return (
                        <td key={col} className="px-1 py-0.5 text-right">
                          {cell ? (
                            <button
                              onClick={() => togglePick(r, ci)}
                              className={`w-full text-right px-1.5 py-1 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "border-transparent hover:bg-muted/60"}`}
                            >
                              {on && <Check className="w-3 h-3 inline mr-0.5" />}¥{Number(cell.price).toLocaleString()}
                            </button>
                          ) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pickedCells.length > 0 && (
        <div className="rounded-md border bg-emerald-50/60 border-emerald-200 p-2.5 space-y-1">
          <p className="text-[10px] text-emerald-800">明細に入れる内容</p>
          {pickedCells.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span>{c.quantity.toLocaleString()}枚 ・ {c.label}納期</span>
              <span>原価 ¥{c.price.toLocaleString()} → 出し値 <strong>¥{c.amount.toLocaleString()}</strong>（@¥{c.unitPrice.toLocaleString()}）</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="text-[10px] font-normal gap-1"><Globe className="w-3 h-3" /> {screenshotPath ? "スクショも保存されます" : "URLが保存されます"}</Badge>
        <Button onClick={save} disabled={!!loading || grid.length === 0} className="gap-1.5">
          {loading === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          価格マスタに{existing ? "更新" : "登録"}して明細に追加
        </Button>
      </div>
    </div>
  );
}
