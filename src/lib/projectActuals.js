// ============================================================================
// 案件の実績（受注合計・発注合計。税抜）を、請求書・発注書・入稿記録から出す
//
//   受注合計 = この案件の分として請求した額（取消を除く。まとめた請求書は明細の案件で分ける）
//   発注合計 = 連携先への発注書（下書きを除く）の税抜合計 ＋ 入稿記録の原価（原価単価 × 数量）
//
// 案件の confirmed_revenue / confirmed_cost に書き戻して持つ（一覧・カルテでもそのまま使えるように）。
// 手で入れたときは actual_revenue_manual / actual_cost_manual を true にして、自動では上書きしない（0042）。
// ============================================================================
import { db } from "@/api/db";
import { invoiceShareFor } from "@/lib/projectInvoicing";

const n = (v) => Number(v) || 0;

/** 請求書・発注書・入稿記録から、案件の実績を計算する */
export function computeActuals(projectId, { invoices = [], partnerOrders = [], printOrders = [] }) {
  const billed = invoices.filter((inv) => inv.status !== "cancelled");
  const revenueRows = billed.map((inv) => ({ inv, amount: invoiceShareFor(inv, projectId).subtotal })).filter((r) => r.amount);
  const revenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const pos = partnerOrders.filter((po) => po.status !== "draft");
  const poCost = pos.reduce((s, po) => s + n(po.subtotal), 0);
  const prints = printOrders.filter((o) => n(o.cost_price) && n(o.quantity));
  const printCost = Math.round(prints.reduce((s, o) => s + n(o.cost_price) * n(o.quantity), 0));
  return {
    revenue: Math.round(revenue),
    revenueCount: revenueRows.length,
    cost: Math.round(poCost) + printCost,
    poCost: Math.round(poCost), poCount: pos.length,
    printCost, printCount: prints.length,
  };
}

/** 書き戻す値（手入力にしている方は触らない。変わらなければ空） */
export function actualsPatch(project, actuals) {
  const patch = {};
  if (!project.actual_revenue_manual && n(project.confirmed_revenue) !== actuals.revenue) patch.confirmed_revenue = actuals.revenue;
  if (!project.actual_cost_manual && n(project.confirmed_cost) !== actuals.cost) patch.confirmed_cost = actuals.cost;
  return patch;
}

/** 案件の請求書（自分の案件の請求書 ＋ ほかの案件にまとめられた、この案件の納品書の請求書） */
async function invoicesOf(projectId) {
  const [own, notes] = await Promise.all([
    db.entities.Invoice.filter({ project_id: projectId }),
    db.entities.DeliveryNote.filter({ project_id: projectId }),
  ]);
  const extraIds = [...new Set(notes.map((d) => d.invoice_id).filter((x) => x && !own.some((i) => i.id === x)))];
  const extra = (await Promise.all(extraIds.map((x) => db.entities.Invoice.get(x).catch(() => null)))).filter(Boolean);
  return [...own, ...extra];
}

/**
 * 案件の実績を計算し直して、案件に書き戻す（請求書・発注書・入稿記録を保存したあとに呼ぶ）。
 * 失敗しても保存そのものは止めない（実績は案件の画面を開いたときにも合わせ直す）。
 */
export async function refreshProjectActuals(projectIds) {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  for (const id of ids) {
    try {
      const project = await db.entities.Project.get(id);
      if (!project) continue;
      const [invoices, partnerOrders, printOrders] = await Promise.all([
        invoicesOf(id),
        db.entities.PartnerOrder.filter({ project_id: id }).catch(() => []),
        db.entities.PrintOrder.filter({ project_id: id }).catch(() => []),
      ]);
      const patch = actualsPatch(project, computeActuals(id, { invoices, partnerOrders, printOrders }));
      if (Object.keys(patch).length) await db.entities.Project.update(id, patch);
    } catch (err) {
      console.warn("案件の実績を合わせられませんでした", id, err);
    }
  }
}

/** 請求書がかかわる案件（請求書の案件 ＋ 明細の案件） */
export const projectIdsOfInvoice = (inv) => [inv?.project_id, ...(inv?.line_items || []).map((li) => li.project_id)].filter(Boolean);
