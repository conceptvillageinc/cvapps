import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Image as ImageIcon, CopyPlus, Check, Minus, Link2, FileSpreadsheet, PackageCheck } from "lucide-react";
import PrintOrderDialog from "@/components/printOrders/PrintOrderDialog";
import { costRowsOfOrder } from "@/lib/costSheetOrders";
import { fmtOrderDate } from "@/lib/printOrders";
import { COST_SHEET_STATUS, groupLabel, groupLines, finalTotals, defaultSelectedRows } from "@/lib/costSheets";

// ============================================================================
// クライアントカルテの「社内見積（原価計算表）」の右側。
//   原価計算表のタブ 1 枚を、大区分ごとの表で見せる。各行に 仕入（単価×数量）／掛け率／売価／調整後売価／
//   仕入先・入稿先 URL／原価の根拠のスクショ／最終納品の印。
// ============================================================================

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const yenUnit = (n) => { const v = Number(n) || 0; return `¥${(Math.round(v * 100) / 100).toLocaleString()}`; };
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtDate = (d) => (d ? String(d).slice(0, 10).replace(/-/g, "/") : "");
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Storage の画像（署名付き URL） */
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

function Thumb({ image, size = "h-12" }) {
  const url = useSignedUrl(image.path);
  const title = `スクショ（${image.group ? groupLabel(image.group) : ""}${image.near_row ? `・${image.near_row} 行目の近く` : ""}）`;
  return (
    <a href={url || "#"} target="_blank" rel="noreferrer" title={title} className="inline-block rounded border bg-white overflow-hidden hover:ring-2 hover:ring-primary/40" data-testid="cost-sheet-image">
      {url ? <img src={url} alt={title} className={`${size} w-auto max-w-[160px] object-contain`} /> : <span className={`${size} w-16 flex items-center justify-center text-muted-foreground`}><ImageIcon className="w-4 h-4" /></span>}
    </a>
  );
}

function LineRow({ l, images, hasFinal, checked, onToggle, orders = [], onOpenOrder }) {
  const muted = hasFinal && !l.final;
  const rowImages = images.filter((im) => im.near_row === l.row);
  const isDiscount = /割引/.test(l.name) || Number(l.adjusted) < 0;
  return (
    <tr className={`border-t align-top ${l.final ? "bg-emerald-50/60" : muted ? "text-muted-foreground/80" : ""}`} data-row={l.row}>
      <td className="px-2 py-1.5 text-center w-12 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`${l.name || "この行"} を新規見積に使う`} />
          {l.final ? <Check className="w-3.5 h-3.5 text-emerald-600" aria-label="最終納品" /> : <span className="w-3.5" />}
        </span>
      </td>
      <td className="px-2 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{l.section}</td>
      <td className="px-2 py-1.5">
        <div className={`text-[12.5px] ${l.final ? "font-semibold" : "font-medium"} ${isDiscount ? "text-red-700" : ""}`}>{l.name || <span className="text-muted-foreground">（項目名なし）</span>}</div>
        {orders.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {orders.map((o) => (
              <button key={o.id} type="button" onClick={() => onOpenOrder?.(o)} className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-1.5 leading-4 text-[9.5px] font-semibold text-teal-800 hover:bg-teal-100" title="入稿記録を開く" data-testid="cost-ordered-chip">
                <PackageCheck className="w-2.5 h-2.5" /> 入稿済 {fmtOrderDate(o.ordered_on)}
              </button>
            ))}
          </div>
        )}
        {l.memo && <div className="text-[11px] text-muted-foreground whitespace-pre-line line-clamp-4" title={l.memo}>{l.memo}</div>}
        {(l.author || l.entered_on) && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{[l.author, fmtDate(l.entered_on)].filter(Boolean).join("・")}</div>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-[11.5px]">
        {l.cost_total || l.cost_unit ? (
          <>
            <div className="font-medium">{yen(l.cost_total)}</div>
            {l.qty ? <div className="text-[10px] text-muted-foreground">{yenUnit(l.cost_unit)} × {Number(l.qty).toLocaleString()}{l.unit}</div> : null}
          </>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-muted-foreground">{l.markup ? `×${l.markup}` : ""}</td>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-[11.5px]">
        <div>{yen(l.sell_total)}</div>
        {l.qty && l.sell_unit ? <div className="text-[10px] text-muted-foreground">{yenUnit(l.sell_unit)} × {Number(l.qty).toLocaleString()}{l.unit}</div> : null}
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold ${Number(l.adjusted) < 0 ? "text-red-700" : ""}`}>{yen(l.adjusted)}</td>
      <td className="px-2 py-1.5 text-[11px]">
        {l.vendor && <div className="font-medium">{l.vendor}</div>}
        {l.url && (
          <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all" title={l.url}>
            <Link2 className="w-3 h-3 shrink-0" /> {host(l.url)}
          </a>
        )}
        {rowImages.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {rowImages.map((im, i) => <Thumb key={i} image={im} size="h-10" />)}
          </div>
        )}
        {!l.vendor && !l.url && rowImages.length === 0 && <span className="text-muted-foreground">—</span>}
      </td>
    </tr>
  );
}

/**
 * @param {object} p
 * @param {object} p.sheet     cost_sheets の 1 行
 * @param {string} p.clientName
 */
export default function CostSheetPane({ sheet, clientName }) {
  const navigate = useNavigate();
  const groups = useMemo(() => groupLines(sheet.lines), [sheet.lines]);
  // この社内見積の行から作った入稿記録（最終納品チェックから作ったもの）
  const { data: clientOrders = [], refetch: refetchOrders } = useQuery({
    queryKey: ["printOrders", "costSheet", sheet.client_id || sheet.client_name],
    queryFn: () => db.entities.PrintOrder.filter(sheet.client_id ? { client_id: sheet.client_id } : { client_name: sheet.client_name }, "-ordered_on"),
    retry: false,
  });
  const ordersByRow = useMemo(() => {
    // 小見出しごとにまとめた入稿記録は、内訳の行すべてに「入稿済」を出す
    const m = new Map();
    for (const o of clientOrders) {
      const { sheetId, rows } = costRowsOfOrder(o);
      if (sheetId !== String(sheet.id)) continue;
      for (const r of rows) m.set(r, [...(m.get(r) || []), o]);
    }
    return m;
  }, [clientOrders, sheet.id]);
  const [openOrder, setOpenOrder] = useState(null);
  const images = sheet.images || [];
  const fin = useMemo(() => finalTotals(sheet.lines), [sheet.lines]);
  const hasFinal = !!fin;
  const st = COST_SHEET_STATUS[sheet.status] || COST_SHEET_STATUS.open;
  const rowLinked = new Set(images.filter((im) => im.near_row).map((im) => im.near_row));
  const groupImages = (title) => images.filter((im) => im.group === title && !(im.near_row && rowLinked.has(im.near_row) && sheet.lines.some((l) => l.row === im.near_row)));
  const orphanImages = images.filter((im) => !im.group);
  // 新規見積に使う行（初期: 調整後売価が 0 でない行。最終納品の印がある区分は印の行だけ）
  const [selected, setSelected] = useState(() => new Set(defaultSelectedRows(sheet)));
  useEffect(() => { setSelected(new Set(defaultSelectedRows(sheet))); }, [sheet.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (row) => setSelected((s) => { const t = new Set(s); if (t.has(row)) t.delete(row); else t.add(row); return t; });
  const setGroup = (lines, on) => setSelected((s) => { const t = new Set(s); for (const l of lines) { if (on) t.add(l.row); else t.delete(l.row); } return t; });
  const allRows = (sheet.lines || []).map((l) => l.row);
  const selLines = (sheet.lines || []).filter((l) => selected.has(l.row));
  const selSell = selLines.reduce((s, l) => s + Number(l.adjusted || 0), 0);
  const selCost = selLines.reduce((s, l) => s + Number(l.cost_total || 0), 0);
  const createEstimate = () => {
    if (selLines.length === 0) return;
    const rows = selLines.map((l) => l.row).join(",");
    navigate(`/estimates/new?client=${encodeURIComponent(clientName)}&cost_sheet=${sheet.id}&rows=${rows}`);
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="cost-sheet-pane">
      {/* 見出し */}
      <div className="px-4 py-3 border-b space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`text-[10px] ${st.color} hover:${st.color}`}>{st.label}</Badge>
          <span className="text-[11px] text-muted-foreground">{sheet.period}</span>
          <h2 className="text-base font-bold truncate">{sheet.title}</h2>
          {sheet.sheet_date && <span className="text-[11px] text-muted-foreground">入稿日 {fmtDate(sheet.sheet_date)}</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <a href={sheet.sheet_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] hover:bg-muted/40" title="原価計算表のタブを開く"><FileSpreadsheet className="w-3.5 h-3.5" /> 原価計算表 <ExternalLink className="w-3 h-3" /></a>
            <Button size="sm" className="h-7 text-[11px] gap-1" onClick={createEstimate} disabled={selLines.length === 0} title="チェックした行を明細にした新しい見積を作る">
              <CopyPlus className="w-3.5 h-3.5" /> 選んだ {selLines.length} 行で新規見積を作る
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs" data-testid="cost-sheet-totals">
          <div className="rounded-md border bg-muted/20 px-2.5 py-1.5"><p className="text-[10px] text-muted-foreground">調整後売価合計（税別）</p><p className="font-bold tabular-nums">{yen(sheet.sell_total)}</p>{fin && <p className="text-[10px] text-emerald-700 tabular-nums">最終納品の行だけ {yen(fin.sell)}</p>}</div>
          <div className="rounded-md border bg-muted/20 px-2.5 py-1.5"><p className="text-[10px] text-muted-foreground">外注／仕入合計（税別）</p><p className="font-bold tabular-nums">{yen(sheet.cost_total)}</p>{fin && <p className="text-[10px] text-emerald-700 tabular-nums">最終納品の行だけ {yen(fin.cost)}</p>}</div>
          <div className="rounded-md border bg-muted/20 px-2.5 py-1.5"><p className="text-[10px] text-muted-foreground">粗利（税別）</p><p className="font-bold tabular-nums">{yen(sheet.gross)}</p>{fin && <p className="text-[10px] text-emerald-700 tabular-nums">最終納品の行だけ {yen(fin.gross)}</p>}</div>
          <div className="rounded-md border bg-muted/20 px-2.5 py-1.5"><p className="text-[10px] text-muted-foreground">粗利率</p><p className="font-bold tabular-nums">{pct(sheet.margin)}</p>{fin && <p className="text-[10px] text-emerald-700 tabular-nums">最終納品の行だけ {pct(fin.margin)}</p>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px]" data-testid="cost-sheet-selection">
          <span className="font-medium">新規見積に使う行: {selLines.length} / {allRows.length} 行</span>
          <span className="text-muted-foreground tabular-nums">調整後売価 {yen(selSell)}・仕入 {yen(selCost)}</span>
          <div className="ml-auto flex gap-1">
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] bg-background" onClick={() => setSelected(new Set(allRows))}>すべて選ぶ</Button>
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] bg-background" onClick={() => setSelected(new Set(defaultSelectedRows(sheet)))}>初期の選択に戻す</Button>
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] bg-background" onClick={() => setSelected(new Set())}>すべて外す</Button>
          </div>
          <span className="basis-full text-[10px] text-muted-foreground">最初は、調整後売価が ¥0 の行（使わなかった割引の候補など）と、最終納品の印がある区分の印の無い行（数量違いの候補）を外しています</span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          記入者 {(sheet.authors || []).join("・") || "—"}{sheet.last_entry_date ? `　最終記入 ${fmtDate(sheet.last_entry_date)}` : ""}　取り込み {fmtDate(sheet.imported_at)}
          {hasFinal ? "　✓ は最終納品の行（数量違いの候補が並ぶときは、この行が採用分）" : "　最終納品の印が無いタブです（全行が候補）"}
        </p>
      </div>

      {/* 明細 */}
      <div className="overflow-auto flex-1 min-h-0">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-12">金額の入った行がありません</p>
        ) : groups.map((g) => {
          const imgs = groupImages(g.title);
          return (
            <div key={g.title} className="border-b last:border-b-0" data-testid="cost-sheet-group">
              <div className="px-3 py-1.5 bg-slate-800 text-white text-[11px] font-semibold flex items-center gap-2">
                {(() => {
                  const n = g.lines.filter((l) => selected.has(l.row)).length;
                  const all = n === g.lines.length;
                  return (
                    <button type="button" role="checkbox" aria-checked={all ? "true" : n > 0 ? "mixed" : "false"} onClick={() => setGroup(g.lines, !all)} className={`h-4 w-4 shrink-0 rounded-sm border border-white flex items-center justify-center ${n > 0 ? "bg-white text-slate-800" : ""}`} aria-label={`${groupLabel(g.title)} の行をまとめて選ぶ`} title={all ? "この区分をすべて外す" : "この区分をすべて選ぶ"}>
                      {all ? <Check className="w-3.5 h-3.5" /> : n > 0 ? <Minus className="w-3.5 h-3.5" /> : null}
                    </button>
                  );
                })()}
                {groupLabel(g.title)}
                <span className="font-normal opacity-70">{g.lines.length} 行</span>
                {/割引/.test(g.title) && <span className="font-normal opacity-70">（シートが自動で出す割引の候補。実際に引いた分は各区分の行に入っています）</span>}
                <span className="ml-auto font-normal opacity-80 tabular-nums">仕入 {yen(g.lines.reduce((s, l) => s + Number(l.cost_total || 0), 0))} ／ 調整後売価 {yen(g.lines.reduce((s, l) => s + Number(l.adjusted || 0), 0))}</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[10px] text-muted-foreground">
                  <tr>
                    <th className="w-12 text-[9px] font-normal">使う</th>
                    <th className="text-left px-2 py-1 font-normal w-20">区分</th>
                    <th className="text-left px-2 py-1 font-normal">項目・仕様・備考</th>
                    <th className="text-right px-2 py-1 font-normal w-28">仕入（単価×数量）</th>
                    <th className="text-right px-2 py-1 font-normal w-12">掛け率</th>
                    <th className="text-right px-2 py-1 font-normal w-28">売価</th>
                    <th className="text-right px-2 py-1 font-normal w-24">調整後売価</th>
                    <th className="text-left px-2 py-1 font-normal w-44">仕入先・入稿先・根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => <LineRow key={l.row} l={l} images={images} hasFinal={hasFinal} checked={selected.has(l.row)} onToggle={() => toggle(l.row)} orders={ordersByRow.get(l.row)} onOpenOrder={setOpenOrder} />)}
                </tbody>
              </table>
              {imgs.length > 0 && (
                <div className="px-3 py-2 bg-muted/20 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><ImageIcon className="w-3 h-3" /> この区分に貼ってあったスクショ（原価の根拠・提出した見積など）</span>
                  {imgs.map((im, i) => <Thumb key={i} image={im} size="h-16" />)}
                </div>
              )}
            </div>
          );
        })}
        {orphanImages.length > 0 && (
          <div className="px-3 py-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><ImageIcon className="w-3 h-3" /> その他のスクショ</span>
            {orphanImages.map((im, i) => <Thumb key={i} image={im} size="h-16" />)}
          </div>
        )}
      </div>
      <PrintOrderDialog open={!!openOrder} onOpenChange={(v) => { if (!v) setOpenOrder(null); }} order={openOrder} onSaved={() => refetchOrders()} />
    </div>
  );
}
