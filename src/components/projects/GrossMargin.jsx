// 案件の粗利率の表示（案件の画面・案件の編集で使う）
//   MarginBadge … 「粗利率 69%」の小さな札（プラスは緑・マイナスは赤）
//   MarginBar   … 受注を 100% とした横棒（発注・その他費用・粗利の割合）

/** 粗利率（%・整数）。受注が 0 以下のときは null（出さない） */
export function marginRate(gross, revenue) {
  const r = Number(revenue) || 0;
  if (r <= 0) return null;
  return Math.round(((Number(gross) || 0) / r) * 100);
}

export function MarginBadge({ gross, revenue, className = "", testId }) {
  const rate = marginRate(gross, revenue);
  if (rate === null) return null;
  const tone = rate < 0
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ${tone} ${className}`} data-testid={testId}>
      <span className="text-[10px] font-normal opacity-80">粗利率</span>{rate < 0 ? `−${-rate}` : rate}%
    </span>
  );
}

/**
 * 受注を 100% とした横棒。costs は [{ label, value }]（発注・その他費用など）。
 * 費用が受注を超える（赤字）ときは、棒全体を赤にして「赤字」と出す。
 */
export function MarginBar({ revenue, costs, className = "", testId }) {
  const r = Number(revenue) || 0;
  if (r <= 0) return null;
  const parts = costs.map((c) => ({ ...c, value: Math.max(0, Number(c.value) || 0) }));
  const totalCost = parts.reduce((s, c) => s + c.value, 0);
  const gross = r - totalCost;
  const pct = (v) => Math.round((v / r) * 100);
  const shades = ["bg-slate-400", "bg-slate-300", "bg-slate-200"];
  const dots = ["bg-slate-400", "bg-slate-300", "bg-slate-200"];

  if (gross < 0) {
    return (
      <div className={className} data-testid={testId}>
        <div className="h-2 w-full rounded-full bg-rose-400" />
        <p className="mt-1 text-[10px] text-rose-700 tabular-nums">赤字：費用が受注を {pct(-gross)}% 上回っています</p>
      </div>
    );
  }
  const shown = parts.filter((c) => c.value > 0);
  return (
    <div className={className} data-testid={testId}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" title={`受注を 100% としたときの割合`}>
        {/* 粗利（緑）を左から。そのあとに費用 */}
        {gross > 0 && <div className="bg-emerald-500" style={{ width: `${(gross / r) * 100}%` }} />}
        {parts.map((c, i) => c.value > 0 && <div key={c.label} className={shades[i % shades.length]} style={{ width: `${(c.value / r) * 100}%` }} />)}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><span className="h-2 w-2 rounded-sm bg-emerald-500" />粗利 {pct(gross)}%</span>
        {shown.map((c) => (
          <span key={c.label} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-sm ${dots[parts.indexOf(c) % dots.length]}`} />{c.label} {pct(c.value)}%</span>
        ))}
      </p>
    </div>
  );
}
