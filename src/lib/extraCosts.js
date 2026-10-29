// 見積外の原価（projects.extra_costs）の合計（税抜）。合計は「その他費用」に足し込んで持つ（ExtraCostsCard.jsx）
export const extraCostsTotal = (rows) => (Array.isArray(rows) ? rows : []).reduce((s, r) => s + (Number(r?.amount) || 0), 0);
