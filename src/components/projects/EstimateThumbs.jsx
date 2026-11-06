import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Eye, EyeOff } from "lucide-react";
import { clientLines, computeEstimateTotals } from "@/lib/estimateTotals";
import SubmissionBadge from "@/components/estimates/SubmissionBadge";

// ============================================================================
// 案件の画面の「見積」の欄: 見積書の小さなプレビュー（新しい順に 4 件まで。押すと見積を開く）
//   A4 の見積書を実寸（595×842）で組んで、枠の幅に合わせて縮める
// ============================================================================

const PAGE_W = 595;
const PAGE_H = 842;
const CROP_H = 470; // 縦に長くならないよう、見積書の上半分（宛先・金額・明細の初めの行）だけ見せる
const MAX_ROWS = 10; // 出す明細の行数（それ以上は「ほか n 行」）
const SHOW = 4;
const PREF_KEY = "cvapps:projectEstimateThumbs";

const num = (n) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const dateOf = (e) => { const d = e.estimate_date || e.created_date; try { return d ? format(new Date(d), "yyyy-MM-dd") : ""; } catch { return ""; } };

function Sheet({ e }) {
  const lines = clientLines(e.line_items);
  const t = computeEstimateTotals(e.line_items, { taxInclusive: !!e.tax_inclusive });
  const total = Array.isArray(e.line_items) && e.line_items.length ? t.total : Number(e.total_amount) || 0;
  const shown = lines.slice(0, MAX_ROWS);
  const rest = lines.length - shown.length;
  return (
    <div className="bg-white text-neutral-900" style={{ width: PAGE_W, height: PAGE_H, padding: 36, fontSize: 10, lineHeight: 1.45 }}>
      <div className="flex justify-between">
        <p className="mt-6 text-[15px] font-semibold">{e.client_name || "（クライアント未入力）"} {e.client_honorific ?? "御中"}</p>
        <table className="text-[9px] text-neutral-600"><tbody>
          <tr><td className="pr-4">見積書番号</td><td className="text-right text-neutral-900">{e.estimate_number}</td></tr>
          <tr><td className="pr-4">発行日</td><td className="text-right text-neutral-900">{dateOf(e)}</td></tr>
        </tbody></table>
      </div>
      <p className="mt-8 text-center text-[20px] font-bold tracking-[0.4em]">御見積書</p>
      <p className="mt-5"><span className="text-neutral-500">件名</span>　{e.estimate_title || e.print_type || "—"}</p>
      <div className="mt-3 flex w-[60%] border border-neutral-400 text-center">
        <div className="flex-1 border-r border-neutral-400"><p className="bg-neutral-900 text-[9px] text-white">小計</p><p className="py-1">{num(t.subtotal)}</p></div>
        <div className="flex-1 border-r border-neutral-400"><p className="bg-neutral-900 text-[9px] text-white">消費税</p><p className="py-1">{num(t.tax)}</p></div>
        <div className="flex-1"><p className="bg-neutral-900 text-[9px] text-white">見積金額</p><p className="py-1 text-[13px] font-bold">{num(total)}</p></div>
      </div>
      <table className="mt-5 w-full border border-neutral-400">
        <thead><tr className="bg-neutral-900 text-[9px] text-white">
          <th className="px-1.5 py-1 text-left font-normal">摘要</th><th className="w-[12%] font-normal">数量</th><th className="w-[14%] text-right font-normal pr-1.5">単価</th><th className="w-[16%] text-right font-normal pr-1.5">金額</th>
        </tr></thead>
        <tbody>
          {shown.map((li, i) => (
            <tr key={li.id || i} className={i % 2 === 0 ? "bg-neutral-100" : ""}>
              {li.row_type === "text" || li.row_type === "subtotal" ? (
                <td colSpan={4} className={`px-1.5 py-[3px] ${li.row_type === "subtotal" ? "text-right font-semibold" : ""}`}>
                  {li.row_type === "subtotal" ? `${li.name || "小計"}　${num(li.amount)}` : (li.text || " ")}
                </td>
              ) : (
                <>
                  <td className="px-1.5 py-[3px] truncate max-w-0">{li.name}</td>
                  <td className="text-center whitespace-nowrap">{`${li.quantity ?? ""} ${li.unit || ""}`.trim()}</td>
                  <td className="pr-1.5 text-right">{num(li.unit_price)}</td>
                  <td className="pr-1.5 text-right">{num(li.amount)}</td>
                </>
              )}
            </tr>
          ))}
          {rest > 0 && <tr><td colSpan={4} className="px-1.5 py-[3px] text-center text-neutral-500">…ほか {rest} 行</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** 枠の幅に合わせて A4 の見積書を縮めて出す */
function Thumb({ e }) {
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
      <div ref={box} className="relative w-full overflow-hidden rounded-md border bg-white shadow-sm transition group-hover:shadow-md group-hover:ring-2 group-hover:ring-primary/40" style={{ aspectRatio: `${PAGE_W} / ${CROP_H}` }}>
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
          <Sheet e={e} />
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
 * @param {{ estimates: object[] }} p  新しい順
 */
export default function EstimateThumbs({ estimates }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; } });
  const [all, setAll] = useState(false);
  if (!estimates.length) return null;
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(PREF_KEY, v ? "on" : "off"); } catch { /* 保存できなくても表示は切り替える */ } };
  const sorted = [...estimates].sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  const shown = all ? sorted : sorted.slice(0, SHOW);
  return (
    <div className="mb-3 border-b pb-3" data-testid="estimate-thumbs">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground">プレビュー{open ? `（新しい順に ${shown.length} 件）` : ""}</span>
        <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" data-testid="estimate-thumbs-toggle">
          {open ? <><EyeOff className="h-3 w-3" />隠す</> : <><Eye className="h-3 w-3" />表示する</>}
        </button>
        {open && estimates.length > SHOW && (
          <button type="button" onClick={() => setAll((v) => !v)} className="ml-auto text-[11px] text-primary hover:underline" data-testid="estimate-thumbs-all">
            {all ? `${SHOW} 件に戻す` : `すべて表示（${estimates.length} 件）`}
          </button>
        )}
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {shown.map((e) => <Thumb key={e.id} e={e} />)}
        </div>
      )}
    </div>
  );
}
