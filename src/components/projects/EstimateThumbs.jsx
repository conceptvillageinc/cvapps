import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { addMonths, format } from "date-fns";
import { clientLines, computeEstimateTotals, lineTaxRate } from "@/lib/estimateTotals";
import { companyInfoFromSettings } from "@/lib/documents";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { formatPostalCode } from "@/lib/postalCode";
import SubmissionBadge from "@/components/estimates/SubmissionBadge";

// ============================================================================
// 案件の画面の「見積」の欄: 見積書の 1 ページ目のプレビュー（新しい順に 4 件）
//   押すとその場で大きく開き（全ページをスクロールで）、左右のボタン・← → で隣の見積へ
//   PDF（api/_lib/estimatePdf.js・docLayout.js）と同じ位置・大きさで A4（595×842pt）を組み、枠の幅に合わせて縮める
//   1 ページに収まる見積は 17 行の表＋内訳・備考、収まらない見積は 1 ページ目に 24 行・2 ページ目以降に 40 行（最後のページは 33 行まで＋内訳・備考）
// ============================================================================

const PAGE_W = 595;
const PAGE_H = 842;
const M = 40; // 余白
const ROW_H = 17.4;
const HEAD_H = 16;
const TABLE_Y = 354;
const CONT_TABLE_Y = 74; // 2 ページ目以降の表の位置（見出しが 1 行だけ）
// 1 ページに入る行数（docLayout.js の rowsForFull / rowsFor と同じ計算。内訳 1 行・備考の枠は標準の高さ）
const fullRows = (tableY) => Math.max(5, Math.floor((PAGE_H - 30 - 14 - tableY - HEAD_H) / ROW_H));
const lastRows = (tableY) => Math.max(5, Math.floor((PAGE_H - 30 - 140 - tableY - HEAD_H) / ROW_H));
export const THUMB_COUNT = 4;

/** 明細をページに分ける（PDF の paginateRows と同じ考え方。行の高さは 1 行分とみなす） */
function paginate(lines) {
  const full = (i) => fullRows(i === 0 ? TABLE_Y : CONT_TABLE_Y);
  const last = (i) => lastRows(i === 0 ? TABLE_Y : CONT_TABLE_Y);
  const pages = [[]];
  for (const li of lines) {
    const i = pages.length - 1;
    if (pages[i].length + 1 > full(i) && pages[i].length > 0) {
      // ページの最後が見出しの行（▼…）だけになるときは、見出しも次のページへ
      const carry = [];
      while (pages[i].length > 1 && pages[i][pages[i].length - 1].row_type === "text") carry.unshift(pages[i].pop());
      pages.push(carry);
    }
    pages[pages.length - 1].push(li);
  }
  // 最後のページに内訳・備考が入らなければ、あふれた行を次のページへ
  for (;;) {
    const i = pages.length - 1;
    if (pages[i].length <= last(i)) break;
    const move = [];
    while (pages[i].length > 1 && pages[i].length > last(i)) move.unshift(pages[i].pop());
    if (!move.length) break;
    pages.push(move);
  }
  return pages.map((rows, i) => {
    const isLast = i === pages.length - 1;
    const cap = !isLast ? full(i) : i === 0 ? last(0) : Math.max(rows.length, Math.min(last(i), Math.max(rows.length + 2, 5)));
    return { rows, cap, isLast };
  });
}

const num = (n) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const fmt = (d) => { try { return d ? format(new Date(d), "yyyy-MM-dd") : ""; } catch { return ""; } };

/** 見積書の 1 ページ（page は 0 始まり） */
function Sheet({ e, company, page = 0 }) {
  const pages = useMemo(() => paginate(clientLines(e.line_items)), [e.line_items]);
  const hasItems = Array.isArray(e.line_items) && e.line_items.length > 0;
  const t = computeEstimateTotals(e.line_items, { taxInclusive: !!e.tax_inclusive });
  const total = hasItems ? t.total : Number(e.total_amount) || 0;
  const pg = pages[page] || pages[0];
  const rows = [...pg.rows, ...Array(Math.max(0, pg.cap - pg.rows.length)).fill(null)];
  const tableY = page === 0 ? TABLE_Y : CONT_TABLE_Y;
  const tableBottom = tableY + HEAD_H + pg.cap * ROW_H;
  const issued = e.estimate_date || e.created_date;
  const months = e.validity_period_months ?? 6;
  const until = issued ? addMonths(new Date(issued), months) : null;
  const who = e.person_in_charge || "";
  const cell = "border-l border-neutral-400 first:border-l-0";
  return (
    <div className="relative bg-white text-neutral-900" style={{ width: PAGE_W, height: PAGE_H, fontSize: 8.5, lineHeight: 1.35 }}>
      {page > 0 ? (
        // 2 ページ目以降は 1 行の見出しだけ（PDF と同じ）
        <div className="absolute flex items-start justify-between border-b border-neutral-400" style={{ left: M, top: M, width: PAGE_W - M * 2, height: 24 }}>
          <p className="text-[12.5px]">御見積書（続き）</p>
          <div className="text-right"><p className="text-[8.5px]">見積書番号　{e.estimate_number}</p><p className="text-[8px] text-neutral-700">{e.client_name}　{e.client_honorific ?? "御中"}</p></div>
        </div>
      ) : (<>
      {/* 宛名 */}
      <div className="absolute" style={{ left: M, top: 58, width: 290 }}>
        {e.client_postal_code && <p className="text-[7.5px]">{formatPostalCode(e.client_postal_code)}</p>}
        <p className="text-[13px]">{e.client_name || "（クライアント未入力）"}　{e.client_honorific ?? "御中"}</p>
      </div>
      {/* 番号・日付と自社情報（右上） */}
      <div className="absolute" style={{ left: 357, top: 32, width: PAGE_W - 357 - M }}>
        <table className="w-full text-[8px]"><tbody>
          <tr><td>見積書番号</td><td className="text-right">{e.estimate_number}</td></tr>
          <tr><td>発行日</td><td className="text-right">{fmt(issued)}</td></tr>
          <tr><td>有効期限</td><td className="text-right">{until ? fmt(until) : ""}</td></tr>
        </tbody></table>
        <p className="mt-3 text-[8.5px]">{company.name}{who ? `　${who}` : ""}</p>
        {(company.locations || []).map((loc, i) => (
          <Fragment key={i}>
            {loc.label && <p className="text-[7px] text-neutral-700">［{loc.label}］</p>}
            <p className="text-[7px] text-neutral-700 whitespace-nowrap overflow-hidden">{formatPostalCode(loc.postal || "")}　{loc.address}</p>
          </Fragment>
        ))}
        {(company.tel || company.fax) && <p className="text-[7px] text-neutral-700">{[company.tel ? `tel ${company.tel}` : "", company.fax ? `fax ${company.fax}` : ""].filter(Boolean).join("｜")}</p>}
      </div>
      <p className="absolute w-full text-center text-[16px]" style={{ top: 198 }}>御見積書</p>
      <p className="absolute text-[11px]" style={{ left: M, top: 260, right: M }}><span className="mr-9">件名</span>{e.estimate_title || e.print_type || ""}</p>
      {/* 小計・消費税・見積金額 */}
      <div className="absolute flex text-center" style={{ left: M, top: 286, width: 294 }}>
        {[["小計", `${num(t.subtotal)}円`, 85], ["消費税", `${num(t.tax)}円`, 74], ["見積金額", `${num(total)}円`, 135]].map(([k, v, w], i) => (
          <div key={k} style={{ width: w }} className={i ? "ml-px" : ""}>
            <p className="bg-black text-white text-[7.5px]" style={{ height: HEAD_H, lineHeight: `${HEAD_H}px` }}>{k}</p>
            <p className={`border border-neutral-400 text-right pr-1 ${i === 2 ? "text-[14px] font-bold" : "text-[8.5px]"}`} style={{ height: 26, lineHeight: "26px" }}>{v}</p>
          </div>
        ))}
      </div>
      </>)}
      {/* 明細（PDF と同じく決まった行数。グレー・白の互い違い） */}
      <table className="absolute border border-neutral-400 table-fixed" style={{ left: M, top: tableY, width: PAGE_W - M * 2 }}>
        <colgroup><col /><col style={{ width: 63 }} /><col style={{ width: 63 }} /><col style={{ width: 88 }} /></colgroup>
        <thead><tr className="bg-black text-white text-[8px]" style={{ height: HEAD_H }}>
          <th className="font-normal">摘要</th><th className="font-normal border-l border-white">数量</th><th className="font-normal border-l border-white">単価</th><th className="font-normal border-l border-white">明細金額</th>
        </tr></thead>
        <tbody>
          {rows.map((li, i) => (
            <tr key={li?.id || `blank${i}`} className={`border-t border-neutral-400 ${i % 2 === 0 ? "bg-neutral-200/70" : ""}`} style={{ height: ROW_H }}>
              {li && (li.row_type === "text" || li.row_type === "subtotal") ? (
                <td colSpan={4} className={`px-1.5 truncate ${li.row_type === "subtotal" ? "text-right font-bold" : ""}`}>
                  {li.row_type === "subtotal" ? `${li.name || "小計"}　${num(li.amount)}` : (li.text || " ")}
                </td>
              ) : (
                <>
                  <td className={`${cell} px-1.5 truncate`}>{li ? `${li.name || ""}${lineTaxRate(li) === 8 ? "（軽減8%）" : ""}` : ""}</td>
                  <td className={`${cell} text-center whitespace-nowrap`}>{li ? `${li.quantity ?? ""} ${li.unit || ""}`.trim() : ""}</td>
                  <td className={`${cell} text-right pr-1.5`}>{li ? num(li.unit_price) : ""}</td>
                  <td className={`${cell} text-right pr-1.5`}>{li ? num(li.amount) : ""}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {pg.isLast && (
        <>
          {/* 内訳・備考（最後のページだけ） */}
          <div className="absolute border border-neutral-400 px-1.5 py-1" style={{ left: 334, top: tableBottom + 24, width: PAGE_W - 334 - M }}>
            {t.breakdown.map((b) => (
              <div key={b.rate} className="flex justify-between text-[8px]"><span>内訳　{b.rate}%対象(税抜)<span className="ml-4 text-[6.5px]">{b.rate}%消費税</span></span><span className="text-right">{num(b.taxable)}円<br /><span className="text-[6.5px]">{num(b.tax)}円</span></span></div>
            ))}
          </div>
          <div className="absolute border border-neutral-400 px-3 py-1.5 text-[8px] whitespace-pre-line overflow-hidden" style={{ left: M, top: tableBottom + 24 + 27 + 12, width: PAGE_W - M * 2, height: 63 }}>
            備考{e.additional_notes ? `\n${e.additional_notes}` : ""}
          </div>
        </>
      )}
      <p className="absolute w-full text-center text-[7px]" style={{ top: PAGE_H - 30 }}>{page + 1} / {pages.length}</p>
    </div>
  );
}

/** 枠の幅に合わせて A4 の 1 ページ目を縮めて出す */
function Thumb({ e, company, onOpen, index }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0.35);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / PAGE_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <button type="button" onClick={onOpen} data-thumb-index={index} className="group block w-full min-w-0 text-left" data-testid="estimate-thumb" title={`${e.estimate_number} を大きく見る`}>
      <div ref={box} className="relative w-full overflow-hidden rounded-sm border bg-white shadow-sm transition group-hover:shadow-md group-hover:ring-2 group-hover:ring-primary/40" style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}` }}>
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
          <Sheet e={e} company={company} />
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{e.estimate_number}</span>
        <SubmissionBadge estimate={e} size="xs" />
      </div>
      <p className="truncate text-xs font-medium group-hover:underline">{e.estimate_title || e.print_type || "（件名なし）"}</p>
    </button>
  );
}

/** ポップアップ: 全ページを縦に並べてスクロールで見る。左右（ボタン・← →）で隣の見積へ */
function PreviewDialog({ list, index, onIndex, company }) {
  // 閉じる間（アニメーション中）も中身を消さないよう、最後に見ていた見積を残す
  const current = index != null ? list[index] : null;
  const lastShown = useRef(null);
  const lastIndex = useRef(0);
  if (current) { lastShown.current = current; lastIndex.current = index; }
  const idx = index ?? lastIndex.current;
  const e = current || lastShown.current;
  const pages = useMemo(() => (e ? paginate(clientLines(e.line_items)).length : 0), [e]);
  const scroller = useRef(null);
  // ページの大きさは画面の幅だけで決める（開いた直後と切り替えたあとで同じ大きさにする。最大で実寸の 1.4 倍）
  const calcScale = () => Math.min(1.4, (Math.min(896, window.innerWidth - 32) - 32 - 16) / PAGE_W);
  const [scale, setScale] = useState(calcScale);
  useEffect(() => {
    const onResize = () => setScale(calcScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const go = useCallback((d) => { if (index == null) return; const n = index + d; if (n >= 0 && n < list.length) onIndex(n); }, [index, list.length, onIndex]);
  useEffect(() => {
    if (index == null) return undefined;
    const onKey = (ev) => {
      if (ev.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
      if (ev.key === "ArrowLeft") { ev.preventDefault(); go(-1); }
      if (ev.key === "ArrowRight") { ev.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);
  // 見積が替わったら先頭（1 ページ目）から
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [index]);
  // 開いたまま後ろの小さなプレビューを押したら、閉じずにその見積に替える（押したところの下にあるプレビューを探す）
  const onPointerDownOutside = (ev) => {
    const o = ev.detail?.originalEvent;
    if (!o) return;
    // 開いている間は後ろの画面が押せない（pointer-events: none）ので、位置で探す
    const hit = [...document.querySelectorAll("[data-thumb-index]")].find((el) => {
      const r = el.getBoundingClientRect();
      return o.clientX >= r.left && o.clientX <= r.right && o.clientY >= r.top && o.clientY <= r.bottom;
    });
    if (!hit) return;
    ev.preventDefault();
    onIndex(Number(hit.dataset.thumbIndex));
  };
  const nav = "absolute top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/95 shadow-lg ring-1 ring-black/10 hover:bg-white disabled:opacity-30 disabled:cursor-default";
  return (
    <Dialog open={!!current} onOpenChange={(v) => !v && onIndex(null)}>
      <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden [&>*]:min-w-0" onPointerDownOutside={onPointerDownOutside} data-testid="estimate-preview-dialog">
        {e && (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-3 pr-12">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm">{e.estimate_title || e.print_type || "（件名なし）"}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono">{e.estimate_number}</span><SubmissionBadge estimate={e} size="xs" />
                  <span>{pages} ページ</span>
                  <span className="tabular-nums">{idx + 1} / {list.length} 件目</span>
                </DialogDescription>
              </div>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs"><Link to={`/estimates/${e.id}`} data-testid="estimate-preview-open"><ExternalLink className="h-3.5 w-3.5" />見積を開く</Link></Button>
            </div>
            <div className="relative">
              <button type="button" className={`${nav} left-3`} onClick={() => go(-1)} disabled={idx === 0} aria-label="前の見積" title="前の見積（←）" data-testid="estimate-preview-prev"><ChevronLeft className="h-6 w-6" /></button>
              <button type="button" className={`${nav} right-3`} onClick={() => go(1)} disabled={idx === list.length - 1} aria-label="次の見積" title="次の見積（→）" data-testid="estimate-preview-next"><ChevronRight className="h-6 w-6" /></button>
              <div ref={scroller} className="max-h-[78vh] overflow-y-auto bg-slate-200/70 px-4 py-4" data-testid="estimate-preview-pages">
                <div className="mx-auto space-y-4" style={{ width: PAGE_W * scale }}>
                  {Array.from({ length: pages }, (_, p) => (
                    <div key={`${e.id}-${p}`} className="overflow-hidden bg-white shadow" style={{ width: PAGE_W * scale, height: PAGE_H * scale }} data-testid="estimate-preview-page">
                      <div className="origin-top-left" style={{ transform: `scale(${scale})` }}><Sheet e={e} company={company} page={p} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 見積書の 1 ページ目のプレビューを並べる
 * @param {{ estimates: object[], all?: boolean }} p
 */
export default function EstimateThumbs({ estimates, all = false }) {
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  const [openIdx, setOpenIdx] = useState(null); // ポップアップで見ている見積（sorted の何番目か）
  if (!estimates.length) return null;
  const sorted = [...estimates].sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  const shown = all ? sorted : sorted.slice(0, THUMB_COUNT);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="estimate-thumbs">
        {shown.map((e, i) => <Thumb key={e.id} e={e} index={i} company={company} onOpen={() => setOpenIdx(i)} />)}
      </div>
      {/* 左右で並びの隣へ（4 件だけ見ているときも、この案件の見積すべてを順に見られる） */}
      <PreviewDialog list={sorted} index={openIdx} onIndex={setOpenIdx} company={company} />
    </>
  );
}
