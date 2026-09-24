import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertTriangle, Send, FileText } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { APPROVAL_CHECKLIST } from "@/lib/constants";
import { computeEstimateTotals } from "@/lib/estimateTotals";
import ReviewPanel from "@/components/estimates/ReviewPanel";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const fmt = (d) => (d ? new Date(d).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "");

/** 見積の内容から自動で判定する社内チェック */
export function autoChecks(estimate, grossMarginTarget) {
  const items = (estimate.line_items || []).filter((li) => li.row_type !== "text" && li.row_type !== "subtotal");
  const totals = computeEstimateTotals(items, { taxInclusive: !!estimate.tax_inclusive });
  const costRows = items.filter((li) => li.cost_price != null && li.cost_price !== "");
  const cost = costRows.reduce((s, li) => s + (Number(li.cost_price) || 0) * (Number(li.quantity) || 1), 0);
  const under = costRows.filter((li) => (Number(li.cost_price) || 0) * (Number(li.quantity) || 1) > (Number(li.amount) || 0));
  const profit = totals.subtotal - cost;
  const rate = totals.subtotal > 0 ? profit / totals.subtotal : 0;
  const target = grossMarginTarget || 0.8;
  const missing = [];
  if (!estimate.client_name) missing.push("宛名");
  if (!estimate.estimate_title) missing.push("件名");
  if (!estimate.desired_delivery_date) missing.push("希望納期");
  if (items.length === 0) missing.push("明細");
  const validity = estimate.validity_period_months ?? 6;
  return {
    totals, cost, profit, rate,
    checks: [
      under.length > 0
        ? { key: "cost", level: "bad", title: "原価が出し値を上回る行あり", note: under.map((li) => li.name).slice(0, 3).join("、") }
        : costRows.length === 0
          ? { key: "cost", level: "warn", title: "原価 未入力", note: "仕入のある行に原価を入れると粗利が出ます" }
          : { key: "cost", level: "ok", title: "原価 OK", note: "すべての行で出し値 ＞ 原価" },
      totals.subtotal === 0
        ? { key: "profit", level: "warn", title: "粗利 —", note: "明細がありません" }
        : rate >= target
          ? { key: "profit", level: "ok", title: `粗利 ${Math.round(rate * 100)}%`, note: `目標 ${Math.round(target * 100)}% を達成` }
          : rate >= target - 0.1
            ? { key: "profit", level: "warn", title: `粗利 ${Math.round(rate * 100)}%`, note: `目標 ${Math.round(target * 100)}% に対して −${Math.round((target - rate) * 100)}pt` }
            : { key: "profit", level: "bad", title: `粗利 ${Math.round(rate * 100)}%`, note: `目標 ${Math.round(target * 100)}% を大きく下回ります` },
      estimate.desired_delivery_date
        ? { key: "delivery", level: "ok", title: "希望納期あり", note: estimate.desired_delivery_date }
        : { key: "delivery", level: "warn", title: "希望納期 未入力", note: "基本情報で入力してください" },
      missing.length > 0
        ? { key: "doc", level: "warn", title: "見積書 要確認", note: `${missing.join("・")} が未入力` }
        : { key: "doc", level: "ok", title: "見積書 OK", note: `宛名・件名・有効期限（${validity}ヶ月）あり` },
    ],
  };
}

const LEVEL = {
  ok: { cls: "border-emerald-200 bg-emerald-50", title: "text-emerald-700", Icon: CheckCircle2 },
  warn: { cls: "border-amber-200 bg-amber-50", title: "text-amber-800", Icon: AlertTriangle },
  bad: { cls: "border-red-200 bg-red-50", title: "text-red-700", Icon: XCircle },
};

/**
 * ステップ2「レビュー・承認」。
 * 左: 社内チェック（自動）＋ チェックリスト・コメント（ReviewPanel）
 * 右: 申請／承認カード、見積の要約、履歴
 */
export default function ReviewStep({ estimate, onUpdate, onApprove, onReject, onRequestReview, onOpenPdf, emailLogs = [] }) {
  const { user } = useAuth();
  const { grossMarginTarget } = useSystemSettings();
  const a = useMemo(() => autoChecks(estimate, grossMarginTarget), [estimate, grossMarginTarget]);
  const checklist = estimate.approval_checklist || {};
  const checked = APPROVAL_CHECKLIST.filter((i) => checklist[i.key]).length;
  const allChecked = checked === APPROVAL_CHECKLIST.length;
  const isReviewer = user?.role === "admin";
  const pending = estimate.status === "review_pending" || estimate.status === "review_in_progress";
  const canRequest = estimate.status === "draft" || estimate.status === "rejected";

  const history = [
    ...emailLogs.filter((l) => l.status === "sent").map((l) => ({ at: l.sent_at, text: l.document_type ? `${l.recipient_company} へ${l.document_type === "estimate" ? "見積書" : "書類"}を送付` : `${l.recipient_company} へ依頼メール送信` })),
    ...emailLogs.filter((l) => l.reply_detected_at).map((l) => ({ at: l.reply_detected_at, text: `${l.recipient_company} から返信（Gmail）` })),
    ...emailLogs.filter((l) => l.replied_at).map((l) => ({ at: l.replied_at, text: `${l.recipient_company} 返答あり（${l.replied_by || ""}）` })),
    ...(estimate.review_requested_at ? [{ at: estimate.review_requested_at, text: `レビュー申請${estimate.review_requested_to_name ? `（→ ${estimate.review_requested_to_name}）` : ""}` }] : []),
    ...(estimate.approved_date ? [{ at: estimate.approved_date, text: `承認（${estimate.reviewer_name || ""}）` }] : []),
    ...(estimate.created_date ? [{ at: estimate.created_date, text: "見積を作成" }] : []),
  ].filter((h) => h.at).sort((x, y) => String(y.at).localeCompare(String(x.at)));

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-bold">社内チェック（自動）</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {a.checks.map((c) => {
                const L = LEVEL[c.level];
                return (
                  <div key={c.key} className={`rounded-lg border px-3 py-2 ${L.cls}`}>
                    <p className={`text-xs font-bold flex items-center gap-1 ${L.title}`}><L.Icon className="w-3.5 h-3.5" /> {c.title}</p>
                    <p className="text-[11px] text-foreground/70 mt-0.5">{c.note}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        <ReviewPanel estimate={estimate} onUpdate={onUpdate} onApprove={onApprove} onReject={onReject} />
      </div>

      <div className="w-full lg:w-[320px] shrink-0 space-y-3">
        <div className={`rounded-xl border-2 bg-card p-4 space-y-3 ${estimate.status === "approved" ? "border-emerald-300" : "border-primary"}`}>
          <p className="text-sm font-bold">{estimate.status === "approved" ? "承認済み" : pending ? "承認" : "レビュー申請"}</p>
          {estimate.status === "approved" ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">{estimate.reviewer_name || ""} が {fmt(estimate.approved_date)} に承認しました。「見積書を送付」でクライアントへ送れます。</p>
          ) : pending ? (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                申請先: <span className="text-foreground font-semibold">{estimate.review_requested_to_name || "（指定なし）"}</span><br />
                申請日時: {fmt(estimate.review_requested_at)}
              </p>
              {isReviewer ? (
                <>
                  <Button className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={!allChecked} onClick={onApprove}>
                    <CheckCircle2 className="w-4 h-4" /> 承認する{!allChecked && `（チェック ${checked}/${APPROVAL_CHECKLIST.length}）`}
                  </Button>
                  <Button variant="outline" className="w-full gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive" onClick={onReject}>
                    <XCircle className="w-4 h-4" /> 差し戻す
                  </Button>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">レビュー担当（管理者）がチェックして承認します</p>
              )}
              <p className="text-[10px] text-muted-foreground leading-relaxed">承認後は「見積書を送付」でクライアントへ。差し戻すと下書きに戻り、ステップ1で直せます。</p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">明細ができたら、レビュー担当を選んで申請します。社内チェックに赤があれば先に直してください。</p>
              <Button className="w-full gap-1.5" onClick={onRequestReview} disabled={!canRequest || a.checks.some((c) => c.level === "bad")}>
                <Send className="w-4 h-4" /> レビューを申請する
              </Button>
            </>
          )}
        </div>

        <Card>
          <CardContent className="pt-4 space-y-2">
            <p className="text-xs font-bold">見積の要約</p>
            <div className="text-[11px] text-foreground/80 space-y-1 tabular-nums">
              <div className="flex justify-between"><span>小計（税別）</span><span>{yen(a.totals.subtotal)}</span></div>
              <div className="flex justify-between"><span>合計（税込）</span><span className="font-bold">{yen(a.totals.total)}</span></div>
              {a.cost > 0 && (
                <>
                  <div className="flex justify-between text-amber-700"><span>仕入合計</span><span>{yen(a.cost)}</span></div>
                  <div className="flex justify-between text-amber-700 font-semibold"><span>粗利</span><span>{yen(a.profit)}（{Math.round(a.rate * 100)}%）</span></div>
                </>
              )}
              <div className="flex justify-between"><span>有効期限</span><span>見積日から {estimate.validity_period_months ?? 6}ヶ月</span></div>
            </div>
            <Button variant="outline" size="sm" className="w-full text-xs gap-1" onClick={onOpenPdf}><FileText className="w-3.5 h-3.5" /> 見積書PDFを見る</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-1.5">
            <p className="text-xs font-bold">履歴</p>
            {history.length === 0 ? <p className="text-[11px] text-muted-foreground">まだ履歴がありません</p> : (
              <ul className="text-[11px] text-muted-foreground space-y-1 max-h-48 overflow-y-auto">
                {history.map((h, i) => <li key={i}><span className="tabular-nums">{fmt(h.at)}</span>　{h.text}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
