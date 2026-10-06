import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ExternalLink, History, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { recomputeSubtotals, recomputeRuleRows, usePricingRules } from "@/lib/pricing";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { priceCheckTargets, oldUnitCost, checkWithMaster, checkWithGrid, replaceWithCurrent, PRICE_CHECK_STATUS, masterOf, vendorOf, originLabel } from "@/lib/priceCheck";

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

export default function CarriedPriceCheck({ estimate, onUpdate }) {
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
            {changed.length > 0 && <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 bg-background border-teal-300 text-teal-800" onClick={replaceAllUp}>変わった {changed.length} 行を今の原価に置き換える</Button>}
            <Button size="sm" className="h-7 text-[11px] gap-1 bg-teal-600 hover:bg-teal-700" onClick={() => run(carried)} disabled={busy.size > 0}>{busy.size > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} まとめて今の価格を確認</Button>
            <button type="button" onClick={() => setOpen((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground" aria-label={open ? "たたむ" : "開く"}>{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
          </div>
        </div>
        {open && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead className="bg-teal-50/40 text-[10px] text-muted-foreground">
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
                    <tr key={li.id} className="border-t align-top" data-testid="price-check-row">
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
                            <div className={pc.status === "up" ? "text-red-700 font-semibold" : pc.status === "down" ? "text-sky-700 font-semibold" : ""}>{yen(pc.current_cost)}</div>
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
                        {pc.error && <div className="text-amber-700">{pc.error}</div>}
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
