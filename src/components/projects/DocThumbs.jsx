import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { addMonths, format } from "date-fns";
import { clientLines, computeEstimateTotals, lineTaxRate } from "@/lib/estimateTotals";
import { companyInfoFromSettings, DELIVERY_STATUS_MAP, INVOICE_STATUS_MAP } from "@/lib/documents";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { formatPostalCode } from "@/lib/postalCode";
import SubmissionBadge from "@/components/estimates/SubmissionBadge";

// ============================================================================
// 案件の画面の「見積」「納品書」「請求書」の欄: 帳票の 1 ページ目のプレビュー（新しい順に 4 件・2 列 × 2 段）
//   押すとその場で大きく開き（全ページをスクロールで）、左右のボタン・← → で隣の帳票へ
//   PDF（api/_lib/estimatePdf.js・pdf.js・docLayout.js）と同じ位置・大きさで A4（595×842pt）を組み、枠の幅に合わせて縮める
//   明細は PDF と同じく決まった行数で、1 ページに収まらないときは 2 ページ目以降へ（最後のページに内訳・備考）
// ============================================================================

const PAGE_W = 595;
const PAGE_H = 842;
const M = 40; // 余白
const ROW_H = 17.4;
const HEAD_H = 16;
const CONT_TABLE_Y = 74; // 2 ページ目以降の表の位置（見出しが 1 行だけ）
// 1 ページに入る行数（docLayout.js の rowsForFull / rowsFor と同じ計算。内訳 1 行・備考の枠は標準の高さ）
const fullRows = (tableY) => Math.max(5, Math.floor((PAGE_H - 30 - 14 - tableY - HEAD_H) / ROW_H));
const lastRows = (tableY) => Math.max(5, Math.floor((PAGE_H - 30 - 140 - tableY - HEAD_H) / ROW_H));
export const THUMB_COUNT = 4;

const num = (n) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const fmt = (d) => { try { return d ? format(new Date(d), "yyyy-MM-dd") : ""; } catch { return ""; } };
const ymd = (d) => (d ? String(d).slice(0, 10) : "");
const docTotals = (d) => ({
  subtotal: Number(d.subtotal) || 0, tax: Number(d.tax) || 0, total: Number(d.total) || 0,
  breakdown: Array.isArray(d.tax_breakdown) && d.tax_breakdown.length ? d.tax_breakdown : [{ rate: 10, taxable: Number(d.subtotal) || 0, tax: Number(d.tax) || 0 }],
});
const StatusBadge = ({ map, status }) => { const st = map[status] || map.draft; return <Badge className={`text-[9px] ${st.color}`}>{st.label}</Badge>; };

/** 帳票ごとの違い（タイトル・番号・日付・金額の出し方・表の位置） */
const KINDS = {
  estimate: {
    noun: "見積", title: "御見積書", numberLabel: "見積書番号", totalLabel: "見積金額", path: "/estimates/", tableY: 354,
    number: (d) => d.estimate_number, caption: (d) => d.estimate_title || d.print_type || "（件名なし）",
    sortKey: (d) => String(d.created_date || ""),
    lines: (d) => clientLines(d.line_items), textOf: (li) => li.text,
    totals: (d) => {
      const t = computeEstimateTotals(d.line_items, { taxInclusive: !!d.tax_inclusive });
      return Array.isArray(d.line_items) && d.line_items.length ? t : { ...t, total: Number(d.total_amount) || 0 };
    },
    meta: (d) => { const issued = d.estimate_date || d.created_date; return [["見積書番号", d.estimate_number], ["発行日", fmt(issued)], ["有効期限", issued ? fmt(addMonths(new Date(issued), d.validity_period_months ?? 6)) : ""]]; },
    notes: (d) => d.additional_notes, badge: (d) => <SubmissionBadge estimate={d} size="xs" />,
  },
  delivery: {
    noun: "納品書", title: "納品書", numberLabel: "納品書番号", totalLabel: "合計金額", path: "/delivery-notes/", tableY: 355,
    number: (d) => d.delivery_number, caption: (d) => d.title || "（件名なし）",
    sortKey: (d) => `${d.delivery_date || ""}|${d.delivery_number || ""}`,
    lines: (d) => (d.line_items || []).filter(Boolean), textOf: (li) => li.name,
    totals: docTotals,
    meta: (d, c) => [["納品書番号", d.delivery_number], ["納品日", ymd(d.delivery_date)], ["登録番号", c.registration_number || ""]],
    notes: (d) => d.notes, badge: (d) => <StatusBadge map={DELIVERY_STATUS_MAP} status={d.status} />,
  },
  invoice: {
    noun: "請求書", title: "御請求書", numberLabel: "請求書番号", totalLabel: "請求金額", path: "/invoices/", tableY: 416, bank: true, dateCol: true,
    number: (d) => d.invoice_number, caption: (d) => d.title || "（件名なし）",
    sortKey: (d) => `${d.invoice_date || ""}|${d.invoice_number || ""}`,
    lines: (d) => (d.line_items || []).filter(Boolean), textOf: (li) => li.name,
    totals: docTotals,
    meta: (d, c) => [["請求書番号", d.invoice_number], ["請求日", ymd(d.invoice_date)], ["登録番号", c.registration_number || ""]],
    notes: (d) => d.notes, badge: (d) => <StatusBadge map={INVOICE_STATUS_MAP} status={d.status} />,
  },
};

/** 明細をページに分ける（PDF の paginateRows と同じ考え方。行の高さは 1 行分とみなす） */
function paginate(lines, firstTableY) {
  const full = (i) => fullRows(i === 0 ? firstTableY : CONT_TABLE_Y);
  const last = (i) => lastRows(i === 0 ? firstTableY : CONT_TABLE_Y);
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
const pagesOf = (k, d) => paginate(k.lines(d), k.tableY);

/** 帳票の 1 ページ（page は 0 始まり） */
function Sheet({ kind, d, company, page = 0 }) {
  const k = KINDS[kind];
  const pages = useMemo(() => pagesOf(k, d), [k, d]);
  const t = k.totals(d);
  const pg = pages[page] || pages[0];
  const rows = [...pg.rows, ...Array(Math.max(0, pg.cap - pg.rows.length)).fill(null)];
  const tableY = page === 0 ? k.tableY : CONT_TABLE_Y;
  const tableBottom = tableY + HEAD_H + pg.cap * ROW_H;
  const who = d.person_in_charge || (kind === "estimate" ? "" : company.representative || "");
  const notes = k.notes(d);
  const cell = "border-l border-neutral-400 first:border-l-0";
  const banks = (company.bank_accounts || []).map((b) => `${b.bank || ""} ${b.branch || ""}（${b.type || "普通"}）${b.number || ""}${b.holder ? ` ${b.holder}` : ""}`.trim());
  const cols = k.dateCol ? 5 : 4;
  return (
    <div className="relative bg-white text-neutral-900" style={{ width: PAGE_W, height: PAGE_H, fontSize: 8.5, lineHeight: 1.35 }}>
      {page > 0 ? (
        // 2 ページ目以降は 1 行の見出しだけ（PDF と同じ）
        <div className="absolute flex items-start justify-between border-b border-neutral-400" style={{ left: M, top: M, width: PAGE_W - M * 2, height: 24 }}>
          <p className="text-[12.5px]">{k.title}（続き）</p>
          <div className="text-right"><p className="text-[8.5px]">{k.numberLabel}　{k.number(d)}</p><p className="text-[8px] text-neutral-700">{d.client_name}　{d.client_honorific ?? "御中"}</p></div>
        </div>
      ) : (<>
        {/* 宛名 */}
        <div className="absolute" style={{ left: M, top: 50, width: 290 }}>
          {d.client_postal_code && <p className="text-[7.5px]">{formatPostalCode(d.client_postal_code)}</p>}
          {d.client_address && <p className="text-[7.5px] break-words">{d.client_address}</p>}
          <p className="mt-1 text-[13px]">{d.client_name || "（クライアント未入力）"}　{d.client_honorific ?? "御中"}</p>
        </div>
        {/* 番号・日付と自社情報（右上） */}
        <div className="absolute" style={{ left: 357, top: 32, width: PAGE_W - 357 - M }}>
          <table className="w-full text-[8px]"><tbody>
            {k.meta(d, company).map(([a, b]) => <tr key={a}><td>{a}</td><td className="text-right">{b}</td></tr>)}
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
        <p className="absolute w-full text-center text-[16px]" style={{ top: 198 }}>{k.title}</p>
        <p className="absolute text-[11px] truncate" style={{ left: M, top: 260, right: M }}><span className="mr-9">件名</span>{k.caption(d).replace("（件名なし）", "")}</p>
        {/* 小計・消費税・合計 */}
        <div className="absolute flex text-center" style={{ left: M, top: 286, width: 294 }}>
          {[["小計", `${num(t.subtotal)}円`, 85], ["消費税", `${num(t.tax)}円`, 74], [k.totalLabel, `${num(t.total)}円`, 135]].map(([a, v, w], i) => (
            <div key={a} style={{ width: w }} className={i ? "ml-px" : ""}>
              <p className="bg-black text-white text-[7.5px]" style={{ height: HEAD_H, lineHeight: `${HEAD_H}px` }}>{a}</p>
              <p className={`border border-neutral-400 text-right pr-1 ${i === 2 ? "text-[14px] font-bold" : "text-[8.5px]"}`} style={{ height: 26, lineHeight: "26px" }}>{v}</p>
            </div>
          ))}
        </div>
        {/* 請求書: 入金期日・振込先 */}
        {k.bank && (
          <div className="absolute" style={{ left: M, top: 337, width: 294 }}>
            <div className="flex bg-black text-center text-[7.5px] text-white" style={{ height: HEAD_H, lineHeight: `${HEAD_H}px` }}><span style={{ width: 85 }}>入金期日</span><span className="flex-1 border-l border-white">振込先</span></div>
            <div className="flex border border-neutral-400" style={{ height: 55 }}>
              <span className="flex items-center justify-center text-[9.5px]" style={{ width: 85 }}>{ymd(d.due_date)}</span>
              <span className="flex-1 overflow-hidden whitespace-pre-line border-l border-neutral-400 px-1.5 py-1 text-[7px] leading-snug">{banks.join("\n")}</span>
            </div>
          </div>
        )}
      </>)}
      {/* 明細（PDF と同じく決まった行数。グレー・白の互い違い） */}
      <table className="absolute border border-neutral-400 table-fixed" style={{ left: M, top: tableY, width: PAGE_W - M * 2 }}>
        <colgroup>{k.dateCol && <col style={{ width: 82 }} />}<col /><col style={{ width: 63 }} /><col style={{ width: 63 }} /><col style={{ width: 88 }} /></colgroup>
        <thead><tr className="bg-black text-white text-[8px]" style={{ height: HEAD_H }}>
          {k.dateCol && <th className="font-normal">取引日</th>}
          <th className={`font-normal ${k.dateCol ? "border-l border-white" : ""}`}>摘要</th><th className="font-normal border-l border-white">数量</th><th className="font-normal border-l border-white">単価</th><th className="font-normal border-l border-white">明細金額</th>
        </tr></thead>
        <tbody>
          {rows.map((li, i) => (
            <tr key={li?.id || `blank${i}`} className={`border-t border-neutral-400 ${i % 2 === 0 ? "bg-neutral-200/70" : ""}`} style={{ height: ROW_H }}>
              {li && (li.row_type === "text" || li.row_type === "subtotal") ? (
                <td colSpan={cols} className={`px-1.5 truncate ${li.row_type === "subtotal" ? "text-right font-bold" : ""}`}>
                  {li.row_type === "subtotal" ? `${li.name || "小計"}　${num(li.amount)}` : (k.textOf(li) || " ")}
                </td>
              ) : (
                <>
                  {k.dateCol && <td className={`${cell} text-center`}>{li ? ymd(li.transaction_date) : ""}</td>}
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
            備考{notes ? `\n${notes}` : ""}
          </div>
        </>
      )}
      <p className="absolute w-full text-center text-[7px]" style={{ top: PAGE_H - 30 }}>{page + 1} / {pages.length}</p>
    </div>
  );
}

/** 枠の幅に合わせて A4 の 1 ページ目を縮めて出す */
function Thumb({ kind, d, company, onOpen, index }) {
  const k = KINDS[kind];
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
    <button type="button" onClick={onOpen} data-thumb-group={kind} data-thumb-index={index} className="group block w-full min-w-0 text-left" data-testid={`${kind}-thumb`} title={`${k.number(d) || ""} を大きく見る`}>
      <div ref={box} className="relative w-full overflow-hidden rounded-sm border bg-white shadow-sm transition group-hover:shadow-md group-hover:ring-2 group-hover:ring-primary/40" style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}` }}>
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
          <Sheet kind={kind} d={d} company={company} />
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{k.number(d)}</span>
        {k.badge(d)}
      </div>
      <p className="truncate text-xs font-medium group-hover:underline">{k.caption(d)}</p>
    </button>
  );
}

/** ポップアップ: 全ページを縦に並べてスクロールで見る。左右（ボタン・← →）で隣の帳票へ */
function PreviewDialog({ kind, list, index, onIndex, company }) {
  const k = KINDS[kind];
  // 閉じる間（アニメーション中）も中身を消さないよう、最後に見ていた帳票を残す
  const current = index != null ? list[index] : null;
  const lastShown = useRef(null);
  const lastIndex = useRef(0);
  if (current) { lastShown.current = current; lastIndex.current = index; }
  const idx = index ?? lastIndex.current;
  const d = current || lastShown.current;
  const pages = useMemo(() => (d ? pagesOf(k, d).length : 0), [k, d]);
  const scroller = useRef(null);
  // ページの大きさは画面の幅だけで決める（開いた直後と切り替えたあとで同じ大きさにする。最大で実寸の 1.4 倍）
  const calcScale = () => Math.min(1.4, (Math.min(896, window.innerWidth - 32) - 32 - 16) / PAGE_W);
  const [scale, setScale] = useState(calcScale);
  useEffect(() => {
    const onResize = () => setScale(calcScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const go = useCallback((dir) => { if (index == null) return; const n = index + dir; if (n >= 0 && n < list.length) onIndex(n); }, [index, list.length, onIndex]);
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
  // 替わったら先頭（1 ページ目）から
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [index]);
  // 開いたまま後ろの小さなプレビュー（同じ欄のもの）を押したら、閉じずにそれに替える
  const onPointerDownOutside = (ev) => {
    const o = ev.detail?.originalEvent;
    if (!o) return;
    // 開いている間は後ろの画面が押せない（pointer-events: none）ので、位置で探す
    const hit = [...document.querySelectorAll(`[data-thumb-group="${kind}"][data-thumb-index]`)].find((el) => {
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
      <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden [&>*]:min-w-0" onPointerDownOutside={onPointerDownOutside} data-testid={`${kind}-preview-dialog`}>
        {d && (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-3 pr-12">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm">{k.caption(d)}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono">{k.number(d)}</span>{k.badge(d)}
                  <span>{pages} ページ</span>
                  <span className="tabular-nums">{idx + 1} / {list.length} 件目</span>
                </DialogDescription>
              </div>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs"><Link to={`${k.path}${d.id}`} data-testid={`${kind}-preview-open`}><ExternalLink className="h-3.5 w-3.5" />{k.noun}を開く</Link></Button>
            </div>
            <div className="relative">
              <button type="button" className={`${nav} left-3`} onClick={() => go(-1)} disabled={idx === 0} aria-label={`前の${k.noun}`} title={`前の${k.noun}（←）`} data-testid={`${kind}-preview-prev`}><ChevronLeft className="h-6 w-6" /></button>
              <button type="button" className={`${nav} right-3`} onClick={() => go(1)} disabled={idx === list.length - 1} aria-label={`次の${k.noun}`} title={`次の${k.noun}（→）`} data-testid={`${kind}-preview-next`}><ChevronRight className="h-6 w-6" /></button>
              <div ref={scroller} className="max-h-[78vh] overflow-y-auto bg-slate-200/70 px-4 py-4" data-testid={`${kind}-preview-pages`}>
                <div className="mx-auto space-y-4" style={{ width: PAGE_W * scale }}>
                  {Array.from({ length: pages }, (_, p) => (
                    <div key={`${d.id}-${p}`} className="overflow-hidden bg-white shadow" style={{ width: PAGE_W * scale, height: PAGE_H * scale }} data-testid={`${kind}-preview-page`}>
                      <div className="origin-top-left" style={{ transform: `scale(${scale})` }}><Sheet kind={kind} d={d} company={company} page={p} /></div>
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
 * 帳票の 1 ページ目のプレビューを 2 列で並べる（新しい順）
 * @param {{ kind: "estimate"|"delivery"|"invoice", docs: object[], all?: boolean }} p
 */
export default function DocThumbs({ kind, docs, all = false }) {
  const k = KINDS[kind];
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  const [openIdx, setOpenIdx] = useState(null); // ポップアップで見ている帳票（sorted の何番目か）
  if (!docs.length) return null;
  const sorted = [...docs].sort((a, b) => k.sortKey(b).localeCompare(k.sortKey(a)));
  const shown = all ? sorted : sorted.slice(0, THUMB_COUNT);
  return (
    <>
      {/* 2 列 × 2 段（開かなくても中身が読める大きさ） */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2" data-testid={`${kind}-thumbs`}>
        {shown.map((d, i) => <Thumb key={d.id} kind={kind} d={d} index={i} company={company} onOpen={() => setOpenIdx(i)} />)}
      </div>
      {/* 左右で並びの隣へ（4 件だけ見ているときも、この案件の帳票すべてを順に見られる） */}
      <PreviewDialog kind={kind} list={sorted} index={openIdx} onIndex={setOpenIdx} company={company} />
    </>
  );
}

/** 欄の見出しの「プレビュー」ボタン（開いたかどうかは欄ごとにこのブラウザに覚える） */
export function usePreviewToggle(key) {
  const storeKey = `cvapps:projectPreview:${key}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(storeKey) === "on"; } catch { return false; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(storeKey, v ? "on" : "off"); } catch { /* 覚えられなくても切り替える */ } };
  return [open, toggle];
}

export function PreviewToggleButton({ open, onClick, noun, testId }) {
  return (
    <Button size="sm" variant={open ? "secondary" : "outline"} className="gap-1 text-xs h-8" onClick={onClick} aria-pressed={open} title={`${noun}の 1 ページ目を、新しい順に 4 件並べて見る`} data-testid={testId}>
      <Eye className="w-3.5 h-3.5" /> プレビュー{open ? "を閉じる" : ""}
    </Button>
  );
}

/** プレビューの並びと「ほかの n 件も見る」 */
export function DocThumbsSection({ kind, docs }) {
  const [all, setAll] = useState(false);
  if (!docs.length) return null;
  return (
    <div className="mb-3 border-b pb-3">
      <DocThumbs kind={kind} docs={docs} all={all} />
      {docs.length > THUMB_COUNT && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[11px] text-primary hover:underline" data-testid={`${kind}-thumbs-all`}>
          {all ? `新しい ${THUMB_COUNT} 件だけにする` : `ほかの ${docs.length - THUMB_COUNT} 件も見る`}
        </button>
      )}
    </div>
  );
}
