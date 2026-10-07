import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { salesByCategory, SALES_CATEGORY_FROM, useSalesCategories } from "@/lib/salesCategory";

// ============================================================================
// 売上粗利管理表の「売上カテゴリー別の実績」
//   請求書の明細を売上カテゴリー（freee の会計計上部門）ごとに、月別・年計・構成比で出す。
//   粗利は明細の原価（見積から引き継いだ仕入単価）から出す。
// ============================================================================

const yen = (v) => (v ? Math.round(v).toLocaleString() : "—");
const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

export default function SalesCategoryReport({ invoices, months, estimates }) {
  const [mode, setMode] = useState("sales"); // sales | gross
  const { list } = useSalesCategories();
  const { rows, totalSales } = useMemo(() => salesByCategory(invoices, months, estimates, list), [invoices, months, estimates, list]);
  const inScope = months.some((m) => `${m.key}-31` >= SALES_CATEGORY_FROM);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const val = (r) => (mode === "sales" ? r.sales : r.gross);
  const colTotal = months.map((_, i) => rows.reduce((s, r) => s + val(r)[i], 0));
  const grand = sum(colTotal);
  const salesGrand = sum(totalSales);
  const fromLabel = SALES_CATEGORY_FROM.replace(/-/g, "/");

  return (
    <Card data-testid="sales-category-report">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">売上カテゴリー別の実績（税別・円）</CardTitle>
            <CardDescription className="text-xs">
              請求書の明細を売上カテゴリーごとに、請求日の月で集計します。{fromLabel} 以降の請求書が対象です（freee 販売から取り込んだ分は含みません）。
              {mode === "gross" && " 粗利は明細の原価（見積から引き継いだ仕入単価）から出しています"}
            </CardDescription>
          </div>
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {[["sales", "売上"], ["gross", "粗利"]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setMode(k)} className={`px-3 h-7 rounded ${mode === k ? "bg-slate-800 text-white" : "hover:bg-muted"}`} aria-pressed={mode === k}>{l}</button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!inScope ? (
          <p className="text-xs text-muted-foreground px-4 pb-4">この期は対象外です。売上カテゴリーは {fromLabel} 以降の請求書から集計します</p>
        ) : (
          <>
            {/* 年間の構成（帯） */}
            {salesGrand > 0 && (
              <div className="px-4 pb-3">
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                  {rows.filter((r) => sum(r.sales) > 0).map((r) => (
                    <div key={r.key} style={{ width: `${(sum(r.sales) / salesGrand) * 100}%`, background: r.color }} title={`${r.label} ${((sum(r.sales) / salesGrand) * 100).toFixed(1)}%`} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10.5px] text-muted-foreground">
                  {rows.filter((r) => sum(r.sales) !== 0).map((r) => (
                    <span key={r.key} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />{r.short} {pct(sum(r.sales) / salesGrand)}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left font-medium px-3 py-2 sticky left-0 bg-slate-800 min-w-[190px]">売上カテゴリー</th>
                    {months.map((m) => <th key={m.key} className="text-right font-medium px-2 py-2 whitespace-nowrap">{m.label}</th>)}
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">年計</th>
                    <th className="text-right font-medium px-3 py-2 whitespace-nowrap">構成比</th>
                    {mode === "gross" && <th className="text-right font-medium px-3 py-2 whitespace-nowrap">粗利率</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const total = sum(val(r));
                    const sales = sum(r.sales);
                    return (
                      <tr key={r.key} className="border-b" data-testid="sales-category-row">
                        <td className="px-3 py-1.5 sticky left-0 bg-white">
                          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.color }} />{r.label}</span>
                        </td>
                        {val(r).map((v, i) => <td key={i} className={`px-2 py-1.5 text-right ${v < 0 ? "text-red-700" : v ? "" : "text-muted-foreground/60"}`}>{yen(v)}</td>)}
                        <td className={`px-3 py-1.5 text-right font-semibold ${total < 0 ? "text-red-700" : ""}`}>{yen(total)}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">{grand ? pct(total / grand) : "—"}</td>
                        {mode === "gross" && <td className="px-3 py-1.5 text-right text-muted-foreground">{sales > 0 ? pct(total / sales) : "—"}</td>}
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/40 font-semibold">
                    <td className="px-3 py-1.5 sticky left-0 bg-muted">計</td>
                    {colTotal.map((v, i) => <td key={i} className="px-2 py-1.5 text-right">{yen(v)}</td>)}
                    <td className="px-3 py-1.5 text-right">{yen(grand)}</td>
                    <td className="px-3 py-1.5 text-right">{grand ? "100%" : "—"}</td>
                    {mode === "gross" && <td className="px-3 py-1.5 text-right">{salesGrand > 0 ? pct(grand / salesGrand) : "—"}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground px-4 py-2">カテゴリーは明細ごとに、見積・請求書で選んだもの（無ければ区分と品名から自動）を使います。取消の請求書は含みません</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
