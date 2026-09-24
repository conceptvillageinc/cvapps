import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Loader2, History, ExternalLink, Copy, CopyPlus, FileText, Lock, Check } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { STATUS_MAP } from "@/lib/constants";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import { specLabel } from "@/lib/printSpecs";
import { openBlob } from "@/lib/documents";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
// 原価は1枚あたりで小数になることがある（例: 8.5円）
const yenCost = (n) => `¥${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;
const fmtDate = (d) => (d ? format(new Date(d), "yyyy/M/d") : "");

/** 一覧・右側の見出しに出す印刷仕様の要約 */
function specSummary(e) {
  const specs = e.print_specs || [];
  if (specs.length > 0) {
    return specs.map((sp, i) => {
      const q = (sp.quantities || []).map((n) => `${Number(n).toLocaleString()}枚`).join("/");
      return [specLabel(sp, i), sp.paper_type, sp.color_count, q].filter(Boolean).join("・");
    }).join("　");
  }
  // 旧形式
  const q = (e.quantities || []).map((n) => `${Number(n).toLocaleString()}枚`).join("/");
  return [e.print_type, e.size, e.paper_type, e.color_count, q].filter(Boolean).join("・");
}

/** 複製できる行か（テキスト行・小計・自動計算行は不可） */
const isCopyable = (li) => li.row_type !== "text" && li.row_type !== "subtotal" && li.source_type !== "rule";

/** 表示用の行一覧。旧形式の見積は印刷費1行として扱う */
function rowsOf(e) {
  if (e.schema_version === 2) return e.line_items || [];
  if (e.selling_price > 0) {
    const qty = (e.quantities || [])[0] || 1;
    return [{
      id: "legacy", row_type: "item",
      category: "印刷費（紙）",
      name: `${e.print_type || "印刷費"}${e.selected_vendor ? `（${e.selected_vendor}）` : ""}`,
      quantity: qty, unit: "枚",
      unit_price: Math.round(Number(e.selling_price) / qty), amount: Number(e.selling_price),
      cost_price: e.cost_price ? Math.round((Number(e.cost_price) / qty) * 100) / 100 : null,
      markup_rate: e.markup_rate || null,
      source_type: "manual", source_ref: e.selected_vendor || undefined,
    }];
  }
  return [];
}

/**
 * 過去の見積を左で選び、右でその中身（仕様・明細の全行・備考・合計）を見ながら明細を複製する。
 * 既定は同一クライアントの見積だけ。切り替えで全クライアントに広げられる。
 *
 * props: estimate（現在の見積）, onAdd(items), onClose()
 */
export default function PastEstimateImport({ estimate, onAdd, onClose }) {
  const [allClients, setAllClients] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [picked, setPicked] = useState(new Set()); // `${estimateId}:${lineId}`
  const [pdfLoading, setPdfLoading] = useState(false);

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["pastEstimates", allClients ? "all" : estimate.client_name],
    queryFn: () => allClients
      ? db.entities.Estimate.list("-created_date", 500)
      : db.entities.Estimate.filter({ client_name: estimate.client_name }, "-created_date", 200),
  });

  const { data: masters = [] } = useQuery({
    queryKey: ["priceMaster"],
    queryFn: () => db.entities.PriceMaster.list("-last_updated"),
  });
  const masterById = useMemo(() => Object.fromEntries(masters.map((m) => [m.id, m])), [masters]);

  // 入稿先（印刷所 or URL）を明細から割り出す
  const sourceOf = (li) => {
    if (li.source_type === "price_master") {
      const m = masterById[li.source_ref];
      return { label: m?.vendor_name || "価格マスタ", url: li.source_url || m?.source_url || null };
    }
    if (li.source_type === "vendor_quote") return { label: li.source_ref || "仕入先見積", url: null };
    if (li.source_type === "design_master") return { label: "デザイン費マスタ", url: null };
    if (li.source_type === "rule") return { label: "自動計算", url: null };
    return { label: li.outsourcing_kind ? "外注" : "手入力", url: li.source_url || null };
  };

  // 左の一覧（明細のある見積だけ。検索は番号・件名・仕様・明細名）
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return estimates
      .filter((e) => e.id !== estimate.id)
      .map((e) => ({ estimate: e, rows: rowsOf(e) }))
      .filter(({ rows }) => rows.some(isCopyable))
      .filter(({ estimate: e, rows }) => {
        if (!q) return true;
        const hay = `${e.estimate_number} ${e.client_name} ${e.estimate_title || ""} ${specSummary(e)} ${rows.map((li) => li.name || li.text || "").join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
  }, [estimates, estimate.id, search]);

  // 選択中の見積が一覧から消えたら先頭を選ぶ
  useEffect(() => {
    if (list.length === 0) { setSelectedId(null); return; }
    if (!list.some((x) => x.estimate.id === selectedId)) setSelectedId(list[0].estimate.id);
  }, [list, selectedId]);

  const current = list.find((x) => x.estimate.id === selectedId) || null;

  const key = (e, li) => `${e.id}:${li.id}`;
  const toggle = (k) => setPicked((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // 右側の集計（税別小計・税・税込・粗利）
  const summary = useMemo(() => {
    if (!current) return null;
    const e = current.estimate;
    const totals = computeEstimateTotals(current.rows, { taxInclusive: !!e.tax_inclusive });
    const cost = current.rows
      .filter((li) => li.row_type !== "text" && li.row_type !== "subtotal" && li.cost_price != null)
      .reduce((s, li) => s + (Number(li.cost_price) || 0) * (Number(li.quantity) || 1), 0);
    const profit = totals.subtotal - cost;
    return { ...totals, cost, profit, profitRate: totals.subtotal > 0 ? ((profit / totals.subtotal) * 100).toFixed(1) : "0.0", taxInclusive: !!e.tax_inclusive };
  }, [current]);

  // 明細ごとの社内メモ（行の notes）
  const lineMemos = current ? current.rows.filter((li) => li.notes).map((li) => `${li.name}: ${li.notes}`) : [];

  // 選択中の件数・出し値合計（全見積にまたがる）
  const pickedStats = useMemo(() => {
    let count = 0, total = 0;
    for (const { estimate: e, rows } of list) {
      for (const li of rows) {
        if (picked.has(key(e, li))) { count += 1; total += Number(li.amount) || 0; }
      }
    }
    return { count, total };
  }, [list, picked]);

  const stripForCopy = (e, li) => {
    // id は追加側で振り直す。複製元を残す。
    const { id: _id, ...rest } = li;
    return { ...rest, copied_from: e.estimate_number, copied_from_id: e.id };
  };

  const submit = () => {
    const items = [];
    for (const { estimate: e, rows } of list) {
      for (const li of rows) {
        if (isCopyable(li) && picked.has(key(e, li))) items.push(stripForCopy(e, li));
      }
    }
    if (items.length === 0) { toast.error("複製する明細を選んでください"); return; }
    onAdd(items);
    toast.success(`${items.length}件の明細を複製しました。数量や単価は必要に応じて直してください`);
    onClose();
  };

  // テキスト行・小計も含めて丸ごと写す（自動計算行は今回の見積側で計算されるので除く）
  const copyWhole = () => {
    if (!current) return;
    const e = current.estimate;
    const items = current.rows.filter((li) => li.source_type !== "rule").map((li) => stripForCopy(e, li));
    if (items.length === 0) { toast.error("複製できる明細がありません"); return; }
    onAdd(items);
    toast.success(`「${e.estimate_title || e.estimate_number}」の明細 ${items.length} 行をまるごと複製しました`);
    onClose();
  };

  const openPdf = async () => {
    if (!current) return;
    const e = current.estimate;
    setPdfLoading(true);
    try {
      const blob = await db.documents.pdf("estimate", e.id, { stamp: false });
      const clean = (s) => String(s || "").replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
      openBlob(blob, `【${clean(e.client_name) || "クライアント"}】見積書_${clean(e.estimate_title) || e.estimate_number}.pdf`);
    } catch (err) {
      toast.error("PDFを作成できませんでした: " + err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  const gridCols = "grid-cols-[28px_minmax(0,1fr)_72px_92px_84px_92px_100px]";

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        左で過去の見積を選ぶと、右にその見積の中身が出ます。複製したい明細にチェックを入れて複製します。前回の原価・売価・入稿先がそのまま入ります。
      </p>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="見積番号・件名・仕様・明細名で絞り込み" className="h-9 pl-8 text-xs" />
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer shrink-0">
          <Checkbox checked={allClients} onCheckedChange={(v) => { setAllClients(!!v); setPicked(new Set()); }} />
          他のクライアントの見積も含む
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-16">
          <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            {allClients || search ? "該当する見積がありません" : "このクライアントの過去見積に明細がありません。「他のクライアントの見積も含む」で広げられます"}
          </p>
        </div>
      ) : (
        <div className="flex gap-3 h-[58vh] min-h-[380px]">
          {/* 左：過去見積の一覧 */}
          <div className="w-[290px] shrink-0 border rounded-lg overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-muted/40 border-b text-[11px] text-muted-foreground font-medium">
              {allClients ? "すべてのクライアント" : `「${estimate.client_name}」`}の過去見積 <span className="text-muted-foreground/70">・ 新しい順 ・ {list.length}件</span>
            </div>
            <div className="overflow-y-auto flex-1">
              {list.map(({ estimate: e, rows }) => {
                const on = e.id === selectedId;
                const pickedHere = rows.filter((li) => picked.has(key(e, li))).length;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    className={`w-full text-left px-3 py-2 border-b border-l-[3px] ${on ? "bg-primary/5 border-l-primary" : "border-l-transparent hover:bg-muted/30"}`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="font-mono text-muted-foreground">{e.estimate_number}</span>
                      <span className="text-muted-foreground/70">{fmtDate(e.created_date)}</span>
                      {e.is_final_submitted && <Badge className="ml-auto text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100 px-1.5 py-0">最終提出版</Badge>}
                      {pickedHere > 0 && <Badge className="text-[9px] bg-primary/10 text-primary hover:bg-primary/10 px-1.5 py-0">{pickedHere}件選択</Badge>}
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-[13px] font-medium truncate flex-1">{e.estimate_title || e.print_type || "（件名なし）"}</span>
                      {e.total_amount > 0 && <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{yen(e.total_amount)}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">
                      {allClients && <span className="font-medium text-muted-foreground mr-1">{e.client_name}</span>}
                      {specSummary(e)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右：選んだ見積の中身 */}
          {current && (() => {
            const e = current.estimate;
            const st = STATUS_MAP[e.status];
            return (
              <div className="flex-1 min-w-0 border rounded-lg flex flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b bg-muted/40">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{e.estimate_title || e.print_type || "（件名なし）"}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                      <span className="font-mono">{e.estimate_number}</span>
                      <span>作成 {fmtDate(e.created_date)}</span>
                      {e.person_in_charge && <span>担当 {e.person_in_charge}</span>}
                      {allClients && <span>{e.client_name}</span>}
                      {e.is_final_submitted ? <span className="text-amber-700 font-medium">最終提出版</span> : st ? <span>{st.label}</span> : null}
                      {e.deal_probability && <span>受注確度 {e.deal_probability}</span>}
                      {e.tax_inclusive && <span className="text-primary">税込見積</span>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <a href={`/estimates/${e.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-7 px-2 rounded-md border bg-background text-[11px] hover:bg-muted/50">
                      <ExternalLink className="w-3 h-3" /> 別タブで開く
                    </a>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1" onClick={openPdf} disabled={pdfLoading}>
                      {pdfLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} 見積書PDF
                    </Button>
                  </div>
                </div>

                {specSummary(e) && (
                  <div className="px-4 py-1.5 border-b flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground font-medium shrink-0">印刷仕様</span>
                    <span className="text-foreground/80 truncate" title={specSummary(e)}>{specSummary(e)}</span>
                  </div>
                )}

                <div className="flex-1 overflow-auto min-h-0">
                  <div className={`grid ${gridCols} px-3 py-1.5 text-[10px] text-muted-foreground font-medium border-b sticky top-0 bg-background`}>
                    <div></div><div>品名</div><div className="text-right">数量</div><div className="text-right">原価</div><div className="text-right">単価</div><div className="text-right">金額</div><div>入稿先</div>
                  </div>
                  {current.rows.map((li, idx) => {
                    if (li.row_type === "text") {
                      return <div key={li.id || idx} className="px-3 py-1.5 text-xs font-semibold text-foreground/80 bg-muted/30 border-b">{li.text || "　"}</div>;
                    }
                    if (li.row_type === "subtotal") {
                      return (
                        <div key={li.id || idx} className={`grid ${gridCols} px-3 py-1 text-[11px] text-muted-foreground border-b bg-muted/10`}>
                          <div></div><div className="text-right pr-2 col-span-4">{li.name || "小計"}</div><div className="text-right font-medium tabular-nums">{yen(li.amount)}</div><div></div>
                        </div>
                      );
                    }
                    if (li.source_type === "rule") {
                      return (
                        <div key={li.id || idx} className={`grid ${gridCols} px-3 py-1.5 text-[11px] text-muted-foreground/80 border-b items-center`}>
                          <div><Lock className="w-3 h-3" /></div>
                          <div className="truncate">{li.name} <span className="text-[9px]">（自動計算・複製しない）</span></div>
                          <div></div><div></div><div></div>
                          <div className="text-right tabular-nums">{yen(li.amount)}</div><div></div>
                        </div>
                      );
                    }
                    const k = key(e, li);
                    const on = picked.has(k);
                    const src = sourceOf(li);
                    return (
                      <button
                        key={li.id || idx}
                        type="button"
                        onClick={() => toggle(k)}
                        className={`grid ${gridCols} w-full text-left px-3 py-1.5 border-b items-center ${on ? "bg-primary/5" : "hover:bg-muted/30"}`}
                      >
                        <div className="flex items-center">
                          <span className={`w-[15px] h-[15px] rounded border-[1.5px] inline-flex items-center justify-center ${on ? "bg-primary border-primary" : "border-muted-foreground/60 bg-background"}`}>
                            {on && <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3.5} />}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs truncate">{li.name}</div>
                          <div className="text-[10px] text-muted-foreground">{li.category}</div>
                        </div>
                        <div className="text-right text-[11px] tabular-nums whitespace-nowrap">{Number(li.quantity || 1).toLocaleString()}{li.unit || ""}</div>
                        <div className="text-right text-[11px] tabular-nums whitespace-nowrap text-amber-700">{li.cost_price != null ? `原価 ${yenCost(li.cost_price)}` : ""}</div>
                        <div className="text-right text-[11px] tabular-nums whitespace-nowrap">@{yen(li.unit_price)}</div>
                        <div className="text-right text-xs font-medium tabular-nums whitespace-nowrap">{yen(li.amount)}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {src.url ? (
                            <a href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={(ev) => ev.stopPropagation()}>
                              {src.label} <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : src.label}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="border-t px-4 py-2.5 flex gap-4 bg-muted/10">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-[10px] text-muted-foreground font-medium">備考（見積書に載る）</p>
                    <p className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-line max-h-16 overflow-y-auto">{e.additional_notes || "（なし）"}</p>
                    {lineMemos.length > 0 && (
                      <>
                        <p className="text-[10px] text-muted-foreground font-medium">社内メモ（明細ごと）</p>
                        <div className="text-[11px] text-foreground/80 leading-relaxed bg-amber-50 border border-amber-200 rounded-md px-2 py-1 max-h-16 overflow-y-auto">
                          {lineMemos.map((m, i) => <p key={i}>{m}</p>)}
                        </div>
                      </>
                    )}
                  </div>
                  {summary && (
                    <div className="w-[210px] shrink-0 text-[11px] tabular-nums space-y-0.5">
                      <div className="flex justify-between text-muted-foreground"><span>小計（税別）</span><span>{yen(summary.subtotal)}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>消費税</span><span>{yen(summary.tax)}</span></div>
                      <div className="flex justify-between text-sm font-bold border-t pt-1 mt-1"><span>合計（税込）</span><span>{yen(summary.total)}</span></div>
                      {summary.cost > 0 && (
                        <div className="flex justify-between text-[10px] text-amber-700"><span>粗利（原価入力分）</span><span>{yen(summary.profit)}（{summary.profitRate}%）</span></div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-xs text-muted-foreground">
          選択中 <strong className="text-foreground">{pickedStats.count} 件</strong>
          {pickedStats.count > 0 && <span className="text-muted-foreground/80">　出し値 合計 {yen(pickedStats.total)}</span>}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={copyWhole} disabled={!current} className="gap-1.5">
            <CopyPlus className="w-4 h-4" /> この見積をまるごと複製
          </Button>
          <Button type="button" onClick={submit} disabled={pickedStats.count === 0} className="gap-1.5">
            <Copy className="w-4 h-4" /> 選択した明細を複製
          </Button>
        </div>
      </div>
    </div>
  );
}
