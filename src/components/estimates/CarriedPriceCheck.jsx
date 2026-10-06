import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/AuthContext";
import { vendorTaxMode, toTaxExcluded, PRICE_READ_NOTES } from "@/lib/priceTax";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ExternalLink, History, ChevronDown, ChevronUp, ArrowRight, AlertTriangle, Send, CheckCircle2, ImagePlus, Image as ImageIcon, Keyboard } from "lucide-react";
import { toast } from "sonner";
import { recomputeSubtotals, recomputeRuleRows, usePricingRules } from "@/lib/pricing";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { priceCheckTargets, oldUnitCost, checkWithMaster, checkWithGrid, replaceWithCurrent, PRICE_CHECK_STATUS, masterOf, vendorOf, originLabel, unknownReason, checkManual, markSame, PRICE_GRID_SCHEMA, defaultCell, checkWithShot } from "@/lib/priceCheck";

// ============================================================================
// 見積書の画面の「印刷費・仕入の価格確認」（依頼ツールの帯の下に常に出す）
//   対象: 価格マスタ・入稿先 URL・仕入先見積から入れた行と、社内見積・過去の見積から引き継いだ印刷費・仕入先の行。
//   行ごとに、見積に入れたときの原価と今の原価（入稿先 URL の価格表を読み直す／価格マスタ）を並べ、
//   値上がり・値下がりを色で出す。「置き換える」で原価と売価（前回と同じ比率）を直す。
//   対象の行が無い見積では、帯をグレーにしてボタンを押せないようにする。
// ============================================================================

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${(Math.round(Number(n) * 100) / 100).toLocaleString()}`);
const yen0 = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("ja-JP") : "");
const pct = (a, b) => (a && b ? `${((b - a) / a * 100 >= 0 ? "+" : "")}${((b - a) / a * 100).toFixed(1)}%` : "");

const REASON_TEXT = {
  url_unreadable: "入稿先のページを読み取れませんでした。価格を JavaScript で後から出すページや、サーバーからのアクセスを断るサイトでは読めないことがあります",
  no_quantity: "価格表は読めましたが、この数量の行がありませんでした（数量の区切りが変わった可能性があります）",
  no_source: "入稿先 URL も価格マスタの登録も無いため、アプリでは今の価格を調べられません",
};

/** 署名付き URL（Storage の非公開バケット） */
function useSignedUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    db.storage.signedUrl(path).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [path]);
  return url;
}

function EvidenceLink({ path, label = "スクショ" }) {
  const url = useSignedUrl(path);
  if (!path) return null;
  return <a href={url || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-teal-700 hover:underline"><ImageIcon className="w-3 h-3" /> {label}</a>;
}

/**
 * スクショ（貼り付け／ファイル）から価格表を読み、数量の行と前回にいちばん近いマスを選ぶ。選び直してから「比べる」。
 */
function ShotReader({ li, masters, printVendors, onCompare }) {
  const qty = Number(li.quantity) || 1;
  const old = oldUnitCost(li);
  const inputRef = useRef(null);
  const [mode, setMode] = useState(() => vendorTaxMode(printVendors, vendorOf(li, masters)));
  const [shot, setShot] = useState(null); // { preview, path, grid, spec, pick }
  const [reading, setReading] = useState(false);
  const [saveMaster, setSaveMaster] = useState(false);
  const [over, setOver] = useState(false);

  const read = async (file) => {
    if (!file) return;
    if (!/^image\/|pdf$/.test(file.type || "") && !/\.(png|jpe?g|webp|pdf)$/i.test(file.name || "")) { toast.error("画像か PDF を選んでください"); return; }
    setReading(true);
    const preview = /^image\//.test(file.type) ? URL.createObjectURL(file) : null;
    try {
      const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || [file.type === "application/pdf" ? ".pdf" : ".png"])[0].toLowerCase();
      const path = `price-checks/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;
      const { file_url } = await db.integrations.Core.UploadFile({ file, path });
      const res = await db.integrations.Core.InvokeLLM({
        prompt: `添付した画像（またはPDF）は印刷会社の価格ページのスクリーンショットか、仕入先の見積書です。縦(枚数)×横(納期)の価格表を読み取ってください。見積書で数量ごとの金額しか無い場合は、数量ごとに 1 マス（label は「見積」）にしてください。価格は表示どおりの数値で返してください。${PRICE_READ_NOTES}`,
        file_urls: [file_url],
        response_json_schema: PRICE_GRID_SCHEMA,
      });
      const grid = (res?.price_grid || []).filter((r) => Number(r.quantity) > 0 && (r.cells || []).length);
      if (grid.length === 0) { toast.error("価格表を読み取れませんでした。価格表全体が写るように撮り直すか、金額を手で入れてください"); setShot({ preview, path: file_url, grid: [], spec: "", pick: null }); return; }
      setShot({ preview, path: file_url, grid, spec: res?.spec_summary || "", pick: defaultCell(grid, qty, old, mode) });
    } catch (e) {
      toast.error("読み取りに失敗しました: " + e.message);
    } finally { setReading(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  const onPaste = (e) => {
    const f = Array.from(e.clipboardData?.items || []).find((it) => it.kind === "file")?.getAsFile();
    if (f) { e.preventDefault(); read(f); }
  };

  const row = shot?.pick ? shot.grid[shot.pick.r] : null;
  const cell = row ? row.cells[shot.pick.c] : null;
  const unit = cell ? Math.round((toTaxExcluded(cell.price, mode) / (Number(row.quantity) || 1)) * 100) / 100 : null;
  const qtyRowIdx = shot ? shot.grid.findIndex((r) => Number(r.quantity) === qty) : -1;
  // 数量の行の前後 1 行ずつだけ見せる（全部だと長くなるため）
  const visibleRows = shot ? shot.grid.map((r, i) => ({ r, i })).filter(({ i }) => qtyRowIdx < 0 || Math.abs(i - qtyRowIdx) <= 1) : [];

  return (
    <div
      tabIndex={0}
      onPaste={onPaste}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer?.files?.[0]); }}
      className={`flex-1 min-w-[320px] rounded-md border border-dashed p-2 bg-white outline-none focus:ring-2 focus:ring-teal-300 ${over ? "border-teal-500 bg-teal-50" : "border-teal-300"}`}
      data-testid="price-shot-reader"
      aria-label="スクリーンショットを貼り付け（クリックしてから Ctrl+V）"
    >
      {!shot && !reading && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
          <Button type="button" size="sm" className="h-7 px-2 text-[11px] gap-1 bg-teal-600 hover:bg-teal-700" onClick={() => inputRef.current?.click()}><ImagePlus className="w-3.5 h-3.5" /> スクショ・PDF を選ぶ</Button>
          <span className="text-[10.5px] text-muted-foreground">または この枠をクリックして Ctrl+V（⌘+V）で貼り付け／ドラッグ＆ドロップ</span>
        </div>
      )}
      {reading && <p className="text-[11px] text-teal-800 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 価格表を読み取っています…（数秒かかります）</p>}
      {shot && !reading && (
        <div className="flex flex-wrap gap-3">
          {shot.preview && <a href={shot.preview} target="_blank" rel="noreferrer" className="shrink-0"><img src={shot.preview} alt="スクショ" className="h-24 w-auto max-w-[180px] rounded border object-contain bg-white" /></a>}
          <div className="flex-1 min-w-[240px] space-y-1.5">
            {shot.grid.length > 0 ? (
              <>
                <p className="text-[10.5px] text-muted-foreground">読み取った価格表{shot.spec ? `（${shot.spec}）` : ""}。{qtyRowIdx >= 0 ? `${qty.toLocaleString()}${li.unit} の行で、前回にいちばん近いマスを選んでいます。違う場合はマスをクリック` : `この画像に ${qty.toLocaleString()}${li.unit} の行がありません。数量の行が写るように撮り直すか、金額を手で入れてください`}</p>
                <div className="overflow-x-auto">
                  <table className="text-[10.5px] border-collapse" data-testid="price-shot-grid">
                    <tbody>
                      {visibleRows.map(({ r, i }) => (
                        <tr key={i} className={i === qtyRowIdx ? "" : "opacity-50"}>
                          <td className="pr-2 py-0.5 text-right tabular-nums whitespace-nowrap font-medium">{Number(r.quantity).toLocaleString()}</td>
                          {(r.cells || []).map((c, j) => {
                            const on = shot.pick && shot.pick.r === i && shot.pick.c === j;
                            return (
                              <td key={j} className="p-0.5">
                                <button type="button" disabled={i !== qtyRowIdx} onClick={() => setShot((sh) => ({ ...sh, pick: { r: i, c: j } }))} className={`px-1.5 py-0.5 rounded border whitespace-nowrap tabular-nums ${on ? "bg-teal-600 text-white border-teal-600" : "bg-white hover:bg-teal-50"}`}>
                                  <span className="opacity-70 mr-1">{c.label}</span>¥{Number(c.price).toLocaleString()}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {cell && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span>使う金額: <b>{Number(row.quantity).toLocaleString()}{li.unit}・{cell.label} ¥{Number(cell.price).toLocaleString()}</b></span>
                    <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-6 rounded border bg-white px-1 text-[10.5px]" aria-label="表示の税"><option value="included">税込表示</option><option value="excluded">税別表示</option></select>
                    <span className="text-muted-foreground">→ 1{li.unit || "個"}あたり ¥{unit?.toLocaleString()}（税別）</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" className="h-7 px-2 text-[11px] bg-teal-600 hover:bg-teal-700" disabled={!cell} onClick={() => onCompare(shot, mode, saveMaster)}>比べる</Button>
                  <label className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><input type="checkbox" checked={saveMaster} onChange={(e) => setSaveMaster(e.target.checked)} /> 価格マスタにも登録する（次から自動で比べられます）</label>
                  <button type="button" className="text-[10.5px] text-teal-700 hover:underline ml-auto" onClick={() => setShot(null)}>別のスクショにする</button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-slate-600">読み取れませんでした。<button type="button" className="text-teal-700 hover:underline" onClick={() => setShot(null)}>別のスクショにする</button></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 確認できなかった行の「次にやること」 */
function NextActions({ li, masters, printVendors, onManual, onSame, onRequest, onShot }) {
  const [manualOpen, setManualOpen] = useState(false);
  const reason = unknownReason(li, masters);
  const url = li.source_url || masterOf(li, masters)?.source_url || "";
  const qty = Number(li.quantity) || 1;
  const [total, setTotal] = useState("");
  const [mode, setMode] = useState(() => vendorTaxMode(printVendors, vendorOf(li, masters)));
  const n = String(total).replace(/[,¥￥\s]/g, "");
  const valid = n !== "" && Number(n) > 0;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-2" data-testid="price-next-actions">
      <p className="text-[11px] text-slate-700 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" /><span><span className="font-semibold">確認できなかった理由：</span>{REASON_TEXT[reason]}</span></p>
      <p className="text-[11px] font-semibold text-slate-700">次にやること</p>
      <ol className="space-y-2 text-[11px]">
        <li className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white text-[9px] shrink-0">1</span>
          {url ? (
            <>
              <span>入稿先のページを開いて、{qty.toLocaleString()}{li.unit} の今の金額を見る</span>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-6 px-2 rounded border bg-white text-[10px] hover:bg-slate-50">入稿先を開く <ExternalLink className="w-3 h-3" /></a>
            </>
          ) : (
            <>
              <span>仕入先（{vendorOf(li, masters) || "未登録"}）に今の価格を確認する。メールで聞くときは依頼ツールが使えます</span>
              <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1 bg-white" onClick={onRequest}><Send className="w-3 h-3" /> 依頼ツールを開く</Button>
            </>
          )}
        </li>
        <li className="flex flex-wrap items-start gap-2">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white text-[9px] shrink-0 mt-1.5">2</span>
          <div className="flex-1 min-w-0 space-y-1.5">
            <p>{url ? "その画面のスクショを貼ると、価格表を読み取って比べます" : "届いた見積書（PDF・画像）を入れると、金額を読み取って比べます"}</p>
            <ShotReader li={li} masters={masters} printVendors={printVendors} onCompare={onShot} />
            <button type="button" className="inline-flex items-center gap-1 text-[10.5px] text-teal-700 hover:underline" onClick={() => setManualOpen((v) => !v)}><Keyboard className="w-3 h-3" /> {manualOpen ? "金額の手入力を閉じる" : "金額を手で入れる"}</button>
            {manualOpen && (
              <div className="flex flex-wrap items-center gap-2">
                <span>見た金額（{qty.toLocaleString()}{li.unit} の合計）</span>
                <Input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="numeric" placeholder="例: 3,010" className="h-7 w-28 text-xs text-right tabular-nums bg-white" aria-label="見た金額" />
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-7 rounded-md border bg-white px-1 text-[11px]" aria-label="税込・税別">
                  <option value="included">税込</option>
                  <option value="excluded">税別</option>
                </select>
                <Button type="button" size="sm" className="h-7 px-2 text-[11px] bg-teal-600 hover:bg-teal-700" disabled={!valid} onClick={() => onManual(Number(n), mode)}>比べる</Button>
              </div>
            )}
          </div>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-400 text-white text-[9px] shrink-0">他</span>
          <span className="text-muted-foreground">確認して前回と同じだった場合は</span>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1 bg-white" onClick={onSame}><CheckCircle2 className="w-3 h-3" /> 変わりなしとして確認済みにする</Button>
          {url && <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 text-teal-800" onClick={onRequest}><Send className="w-3 h-3" /> 仕入先に聞く（依頼ツール）</Button>}
        </li>
      </ol>
      {reason !== "no_source" && <p className="text-[10px] text-muted-foreground">よく使う印刷物は価格マスタに登録しておくと、次から URL が読めなくても価格マスタで自動で比べられます</p>}
    </div>
  );
}

export default function CarriedPriceCheck({ estimate, onUpdate, onOpenRequestTool }) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.email || "";
  const { rules } = usePricingRules();
  const items = estimate.line_items || [];
  const carried = useMemo(() => priceCheckTargets(items), [items]);
  const [busy, setBusy] = useState(() => new Set());
  const [open, setOpen] = useState(true);
  const { data: masters = [] } = useQuery({ queryKey: ["priceMaster"], queryFn: () => db.entities.PriceMaster.list("-last_updated"), enabled: carried.length > 0 });
  const { data: printVendors = [] } = useQuery({ queryKey: ["printVendors"], queryFn: () => db.entities.PrintVendor.list(), enabled: carried.length > 0 });

  if (carried.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-slate-400 select-none" data-testid="carried-price-check" aria-disabled="true">
        <History className="w-4 h-4" />
        <span className="text-sm font-semibold">印刷費・仕入の価格確認</span>
        <span className="text-[11px]">対象の行がありません（価格マスタ・入稿先 URL・仕入先の見積から入れた行や、社内見積・過去の見積から引き継いだ印刷費の行があると使えます）</span>
        <Button size="sm" className="ml-auto h-7 text-[11px] gap-1" disabled><RefreshCw className="w-3.5 h-3.5" /> まとめて今の価格を確認</Button>
      </div>
    );
  }

  const commit = (nextItems) => {
    const fixed = recomputeSubtotals(recomputeRuleRows(nextItems, rules));
    onUpdate({ line_items: fixed, total_amount: computeEstimateTotals(fixed, { taxInclusive: !!estimate.tax_inclusive }).total });
  };
  const patchItems = (patches) => commit((estimate.line_items || []).map((li) => (patches[li.id] ? patches[li.id](li) : li)));

  const checkOne = async (li) => {
    // 1) 入稿先 URL があれば読み直す → 2) 読めなければ価格マスタ → 3) どちらも無ければ要確認
    let result = null; let urlError = "";
    const url = li.source_url || masterOf(li, masters)?.source_url || "";
    if (url) {
      try {
        const res = await db.functions.invoke("fetchPriceFromUrl", { url, spec_summary: li.name });
        if (res?.data?.error) urlError = res.data.error;
        else if (res?.data?.price_grid?.length) result = checkWithGrid(li, res.data.price_grid, printVendors, masters, url);
        else urlError = "URL から価格表を読み取れませんでした";
      } catch (e) { urlError = e.message; }
    }
    if (!result || result.status === "unknown") {
      const m = checkWithMaster(li, masters, printVendors);
      if (m) result = m;
    }
    if (!result) {
      result = { status: "unknown", checked_at: new Date().toISOString(), old_cost: oldUnitCost(li), current_cost: null, source: url ? "url" : "", label: "", ref: url, error: urlError || (url ? "" : "入稿先 URL も価格マスタの登録も無い行です。仕入先に確認してください") };
    } else if (urlError && result.source === "master") {
      result.error = `URL は読めなかったため価格マスタで確認（${urlError.slice(0, 60)}）`;
    }
    return result;
  };

  const run = async (targets) => {
    const ids = targets.map((li) => li.id);
    setBusy((s) => new Set([...s, ...ids]));
    const patches = {};
    for (const li of targets) {
      const r = await checkOne(li);
      patches[li.id] = (cur) => ({ ...cur, price_check: { ...(cur.price_check || {}), ...r } });
    }
    patchItems(patches);
    setBusy((s) => { const t = new Set(s); ids.forEach((id) => t.delete(id)); return t; });
    const up = Object.keys(patches).length;
    toast.success(`${up} 行の価格を確認しました`);
  };

  const replace = (li) => patchItems({ [li.id]: (cur) => replaceWithCurrent(cur) });
  const manual = (li, total, mode) => { patchItems({ [li.id]: (cur) => ({ ...cur, price_check: checkManual(cur, total, mode, userName) }) }); toast.success("入れた金額で比べました"); };
  const shotCompare = async (li, shot, mode, saveMaster) => {
    const pc = checkWithShot(li, shot.grid, shot.pick, mode, shot.path, userName);
    patchItems({ [li.id]: (cur) => ({ ...cur, price_check: checkWithShot(cur, shot.grid, shot.pick, mode, shot.path, userName), screenshot_path: cur.screenshot_path || shot.path }) });
    toast.success(`スクショの価格で比べました（${PRICE_CHECK_STATUS[pc.status]?.label || ""}）`);
    if (saveMaster) {
      try {
        await db.entities.PriceMaster.create({
          category: li.name, vendor_name: vendorOf(li, masters) || "（仕入先未登録）", spec_summary: shot.spec || "",
          paper_type_group: /紙以外/.test(li.category || "") ? "紙以外" : "紙", price_grid: shot.grid, last_updated: new Date().toISOString().slice(0, 10),
          screenshot_url: shot.path, source_url: li.source_url || null, price_tax_mode: mode,
        });
        toast.success("価格マスタにも登録しました");
      } catch (e) { toast.error("価格マスタに登録できませんでした: " + e.message); }
    }
  };
  const same = (li) => { patchItems({ [li.id]: (cur) => ({ ...cur, price_check: markSame(cur, userName) }) }); toast.success("変わりなしとして確認済みにしました"); };
  const replaceAllUp = () => {
    const targets = carried.filter((li) => ["up", "down"].includes(li.price_check?.status) && li.price_check?.current_cost != null);
    const patches = Object.fromEntries(targets.map((li) => [li.id, (cur) => replaceWithCurrent(cur)]));
    patchItems(patches);
    toast.success(`${targets.length} 行を今の原価に置き換えました`);
  };

  const count = (st) => carried.filter((li) => (li.price_check?.status || "none") === st).length;
  const changed = carried.filter((li) => ["up", "down"].includes(li.price_check?.status) && li.price_check?.current_cost != null);
  const sources = [...new Set(carried.map((li) => li.copied_from).filter(Boolean))].map((c) => (/^原価計算表/.test(c) ? c.replace(/^原価計算表\s*/, "社内見積 ") : `見積 ${c}`));

  return (
    <Card className="border-teal-300 overflow-hidden" data-testid="carried-price-check">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-teal-50 border-b border-teal-200">
          <History className="w-4 h-4 text-teal-700" />
          <span className="text-sm font-semibold text-teal-900">印刷費・仕入の価格確認</span>
          <span className="text-[11px] text-teal-800/80">対象 {carried.length} 行{sources.length ? `（${sources.length > 2 ? `${sources.slice(0, 2).join("、")} ほか` : sources.join("、")} から引き継ぎを含む）` : ""}</span>
          <div className="flex flex-wrap items-center gap-1 text-[10px]" data-testid="price-check-summary">
            {["same", "up", "down", "unknown", "replaced", "none"].map((st) => count(st) > 0 && <Badge key={st} className={`${PRICE_CHECK_STATUS[st].cls} hover:${PRICE_CHECK_STATUS[st].cls} font-normal`}>{PRICE_CHECK_STATUS[st].label} {count(st)}</Badge>)}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {changed.length > 0 && <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 bg-background" onClick={replaceAllUp}>変わった {changed.length} 行を今の原価に置き換える</Button>}
            <Button size="sm" className="h-7 text-[11px] gap-1 bg-teal-600 hover:bg-teal-700" onClick={() => run(carried)} disabled={busy.size > 0}>{busy.size > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} まとめて今の価格を確認</Button>
            <button type="button" onClick={() => setOpen((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground" aria-label={open ? "たたむ" : "開く"}>{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
          </div>
        </div>
        {open && count("unknown") > 0 && (
          <div className="px-4 py-1.5 border-b bg-slate-50 text-[11px] text-slate-700 flex items-center gap-1.5" data-testid="price-check-unknown-note">
            <AlertTriangle className="w-3.5 h-3.5 text-slate-400" /> 確認できなかった行が {count("unknown")} 行あります。各行の下の「次にやること」から、入稿先を見て金額を入れるか、仕入先に確認してください
          </div>
        )}
        {open && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead className="bg-slate-50 text-[10px] text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-1.5 font-normal">明細</th>
                  <th className="text-right px-2 py-1.5 font-normal w-24">数量</th>
                  <th className="text-right px-2 py-1.5 font-normal w-32">見積に入れた原価（単価）</th>
                  <th className="text-right px-2 py-1.5 font-normal w-32">今の原価（単価）</th>
                  <th className="text-left px-2 py-1.5 font-normal w-28">結果</th>
                  <th className="text-left px-2 py-1.5 font-normal w-52">確認元</th>
                  <th className="w-44"></th>
                </tr>
              </thead>
              <tbody>
                {carried.map((li) => {
                  const pc = li.price_check || {};
                  const st = PRICE_CHECK_STATUS[pc.status || "none"];
                  const old = oldUnitCost(li);
                  const loading = busy.has(li.id);
                  return (
                    <Fragment key={li.id}>
                    <tr className="border-t align-top" data-testid="price-check-row">
                      <td className="px-3 py-2">
                        <div className="font-medium text-[12px]">{li.name}</div>
                        <div className="text-[10px] text-muted-foreground">{[li.source_type === "price_master" ? "" : vendorOf(li, masters), originLabel(li, masters), li.cost_as_of ? `${fmtDate(li.cost_as_of)} 時点` : ""].filter(Boolean).join("・")}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{Number(li.quantity || 0).toLocaleString()}{li.unit}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <div>{yen(old)}</div>
                        {old != null && <div className="text-[10px] text-muted-foreground">計 {yen0(old * (Number(li.quantity) || 1))}</div>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {pc.current_cost != null ? (
                          <>
                            <div className={pc.status === "up" ? "text-red-700 font-semibold" : pc.status === "down" ? "text-teal-700 font-semibold" : ""}>{yen(pc.current_cost)}</div>
                            <div className="text-[10px] text-muted-foreground">計 {yen0(pc.current_cost * (Number(li.quantity) || 1))}</div>
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-2">
                        <Badge className={`${st.cls} hover:${st.cls} font-normal text-[10px]`}>{st.label}{(pc.status === "up" || pc.status === "down") && old ? ` ${pct(old, pc.current_cost)}` : ""}</Badge>
                        {pc.checked_at && <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(pc.checked_at)} 確認</div>}
                      </td>
                      <td className="px-2 py-2 text-[10.5px] text-muted-foreground">
                        {pc.source === "url" && <div>入稿先の価格表{pc.label ? `（${pc.label}）` : ""}</div>}
                        {pc.source === "master" && <div>価格マスタ {pc.ref}{pc.label ? `（${pc.label}）` : ""}{pc.master_date ? `・${fmtDate(pc.master_date)} 更新` : ""}</div>}
                        {pc.source === "manual" && <div>手で入力（{pc.manual_total != null ? `${yen0(pc.manual_total)}・` : ""}{pc.label}）{pc.checked_by ? `・${pc.checked_by}` : ""}</div>}
                        {pc.source === "screenshot" && <div>スクショから読み取り（{pc.label}・¥{Number(pc.shot_price || 0).toLocaleString()}{pc.shot_tax_mode === "excluded" ? "税別" : "税込"}）{pc.checked_by ? `・${pc.checked_by}` : ""} <EvidenceLink path={pc.evidence_path} /></div>}
                        {pc.source === "manual_same" && <div>前回と同じことを確認{pc.checked_by ? `・${pc.checked_by}` : ""}</div>}
                        {pc.error && pc.status === "unknown" && <div className="text-slate-600">確認できませんでした（下の「次にやること」へ）</div>}
                        {pc.error && pc.status !== "unknown" && <div className="text-slate-600">{pc.error}</div>}
                        {!pc.status && <div>{li.source_url || masterOf(li, masters)?.source_url ? "入稿先 URL を読み直します" : "価格マスタで探します"}</div>}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {li.source_url && <a href={li.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 h-6 px-1.5 rounded border text-[10px] hover:bg-muted/40" title={li.source_url}>入稿先 <ExternalLink className="w-3 h-3" /></a>}
                          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] gap-0.5" onClick={() => run([li])} disabled={loading}>{loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 確認</Button>
                          {(pc.status === "up" || pc.status === "down") && pc.current_cost != null && (
                            <Button size="sm" className="h-6 px-1.5 text-[10px] gap-0.5 bg-teal-600 hover:bg-teal-700" onClick={() => replace(li)} title="原価を今の値にし、売価も前回と同じ比率で計算し直します"><ArrowRight className="w-3 h-3" /> 置き換える</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {pc.status === "unknown" && (
                      <tr>
                        <td colSpan={7} className="px-3 pb-3 pt-0">
                          <NextActions li={li} masters={masters} printVendors={printVendors} onManual={(t, m) => manual(li, t, m)} onSame={() => same(li)} onRequest={() => onOpenRequestTool?.()} onShot={(shot, mode, saveMaster) => shotCompare(li, shot, mode, saveMaster)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[10px] text-muted-foreground border-t">入稿先 URL がある行（価格マスタに URL があるものを含む）はその価格表を読み直し、同じ数量で見積に入れた原価にいちばん近い納期のマスと比べます。読めないサイト（JavaScript で価格を出すページなど）は価格マスタで探し、どちらも無い行は「要確認」です。置き換えると、原価を今の値にし、売価は前回と同じ「売価 ÷ 原価」の比率で計算し直します</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
