import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ExternalLink, ListChecks, ChevronDown, ChevronUp } from "lucide-react";
import { computeEstimateTotals } from "@/lib/estimateTotals";

// ============================================================================
// 新規見積作成の右側「引き継ぐ明細」
//   社内見積（原価計算表）や見積の選択複製から来たとき、新しい見積に入る明細を一覧で見せる。
//   ここでもチェックを付け外しでき、合計（税別・消費税・税込）・原価・粗利がその場で変わる。
// ============================================================================

const yen = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "−" : ""}¥${Math.abs(v).toLocaleString()}`; };
const num = (n) => Number(n || 0).toLocaleString();

/**
 * @param {object} p
 * @param {string} p.title            「社内見積 お中元チラシ」など
 * @param {string} [p.subtitle]       「14期・入稿済・小原」など
 * @param {string} [p.linkTo]         元を開くリンク
 * @param {string} [p.linkLabel]
 * @param {{ key, label, sub?, qty?, unit?, unitPrice?, amount, cost?, kind? }[]} p.rows   候補の行（全部）
 * @param {Set} p.selected            選んでいる行の key
 * @param {(key)=>void} p.onToggle
 * @param {(keys:any[])=>void} p.onSetAll
 * @param {any[]} [p.defaultKeys]     「初期の選択に戻す」用
 * @param {object[]} p.items          実際に新しい見積に入る明細（合計の計算用）
 * @param {boolean} [p.taxInclusive]
 */
export default function CarryOverPanel({ title, subtitle, linkTo, linkLabel = "元を開く", rows, selected, onToggle, onSetAll, defaultKeys, items, taxInclusive = false }) {
  const [showAll, setShowAll] = useState(false);
  const chosen = rows.filter((r) => selected.has(r.key));
  const others = rows.filter((r) => !selected.has(r.key));
  const visible = showAll ? rows : chosen;
  const totals = computeEstimateTotals(items, { taxInclusive });
  const cost = (items || []).reduce((s, li) => s + (li.cost_price != null && li.cost_price !== "" ? Number(li.cost_price) * (Number(li.quantity) || 1) : 0), 0);
  const gross = totals.subtotal - cost;

  return (
    <Card className="lg:sticky lg:top-4" data-testid="carry-over-panel">
      <CardContent className="p-0">
        <div className="px-4 pt-4 pb-3 border-b space-y-1">
          <p className="text-xs font-semibold text-primary flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> 引き継ぐ明細</p>
          <p className="text-sm font-bold leading-snug">{title}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          {linkTo && <Link to={linkTo} target="_blank" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">{linkLabel} <ExternalLink className="w-3 h-3" /></Link>}
        </div>

        <div className="px-4 py-2 border-b flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-medium">{chosen.length} / {rows.length} 行を使う</span>
          <div className="ml-auto flex gap-1">
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => onSetAll(rows.map((r) => r.key))}>すべて選ぶ</Button>
            {defaultKeys && <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => onSetAll(defaultKeys)}>初期に戻す</Button>}
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => onSetAll([])}>すべて外す</Button>
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto divide-y" data-testid="carry-over-rows">
          {visible.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">明細を選んでいません。新しい見積は明細なしで作られます</p>}
          {visible.map((r) => {
            const on = selected.has(r.key);
            const heading = r.kind === "text" || r.kind === "subtotal";
            return (
              <label key={r.key} className={`flex items-start gap-2 px-4 py-2 cursor-pointer hover:bg-muted/30 ${on ? "" : "opacity-55"}`}>
                <Checkbox checked={on} onCheckedChange={() => onToggle(r.key)} className="mt-0.5" aria-label={`${r.label} を引き継ぐ`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[12.5px] leading-snug ${heading ? "font-semibold text-muted-foreground" : "font-medium"} ${Number(r.amount) < 0 ? "text-red-700" : ""}`}>{r.label}</span>
                    {!heading && <span className={`ml-auto text-[12px] tabular-nums font-semibold whitespace-nowrap ${Number(r.amount) < 0 ? "text-red-700" : ""}`}>{yen(r.amount)}</span>}
                  </div>
                  {!heading && (
                    <div className="flex items-baseline gap-2 text-[10.5px] text-muted-foreground tabular-nums">
                      <span>{num(r.qty)}{r.unit} × {yen(r.unitPrice)}</span>
                      {r.cost != null && r.cost !== 0 && <span className="ml-auto whitespace-nowrap">原価 {yen(r.cost)}</span>}
                    </div>
                  )}
                  {r.sub && <div className="text-[10.5px] text-muted-foreground/80 truncate" title={r.sub}>{r.sub}</div>}
                </div>
              </label>
            );
          })}
        </div>

        {others.length > 0 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full px-4 py-1.5 border-t text-[11px] text-primary hover:bg-muted/30 flex items-center justify-center gap-1">
            {showAll ? <><ChevronUp className="w-3.5 h-3.5" /> 選んだ行だけ表示</> : <><ChevronDown className="w-3.5 h-3.5" /> 選んでいない行も表示（{others.length}）</>}
          </button>
        )}

        <div className="px-4 py-3 border-t bg-muted/30 space-y-1 text-xs tabular-nums" data-testid="carry-over-totals">
          <div className="flex justify-between"><span className="text-muted-foreground">小計（税別）</span><span>{yen(totals.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">消費税</span><span>{yen(totals.tax)}</span></div>
          <div className="flex justify-between text-sm font-bold"><span>合計（税込）</span><span>{yen(totals.total)}</span></div>
          {cost > 0 && (
            <div className="flex justify-between text-[11px] text-muted-foreground pt-1 border-t"><span>原価 {yen(cost)}</span><span>粗利 {yen(gross)}{totals.subtotal > 0 ? `（${((gross / totals.subtotal) * 100).toFixed(1)}%）` : ""}</span></div>
          )}
          <p className="text-[10px] text-muted-foreground pt-1">作成後、見積書の画面で数量・単価・原価を直せます</p>
        </div>
      </CardContent>
    </Card>
  );
}
