import { Fragment, useState } from "react";
import { Eye } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPostalCode } from "@/lib/postalCode";

// ============================================================================
// 納品書・請求書の画面のプレビュー（編集中の内容をそのまま反映する）
//   PDF（api/_lib/pdf.js・docLayout.js）と同じ並び:
//   宛名／自社情報／表題／件名・日付・番号／小計・消費税・合計の帯／請求書は入金期日・振込先
//   ／明細表（請求書は取引日つき）／税率別内訳／備考
//   印影・ロゴは PDF だけに入る。
// ============================================================================

const PREF_SHOW = "cv.docEditor.preview";
const PREF_LEFT = "cv.docEditor.previewLeft";
const readPref = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const writePref = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* 保存できない環境では今回だけ */ } };

/** プレビューの表示・左右の設定（このブラウザに保存。納品書と請求書で共通） */
export function useDocPreviewPrefs() {
  const [show, setShowState] = useState(() => readPref(PREF_SHOW) !== "0");
  const [left, setLeftState] = useState(() => readPref(PREF_LEFT) === "1");
  const setShow = (v) => { setShowState(v); writePref(PREF_SHOW, v ? "1" : "0"); };
  const setLeft = (v) => { setLeftState(v); writePref(PREF_LEFT, v ? "1" : "0"); };
  return { show, left, setShow, setLeft };
}

/** 「プレビューを表示」「左右表示切り替え」のスイッチ（見積書の画面と同じ） */
export function DocPreviewSwitches({ prefs }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1.5" title="OFF にするとプレビューを隠し、編集欄を横いっぱいに広げます">
        <Label htmlFor="doc-preview" className="text-xs cursor-pointer">プレビューを表示</Label>
        <Switch id="doc-preview" checked={prefs.show} onCheckedChange={prefs.setShow} />
      </div>
      {prefs.show && (
        <div className="flex items-center gap-1.5" title="ON にするとプレビューを左、編集欄を右に並べます。この設定はこのブラウザに保存されます">
          <Label htmlFor="doc-preview-left" className="text-xs cursor-pointer">左右表示切り替え</Label>
          <Switch id="doc-preview-left" checked={prefs.left} onCheckedChange={prefs.setLeft} />
        </div>
      )}
    </div>
  );
}

const num = (n) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const signed = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("ja-JP")}`; };
const unitPrice = (p) => { const n = Number(p) || 0; return Number.isInteger(n) ? signed(n) : n.toLocaleString("ja-JP", { maximumFractionDigits: 2 }); };
const qty = (q) => { const n = Number(q); if (!Number.isFinite(n)) return ""; return Number.isInteger(n) ? n.toLocaleString("ja-JP") : String(n); };
const dateOf = (d) => (d ? String(d).slice(0, 10) : "");

const Head = ({ children, className = "" }) => <th className={`bg-black text-white font-normal px-1.5 py-1 ${className}`}>{children}</th>;

/**
 * @param {object} p
 * @param {'delivery'|'invoice'} p.type
 * @param {object} p.doc       編集中のフォーム（delivery_notes / invoices の形）
 * @param {{subtotal:number,tax:number,total:number,tax_breakdown:Array}} p.totals
 * @param {object} p.company   companyInfoFromSettings の値
 */
export default function DocumentPreview({ type, doc, totals, company }) {
  const isInvoice = type === "invoice";
  const items = (doc.line_items || []).filter((li) => li && (li.name || Number(li.amount)));
  const breakdown = totals.tax_breakdown?.length ? totals.tax_breakdown : [{ rate: 10, taxable: totals.subtotal, tax: totals.tax }];
  const hasReduced = items.some((li) => Number(li.tax_rate) === 8);
  const meta = isInvoice
    ? [["請求日", dateOf(doc.invoice_date)], ["請求書番号", doc.invoice_number || "（作成時に採番）"], ["登録番号", company.registration_number || ""]]
    : [["納品日", dateOf(doc.delivery_date)], ["納品書番号", doc.delivery_number || "（作成時に採番）"], ["登録番号", company.registration_number || ""]];
  const who = doc.person_in_charge || company.representative || "";
  const banks = (company.bank_accounts || []).map((b) => `${b.bank || ""} ${b.branch || ""}（${b.type || "普通"}）${b.number || ""}${b.holder ? ` ${b.holder}` : ""}`.trim());
  const cols = isInvoice ? 5 : 4;

  return (
    <div className="rounded-lg border bg-white shadow-sm" data-testid="doc-preview">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 px-4 pt-3">
        <Eye className="w-3.5 h-3.5" /> プレビュー（PDF と同じ並び・自動同期。印影とロゴは PDF に入ります）
      </p>
      <div className="px-6 pb-6 pt-4 text-[11px] leading-relaxed text-black space-y-4">
        {/* 宛名・自社情報 */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px]">{doc.client_postal_code ? formatPostalCode(doc.client_postal_code) : ""}</p>
            <p className="text-[10px] break-words">{doc.client_address}</p>
            <p className="text-[15px] mt-1 break-words">{doc.client_name || "（クライアント名未入力）"}　{doc.client_honorific ?? "御中"}</p>
          </div>
          <div className="text-[10px] text-right sm:text-left shrink-0 max-w-[50%]">
            <p className="text-[11px]">{company.name}{who ? `　${who}` : ""}</p>
            {(company.locations || []).map((loc, i) => (
              <Fragment key={i}>
                {loc.label && <p className="text-neutral-700">［{loc.label}］</p>}
                <p className="text-neutral-700">{formatPostalCode(loc.postal || "")}　{loc.address}</p>
              </Fragment>
            ))}
            {(company.tel || company.fax) && <p className="text-neutral-700">{[company.tel ? `tel ${company.tel}` : "", company.fax ? `fax ${company.fax}` : ""].filter(Boolean).join("｜")}</p>}
          </div>
        </div>

        <p className="text-center text-[20px] tracking-[0.2em] pt-2">{isInvoice ? "御請求書" : "納品書"}</p>

        {/* 件名・日付・番号 */}
        <div className="flex items-end justify-between gap-4">
          <p className="min-w-0 break-words"><span className="text-neutral-600">件名</span>　{doc.title || "—"}</p>
          <table className="shrink-0 text-[10px]"><tbody>
            {meta.map(([k, v]) => <tr key={k}><td className="pr-3 text-neutral-600">{k}</td><td>{v}</td></tr>)}
          </tbody></table>
        </div>

        {/* 小計・消費税・合計 */}
        <table className="w-full max-w-[60%] border border-neutral-400 text-center">
          <thead><tr><Head>小計</Head><Head>消費税</Head><Head>{isInvoice ? "請求金額" : "合計金額"}</Head></tr></thead>
          <tbody><tr>
            <td className="border-r border-neutral-400 py-1.5 text-[12px]">{num(totals.subtotal)}</td>
            <td className="border-r border-neutral-400 py-1.5 text-[12px]">{num(totals.tax)}</td>
            <td className="py-1.5 text-[14px] font-bold">{num(totals.total)}</td>
          </tr></tbody>
        </table>

        {isInvoice && (
          <table className="w-full max-w-[60%] border border-neutral-400">
            <thead><tr><Head className="w-[29%]">入金期日</Head><Head>振込先</Head></tr></thead>
            <tbody><tr>
              <td className="border-r border-neutral-400 text-center py-1.5 text-[12px] align-middle">{dateOf(doc.due_date)}</td>
              <td className="px-2 py-1.5 text-[10px] whitespace-pre-line">{banks.join("\n") || "（システム設定の会社情報で振込先を登録してください）"}</td>
            </tr></tbody>
          </table>
        )}

        {/* 明細 */}
        <table className="w-full border border-neutral-400">
          <thead><tr>
            {isInvoice && <Head className="w-[15%]">取引日</Head>}
            <Head className="text-left">摘要</Head>
            <Head className="w-[12%]">数量</Head>
            <Head className="w-[12%] text-right">単価</Head>
            <Head className="w-[16%] text-right">明細金額</Head>
          </tr></thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={cols} className="text-center text-neutral-500 py-6">明細を入れると、ここにそのまま反映されます</td></tr>
            )}
            {items.map((li, i) => (
              <tr key={li.id || i} className={i % 2 ? "bg-neutral-100" : ""}>
                {isInvoice && <td className="px-1.5 py-1 text-center tabular-nums">{dateOf(li.transaction_date)}</td>}
                <td className="px-1.5 py-1 break-words">{li.name}{Number(li.tax_rate) === 8 ? "（軽減8%）" : ""}</td>
                <td className="px-1.5 py-1 text-center tabular-nums whitespace-nowrap">{`${qty(li.quantity)} ${li.unit || ""}`.trim()}</td>
                <td className="px-1.5 py-1 text-right tabular-nums">{unitPrice(li.unit_price)}</td>
                <td className="px-1.5 py-1 text-right tabular-nums">{signed(li.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 税率別内訳 */}
        <div className="flex justify-end">
          <table className="text-[10px]"><tbody>
            {breakdown.map((b) => (
              <Fragment key={b.rate}>
                <tr><td className="pr-4 text-neutral-600">{b.rate}%対象（税抜）</td><td className="text-right tabular-nums">{num(b.taxable)}</td></tr>
                <tr><td className="pr-4 text-neutral-600">{b.rate}%消費税</td><td className="text-right tabular-nums">{num(b.tax)}</td></tr>
              </Fragment>
            ))}
            {hasReduced && <tr><td colSpan={2} className="text-neutral-600">（軽減8%）は軽減税率対象</td></tr>}
          </tbody></table>
        </div>

        {/* 備考 */}
        <div className="border border-neutral-400">
          <p className="bg-black text-white px-1.5 py-0.5">備考</p>
          <p className="px-2 py-1.5 min-h-[3.5rem] whitespace-pre-wrap break-words">{doc.notes}</p>
        </div>
      </div>
    </div>
  );
}
