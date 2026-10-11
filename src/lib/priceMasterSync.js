// ============================================================================
// 価格マスタの更新（価格を実際に調べたときに、作り直さずに上書きする）
//   ・見積の「印刷費・仕入の価格確認」で値上がり／値下がりを置き換えたとき … そのマスの価格と最終更新日
//   ・「変わりなし」と確認したとき・入稿したとき … 最終更新日だけ
//   ・スクショから読んだ価格表を登録するとき … 同じマスタがあれば価格表を上書き（見積に出すセルの選択は残す）
// ============================================================================
import { db } from "@/api/db";
import { findMaster, masterOf, vendorOf } from "@/lib/priceCheck";
import { vendorTaxMode } from "@/lib/priceTax";

const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[\s()（）［］[\]・]/g, "").replace(/株式会社|（株）|\(株\)|㈱/g, "");

/** この明細の価格マスタ（マスタから入れた行 → 入稿先 URL・仕入先と数量が同じもの → 品名と仕入先が同じもの） */
export function masterForLine(li, masters) {
  const own = masterOf(li, masters);
  if (own) return own;
  const found = findMaster(li, masters);
  if (found) return found;
  const name = norm(li.name);
  const vendor = norm(vendorOf(li, masters));
  return (masters || []).find((m) => norm(m.category) === name && (!vendor || norm(m.vendor_name) === vendor)) || null;
}

const taxModeOf = (m, printVendors) => (m.price_tax_mode === "excluded" || m.price_tax_mode === "included" ? m.price_tax_mode : vendorTaxMode(printVendors, m.vendor_name));

/**
 * 価格確認の結果（今の原価・税別 1 単位）を、価格マスタの同じ数量・同じ納期のマスに入れた価格表。該当のマスが無ければ null。
 */
export function gridWithCurrent(master, li, pc, printVendors) {
  const q = Number(li.quantity) || 0;
  const now = Number(pc?.current_cost);
  if (!q || !(now > 0)) return null;
  const grid = Array.isArray(master.price_grid) ? master.price_grid : [];
  const r = grid.findIndex((row) => Number(row.quantity) === q);
  if (r < 0) return null;
  const c = (grid[r].cells || []).findIndex((cell) => String(cell.label) === String(pc.label || ""));
  if (c < 0) return null;
  const total = now * q;
  const price = Math.round(taxModeOf(master, printVendors) === "included" ? total * 1.1 : total);
  return grid.map((row, i) => (i !== r ? row : { ...row, cells: row.cells.map((cell, j) => (j !== c ? cell : { ...cell, price })) }));
}

/** スクショから読んだ価格表を、今の価格表に重ねる（同じ数量・納期のマスの「見積に出す」選択は残す） */
export function mergeGrid(oldGrid, newGrid) {
  const sel = new Set((oldGrid || []).flatMap((row) => (row.cells || []).filter((c) => c.selected).map((c) => `${Number(row.quantity)}|${c.label}`)));
  return (newGrid || []).map((row) => ({ ...row, cells: (row.cells || []).map((c) => ({ ...c, selected: sel.has(`${Number(row.quantity)}|${c.label}`) || !!c.selected })) }));
}

/**
 * 価格確認のあと、価格マスタを今の価格にする。
 * @returns {Promise<{ action: "price" | "date" | "none", master?: object }>}
 */
export async function syncMasterFromCheck(li, pc, masters, printVendors) {
  const m = masterForLine(li, masters);
  if (!m || pc?.source === "master") return { action: "none" }; // マスタで確認した行は、マスタがすでに今の価格
  const grid = (pc?.status === "up" || pc?.status === "down" || pc?.status === "replaced") ? gridWithCurrent(m, li, pc, printVendors) : null;
  if (grid) {
    await db.entities.PriceMaster.update(m.id, { price_grid: grid, last_updated: today() });
    return { action: "price", master: m };
  }
  await db.entities.PriceMaster.update(m.id, { last_updated: today() });
  return { action: "date", master: m };
}

/** 入稿したとき: 価格マスタから入れた行なら、そのマスタの最終更新日を入稿日にする（新しくなるときだけ） */
export async function touchMasterOnOrder(masterId, orderedOn) {
  if (!masterId) return false;
  const m = await db.entities.PriceMaster.get(masterId).catch(() => null);
  const day = String(orderedOn || today()).slice(0, 10);
  if (!m || String(m.last_updated || "") >= day) return false;
  await db.entities.PriceMaster.update(m.id, { last_updated: day });
  return true;
}
