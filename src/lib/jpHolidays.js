// ============================================================================
// 日本の祝日（内閣府の「国民の祝日」の決まりから計算する。外部の API は使わない）
//   固定の祝日・ハッピーマンデー・春分／秋分の日（1980〜2099 年の近似式）・振替休日・国民の休日
//   isOffDay / nextBusinessDay は、これに土日と年末年始（12/29〜1/3）を足した「休み」で判定する
// ============================================================================

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** その月の n 番目の月曜日（日） */
function nthMonday(y, m, n) {
  const first = new Date(y, m - 1, 1).getDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

const cache = new Map();

/** その年の祝日（"yyyy-mm-dd" の Set） */
export function jpHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const base = new Set();
  const add = (m, d) => base.add(ymd(year, m, d));
  add(1, 1);                       // 元日
  add(1, nthMonday(year, 1, 2));   // 成人の日
  add(2, 11);                      // 建国記念の日
  add(2, 23);                      // 天皇誕生日
  add(3, Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))); // 春分の日
  add(4, 29);                      // 昭和の日
  add(5, 3); add(5, 4); add(5, 5); // 憲法記念日・みどりの日・こどもの日
  add(7, nthMonday(year, 7, 3));   // 海の日
  add(8, 11);                      // 山の日
  add(9, nthMonday(year, 9, 3));   // 敬老の日
  add(9, Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))); // 秋分の日
  add(10, nthMonday(year, 10, 2)); // スポーツの日
  add(11, 3);                      // 文化の日
  add(11, 23);                     // 勤労感謝の日

  const out = new Set(base);
  const key = (d) => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  // 振替休日: 祝日が日曜日なら、その後の最初の祝日でない日
  for (const s of base) {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getDay() !== 0) continue;
    const next = new Date(y, m - 1, d + 1);
    while (out.has(key(next))) next.setDate(next.getDate() + 1);
    out.add(key(next));
  }
  // 国民の休日: 前日と翌日が祝日の平日（9 月の敬老の日と秋分の日の間など）
  for (let m = 1; m <= 12; m++) {
    const days = new Date(year, m, 0).getDate();
    for (let d = 2; d < days; d++) {
      const dt = new Date(year, m - 1, d);
      if (dt.getDay() === 0 || out.has(key(dt))) continue;
      if (base.has(ymd(year, m, d - 1)) && base.has(ymd(year, m, d + 1))) out.add(key(dt));
    }
  }
  cache.set(year, out);
  return out;
}

/** 年末年始の休み（12/29〜1/3） */
export function isYearEndHoliday(date) {
  const m = date.getMonth() + 1, d = date.getDate();
  return (m === 12 && d >= 29) || (m === 1 && d <= 3);
}

/** 土日・祝日・年末年始（12/29〜1/3）か */
export function isOffDay(date) {
  const w = date.getDay();
  if (w === 0 || w === 6 || isYearEndHoliday(date)) return true;
  return jpHolidays(date.getFullYear()).has(ymd(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

/** 土日・祝日・年末年始なら、次の平日まで進めた日 */
export function nextBusinessDay(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (isOffDay(d)) d.setDate(d.getDate() + 1);
  return d;
}
