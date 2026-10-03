// 収入印紙（売上代金の受取書・第17号の1文書）の税額。
// 消費税を区分して書いた領収書は、税抜の金額で判定する。紙で渡すときだけ必要で、電子発行は不要。
const TABLE = [
  [50000, 0], [1000000, 200], [2000000, 400], [3000000, 600], [5000000, 1000], [10000000, 2000],
  [20000000, 4000], [30000000, 6000], [50000000, 10000], [100000000, 20000],
];
export function stampDuty(amountExTax) {
  const a = Number(amountExTax) || 0;
  if (a < 50000) return 0;
  for (const [limit, duty] of TABLE) if (a <= limit) return duty;
  return 60000; // 1 億円超は 6 万円〜（上限は 20 万円）。実務ではまず出ない
}
export function stampDutyLabel(amountExTax) {
  const d = stampDuty(amountExTax);
  return d === 0 ? "不要（税抜 5 万円未満）" : `${d.toLocaleString()}円`;
}
