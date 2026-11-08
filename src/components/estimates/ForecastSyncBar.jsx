import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Switch } from "@/components/ui/switch";
import { TrendingUp } from "lucide-react";
import { forecastLines, forecastSources, sumLines } from "@/lib/projectForecast";

// ============================================================================
// 見積の画面: 「案件の見込みに自動で入れる」
//   オンにすると、明細の「見込」にチェックした行の金額（税抜）と原価×数量を、案件の受注見込・発注見込に入れる。
//   明細を直すたびに（入力が落ち着いたら）案件の見込みも入れ直す。
//   入れ元は案件の forecast_source に残す（案件の画面の「見積から見込みを入れる」と同じ形。この見積の分に auto: true）。
//   ほかの見積から入れた分があれば、その分も足したまま残す。
//   案件の見込みがまだ空なら、最初からオンにする（明細が入った時点で）。
// ============================================================================

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;
const SYNC_DELAY = 1500;

/** この見積で「見込」にチェックした行 */
export function forecastPicked(estimate) {
  const byId = new Map((estimate?.line_items || []).map((li) => [li.id, li]));
  const lines = forecastLines(estimate);
  const ids = lines.filter((l) => !byId.get(l.id)?.forecast_exclude).map((l) => l.id);
  return { lines, ids, sums: sumLines(lines, ids) };
}

export default function ForecastSyncBar({ estimate, project, user }) {
  const qc = useQueryClient();
  const { data: projectEstimates = [] } = useQuery({
    queryKey: ["estimates", "byProject", project.id],
    queryFn: () => db.entities.Estimate.filter({ project_id: project.id }, "-created_date"),
  });
  const fs = project.forecast_source;
  const sources = forecastSources(fs);
  const mine = sources.find((s) => s.estimate_id === estimate.id);
  const auto = !!mine?.auto;
  const picked = useMemo(() => forecastPicked(estimate), [estimate]);
  // ほかの見積から入れた分（いまの見積の内容で数え直す）
  const others = useMemo(() => {
    const list = sources.filter((s) => s.estimate_id !== estimate.id);
    let revenue = 0, cost = 0;
    for (const s of list) {
      const est = projectEstimates.find((e) => e.id === s.estimate_id);
      if (!est) continue;
      const now = sumLines(forecastLines(est), s.line_ids || []);
      revenue += now.revenue; cost += now.cost;
    }
    return { list, revenue, cost };
  }, [sources, projectEstimates, estimate.id]);
  const total = { revenue: picked.sums.revenue + others.revenue, cost: picked.sums.cost + others.cost };
  const gross = total.revenue - total.cost - (Number(project.other_cost) || 0);

  const write = async (on, { silent = false } = {}) => {
    const entry = {
      estimate_id: estimate.id, estimate_number: estimate.estimate_number || "",
      line_ids: picked.ids, unchecked_ids: picked.lines.filter((l) => !picked.ids.includes(l.id)).map((l) => l.id), auto: on,
    };
    const patch = on
      ? {
          expected_revenue: total.revenue, expected_cost: total.cost,
          forecast_source: { sources: [...others.list, entry], revenue: total.revenue, cost: total.cost, applied_at: new Date().toISOString(), applied_by: user?.full_name || user?.email || "", dismissed_sig: null },
        }
      // オフにしたときは金額はそのまま、自動で入れ直すのだけ止める
      : { forecast_source: { ...(fs || {}), sources: sources.map((s) => (s.estimate_id === estimate.id ? { ...s, auto: false } : s)) } };
    try {
      await db.entities.Project.update(project.id, patch);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (!silent) toast.success(on ? `案件の見込みに入れました（受注見込 ${yen(total.revenue)}・発注見込 ${yen(total.cost)}）。明細を直すと自動で入れ直します` : "案件の見込みへの自動入力を止めました（いまの金額はそのまま）");
    } catch (err) {
      toast.error("案件の見込みを入れられませんでした: " + (err?.message || "不明なエラー"));
    }
  };

  // 案件の見込みがまだ空（どの見積からも入れていない・金額も 0）なら、明細が入った時点で最初からオンにする
  const autoStarted = useRef(false);
  const emptyForecast = sources.length === 0 && !(Number(project.expected_revenue) > 0) && !(Number(project.expected_cost) > 0);
  useEffect(() => {
    if (autoStarted.current || !emptyForecast || picked.lines.length === 0) return;
    autoStarted.current = true;
    write(true, { silent: true });
  }, [emptyForecast, picked.lines.length]);

  // オンのあいだは、明細が変わったら入れ直す（入力が落ち着いてから）
  const timer = useRef(null);
  const sig = `${picked.ids.join(",")}|${total.revenue}|${total.cost}`;
  const savedSig = mine ? `${(mine.line_ids || []).join(",")}|${Number(project.expected_revenue) || 0}|${Number(project.expected_cost) || 0}` : "";
  useEffect(() => {
    if (!auto || sig === savedSig) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => write(true, { silent: true }), SYNC_DELAY);
    return () => clearTimeout(timer.current);
  }, [auto, sig, savedSig]);

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5 ${auto ? "border-emerald-200 bg-emerald-50/60" : "bg-white"}`} data-testid="forecast-sync-bar">
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <Switch checked={auto} onCheckedChange={(v) => write(v)} data-testid="forecast-sync-toggle" />
        <TrendingUp className={`h-4 w-4 ${auto ? "text-emerald-700" : "text-muted-foreground"}`} />
        案件 {project.project_number} の見込みに自動で入れる
      </label>
      {auto ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums" data-testid="forecast-sync-sums">
          <span>受注見込 <b className="text-sm">{yen(total.revenue)}</b></span>
          <span>発注見込 <b className="text-sm">{total.cost > 0 ? "−" : ""}{yen(total.cost)}</b></span>
          <span>粗利見込 <b className={`text-sm ${gross < 0 ? "text-destructive" : "text-emerald-700"}`}>{gross < 0 ? `−${yen(-gross)}` : yen(gross)}</b></span>
          <span className="text-muted-foreground">この見積の明細 {picked.ids.length}／{picked.lines.length} 行（行の右の「見込」で選べます）{others.list.length > 0 && `・ほかの見積 ${others.list.map((s) => s.estimate_number).filter(Boolean).join("・")} の分 ${yen(others.revenue)} も含みます`}</span>
        </div>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          オンにすると、明細で選んだ行の金額（税抜）と原価が、案件の受注見込・発注見込に入ります。明細を直すたびに自動で入れ直します
          {mine && "（いまはこの見積から入れた金額のまま、自動では入れ直しません）"}
        </span>
      )}
    </div>
  );
}
