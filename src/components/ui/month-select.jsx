// ============================================================================
// 年月を選ぶ（「2027年」「3月」の 2 つのプルダウン）。値は "YYYY-MM"（空なら ""）。
//   ブラウザの年月の入力（type="month"）は、環境によって「March 2027」と英語で出るので、数字で選べるようにする。
//   allowEmpty: 「指定なし」を選べる（終了月など）。min / max: "YYYY-MM"（その外の月は選べない）
//   monthSuffix: 月の選択肢の後ろの字（既定「月」。後ろに「月分まで」と続けるときは ""）
// ============================================================================
const pad = (n) => String(n).padStart(2, "0");
const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export default function MonthSelect({ value = "", onChange, min = "", max = "", allowEmpty = false, emptyLabel = "指定なし", className = "", ariaLabel = "年月", yearsBack = 5, yearsAhead = 5, disabled = false, monthSuffix = "月" }) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const [y, m] = /^\d{4}-\d{2}$/.test(value || "") ? [Number(value.slice(0, 4)), Number(value.slice(5, 7))] : [null, null];
  const minY = min ? Number(min.slice(0, 4)) : null;
  const maxY = max ? Number(max.slice(0, 4)) : null;
  let from = Math.min(thisYear - yearsBack, y ?? thisYear);
  let to = Math.max(thisYear + yearsAhead, y ?? thisYear);
  if (minY) from = Math.max(from, minY);
  if (maxY) to = Math.min(to, maxY);
  const years = [];
  for (let i = from; i <= to; i++) years.push(i);
  const outOfRange = (yy, mm) => (min && `${yy}-${pad(mm)}` < min) || (max && `${yy}-${pad(mm)}` > max);
  // 範囲の外にならない月に寄せる
  const clamp = (yy, mm) => {
    if (min && `${yy}-${pad(mm)}` < min) return min;
    if (max && `${yy}-${pad(mm)}` > max) return max;
    return `${yy}-${pad(mm)}`;
  };

  const setYear = (v) => {
    if (v === "") { onChange(""); return; }
    onChange(clamp(Number(v), m ?? now.getMonth() + 1));
  };
  const setMonth = (v) => onChange(clamp(y ?? thisYear, Number(v)));

  return (
    <div className={`flex items-center gap-1 ${className}`} role="group" aria-label={ariaLabel}>
      <select value={y ?? ""} onChange={(e) => setYear(e.target.value)} className={SELECT} aria-label={`${ariaLabel}（年）`} disabled={disabled}>
        {(allowEmpty || y === null) && <option value="">{allowEmpty ? emptyLabel : "—"}</option>}
        {years.map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
      </select>
      <select value={m ?? ""} onChange={(e) => setMonth(e.target.value)} className={SELECT} aria-label={`${ariaLabel}（月）`} disabled={disabled || y === null}>
        {m === null && <option value="">—</option>}
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm} disabled={y !== null && !!outOfRange(y, mm)}>{mm}{monthSuffix}</option>)}
      </select>
    </div>
  );
}
