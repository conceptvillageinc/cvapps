import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { CalendarClock, Loader2 } from "lucide-react";
import { todayString, nextMonthEnd } from "@/lib/fiscal";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
// 売上粗利管理表と同じ配色（青=確定 / オレンジ=見込 / 赤=支払 / 緑=実績・差引）
const C = { receivable: "#2a78d6", forecast: "#eb6834", payable: "#d64545", paid: "#1baf7a", net: "#1f2937", grid: "#e5e7eb", text: "#52514e" };

function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto tabular-nums">¥{Math.round(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/** 月別の入金・支払のグラフ（表と同じ数字。月別＝その月の入出金、累計＝差引の積み上がり） */
function CashflowChart({ months, thisMonth }) {
  const [mode, setMode] = useState("monthly"); // monthly | cumulative
  const data = useMemo(() => {
    let cum = 0;
    return months.map((m) => {
      cum += m.net;
      return {
        label: `${Number(m.key.slice(5, 7))}月${m.key === thisMonth ? "（今月）" : ""}`,
        "入金予定（請求済）": m.sum_receivable,
        "入金見込（未請求）": m.sum_forecast,
        "支払予定": -m.sum_payable,
        "入金実績": m.sum_paid,
        "差引": m.net,
        "差引の累計": cum,
      };
    });
  }, [months, thisMonth]);
  const empty = months.every((m) => !m.sum_receivable && !m.sum_forecast && !m.sum_payable && !m.sum_paid);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-sm">{mode === "monthly" ? "月別の入金予定・支払予定" : "差引の累計（入金 − 支払の積み上がり）"}</CardTitle>
            <CardDescription className="text-xs">税込・円。上向きが入金（請求済＋未請求の見込）、下向きが支払予定。線は{mode === "monthly" ? "その月の差引" : "差引を今月から積み上げた額"}</CardDescription>
          </div>
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="h-8">
              <TabsTrigger value="monthly" className="text-xs h-7">月別</TabsTrigger>
              <TabsTrigger value="cumulative" className="text-xs h-7">累計</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72" data-testid="cashflow-chart">
          {empty ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">この期間に入金・支払の予定はありません</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%" stackOffset="sign">
                <CartesianGrid vertical={false} stroke={C.grid} strokeWidth={1} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.text }} axisLine={{ stroke: C.grid }} tickLine={false} />
                <YAxis tickFormatter={(v) => `${Math.round(v / 10000).toLocaleString()}万`} tick={{ fontSize: 11, fill: C.text }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke={C.text} strokeWidth={1} />
                <Bar dataKey="入金予定（請求済）" stackId="c" fill={C.receivable} maxBarSize={28} />
                <Bar dataKey="入金見込（未請求）" stackId="c" fill={C.forecast} maxBarSize={28} radius={[4, 4, 0, 0]} />
                <Bar dataKey="支払予定" stackId="c" fill={C.payable} maxBarSize={28} radius={[0, 0, 4, 4]} />
                <Bar dataKey="入金実績" fill={C.paid} maxBarSize={12} radius={[4, 4, 0, 0]} />
                {mode === "monthly"
                  ? <Line type="linear" dataKey="差引" stroke={C.net} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                  : <Line type="linear" dataKey="差引の累計" stroke={C.net} strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
const ym = (d) => (d ? String(d).slice(0, 7) : null);
const label = (k) => `${k.slice(0, 4)}年${Number(k.slice(5, 7))}月`;

function addMonths(ymKey, n) {
  const [y, m] = ymKey.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 入出金予定表: 請求書の入金期日と案件の支払予定日から、月別の入金・出金の予定を出す。
 */
export default function Cashflow() {
  const [span, setSpan] = useState(6);
  const today = todayString();
  const thisMonth = today.slice(0, 7);

  const { data: invoices = [], isLoading } = useQuery({ queryKey: ["invoices", "all"], queryFn: () => db.entities.Invoice.list("-invoice_date") });
  const { data: projects = [] } = useQuery({ queryKey: ["projects", "all"], queryFn: () => db.entities.Project.list("-registered_at") });

  const data = useMemo(() => {
    const months = Array.from({ length: span }, (_, i) => addMonths(thisMonth, i));
    const rows = new Map(months.map((k) => [k, { key: k, receivable: [], forecast: [], payable: [], paid: [] }]));
    const overdue = [];

    const invoicedByProject = new Map();
    for (const inv of invoices) {
      if (inv.status === "cancelled") continue;
      if (inv.project_id) invoicedByProject.set(inv.project_id, (invoicedByProject.get(inv.project_id) || 0) + Number(inv.total || 0));
      if (inv.status === "paid") {
        const k = ym(inv.paid_at);
        if (rows.has(k)) rows.get(k).paid.push(inv);
        continue;
      }
      // 未入金: 入金期日の月へ。期日が過ぎたものは「期日超過」
      const due = inv.due_date || nextMonthEnd(inv.invoice_date);
      if (due < today) { overdue.push(inv); continue; }
      const k = ym(due);
      if (rows.has(k)) rows.get(k).receivable.push(inv);
    }

    for (const p of projects) {
      if (p.status !== "open") continue;
      const prob = p.deal_probability || "";
      if (!(prob === "A" || prob === "A（定期売上）" || /要注意/.test(prob))) continue;
      // 未請求の見込（税込換算）
      const remaining = Math.max(0, Math.round(Number(p.expected_revenue || 0) * 1.1) - (invoicedByProject.get(p.id) || 0));
      const payKey = ym(p.payment_due_date || nextMonthEnd(p.due_date || p.registered_at));
      if (remaining > 0 && rows.has(payKey)) rows.get(payKey).forecast.push({ ...p, remaining });
      // 支払予定（仕入）
      const cost = Math.round((Number(p.expected_cost || 0) + Number(p.other_cost || 0)) * 1.1);
      const vendorKey = ym(p.vendor_payment_date || nextMonthEnd(p.due_date || p.registered_at));
      if (cost > 0 && rows.has(vendorKey)) rows.get(vendorKey).payable.push({ ...p, cost });
    }

    const list = months.map((k) => {
      const r = rows.get(k);
      const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
      const receivable = sum(r.receivable, (i) => i.total);
      const forecast = sum(r.forecast, (p) => p.remaining);
      const payable = sum(r.payable, (p) => p.cost);
      const paid = sum(r.paid, (i) => i.paid_amount ?? i.total);
      return { ...r, sum_receivable: receivable, sum_forecast: forecast, sum_payable: payable, sum_paid: paid, receivable_n: r.receivable.length, net: receivable + forecast - payable };
    });
    const overdueTotal = overdue.reduce((s, i) => s + Number(i.total || 0), 0);
    return { months: list, overdue, overdueTotal };
  }, [invoices, projects, span, thisMonth, today]);

  const totals = data.months.reduce((a, m) => ({ receivable: a.receivable + m.sum_receivable, forecast: a.forecast + m.sum_forecast, payable: a.payable + m.sum_payable, net: a.net + m.net }), { receivable: 0, forecast: 0, payable: 0, net: 0 });

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><CalendarClock className="w-5 h-5" /> 入出金予定表</h1>
          <p className="text-sm text-muted-foreground mt-0.5">請求書の入金期日と案件の支払予定日から、今後の入金・出金を月別に見ます（税込）</p>
        </div>
        <div className="flex gap-1">
          {[3, 6, 12].map((n) => <Button key={n} size="sm" variant={span === n ? "default" : "outline"} className="text-xs" onClick={() => setSpan(n)}>{n}ヶ月</Button>)}
        </div>
      </div>

      {data.overdue.length > 0 && (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-800">期日超過の未入金 {data.overdue.length}件　{yen(data.overdueTotal)}</CardTitle>
            <CardDescription className="text-xs">入金確認で照合するか、請求書から「入金済にする」で記録してください</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.overdue.slice(0, 20).map((inv) => (
              <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center gap-3 text-xs hover:underline">
                <span className="font-mono text-muted-foreground w-28 shrink-0">{inv.invoice_number}</span>
                <span className="text-muted-foreground w-20 shrink-0">期日 {inv.due_date || "—"}</span>
                <span className="truncate flex-1">{inv.client_name} / {inv.title}</span>
                <span className="tabular-nums">{yen(inv.total)}</span>
              </Link>
            ))}
            {data.overdue.length > 20 && <p className="text-[10px] text-muted-foreground">他 {data.overdue.length - 20}件（請求書一覧の「期日超過」で確認）</p>}
          </CardContent>
        </Card>
      )}

      {!isLoading && <CashflowChart months={data.months} thisMonth={thisMonth} />}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">月</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">入金予定（請求済）</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">入金見込（未請求の案件）</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">支払予定（仕入見込）</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">差引</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">入金実績</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.key} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{label(m.key)}{m.key === thisMonth && <Badge variant="outline" className="ml-1 text-[9px] font-normal">今月</Badge>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{yen(m.sum_receivable)}{m.receivable_n > 0 && <span className="text-muted-foreground ml-1">({m.receivable_n}件)</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{yen(m.sum_forecast)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-700">{m.sum_payable ? `-${yen(m.sum_payable)}` : "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${m.net < 0 ? "text-red-700" : ""}`}>{yen(m.net)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{m.sum_paid ? yen(m.sum_paid) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/30 font-medium">
                    <td className="px-3 py-2">合計（{span}ヶ月）</td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(totals.receivable)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(totals.forecast)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">-{yen(totals.payable)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${totals.net < 0 ? "text-red-700" : ""}`}>{yen(totals.net)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {data.months.map((m) => (
          <details key={m.key} className="text-xs border rounded-md px-3 py-2 bg-background">
            <summary className="cursor-pointer font-medium">{label(m.key)} の内訳　入金 {m.receivable.length + m.forecast.length}件 ／ 支払 {m.payable.length}件</summary>
            <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">入金</p>
                {m.receivable.map((inv) => (
                  <Link key={inv.id} to={`/invoices/${inv.id}`} className="flex items-center gap-2 hover:underline">
                    <Badge variant="outline" className="text-[9px] font-normal">請求済</Badge>
                    <span className="text-muted-foreground w-20 shrink-0">{inv.due_date}</span>
                    <span className="truncate flex-1">{inv.client_name} / {inv.title}</span>
                    <span className="tabular-nums">{yen(inv.total)}</span>
                  </Link>
                ))}
                {m.forecast.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-2 hover:underline text-muted-foreground">
                    <Badge variant="outline" className="text-[9px] font-normal">見込</Badge>
                    <span className="w-20 shrink-0">{p.payment_due_date || "—"}</span>
                    <span className="truncate flex-1">{p.client_name} / {p.name}</span>
                    <span className="tabular-nums">{yen(p.remaining)}</span>
                  </Link>
                ))}
                {m.receivable.length + m.forecast.length === 0 && <p className="text-muted-foreground">なし</p>}
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">支払（案件の発注見込・その他費用）</p>
                {m.payable.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-2 hover:underline">
                    <span className="text-muted-foreground w-20 shrink-0">{p.vendor_payment_date || "（既定）"}</span>
                    <span className="truncate flex-1">{p.client_name} / {p.name}</span>
                    <span className="tabular-nums text-red-700">-{yen(p.cost)}</span>
                  </Link>
                ))}
                {m.payable.length === 0 && <p className="text-muted-foreground">なし</p>}
              </div>
            </div>
          </details>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        入金予定は請求書の入金期日（未設定なら請求日の翌月末）、未請求の案件は入金予定日（既定: 完了予定日の翌月末）、支払予定は案件の「仕入先 支払予定日」（未設定なら完了予定日の翌月末）で集計しています。案件の日付は案件詳細の「編集」で変更できます。
      </p>
    </div>
  );
}
