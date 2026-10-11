import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Input } from "@/components/ui/input";
import { Search, X, PackageCheck, History, Tag } from "lucide-react";
import { searchItems } from "@/lib/itemSearch";

const yen = (n) => (n === null || n === undefined || n === "" ? "—" : `¥${Math.round(Number(n)).toLocaleString()}`);
const ymd = (s) => String(s || "").slice(0, 10).replace(/-/g, "/");

/** 似たもの探しに使うデータ（価格マスタ・入稿記録・過去見積）。ほかの画面とキャッシュを共有する */
export function useItemSearchData(enabled = true) {
  const { data: masters = [] } = useQuery({ queryKey: ["priceMaster"], queryFn: () => db.entities.PriceMaster.list("-last_updated"), enabled });
  const { data: orders = [] } = useQuery({ queryKey: ["printOrders", "all"], queryFn: () => db.entities.PrintOrder.list("-ordered_on", 1000), enabled, retry: false });
  const { data: estimates = [] } = useQuery({ queryKey: ["pastEstimates", "all"], queryFn: () => db.entities.Estimate.list("-created_date", 500), enabled });
  return useMemo(() => ({ masters, orders, estimates }), [masters, orders, estimates]);
}

/**
 * 探した結果（価格マスタ・前回の入稿・過去見積の明細）。行を押すと明細に入れる。
 * @param {object} p
 * @param {{ masters, orders, lines }} p.results
 * @param {(entry, cell) => { cost: number, price: number }} p.priceOf  価格マスタのセルの原価・出し値（税別・合計）
 * @param {(entry, cell) => void} [p.onPickCell]
 * @param {(order) => void} [p.onPickOrder]
 * @param {(candidate) => void} [p.onPickLine]
 * @param {string} [p.pickLabel]  行を押したときの説明（「明細に追加」「この行を置き換え」など）
 */
export function ItemSearchResults({ results, priceOf, onPickCell, onPickOrder, onPickLine, pickLabel = "クリックで明細に追加", maxCells = 6 }) {
  const { masters = [], orders = [], lines = [] } = results || {};
  if (masters.length + orders.length + lines.length === 0) return <p className="text-xs text-muted-foreground text-center py-4">見つかりませんでした</p>;
  return (
    <div className="space-y-3 text-xs" data-testid="item-search-results">
      {masters.length > 0 && onPickCell && (
        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold text-emerald-800 inline-flex items-center gap-1"><Tag className="w-3 h-3" /> 価格マスタ（{masters.length}）</p>
          {masters.map((m) => (
            <div key={m.id} className={`rounded-md border overflow-hidden ${m.dim ? "opacity-60" : ""}`} data-testid="item-search-master">
              <div className="px-2.5 py-1 bg-muted/40 flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{m.title}</span>
                {m.sub && <span className="text-muted-foreground">{m.sub}</span>}
                <span className="text-muted-foreground">・{m.vendor}</span>
                {m.dim && <span className="text-[10px] rounded bg-slate-200 text-slate-700 px-1">見積に出すセル未選択</span>}
                <span className="ml-auto text-[10px] text-muted-foreground">更新 {ymd(m.date) || "—"}</span>
              </div>
              <table className="w-full">
                <tbody>
                  {m.cells.slice(0, maxCells).map((cell, i) => {
                    const { cost, price } = priceOf(m.entry, cell);
                    return (
                      <tr key={i} className="border-t hover:bg-emerald-50 cursor-pointer" onClick={() => onPickCell(m.entry, cell)} title={pickLabel}>
                        <td className="px-2.5 py-1 tabular-nums w-20 text-right">{Number(cell.quantity || 0).toLocaleString()}</td>
                        <td className="px-2 py-1">{cell.label}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">原価 {yen(cost)}</td>
                        <td className="px-2.5 py-1 text-right tabular-nums font-medium text-primary">出し値 {yen(price)}</td>
                      </tr>
                    );
                  })}
                  {m.cells.length > maxCells && <tr className="border-t"><td colSpan={4} className="px-2.5 py-1 text-[10px] text-muted-foreground">ほか {m.cells.length - maxCells} パターン（印刷費のパネルで全部見られます）</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
      {orders.length > 0 && onPickOrder && (
        <section className="space-y-1">
          <p className="text-[11px] font-semibold text-teal-800 inline-flex items-center gap-1"><PackageCheck className="w-3 h-3" /> 前回の入稿（{orders.length}）</p>
          <div className="rounded-md border divide-y">
            {orders.map((o) => (
              <button key={o.id} type="button" onClick={() => onPickOrder(o.order)} className="w-full text-left px-2.5 py-1.5 hover:bg-teal-50 flex items-baseline gap-2" title={pickLabel} data-testid="item-search-order">
                <span className="tabular-nums text-muted-foreground w-[72px] shrink-0">{ymd(o.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{o.title}</span>
                  <span className="text-muted-foreground">　{o.client}{o.vendor ? `・${o.vendor}` : ""}</span>
                  {o.sub && <span className="block text-[10px] text-muted-foreground truncate">内訳 {o.sub}</span>}
                </span>
                <span className="tabular-nums shrink-0">{o.quantity != null ? `${Number(o.quantity).toLocaleString()}${o.unit || ""}　` : ""}<b>{yen(o.amount)}</b></span>
              </button>
            ))}
          </div>
        </section>
      )}
      {lines.length > 0 && onPickLine && (
        <section className="space-y-1">
          <p className="text-[11px] font-semibold text-sky-800 inline-flex items-center gap-1"><History className="w-3 h-3" /> 過去見積の明細（{lines.length}）</p>
          <div className="rounded-md border divide-y">
            {lines.map((c) => (
              <button key={c.id} type="button" onClick={() => onPickLine(c)} className="w-full text-left px-2.5 py-1.5 hover:bg-sky-50 flex items-baseline gap-2" title={pickLabel} data-testid="item-search-line">
                <span className="tabular-nums text-muted-foreground w-[72px] shrink-0">{ymd(c.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.title}</span>
                  <span className="text-muted-foreground">　{c.client}{c.number ? `・${c.number}` : ""}</span>
                </span>
                <span className="tabular-nums shrink-0">{c.quantity != null ? `${Number(c.quantity).toLocaleString()}${c.unit || ""} × ${yen(c.unit_price)} ＝ ` : ""}<b>{yen(c.amount)}</b>{c.cost_price != null && <span className="text-muted-foreground">（原価 {yen(c.cost_price)}）</span>}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * 明細の表の上に置く検索バー（価格マスタ・入稿記録・過去見積の明細をまとめて探す）。
 *   打つと下に候補が出て、押すと明細に 1 行（入稿記録は内訳の行ごと）入る。
 */
export function ItemSearchBar({ data, excludeEstimateId, priceOf, onPickCell, onPickOrder, onPickLine }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const results = useMemo(() => searchItems(q, data, { mode: "all", limit: 8, excludeEstimateId }), [q, data, excludeEstimateId]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const done = (fn) => (...args) => { fn(...args); setOpen(false); setQ(""); };
  return (
    <div ref={boxRef} className="relative" data-testid="item-search-bar">
      <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }}
        placeholder="品名・仕様・仕入先で探す（価格マスタ・前回の入稿・過去見積）例: A0 ポスター／チラシ 両面"
        className="h-9 pl-8 pr-8 text-xs bg-white"
        aria-label="明細を探す"
      />
      {q && <button type="button" className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => { setQ(""); setOpen(false); }} aria-label="消す"><X className="w-4 h-4" /></button>}
      {open && q.trim() && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-[60vh] overflow-y-auto rounded-md border bg-white shadow-lg p-2.5">
          <ItemSearchResults results={results} priceOf={priceOf} onPickCell={done(onPickCell)} onPickOrder={done(onPickOrder)} onPickLine={done(onPickLine)} />
        </div>
      )}
    </div>
  );
}
