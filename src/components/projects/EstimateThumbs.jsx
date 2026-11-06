import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addMonths, format } from "date-fns";
import { clientLines, computeEstimateTotals, lineTaxRate } from "@/lib/estimateTotals";
import { companyInfoFromSettings } from "@/lib/documents";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { formatPostalCode } from "@/lib/postalCode";
import SubmissionBadge from "@/components/estimates/SubmissionBadge";

// ============================================================================
// 案件の画面の「見積」の欄: 見積書の 1 ページ目のプレビュー（新しい順に 4 件。押すと見積を開く）
//   PDF（api/_lib/estimatePdf.js・docLayout.js）と同じ位置・大きさで A4（595×842pt）を組み、枠の幅に合わせて縮める
//   1 ページに収まる見積は 17 行の表＋内訳・備考、収まらない見積は 1 ページ目に 24 行（残りは 2 ページ目以降）
// ============================================================================

const PAGE_W = 595;
const PAGE_H = 842;
const M = 40; // 余白
const ROW_H = 17.4;
const HEAD_H = 16;
const TABLE_Y = 354;
const ROWS_SINGLE = 17; // 1 ページだけのとき（下に内訳・備考）
const ROWS_FIRST = 24; // 2 ページ以上のときの 1 ページ目
export const THUMB_COUNT = 4;

const num = (n) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const fmt = (d) => { try { return d ? format(new Date(d), "yyyy-MM-dd") : ""; } catch { return ""; } };

function Sheet({ e, company }) {
  const lines = clientLines(e.line_items);
  const hasItems = Array.isArray(e.line_items) && e.line_items.length > 0;
  const t = computeEstimateTotals(e.line_items, { taxInclusive: !!e.tax_inclusive });
  const total = hasItems ? t.total : Number(e.total_amount) || 0;
  const single = lines.length <= ROWS_SINGLE;
  const cap = single ? ROWS_SINGLE : ROWS_FIRST;
  const pages = single ? 1 : 1 + Math.ceil((lines.length - ROWS_FIRST) / 30);
  const rows = [...lines.slice(0, cap), ...Array(Math.max(0, cap - lines.length)).fill(null)];
  const issued = e.estimate_date || e.created_date;
  const months = e.validity_period_months ?? 6;
  const until = issued ? addMonths(new Date(issued), months) : null;
  const who = e.person_in_charge || "";
  const cell = "border-l border-neutral-400 first:border-l-0";
  return (
    <div className="relative bg-white text-neutral-900" style={{ width: PAGE_W, height: PAGE_H, fontSize: 8.5, lineHeight: 1.35 }}>
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
      {/* 明細（PDF と同じく決まった行数。グレー・白の互い違い） */}
      <table className="absolute border border-neutral-400 table-fixed" style={{ left: M, top: TABLE_Y, width: PAGE_W - M * 2 }}>
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
      {single && (
        <>
          {/* 内訳・備考（最後のページだけ） */}
          <div className="absolute border border-neutral-400 px-1.5 py-1" style={{ left: 334, top: 690, width: PAGE_W - 334 - M }}>
            {t.breakdown.map((b) => (
              <div key={b.rate} className="flex justify-between text-[8px]"><span>内訳　{b.rate}%対象(税抜)<span className="ml-4 text-[6.5px]">{b.rate}%消費税</span></span><span className="text-right">{num(b.taxable)}円<br /><span className="text-[6.5px]">{num(b.tax)}円</span></span></div>
            ))}
          </div>
          <div className="absolute border border-neutral-400 px-3 py-1.5 text-[8px] whitespace-pre-line overflow-hidden" style={{ left: M, top: 729, width: PAGE_W - M * 2, height: 63 }}>
            備考{e.additional_notes ? `\n${e.additional_notes}` : ""}
          </div>
        </>
      )}
      <p className="absolute w-full text-center text-[7px]" style={{ top: PAGE_H - 30 }}>1 / {pages}</p>
    </div>
  );
}

/** 枠の幅に合わせて A4 の 1 ページ目を縮めて出す */
function Thumb({ e, company }) {
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
    <Link to={`/estimates/${e.id}`} className="group block min-w-0" data-testid="estimate-thumb" title={`${e.estimate_number} を開く`}>
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
    </Link>
  );
}

/**
 * 見積書の 1 ページ目のプレビューを並べる
 * @param {{ estimates: object[], all?: boolean }} p
 */
export default function EstimateThumbs({ estimates, all = false }) {
  const { settings } = useSystemSettings();
  const company = useMemo(() => companyInfoFromSettings(settings), [settings]);
  if (!estimates.length) return null;
  const sorted = [...estimates].sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  const shown = all ? sorted : sorted.slice(0, THUMB_COUNT);
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="estimate-thumbs">
      {shown.map((e) => <Thumb key={e.id} e={e} company={company} />)}
    </div>
  );
}
