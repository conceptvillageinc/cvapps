import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FileOutput, Eye, EyeOff } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

const COMPANY_INFO = {
  name: "株式会社コンセプト・ヴィレッジ",
  address: "福島県郡山市（詳細住所は設定画面で編集できます）",
};

function buildLineItems(estimate) {
  const items = [];
  if (estimate.selling_price) {
    const specParts = [estimate.size, estimate.paper_type, estimate.color_count]
      .filter(Boolean)
      .join(" / ");
    const qtyText = (estimate.quantities || []).length > 0
      ? `${estimate.quantities.join("・")}枚`
      : "";
    items.push({
      name: estimate.print_type || "印刷費",
      detail: [specParts, qtyText].filter(Boolean).join("　"),
      amount: estimate.selling_price,
    });
  }
  (estimate.design_fees || []).forEach(fee => {
    items.push({
      name: fee.name,
      detail: fee.detail,
      amount: (fee.selling_price || 0) * (fee.quantity || 1),
    });
  });
  if (estimate.proofreading_fee) {
    items.push({ name: "校正費", detail: "", amount: estimate.proofreading_fee });
  }
  if (estimate.other_fees) {
    items.push({ name: "その他費用", detail: "", amount: estimate.other_fees });
  }
  return items;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function buildClientHtml(estimate) {
  const items = buildLineItems(estimate);
  const total = estimate.total_amount || 0;
  const today = format(new Date(), "yyyy年M月d日", { locale: ja });

  const rows = items.map(item => `
    <tr>
      <td class="name">${escapeHtml(item.name)}${item.detail ? `<div class="detail">${escapeHtml(item.detail)}</div>` : ""}</td>
      <td class="amount">¥${(item.amount || 0).toLocaleString()}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(estimate.estimate_number)} 御見積書</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; color: #222; margin: 0; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e293b; padding-bottom: 16px; margin-bottom: 24px; }
  .title { font-size: 26px; font-weight: 700; letter-spacing: 0.1em; }
  .meta { text-align: right; font-size: 12px; color: #555; line-height: 1.7; }
  .client { font-size: 20px; font-weight: 600; border-bottom: 2px solid #333; display: inline-block; padding-bottom: 4px; margin-bottom: 4px; }
  .client-sub { font-size: 12px; color: #666; }
  .company { text-align: right; font-size: 12px; line-height: 1.6; margin-top: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th { background: #1e293b; color: #fff; font-size: 12px; padding: 8px 12px; text-align: left; }
  th.amount, td.amount { text-align: right; }
  td { padding: 10px 12px; border-bottom: 1px solid #ddd; font-size: 13px; vertical-align: top; }
  .detail { font-size: 11px; color: #777; margin-top: 2px; }
  .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #1e293b; border-bottom: none; background: #f8fafc; }
  .footnote { margin-top: 32px; font-size: 11px; color: #666; line-height: 1.8; }
  .print-btn { position: fixed; top: 16px; right: 16px; padding: 8px 16px; background: #1e293b; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>
  <div class="header">
    <div class="title">御 見 積 書</div>
    <div class="meta">
      見積番号: ${escapeHtml(estimate.estimate_number)}<br />
      発行日: ${today}<br />
      希望納期: ${escapeHtml(estimate.desired_delivery_date) || "別途お打合せ"}
    </div>
  </div>

  <div>
    <div class="client">${escapeHtml(estimate.client_name)} 御中</div>
    <div class="client-sub">下記の通りお見積り申し上げます。</div>
  </div>

  <table>
    <thead>
      <tr><th>項目</th><th class="amount">金額（税抜）</th></tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row"><td>合計金額</td><td class="amount">¥${total.toLocaleString()}</td></tr>
    </tbody>
  </table>

  ${estimate.additional_notes ? `<div class="footnote"><strong>備考</strong><br/>${escapeHtml(estimate.additional_notes)}</div>` : ""}

  <div class="company">
    ${escapeHtml(COMPANY_INFO.name)}<br />
    ${escapeHtml(COMPANY_INFO.address)}
  </div>
</body>
</html>`;
}

export default function EstimatePreview({ estimate }) {
  const [showInternal, setShowInternal] = useState(false);
  const items = buildLineItems(estimate);
  const total = estimate.total_amount || 0;
  const today = format(new Date(), "yyyy年M月d日", { locale: ja });

  const openPrintable = () => {
    const html = buildClientHtml(estimate);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileOutput className="w-4 h-4" /> 社外見積プレビュー
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {showInternal ? <Eye className="w-3.5 h-3.5 text-primary" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                <Label htmlFor="show-internal" className="text-xs cursor-pointer">社内確認用（原価・掛け率を表示）</Label>
                <Switch id="show-internal" checked={showInternal} onCheckedChange={setShowInternal} />
              </div>
              <Button size="sm" onClick={openPrintable} className="gap-1.5 text-xs h-8">
                <FileOutput className="w-3.5 h-3.5" /> 印刷用に新しいタブで開く
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            「印刷用に新しいタブで開く」は常にクライアント提出用（原価・掛け率非表示）の内容で生成されます。仕様・印刷費・デザイン費タブの入力内容がリアルタイムに反映されます。
          </p>
        </CardHeader>
        <CardContent>
          {/* 見積書風プレビュー */}
          <div className="border rounded-lg p-6 bg-white">
            <div className="flex items-start justify-between border-b-4 border-slate-800 pb-3 mb-5">
              <div className="text-2xl font-bold tracking-widest">御 見 積 書</div>
              <div className="text-right text-xs text-muted-foreground leading-relaxed">
                見積番号: {estimate.estimate_number}<br />
                発行日: {today}<br />
                希望納期: {estimate.desired_delivery_date || "別途お打合せ"}
              </div>
            </div>

            <div className="mb-5">
              <div className="text-lg font-semibold border-b-2 border-slate-800 inline-block pb-1">
                {estimate.client_name || "（クライアント名未入力）"} 御中
              </div>
              <p className="text-xs text-muted-foreground mt-1">下記の通りお見積り申し上げます。</p>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
                  <th className="text-left px-3 py-2 font-medium">項目</th>
                  <th className="text-right px-3 py-2 font-medium">金額（税抜）</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={2} className="text-center text-xs text-muted-foreground py-6">
                      印刷費・デザイン費タブで内容を入力するとここに表示されます
                    </td>
                  </tr>
                )}
                {items.map((item, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-3 py-2.5 align-top">
                      {item.name}
                      {item.detail && <div className="text-[10px] text-muted-foreground mt-0.5">{item.detail}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top">¥{(item.amount || 0).toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-800 bg-slate-50 font-bold">
                  <td className="px-3 py-3">合計金額</td>
                  <td className="px-3 py-3 text-right">¥{total.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>

            {estimate.additional_notes && (
              <div className="mt-5 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground mb-1">備考</p>
                <p className="whitespace-pre-wrap">{estimate.additional_notes}</p>
              </div>
            )}
          </div>

          {/* 社内確認用パネル */}
          {showInternal && (
            <div className="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs font-semibold text-amber-800 mb-2">社内確認用（クライアントには非表示）</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">原価</p>
                  <p className="font-medium">¥{(estimate.cost_price || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">掛け率</p>
                  <p className="font-medium">×{estimate.markup_rate || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">粗利</p>
                  <p className="font-medium text-emerald-700">¥{(estimate.gross_profit || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">採用印刷会社</p>
                  <p className="font-medium">{estimate.selected_vendor || "—"}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
