import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Palette, Printer, Hammer, Plus, Trash2, FileOutput, Eye, EyeOff, Type, ChevronRight, GripVertical, FileText, FileUp, Calculator, Lock, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { format, addMonths } from "date-fns";
import {
  LINE_ITEM_CATEGORIES, COMPANY_INFO, DEFAULT_VALIDITY_MONTHS, TAX_RATE, applyMarkup,
} from "@/lib/constants";
import {
  usePricingRules, markupRateFor, recomputeRuleRows, makeRuleRow, ruleRowHint, outsourcingPrice, OUTSOURCING_KINDS,
} from "@/lib/pricing";
import { DESIGN_FEE_MASTER, getDesignItemsByCategory } from "@/lib/designFees";
import NumericField from "@/components/estimates/NumericField";
import { formatPostalCode } from "@/lib/postalCode";

import VendorQuoteImport from "@/components/estimates/VendorQuoteImport";
import WebPriceImport from "@/components/estimates/WebPriceImport";

const CATEGORY_ICONS = { design: Palette, print_paper: Printer, print_nonpaper: Printer, build: Hammer, other: Plus };

function uid() {
  return `li_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// number入力の増減ボタン（スピンボタン）を非表示にし、数字との重なりを回避
const noSpinner = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

function round(n) {
  return Math.round(n || 0);
}

// 金額表示。割引行はマイナスになるので「-¥7,000」の形にする
function yen(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? "-" : ""}¥${Math.abs(v).toLocaleString()}`;
}

function computeTotals(lineItems) {
  const subtotal = (lineItems || [])
    .filter(li => li.row_type !== "text")
    .reduce((sum, li) => sum + (Number(li.amount) || 0), 0);
  const tax = round(subtotal * TAX_RATE);
  return { subtotal, tax, total: subtotal + tax };
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export default function QuoteEditor({ estimate, onUpdate }) {
  const [showInternal, setShowInternal] = useState(true);
  const [addPanel, setAddPanel] = useState(null); // LINE_ITEM_CATEGORIES key
  const [priceMasterPick, setPriceMasterPick] = useState(null); // selected PriceMaster entry for tier selection
  const [dragId, setDragId] = useState(null);
  const [manualForm, setManualForm] = useState({ name: "", quantity: 1, unit: "式", unit_price: 0, cost: "", outsourcing: "" });
  const { rules } = usePricingRules();

  const lineItems = estimate.line_items || [];
  const { subtotal, tax, total } = useMemo(() => computeTotals(lineItems), [lineItems]);

  // 社内確認用：原価情報を持つ行のみを集計して粗利を計算
  const { totalCost, grossProfit, profitRate } = useMemo(() => {
    const cost = lineItems
      .filter(li => li.row_type !== "text" && li.cost_price != null)
      .reduce((sum, li) => sum + (Number(li.cost_price) || 0) * (Number(li.quantity) || 1), 0);
    const profit = subtotal - cost;
    return { totalCost: cost, grossProfit: profit, profitRate: subtotal > 0 ? ((profit / subtotal) * 100).toFixed(1) : 0 };
  }, [lineItems, subtotal]);

  const { data: priceMasterEntries = [] } = useQuery({
    queryKey: ["priceMaster"],
    queryFn: () => db.entities.PriceMaster.list("-last_updated"),
  });

  // 価格マスタ一覧：選択済みセル（selected=true）が1つ以上あるレコードのみ対象
  const priceMasterEntriesWithSelection = useMemo(() => {
    return priceMasterEntries
      .map(e => ({
        ...e,
        selectedCells: (e.price_grid || []).flatMap(row =>
          (row.cells || [])
            .filter(c => c.selected)
            .map(c => ({ quantity: row.quantity, label: c.label, price: c.price }))
        ),
      }))
      .filter(e => e.selectedCells.length > 0)
      .sort((a, b) => `${a.category}${a.vendor_name}`.localeCompare(`${b.category}${b.vendor_name}`, "ja"));
  }, [priceMasterEntries]);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });
  const client = clients.find(c => c.name === estimate.client_name);

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => db.entities.SystemSettings.list(),
  });
  const notesTemplates = useMemo(() => {
    const s = settings.find(x => x.setting_key === "notes_templates");
    try { return s ? JSON.parse(s.setting_value) : []; } catch { return []; }
  }, [settings]);

  const appendNoteTemplate = (text) => {
    const current = estimate.additional_notes || "";
    const next = current ? `${current}\n${text}` : text;
    onUpdate({ additional_notes: next });
  };

  const estimateDate = estimate.estimate_date || format(new Date(), "yyyy-MM-dd");
  const validityMonths = estimate.validity_period_months ?? DEFAULT_VALIDITY_MONTHS;
  const validUntil = format(addMonths(new Date(estimateDate), validityMonths), "yyyy-MM-dd");

  const commitItems = (rawItems) => {
    // コンセプト設計費・校正費・割引などの自動計算行を、他の行の合計から入れ直す
    const newItems = recomputeRuleRows(rawItems, rules);
    const totals = computeTotals(newItems);
    onUpdate({ line_items: newItems, total_amount: totals.total });
  };

  const addRuleRow = (rule, discount) => {
    if (lineItems.some(li => li.source_type === "rule" && li.rule === rule && (rule !== "discount" || li.discount_key === discount?.key))) {
      toast.info("その自動計算行はすでに追加されています");
      return;
    }
    commitItems([...lineItems, { id: uid(), row_type: "item", ...makeRuleRow(rules, rule, discount) }]);
  };

  const addItem = (item) => {
    commitItems([...lineItems, { id: uid(), row_type: "item", ...item }]);
  };

  const addItems = (items) => {
    commitItems([...lineItems, ...items.map(item => ({ id: uid(), row_type: "item", ...item }))]);
  };

  const addTextRow = () => {
    commitItems([...lineItems, { id: uid(), row_type: "text", text: "" }]);
  };

  const updateItem = (id, patch) => {
    commitItems(lineItems.map(li => li.id === id ? { ...li, ...patch } : li));
  };

  const removeItem = (id) => {
    commitItems(lineItems.filter(li => li.id !== id));
  };

  const reorderItems = (draggedId, targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const items = [...lineItems];
    const fromIdx = items.findIndex(i => i.id === draggedId);
    const toIdx = items.findIndex(i => i.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    commitItems(items);
  };

  const closeAddPanel = () => {
    setAddPanel(null);
    setPriceMasterPick(null);
    setManualForm({ name: "", quantity: 1, unit: "式", unit_price: 0, cost: "", outsourcing: "" });
  };

  const pickDesignItem = (categoryLabel, masterItem) => {
    addItem({
      category: "デザイン費",
      name: masterItem.name,
      quantity: 1,
      unit: "式",
      unit_price: masterItem.selling_price,
      amount: masterItem.selling_price,
      source_type: "design_master",
      source_ref: `${categoryLabel}:${masterItem.name}`,
    });
    closeAddPanel();
  };

  const pickPriceMasterCell = (entry, cell) => {
    const catDef = LINE_ITEM_CATEGORIES.find(c => c.key === addPanel);
    const quantity = cell.quantity || 1;
    const costPerUnit = cell.price / quantity;
    const markupRate = markupRateFor(rules, entry.category);
    const unitPrice = applyMarkup(costPerUnit, markupRate);
    addItem({
      category: catDef.label,
      name: `${entry.category}（${entry.vendor_name}・${cell.label}納期）`,
      quantity,
      unit: "枚",
      unit_price: unitPrice,
      amount: unitPrice * quantity,
      cost_price: Math.round(costPerUnit * 100) / 100,
      markup_rate: markupRate,
      source_type: "price_master",
      source_ref: entry.id,
    });
    closeAddPanel();
  };

  const submitManual = () => {
    if (!manualForm.name) {
      toast.error("名称を入力してください");
      return;
    }
    const catDef = LINE_ITEM_CATEGORIES.find(c => c.key === addPanel);
    addItem({
      category: catDef.label,
      name: manualForm.name,
      quantity: Number(manualForm.quantity) || 1,
      unit: manualForm.unit || "式",
      unit_price: Number(manualForm.unit_price) || 0,
      amount: (Number(manualForm.quantity) || 1) * (Number(manualForm.unit_price) || 0),
      source_type: "manual",
      // 外注の仕入額から売価を出した場合は、原価として持ち粗利に反映する
      ...(manualForm.outsourcing && Number(manualForm.cost) > 0
        ? { cost_price: Number(manualForm.cost), outsourcing_kind: manualForm.outsourcing }
        : {}),
    });
    closeAddPanel();
  };

  const openPrintable = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = lineItems.map(li => {
      if (li.row_type === "text") {
        return `<tr class="text-row"><td colspan="5">${escapeHtml(li.text)}</td></tr>`;
      }
      return `<tr>
        <td>${escapeHtml(li.name)}</td>
        <td class="num">${(li.quantity ?? "").toLocaleString ? li.quantity.toLocaleString() : li.quantity}</td>
        <td class="num">${escapeHtml(li.unit)}</td>
        <td class="num">${yen(li.unit_price).replace("¥", "")}</td>
        <td class="num">${yen(li.amount).replace("¥", "")}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8" />
<title>${escapeHtml(estimate.estimate_number)} 御見積書</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
    color: #1e293b;
    font-size: 12px;
    line-height: 1.6;
    padding: 70px 28px 28px;
    max-width: 900px;
    margin: 0 auto;
  }
  .print-btn {
    position: fixed; top: 16px; right: 16px;
    padding: 9px 18px; background: #1e293b; color: #fff; border: none;
    border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  }
  @media print { .print-btn { display: none; } body { padding-top: 0; max-width: none; } }

  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 28px; }
  .client-block p { margin: 1px 0; color: #64748b; }
  .client-name { font-size: 17px; font-weight: 700; color: #1e293b; margin-top: 8px !important; border-bottom: 2px solid #1e293b; display: inline-block; padding-bottom: 3px; }
  .company-block { text-align: right; flex-shrink: 0; }
  .company-block p { margin: 1px 0; color: #64748b; }
  .company-name { font-weight: 700; font-size: 13px; color: #1e293b; margin-bottom: 4px !important; }

  .title { text-align: center; font-size: 24px; font-weight: 700; letter-spacing: 0.35em; color: #1e293b; margin: 8px 0 28px; padding-left: 0.35em; }

  .meta-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 20px; }
  .meta-row .subject-label { color: #64748b; font-size: 11px; }
  .meta-table { border-collapse: collapse; }
  .meta-table td { padding: 3px 0; font-size: 12px; }
  .meta-table td:first-child { color: #64748b; padding-right: 16px; white-space: nowrap; }
  .meta-table td:last-child { font-weight: 500; }

  table.summary { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 24px; border: 1px solid #cbd5e1; }
  table.summary td { text-align: center; padding: 10px 8px; border-right: 1px solid #cbd5e1; vertical-align: middle; }
  table.summary td:last-child { border-right: none; background: #eef2ff; }
  table.summary .label { display: block; font-size: 11px; color: #64748b; margin-bottom: 4px; }
  table.summary .value { display: block; font-size: 16px; font-weight: 700; color: #1e293b; }
  table.summary td:last-child .value { font-size: 21px; color: #4338ca; }

  table.items { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.items th { background: #1e293b; color: #fff; padding: 8px 10px; font-size: 11px; font-weight: 500; text-align: left; }
  table.items th.num, table.items td.num { text-align: right; }
  table.items td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
  tr.text-row td { background: #f1f5f9; font-weight: 600; color: #334155; }

  .breakdown { display: flex; justify-content: flex-end; margin: 10px 0 0; }
  .breakdown table { border-collapse: collapse; }
  .breakdown td { padding: 2px 4px; font-size: 11px; color: #64748b; }
  .breakdown td.amt { text-align: right; padding-left: 16px; color: #1e293b; }

  .notes { margin-top: 28px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 12px 14px; font-size: 11px; color: #475569; white-space: pre-wrap; }
  .notes strong { display: block; margin-bottom: 6px; color: #1e293b; font-size: 12px; }
</style></head>
<body>
  <button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>
  <div class="top">
    <div class="client-block">
      <p>${escapeHtml(client?.postal_code ? formatPostalCode(client.postal_code) : "")}</p>
      <p>${escapeHtml(client?.address)}</p>
      <p class="client-name">${escapeHtml(estimate.client_name)} ${escapeHtml(estimate.client_honorific || "御中")}</p>
    </div>
    <div class="company-block">
      <p class="company-name">${escapeHtml(COMPANY_INFO.name)} ${escapeHtml(estimate.person_in_charge)}</p>
      ${COMPANY_INFO.locations.map(loc => `<p>［${loc.label}］${loc.postal} ${escapeHtml(loc.address)}</p>`).join("")}
      <p>tel ${COMPANY_INFO.tel}｜fax ${COMPANY_INFO.fax}</p>
    </div>
  </div>

  <div class="title">御見積書</div>

  <div class="meta-row">
    <div><span class="subject-label">件名</span><br />${escapeHtml(estimate.estimate_title || estimate.print_type || "—")}</div>
    <table class="meta-table">
      <tr><td>見積日</td><td>${estimateDate}</td></tr>
      <tr><td>見積書番号</td><td>${escapeHtml(estimate.estimate_number)}</td></tr>
      <tr><td>有効期限</td><td>${validUntil}</td></tr>
    </table>
  </div>

  <table class="summary">
    <tr>
      <td><span class="label">小計</span><span class="value">${subtotal.toLocaleString()}円</span></td>
      <td><span class="label">消費税</span><span class="value">${tax.toLocaleString()}円</span></td>
      <td><span class="label">見積金額</span><span class="value">${total.toLocaleString()}円</span></td>
    </tr>
  </table>

  <table class="items">
    <thead><tr><th>名称</th><th class="num" style="width:70px;">数量</th><th class="num" style="width:56px;">単位</th><th class="num" style="width:90px;">単価</th><th class="num" style="width:100px;">金額</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="breakdown">
    <table>
      <tr><td>10%対象(税抜)</td><td class="amt">${subtotal.toLocaleString()}円</td></tr>
      <tr><td>10%消費税</td><td class="amt">${tax.toLocaleString()}円</td></tr>
    </table>
  </div>

  ${estimate.additional_notes ? `<div class="notes"><strong>備考</strong>${escapeHtml(estimate.additional_notes)}</div>` : ""}
</body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-1.5">
          {showInternal ? <Eye className="w-3.5 h-3.5 text-primary" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
          <Label htmlFor="qe-internal" className="text-xs cursor-pointer">社内確認用（原価・掛け率を表示）</Label>
          <Switch id="qe-internal" checked={showInternal} onCheckedChange={setShowInternal} />
        </div>
        <Button size="sm" onClick={openPrintable} className="gap-1.5 text-xs h-8">
          <FileOutput className="w-3.5 h-3.5" /> 印刷用に新しいタブで開く
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* 左：クライアント提出用プレビュー（常にクリーン表示・自動同期） */}
        <div className="border rounded-lg p-6 bg-white space-y-4 lg:sticky lg:top-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 -mt-1 mb-1">
            <Eye className="w-3.5 h-3.5" /> プレビュー（クライアント提出用・自動同期）
          </p>
          <div className="flex items-start justify-between">
            <div className="text-xs leading-relaxed text-muted-foreground">
              <p>{client?.postal_code ? formatPostalCode(client.postal_code) : ""}</p>
              <p>{client?.address}</p>
              <p className="text-base font-semibold text-foreground mt-1">
                {estimate.client_name || "（クライアント名未入力）"} {estimate.client_honorific ?? "御中"}
              </p>
            </div>
            <div className="text-right text-xs leading-relaxed text-muted-foreground">
              <p className="font-semibold text-foreground">{COMPANY_INFO.name} {estimate.person_in_charge}</p>
              {COMPANY_INFO.locations.map(loc => (
                <p key={loc.label}>［{loc.label}］{loc.postal} {loc.address}</p>
              ))}
              <p>tel {COMPANY_INFO.tel}｜fax {COMPANY_INFO.fax}</p>
            </div>
          </div>

          <div className="text-center text-xl font-bold tracking-[0.3em]">御 見 積 書</div>

          <div className="flex items-start justify-between flex-wrap gap-3 text-xs text-muted-foreground">
            <div><span className="text-xs">件名</span>　<span className="text-foreground">{estimate.estimate_title || "—"}</span></div>
            <table className="text-xs">
              <tbody>
                <tr><td className="pr-3 py-0.5">見積日</td><td className="text-foreground">{estimateDate}</td></tr>
                <tr><td className="pr-3 py-0.5">見積書番号</td><td className="text-foreground">{estimate.estimate_number}</td></tr>
                <tr><td className="pr-3 py-0.5">有効期限</td><td className="text-foreground">{validityMonths}ヶ月（{validUntil}）</td></tr>
              </tbody>
            </table>
          </div>

          <div className="flex border rounded-lg overflow-hidden divide-x">
            <div className="flex-1 text-center py-2 bg-muted/30">
              <p className="text-[10px] text-muted-foreground">小計</p>
              <p className="text-sm font-bold">{subtotal.toLocaleString()}円</p>
            </div>
            <div className="flex-1 text-center py-2 bg-muted/30">
              <p className="text-[10px] text-muted-foreground">消費税</p>
              <p className="text-sm font-bold">{tax.toLocaleString()}円</p>
            </div>
            <div className="flex-1 text-center py-2 bg-primary/10">
              <p className="text-[10px] text-muted-foreground">見積金額</p>
              <p className="text-lg font-bold text-primary">{total.toLocaleString()}円</p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white text-xs">
                <th className="text-left px-3 py-2 font-medium">名称</th>
                <th className="text-right px-3 py-2 font-medium w-16">数量</th>
                <th className="text-right px-3 py-2 font-medium w-14">単位</th>
                <th className="text-right px-3 py-2 font-medium w-20">単価</th>
                <th className="text-right px-3 py-2 font-medium w-24">金額</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                    右側で明細を追加すると、ここにそのまま反映されます
                  </td>
                </tr>
              )}
              {lineItems.map(li => (
                li.row_type === "text" ? (
                  <tr key={li.id} className="bg-muted/30">
                    <td colSpan={5} className="px-3 py-1.5 font-medium text-xs">{li.text}</td>
                  </tr>
                ) : (
                  <tr key={li.id} className="border-b">
                    <td className="px-3 py-2 align-top">{li.name}</td>
                    <td className="px-3 py-2 text-right align-top">{li.quantity?.toLocaleString?.() ?? li.quantity}</td>
                    <td className="px-3 py-2 text-right align-top">{li.unit}</td>
                    <td className="px-3 py-2 text-right align-top">{yen(li.unit_price)}</td>
                    <td className="px-3 py-2 text-right align-top font-medium">{yen(li.amount)}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>

          {estimate.additional_notes !== undefined && (
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold text-foreground mb-1">備考</p>
              <p className="whitespace-pre-wrap min-h-[1em]">{estimate.additional_notes || ""}</p>
            </div>
          )}
        </div>

        {/* 右：入力（社内編集画面） */}
        <div className="space-y-4">
          <div className="border rounded-lg p-6 bg-white space-y-5">
            <div className="flex items-start justify-between">
              <div className="text-xs leading-relaxed text-muted-foreground">
                <p>{client?.postal_code ? formatPostalCode(client.postal_code) : ""}</p>
                <p>{client?.address}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-base font-semibold text-foreground">{estimate.client_name || "（クライアント名未入力）"}</span>
                  <Input
                    value={estimate.client_honorific ?? "御中"}
                    onChange={e => onUpdate({ client_honorific: e.target.value })}
                    className="text-base font-semibold text-foreground h-8 w-20 px-1.5 -mx-1.5 border-transparent hover:border-border focus:border-input"
                  />
                </div>
              </div>
              <div className="text-right text-xs leading-relaxed text-muted-foreground">
                <p className="font-semibold text-foreground">{COMPANY_INFO.name} {estimate.person_in_charge}</p>
                {COMPANY_INFO.locations.map(loc => (
                  <p key={loc.label}>［{loc.label}］{loc.postal} {loc.address}</p>
                ))}
                <p>tel {COMPANY_INFO.tel}｜fax {COMPANY_INFO.fax}</p>
              </div>
            </div>

            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground text-xs">件名</span>
                <Input
                  value={estimate.estimate_title || ""}
                  onChange={e => onUpdate({ estimate_title: e.target.value })}
                  placeholder="例: チラシ制作費"
                  className="h-8 text-sm w-72"
                />
              </div>
              <table className="text-xs text-muted-foreground">
                <tbody>
                  <tr>
                    <td className="pr-3 py-0.5">見積日</td>
                    <td><Input type="date" value={estimateDate} onChange={e => onUpdate({ estimate_date: e.target.value })} className="h-7 text-xs w-36" /></td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5">見積書番号</td>
                    <td className="py-0.5">{estimate.estimate_number}</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5">有効期限</td>
                    <td className="flex items-center gap-1 py-0.5">
                      <NumericField
                        value={validityMonths}
                        onCommit={(months) => onUpdate({ validity_period_months: months })}
                        className={`h-7 text-xs w-14 ${noSpinner}`}
                      />
                      ヶ月（{validUntil}）
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex border rounded-lg overflow-hidden divide-x">
              <div className="flex-1 text-center py-2 bg-muted/30">
                <p className="text-[10px] text-muted-foreground">小計</p>
                <p className="text-sm font-bold">{subtotal.toLocaleString()}円</p>
              </div>
              <div className="flex-1 text-center py-2 bg-muted/30">
                <p className="text-[10px] text-muted-foreground">消費税</p>
                <p className="text-sm font-bold">{tax.toLocaleString()}円</p>
              </div>
              <div className="flex-1 text-center py-2 bg-primary/10">
                <p className="text-[10px] text-muted-foreground">見積金額</p>
                <p className="text-lg font-bold text-primary">{total.toLocaleString()}円</p>
              </div>
            </div>

            {showInternal && (
              <div className="flex border rounded-lg overflow-hidden divide-x border-amber-200">
                <div className="flex-1 text-center py-2 bg-amber-50">
                  <p className="text-[10px] text-amber-700">総原価（参考）</p>
                  <p className="text-sm font-bold text-amber-800">¥{totalCost.toLocaleString()}</p>
                </div>
                <div className="flex-1 text-center py-2 bg-amber-50">
                  <p className="text-[10px] text-amber-700">この見積の粗利</p>
                  <p className="text-sm font-bold text-amber-800">¥{grossProfit.toLocaleString()}</p>
                </div>
                <div className="flex-1 text-center py-2 bg-amber-50">
                  <p className="text-[10px] text-amber-700">粗利率</p>
                  <p className="text-sm font-bold text-amber-800">{profitRate}%</p>
                </div>
              </div>
            )}

            {/* 明細追加バー （表の直前に配置し、スクロールなしで触れるように） */}
            <div className="border border-dashed border-emerald-300 rounded-lg p-3 bg-emerald-50/60 space-y-2">
              <p className="text-xs text-emerald-700">+ 明細を追加 — 大カテゴリを選択</p>
              <div className="flex gap-2 flex-wrap">
                {LINE_ITEM_CATEGORIES.map(cat => {
                  const Icon = CATEGORY_ICONS[cat.key];
                  return (
                    <Button key={cat.key} size="sm" variant="outline" className="gap-1.5 text-xs h-9 bg-white text-foreground hover:bg-emerald-100 hover:text-foreground border-emerald-200" onClick={() => setAddPanel(cat.key)}>
                      <Icon className="w-3.5 h-3.5" /> {cat.label}
                    </Button>
                  );
                })}
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-9 bg-white text-foreground hover:bg-emerald-100 hover:text-foreground border-emerald-200" onClick={() => setAddPanel("vendor_quote")}>
                  <FileUp className="w-3.5 h-3.5" /> 仕入先見積から読込
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-9 bg-white text-foreground hover:bg-emerald-100 hover:text-foreground border-emerald-200" onClick={() => setAddPanel("web_price")}>
                  <Globe className="w-3.5 h-3.5" /> ネット印刷から取込
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs h-9 bg-white text-foreground hover:bg-emerald-100 hover:text-foreground border-emerald-200">
                      <Calculator className="w-3.5 h-3.5" /> 自動計算行
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-1" align="start">
                    <p className="text-[10px] text-muted-foreground px-2 py-1">他の明細の合計から金額が決まる行です。%はシステム設定で変更できます</p>
                    <button className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/50" onClick={() => addRuleRow("concept_fee")}>
                      コンセプト設計費 <span className="text-muted-foreground">（印刷費を除く合計の{Math.round(rules.concept_fee.rate * 100)}%）</span>
                    </button>
                    <button className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/50" onClick={() => addRuleRow("proofreading_fee")}>
                      校正費 <span className="text-muted-foreground">（デザイン費の{Math.round(rules.proofreading_fee.rate * 100)}%）</span>
                    </button>
                    <div className="border-t my-1" />
                    {rules.discounts.map(d => (
                      <button key={d.key} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/50" onClick={() => addRuleRow("discount", d)}>
                        {d.label} <span className="text-muted-foreground">（デザイン費の{Math.round(d.rate * 100)}%を値引き）</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <Button size="sm" variant="ghost" className="gap-1.5 text-xs h-9 text-foreground hover:bg-emerald-100 hover:text-foreground" onClick={addTextRow}>
                  <Type className="w-3.5 h-3.5" /> テキスト行（見出し・注記）
                </Button>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
                  <th className="w-6"></th>
                  <th className="text-left px-3 py-2 font-medium">名称</th>
                  <th className="text-right px-3 py-2 font-medium w-24">数量</th>
                  <th className="text-right px-3 py-2 font-medium w-16">単位</th>
                  <th className="text-right px-3 py-2 font-medium w-28">単価</th>
                  <th className="text-right px-3 py-2 font-medium w-32">金額</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-xs text-muted-foreground py-8">
                      下の「+ 明細を追加」からデザイン費・印刷費などを追加してください
                    </td>
                  </tr>
                )}
                {lineItems.map((li) => (
                  <LineItemRow
                    key={li.id}
                    item={li}
                    showInternal={showInternal}
                    isDragging={dragId === li.id}
                    onDragStart={() => setDragId(li.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => { reorderItems(dragId, li.id); setDragId(null); }}
                    onDragEnd={() => setDragId(null)}
                    onChange={patch => updateItem(li.id, patch)}
                    onRemove={() => removeItem(li.id)}
                  />
                ))}
              </tbody>
            </table>

            {estimate.additional_notes !== undefined && (
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">備考</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-[10px] text-primary hover:underline flex items-center gap-1">
                        <FileText className="w-3 h-3" /> + テンプレートを追加
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 max-h-[70vh] overflow-y-auto p-1" align="end">
                      {notesTemplates.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-3">
                          「システム設定」画面で備考テンプレートを登録できます
                        </p>
                      ) : (
                        notesTemplates.map((t, i) => (
                          <button
                            key={i}
                            onClick={() => appendNoteTemplate(t.text)}
                            className="w-full text-left px-2.5 py-2 rounded hover:bg-muted/50"
                          >
                            <p className="text-xs font-medium">{t.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{t.text}</p>
                          </button>
                        ))
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
                <textarea
                  value={estimate.additional_notes || ""}
                  onChange={e => onUpdate({ additional_notes: e.target.value })}
                  rows={3}
                  className="w-full mt-1 text-xs border rounded-md p-2 resize-none"
                  placeholder="例: ※送料は別途ご請求となる場合がございます。"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* カテゴリ別の選択ダイアログ */}
      <Dialog open={!!addPanel} onOpenChange={(open) => !open && closeAddPanel()}>
        <DialogContent className={`${addPanel === "vendor_quote" || addPanel === "web_price" ? "max-w-3xl" : "max-w-lg"} max-h-[80vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle>
              {addPanel === "vendor_quote"
                ? "仕入先見積から明細を読み込む"
                : addPanel === "web_price"
                  ? "ネット印刷の価格ページから取り込む"
                  : `${LINE_ITEM_CATEGORIES.find(c => c.key === addPanel)?.label} を追加`}
            </DialogTitle>
          </DialogHeader>

          {addPanel === "vendor_quote" && (
            <VendorQuoteImport onAdd={addItems} onClose={closeAddPanel} />
          )}

          {addPanel === "web_price" && (
            <WebPriceImport
              defaultCategory={(estimate.print_specs || []).find(sp => sp.print_type)?.print_type || ""}
              onAdd={addItems}
              onClose={closeAddPanel}
            />
          )}

          {addPanel === "design" && (
            <div className="space-y-3">
              {DESIGN_FEE_MASTER.map(cat => (
                <div key={cat.category}>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{cat.category}</p>
                  <div className="space-y-1">
                    {getDesignItemsByCategory(cat.category).map((item, i) => (
                      <button
                        key={i}
                        onClick={() => pickDesignItem(cat.category, item)}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm border rounded-md hover:bg-muted/40 text-left"
                      >
                        <span>{item.name}</span>
                        <span className="text-primary font-medium shrink-0 ml-2">¥{item.selling_price.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(addPanel === "print_paper" || addPanel === "print_nonpaper") && !priceMasterPick && (
            <div className="space-y-1.5">
              {priceMasterEntriesWithSelection
                .filter(e => e.paper_type_group === LINE_ITEM_CATEGORIES.find(c => c.key === addPanel)?.paperGroup)
                .map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setPriceMasterPick(entry)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm border rounded-md hover:bg-muted/40 text-left"
                  >
                    <div>
                      <p>{entry.category}（{entry.vendor_name}）</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{entry.spec_summary} ・ {entry.selectedCells.length}パターン選択中</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              {priceMasterEntriesWithSelection.filter(e => e.paper_type_group === LINE_ITEM_CATEGORIES.find(c => c.key === addPanel)?.paperGroup).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  選択済みの価格データがありません。「価格マスタ」画面で使うセルを選択しておいてください。
                </p>
              )}
            </div>
          )}

          {(addPanel === "print_paper" || addPanel === "print_nonpaper") && priceMasterPick && (
            <div className="space-y-2">
              <Button variant="ghost" size="sm" className="text-xs h-7 -ml-2" onClick={() => setPriceMasterPick(null)}>
                ← 一覧に戻る
              </Button>
              <p className="text-sm font-medium">{priceMasterPick.category}（{priceMasterPick.vendor_name}）</p>
              <p className="text-xs text-muted-foreground">{priceMasterPick.spec_summary} ・ 掛け率 ×{markupRateFor(rules, priceMasterPick.category)}</p>
              <div className="space-y-1">
                {priceMasterPick.selectedCells.map((cell, i) => (
                  <button
                    key={i}
                    onClick={() => pickPriceMasterCell(priceMasterPick, cell)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm border rounded-md hover:bg-muted/40"
                  >
                    <span>{cell.quantity}枚 ・ {cell.label}納期</span>
                    <span className="text-primary font-medium">
                      原価¥{(cell.price || 0).toLocaleString()} → 出し値¥{(applyMarkup(cell.price / (cell.quantity || 1), markupRateFor(rules, priceMasterPick.category)) * (cell.quantity || 1)).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(addPanel === "build" || addPanel === "other") && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">名称</Label>
                <Input value={manualForm.name} onChange={e => setManualForm({ ...manualForm, name: e.target.value })} placeholder="例: LP初期構築費" autoFocus />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">数量</Label>
                  <Input type="number" value={manualForm.quantity} onChange={e => setManualForm({ ...manualForm, quantity: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">単位</Label>
                  <Input value={manualForm.unit} onChange={e => setManualForm({ ...manualForm, unit: e.target.value })} placeholder="式" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">単価</Label>
                  <Input type="number" value={manualForm.unit_price} onChange={e => setManualForm({ ...manualForm, unit_price: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">社内の時間単価（クリックで単価に入れる）</p>
                <div className="flex flex-wrap gap-1">
                  {[
                    ["produce", "プロデュース・企画・コンサル"], ["model", "モデル対応"], ["other_work", "撮影同行サポート"],
                    ["inhouse_design", "社内デザイン"], ["inhouse_photo", "社内撮影"], ["labeling", "一括表示作成"],
                  ].filter(([k]) => Number(rules.hourly[k]) > 0).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className="text-[10px] px-2 py-1 rounded border bg-white hover:bg-muted/50"
                      onClick={() => setManualForm({ ...manualForm, name: manualForm.name || label, unit: k === "labeling" ? "商品" : "時間", unit_price: rules.hourly[k], outsourcing: "", cost: "" })}
                    >
                      {label} ¥{Number(rules.hourly[k]).toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-dashed p-2.5 space-y-2 bg-muted/20">
                <p className="text-[10px] text-muted-foreground">外注の仕入額から売価を出す（売価 = 仕入 ÷ 率、{rules.rounding.outsourcing.toLocaleString()}円単位で切り上げ）</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">外注の種類</Label>
                    <select
                      value={manualForm.outsourcing}
                      onChange={e => {
                        const kind = e.target.value;
                        const price = kind && Number(manualForm.cost) > 0 ? outsourcingPrice(rules, kind, Number(manualForm.cost)) : manualForm.unit_price;
                        setManualForm({ ...manualForm, outsourcing: kind, unit_price: price });
                      }}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">使わない</option>
                      {OUTSOURCING_KINDS.map(k => (
                        <option key={k.key} value={k.key}>{k.label}（÷{rules.outsourcing[k.key]}）</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">仕入額（税抜・単価）</Label>
                    <Input
                      type="number"
                      value={manualForm.cost}
                      onChange={e => {
                        const cost = e.target.value;
                        const price = manualForm.outsourcing && Number(cost) > 0 ? outsourcingPrice(rules, manualForm.outsourcing, Number(cost)) : manualForm.unit_price;
                        setManualForm({ ...manualForm, cost, unit_price: price });
                      }}
                      placeholder="例: 35000"
                    />
                  </div>
                </div>
              </div>
              <Button className="w-full gap-1.5" onClick={submitManual}>
                <Plus className="w-3.5 h-3.5" /> 追加
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


function LineItemRow({ item, showInternal, isDragging, onDragStart, onDragOver, onDrop, onDragEnd, onChange, onRemove }) {
  if (item.row_type === "text") {
    return (
      <tr className={`bg-muted/30 ${isDragging ? "opacity-40" : ""}`} onDragOver={onDragOver} onDrop={onDrop}>
        <td colSpan={7} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </span>
            <Input
              value={item.text || ""}
              onChange={e => onChange({ text: e.target.value })}
              placeholder="見出し・注記（例: ▼ 印刷費）"
              className="h-7 text-xs font-medium bg-transparent border-none px-0 focus-visible:ring-0"
            />
            <button onClick={onRemove} className="text-muted-foreground hover:text-destructive shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const isRule = item.source_type === "rule";
  const hasCost = item.cost_price != null;
  const lineCostTotal = hasCost ? Number(item.cost_price) * (Number(item.quantity) || 1) : 0;
  const lineProfit = hasCost ? (Number(item.amount) || 0) - lineCostTotal : 0;
  const lineProfitRate = hasCost && item.amount > 0 ? ((lineProfit / item.amount) * 100).toFixed(1) : "0.0";
  const cellInputClass = `h-7 text-xs bg-transparent border border-transparent hover:border-border focus:border-input focus-visible:ring-1 rounded px-1.5 -mx-1.5 transition-colors ${noSpinner}`;

  return (
    <>
    <tr className={`${showInternal && hasCost ? "" : "border-b"} ${isDragging ? "opacity-40" : ""}`} onDragOver={onDragOver} onDrop={onDrop}>
      <td className="px-1 py-2 align-top">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing inline-block mt-1"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>
      </td>
      <td className="px-3 py-2 align-top">
        <InlineTextCell value={item.name} onCommit={(v) => onChange({ name: v })} />
        {item.category && (
          <div className="text-[10px] text-muted-foreground mt-0.5 px-1.5 flex items-center gap-1">
            {item.category}
            {isRule && <span className="inline-flex items-center gap-0.5 text-emerald-700"><Lock className="w-2.5 h-2.5" /> {ruleRowHint(item)}</span>}
          </div>
        )}
      </td>
      {isRule ? (
        <>
          <td className="px-3 py-2 text-right align-top text-xs text-muted-foreground">1</td>
          <td className="px-3 py-2 text-right align-top text-xs text-muted-foreground">式</td>
          <td className="px-3 py-2 text-right align-top text-xs text-muted-foreground">自動</td>
        </>
      ) : (
        <>
          <td className="px-3 py-2 text-right align-top">
            <NumericField
              value={item.quantity}
              onCommit={(q) => onChange({ quantity: q, amount: q * (item.unit_price || 0) })}
              className={`${cellInputClass} text-right`}
            />
          </td>
          <td className="px-3 py-2 text-right align-top">
            <Input value={item.unit} onChange={e => onChange({ unit: e.target.value })} className={`${cellInputClass} text-right`} />
          </td>
          <td className="px-3 py-2 text-right align-top">
            <NumericField
              value={item.unit_price}
              onCommit={(p) => onChange({ unit_price: p, amount: p * (item.quantity || 1) })}
              className={`${cellInputClass} text-right`}
            />
          </td>
        </>
      )}
      <td className="px-3 py-2 text-right align-top font-medium">
        {yen(item.amount)}
      </td>
      <td className="px-2 py-2 align-top">
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
    {showInternal && hasCost && (
      <tr className="border-b">
        <td></td>
        <td colSpan={6} className="px-3 pb-2 pt-0">
          <div className="p-2.5 rounded bg-amber-50 border border-amber-100 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <div className="text-[10px] text-amber-700">
              原価 ¥{Number(item.cost_price).toLocaleString()} × {(item.quantity || 1).toLocaleString()}{item.unit || "枚"}
              <span className="mx-1.5">−</span>
              出し値 ¥{Number(item.unit_price || 0).toLocaleString()} × {(item.quantity || 1).toLocaleString()}{item.unit || "枚"}
              <span className="mx-1.5">＝</span>
              粗利 <strong>¥{lineProfit.toLocaleString()}</strong>（粗利率 <strong>{lineProfitRate}%</strong>）
            </div>
            {item.outsourcing_kind ? (
              <div className="text-[10px] text-amber-700">外注（仕入 ÷ 率で売価を算出）</div>
            ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-700">
              <span className="shrink-0">掛け率</span>
              <NumericField
                value={item.markup_rate}
                onCommit={(rate) => {
                  const unitPrice = applyMarkup(item.cost_price, rate);
                  onChange({ markup_rate: rate, unit_price: unitPrice, amount: unitPrice * (item.quantity || 1) });
                }}
                className={`h-6 w-16 text-[10px] px-1.5 bg-white shrink-0 ${noSpinner}`}
              />
              <span className="text-amber-600">変更すると自動反映</span>
            </div>
            )}
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

// 名称セル：普段は文字折り返しで全文表示し、クリックすると入力欄になる（長い名称でも切れない）
function InlineTextCell({ value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");

  if (editing) {
    return (
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => { setEditing(false); if (text !== value) onCommit(text); }}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        rows={2}
        className="w-full text-xs border border-input rounded px-1.5 py-1 resize-none focus-visible:outline-none focus-visible:ring-1"
      />
    );
  }

  return (
    <div
      onClick={() => { setText(value || ""); setEditing(true); }}
      className="text-xs px-1.5 py-1 -mx-1.5 rounded cursor-text hover:bg-muted/50 whitespace-normal break-words leading-relaxed"
    >
      {value || <span className="text-muted-foreground/50">名称を入力</span>}
    </div>
  );
}
