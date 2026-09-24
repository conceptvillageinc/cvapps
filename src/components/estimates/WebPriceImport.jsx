import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { PRICE_READ_NOTES, PRICE_TAX_MODES, toTaxExcluded, vendorTaxMode } from "@/lib/priceTax";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Link2, FileUp, AlertTriangle, Check, Globe, Save, ArrowLeft, ArrowRight, Image as ImageIcon } from "lucide-react";
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

// URLのドメインから参照メーカーを推定する（印刷所マスタの WebサイトURL を優先し、無ければ既知の一覧）
const VENDOR_BY_HOST = [
  ["graphic.jp", "グラフィック"],
  ["raksul.com", "ラクスル"],
  ["printpac.co.jp", "プリントパック"],
  ["matsuda-print", "マツダプリント"],
];
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function guessVendor(url, printVendors) {
  const host = hostOf(url);
  if (!host) return "";
  const fromMaster = (printVendors || []).find((v) => v.website_url && hostOf(v.website_url) && (host.endsWith(hostOf(v.website_url)) || hostOf(v.website_url).endsWith(host)));
  if (fromMaster) return fromMaster.name;
  return VENDOR_BY_HOST.find(([h]) => host.includes(h))?.[1] || "";
}

const PAPER_GROUP_BY_TYPE = {
  "パッケージラベル印刷": "紙以外", "ラベル印刷": "紙以外", "のぼり旗印刷": "紙以外", "パネル印刷": "紙以外", "ユニフォーム": "紙以外",
};

const STEPS = [
  { n: 1, label: "価格ページの URL" },
  { n: 2, label: "読み取り方法を選ぶ" },
  { n: 3, label: "確認して明細に追加" },
];

/** 上部のステップ表示 */
function StepBar({ current }) {
  return (
    <div className="flex items-center rounded-lg border bg-muted/30 px-3 py-2">
      {STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <div key={s.n} className="flex items-center flex-1 min-w-0">
            {i > 0 && <div className={`h-0.5 w-6 sm:w-10 shrink-0 ${done || active ? "bg-primary" : "bg-border"}`} />}
            <div className={`flex items-center gap-2 min-w-0 ${i > 0 ? "pl-2" : ""}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${done ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {done ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className={`text-xs truncate ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ネット印刷のページから価格表を読み取り、価格マスタに登録しつつ、選んだセルを見積の明細に入れる。
 *
 * 3 ステップ:
 *   1. 価格ページの URL（必須。読み取りに使わなくても価格の根拠として保存する）と、大カテゴリ・参照メーカー・税表示
 *   2. 読み取り方法（URL から自動 / スクショ・PDF）を選ぶ
 *   3. 読み取った価格表を確認し、明細に入れるセルを選んで登録
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

  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [vendorName, setVendorName] = useState("");
  const [vendorTouched, setVendorTouched] = useState(false);
  const [specSummary, setSpecSummary] = useState("");
  const [grid, setGrid] = useState([]);
  const [screenshotPath, setScreenshotPath] = useState("");
  const [screenshotName, setScreenshotName] = useState("");
  const [readMethod, setReadMethod] = useState(null); // 'url' | 'file'
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

  const urlValid = (() => { try { const u = new URL(url.trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } })();

  // URL を入れたら参照メーカーを自動で入れる（手で直した後は触らない）
  const onUrlChange = (value) => {
    setUrl(value);
    if (!vendorTouched) setVendorName(guessVendor(value, printVendors));
  };

  const goStep2 = () => {
    if (!urlValid) { toast.error("価格ページの URL を入力してください（https:// から）"); return; }
    if (!category) { toast.error("大カテゴリ（印刷物種別）を選んでください"); return; }
    if (!vendorName.trim()) { toast.error("参照メーカーを入力してください"); return; }
    setError(null);
    setStep(2);
  };

  const applyResult = (data, method) => {
    setGrid(data.price_grid || []);
    if (data.spec_summary && !specSummary) setSpecSummary(data.spec_summary);
    setPicked([]);
    setReadMethod(method);
    setStep(3);
    toast.success(`価格表を${(data.price_grid || []).length}行読み取りました。明細に入れるマスを選んでください`);
  };

  const runUrl = async () => {
    setLoading("url"); setError(null);
    try {
      const res = await db.functions.invoke("fetchPriceFromUrl", { url: url.trim(), spec_summary: specSummary });
      if (res?.data?.error) setError(res.data.error);
      else if (!res?.data?.price_grid?.length) setError("URL から価格表を読み取れませんでした。B のスクショ／PDF をお試しください。");
      else applyResult(res.data, "url");
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
      setScreenshotName(file.name);
      const res = await db.integrations.Core.InvokeLLM({
        prompt: `添付した印刷価格ページのスクリーンショットを読み取り、縦(枚数)×横(納期)の価格表全体と、紙質・厚さ・面などの仕様を抽出してください。価格は表示どおりの数値のみで返してください。${PRICE_READ_NOTES}`,
        file_urls: [file_url],
        response_json_schema: GRID_EXTRACT_SCHEMA,
      });
      if (!res?.price_grid?.length) setError("画像から価格表を読み取れませんでした。価格表全体が写った画像でもう一度お試しください。");
      else applyResult(res, "file");
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
  const costOf = (row, cell) => toTaxExcluded(cell.price, effectiveTaxMode) / (Number(row.quantity) || 1);
  const pickedCells = picked.map(({ rowIdx, cellIdx }) => {
    const row = grid[rowIdx]; const cell = row.cells[cellIdx];
    const costPerUnit = costOf(row, cell);
    const unitPrice = applyMarkup(costPerUnit, markup);
    return { quantity: Number(row.quantity) || 1, label: cell.label, price: Number(cell.price) || 0, costPerUnit, unitPrice, amount: unitPrice * (Number(row.quantity) || 1) };
  });

  const save = async () => {
    if (picked.length === 0) { toast.error("明細に入れるマスを1つ以上選んでください"); return; }
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
        source_url: url.trim(),
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
        ...(screenshotPath ? { screenshot_path: screenshotPath } : {}),
      })));
      toast.success(existing ? "価格マスタを更新し、明細に追加しました" : "価格マスタに登録し、明細に追加しました");
      onClose();
    } catch (err) {
      toast.error("登録できませんでした: " + err.message);
    } finally {
      setLoading(null);
    }
  };

  const summaryBadge = (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 font-medium">
        {category} ・ {vendorName.trim()} ・ {PRICE_TAX_MODES[effectiveTaxMode]}
      </span>
      {readMethod && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 font-medium">
          {readMethod === "url" ? "URL から読み取り" : "スクショ／PDF から読み取り"}
        </span>
      )}
      <span className="text-muted-foreground truncate max-w-[360px]" title={url}>{url}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        価格ページを読み取り、価格マスタに登録しながら明細に入れます。URL は価格の根拠として残り、後日「価格マスタ」から更新できます。
      </p>

      <StepBar current={step} />

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-200">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* ---- ステップ 1: URL と基本情報 ---- */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">価格ページの URL <span className="text-destructive">*</span></Label>
            <Input value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://www.graphic.jp/price/..." className="h-10" autoFocus />
            <p className="text-[10px] text-muted-foreground">読み取りに使わなくても、価格の根拠として価格マスタに保存します。後日「価格マスタ」から同じページを開いて更新できます</p>
            {existing && (
              <p className="text-[10px] text-primary">この URL は価格マスタに登録済み（{existing.category}・{existing.vendor_name}）。読み取り結果でその 1 件を更新します</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">大カテゴリ（印刷物種別） <span className="text-destructive">*</span></Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent>
                  {PRINT_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">参照メーカー <span className="text-destructive">*</span></Label>
              <Input list="web-vendor-options" value={vendorName} onChange={(e) => { setVendorTouched(true); setVendorName(e.target.value); }} placeholder="例: グラフィック" className="h-9 text-xs" />
              <datalist id="web-vendor-options">
                {vendorOptions.map((v) => <option key={v} value={v} />)}
              </datalist>
              <p className="text-[10px] text-muted-foreground">URL から自動判定（変更可）</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">ページの金額表示</Label>
              <select value={effectiveTaxMode} onChange={(e) => setTaxMode(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-xs">
                {Object.entries(PRICE_TAX_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <p className="text-[10px] text-muted-foreground">税込表示なら原価は税別（÷1.1）に直します。初期値は印刷所マスタの設定</p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Globe className="w-3 h-3" /> URL は価格マスタに保存されます</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>キャンセル</Button>
              <Button onClick={goStep2} className="gap-1.5">次へ：読み取り方法を選ぶ <ArrowRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>
      )}

      {/* ---- ステップ 2: 読み取り方法 ---- */}
      {step === 2 && (
        <div className="space-y-4">
          {summaryBadge}
          <p className="text-xs font-semibold">価格表をどの方法で読み取りますか？</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-3 rounded-xl border-2 p-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Link2 className="w-5 h-5 text-primary" /></div>
              <p className="text-sm font-semibold">A. URL から自動で読み取る</p>
              <p className="text-xs text-muted-foreground leading-relaxed">ステップ 1 の URL のページを取得して、枚数×納期の価格表を AI が読み取ります。ボタンを押すだけで済みます。</p>
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 leading-relaxed">グラフィックなど一部のサイトは、サーバーからのアクセスを遮断したり価格表を後から描画するため、読み取れないことがあります。その場合は B へ。</p>
              <Button onClick={runUrl} disabled={!!loading} className="mt-auto self-start gap-1.5" size="sm">
                {loading === "url" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} URL から読み込む
              </Button>
            </div>
            <div className="relative flex flex-col gap-3 rounded-xl border-2 border-primary bg-primary/5 p-4">
              <span className="absolute top-3 right-3 text-[10px] font-bold text-primary bg-primary/10 rounded-full px-2 py-0.5">おすすめ（確実）</span>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><ImageIcon className="w-5 h-5 text-primary" /></div>
              <p className="text-sm font-semibold">B. スクショ／PDF を読み取る</p>
              <p className="text-xs text-muted-foreground leading-relaxed">ブラウザで価格表を全部表示した状態のスクリーンショット（または PDF）を選びます。画像から AI が価格表を読み取ります。</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">画像は価格マスタに保存され、後から見返せます。表が長い場合はページ全体のスクショで OK。</p>
              <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={runFile} />
              <Button onClick={() => fileInputRef.current?.click()} disabled={!!loading} className="mt-auto self-start gap-1.5" size="sm">
                {loading === "file" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} ファイルを選ぶ
              </Button>
            </div>
          </div>
          {loading && <p className="text-xs text-muted-foreground">AI が価格表を読み取っています。30 秒ほどかかることがあります…</p>}
          <div className="flex items-center justify-between border-t pt-4">
            <Button variant="outline" onClick={() => { setError(null); setStep(1); }} className="gap-1.5" disabled={!!loading}><ArrowLeft className="w-4 h-4" /> 戻る（URL を直す）</Button>
            <span className="text-[10px] text-muted-foreground">読み取り結果は次のステップで確認してから明細に入れます</span>
          </div>
        </div>
      )}

      {/* ---- ステップ 3: 確認して登録 ---- */}
      {step === 3 && (
        <div className="space-y-4">
          {summaryBadge}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">読み取った価格表（原価は税別に直して表示）</p>
              <p className="text-[10px] text-muted-foreground">明細に入れるマスをクリックして選んでください（複数可）。出し値 = 原価 × 掛け率 {markup}</p>
            </div>
            <div className="space-y-1 sm:w-72">
              <Label className="text-[10px] font-semibold text-muted-foreground">仕様（紙質・厚さ・面など）</Label>
              <Input value={specSummary} onChange={(e) => setSpecSummary(e.target.value)} placeholder="例: 両面・コート紙135kg" className="h-8 text-xs" />
            </div>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">枚数</th>
                  {columns.map((c) => <th key={c} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, r) => (
                  <tr key={r} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap font-medium">{Number(row.quantity).toLocaleString()}枚</td>
                    {columns.map((col) => {
                      const ci = (row.cells || []).findIndex((c) => c.label === col);
                      const cell = ci >= 0 ? row.cells[ci] : null;
                      const on = ci >= 0 && isPicked(r, ci);
                      const cost = cell ? costOf(row, cell) : 0;
                      const sell = cell ? applyMarkup(cost, markup) * (Number(row.quantity) || 1) : 0;
                      return (
                        <td key={col} className="px-1 py-0.5 text-right align-top">
                          {cell ? (
                            <button
                              onClick={() => togglePick(r, ci)}
                              className={`w-full text-right px-1.5 py-1 rounded border ${on ? "bg-primary/10 border-primary font-semibold" : "border-transparent hover:bg-muted/60"}`}
                              title={`原価（税別）¥${Math.round(cost * (Number(row.quantity) || 1)).toLocaleString()} → 出し値 ¥${Math.round(sell).toLocaleString()}`}
                            >
                              {on && <Check className="w-3 h-3 inline mr-0.5 text-primary" />}¥{Math.round(toTaxExcluded(cell.price, effectiveTaxMode)).toLocaleString()}
                              {on && <span className="block text-[10px] font-medium text-primary">→ 出し値 ¥{Math.round(sell).toLocaleString()}</span>}
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

          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            {screenshotPath ? <ImageIcon className="w-3.5 h-3.5 shrink-0" /> : <Globe className="w-3.5 h-3.5 shrink-0" />}
            <span>
              {screenshotPath ? <>読み取り元のスクショ <span className="text-foreground font-medium">{screenshotName}</span> と URL を価格マスタに保存します。</> : <>URL を価格マスタに保存します。</>}
              　読み取り結果が違う場合は、登録後に「価格マスタ」画面で表を直せます。
            </span>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <Button variant="outline" onClick={() => { setError(null); setStep(2); }} className="gap-1.5" disabled={!!loading}><ArrowLeft className="w-4 h-4" /> 戻る（読み直す）</Button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">選択中 <strong className="text-foreground">{pickedCells.length} パターン</strong>{pickedCells.length > 0 && <>　出し値 合計 ¥{pickedCells.reduce((s, c) => s + c.amount, 0).toLocaleString()}</>}</span>
              <Button onClick={save} disabled={!!loading || pickedCells.length === 0} className="gap-1.5">
                {loading === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                価格マスタに{existing ? "更新" : "登録"}して明細に追加
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
