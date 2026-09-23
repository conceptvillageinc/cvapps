import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Target, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearLabel, todayString } from "@/lib/fiscal";
import { buildSalesReport, emptyTargets, splitAnnual } from "@/lib/salesReport";

// 検証済みの配色（dataviz の基準パレット: 青 / オレンジ / アクア / 黄）
const C = { actual: "#2a78d6", forecast: "#eb6834", target: "#1baf7a", must: "#eda100", grid: "#e5e7eb", text: "#52514e" };

const yen = (v) => (v === null || v === undefined ? "—" : `${Math.round(Number(v)).toLocaleString()}`);
const man = (v) => `${Math.round(Number(v) / 10000).toLocaleString()}万`;
const pct = (v) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
const noSpinner = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

function Cell({ v, kind = "yen", warn, ok, muted }) {
  const text = kind === "pct" ? pct(v) : yen(v);
  const neg = kind === "yen" && Number(v) < 0;
  const cls = warn ? "text-red-700 font-medium" : ok ? "text-emerald-700 font-medium" : neg ? "text-red-700" : muted ? "text-muted-foreground" : "";
  return <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${cls}`}>{text}</td>;
}

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

/** 期の目標を編集する（年額→月割り、または月ごと） */
function TargetsDialog({ open, onOpenChange, fiscalYear, months, targets, onSaved }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [annual, setAnnual] = useState({ sales: "", purchase: "", gross_jump: "", gross_must: "" });

  // 開いたときに現在の目標を読み込む（ボタンから開いても効くように effect で）
  useEffect(() => {
    if (open) init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fiscalYear, targets?.id]);

  const init = () => {
    const t = targets || emptyTargets(fiscalYear);
    setForm({
      sales: Array.from({ length: 12 }, (_, i) => t.sales?.[i] ?? 0),
      purchase: Array.from({ length: 12 }, (_, i) => t.purchase?.[i] ?? 0),
      gross_jump: Array.from({ length: 12 }, (_, i) => t.gross_jump?.[i] ?? 0),
      gross_must: Array.from({ length: 12 }, (_, i) => t.gross_must?.[i] ?? 0),
      actual_purchase: Array.from({ length: 12 }, (_, i) => t.actual_purchase?.[i] ?? null),
      actual_other_cost: Array.from({ length: 12 }, (_, i) => t.actual_other_cost?.[i] ?? null),
    });
    setAnnual({ sales: "", purchase: "", gross_jump: "", gross_must: "" });
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = { fiscal_year: fiscalYear, ...form };
      if (targets?.id) return db.entities.FiscalTarget.update(targets.id, payload);
      return db.entities.FiscalTarget.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscalTargets"] });
      toast.success("目標を保存しました");
      onOpenChange(false);
      onSaved?.();
    },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const rowsDef = [
    ["sales", "売上目標"], ["purchase", "仕入目標"], ["gross_jump", "目標粗利（ジャンプ）"], ["gross_must", "必達粗利"],
  ];
  const actualDef = [["actual_purchase", "実績 仕入（空欄=銀行明細の出金）"], ["actual_other_cost", "実績 その他原価（クレカ等）"]];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{fiscalYearLabel(fiscalYear)} の目標</DialogTitle>
          <DialogDescription className="text-xs">金額はすべて税別（税抜）で入力してください。年額を入れて「月割り」を押すと12等分します。月ごとに直接直すこともできます。目標粗利は「売上目標 − 仕入目標」で計算されます</DialogDescription>
        </DialogHeader>
        {form && (
          <div className="space-y-4 min-w-0 max-w-full">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {rowsDef.map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <Label className="text-[10px]">{label}（年額）</Label>
                  <div className="flex gap-1">
                    <Input type="number" value={annual[k]} onChange={(e) => setAnnual({ ...annual, [k]: e.target.value })} className={`h-8 text-xs text-right ${noSpinner}`} placeholder={String(form[k].reduce((s, v) => s + Number(v || 0), 0))} />
                    <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={() => setForm({ ...form, [k]: splitAnnual(Number(annual[k]) || 0) })} disabled={annual[k] === ""}>月割り</Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto border rounded-md max-w-full">
              <table className="text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap w-48"></th>
                    {months.map((m) => <th key={m.key} className="px-1 py-1.5 text-right font-medium whitespace-nowrap">{m.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...rowsDef, ...actualDef].map(([k, label]) => (
                    <tr key={k} className="border-t">
                      <td className="px-2 py-1 whitespace-nowrap">{label}</td>
                      {months.map((m, i) => (
                        <td key={m.key} className="px-0.5 py-0.5">
                          <Input
                            type="number"
                            value={form[k][i] ?? ""}
                            onChange={(e) => setForm({ ...form, [k]: form[k].map((v, j) => (j === i ? (e.target.value === "" ? (k.startsWith("actual") ? null : 0) : Number(e.target.value)) : v)) })}
                            className={`h-7 text-[11px] text-right px-1 w-24 ${noSpinner}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={() => save.mutate()} disabled={!form || save.isPending} className="gap-1.5">{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} 保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesReport() {
  const { fiscalYearStartMonth, grossMarginTarget } = useSystemSettings();
  const currentFy = fiscalYearOf(todayString(), fiscalYearStartMonth);
  const [fiscalYear, setFiscalYear] = useState(String(currentFy));
  const [chart, setChart] = useState("sales"); // sales | gross
  const [targetsOpen, setTargetsOpen] = useState(false);
  const fy = Number(fiscalYear);

  const { data: projects = [] } = useQuery({ queryKey: ["projects", "all"], queryFn: () => db.entities.Project.list("-registered_at") });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices", "all"], queryFn: () => db.entities.Invoice.list("-invoice_date") });
  const { data: bankTxs = [] } = useQuery({ queryKey: ["bankTransactions"], queryFn: () => db.entities.BankTransaction.list("-transaction_date", 1000) });
  const { data: targetRows = [], isLoading } = useQuery({ queryKey: ["fiscalTargets"], queryFn: () => db.entities.FiscalTarget.list() });
  const targets = targetRows.find((t) => Number(t.fiscal_year) === fy) || null;

  const report = useMemo(
    () => buildSalesReport({ fiscalYear: fy, startMonth: fiscalYearStartMonth, projects, invoices, bankTxs, targets, marginTarget: grossMarginTarget }),
    [fy, fiscalYearStartMonth, projects, invoices, bankTxs, targets, grossMarginTarget],
  );
  const { rows, annual, months } = report;
  const hasTargets = !!targets && annual.target.sales > 0;
  const years = [];
  for (let y = currentFy + 1; y >= currentFy - 3; y--) years.push(y);

  const chartData = rows.map((r) => ({
    label: r.label,
    実績売上: r.actual.sales,
    見込売上: r.forecast.sales,
    目標売上: r.target.sales,
    粗利計: r.total.gross,
    目標粗利: r.target.gross,
    必達粗利: r.target.gross_must,
    ジャンプ目標: r.target.gross_jump,
  }));

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><BarChart3 className="w-5 h-5" /> 売上粗利管理表</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {fiscalYearLabel(fy, fiscalYearStartMonth)}　粗利率の目標 {pct(grossMarginTarget)}（システム設定で変更可）　※金額はすべて税別（税抜）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={fiscalYear} onValueChange={setFiscalYear}>
            <SelectTrigger className="h-9 w-[230px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)} className="text-xs">{fiscalYearLabel(y, fiscalYearStartMonth)}{y === currentFy ? "　今期" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant={hasTargets ? "outline" : "default"} className="gap-2" onClick={() => setTargetsOpen(true)}>
            <Target className="w-4 h-4" /> {hasTargets ? "目標を編集" : "目標を設定"}
          </Button>
        </div>
      </div>

      {/* 要約 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["売上（実績＋見込）", annual.total.sales, `目標 ${man(annual.target.sales)}`],
          ["粗利（実績＋見込）", annual.total.gross, `目標 ${man(annual.target.gross)} / 必達 ${man(annual.target.gross_must)}`],
          ["粗利率", annual.total.margin, null, "pct"],
          ["必要粗利（目標まで）", annual.total.need_gross, annual.total.need_gross >= 0 ? "達成" : "不足"],
        ].map(([label, value, sub, kind]) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold tabular-nums ${kind === "pct" ? (annual.total.margin_ok === false ? "text-red-700" : "text-emerald-700") : Number(value) < 0 ? "text-red-700" : ""}`}>
                {kind === "pct" ? pct(value) : `¥${yen(value)}`}
              </p>
              {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* グラフ */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-sm">{chart === "sales" ? "月別の売上（実績・見込）と目標" : "月別の粗利（実績＋見込）と目標"}</CardTitle>
              <CardDescription className="text-xs">税別・円。実績は請求書、見込は案件（請求済み分を除く）から</CardDescription>
            </div>
            <Tabs value={chart} onValueChange={setChart}>
              <TabsList className="h-8">
                <TabsTrigger value="sales" className="text-xs h-7">売上</TabsTrigger>
                <TabsTrigger value="gross" className="text-xs h-7">粗利</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke={C.grid} strokeWidth={1} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.text }} axisLine={{ stroke: C.grid }} tickLine={false} />
                <YAxis tickFormatter={(v) => `${Math.round(v / 10000).toLocaleString()}万`} tick={{ fontSize: 11, fill: C.text }} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke={C.grid} />
                {chart === "sales" ? (
                  <>
                    <Bar dataKey="実績売上" stackId="s" fill={C.actual} maxBarSize={24} />
                    <Bar dataKey="見込売上" stackId="s" fill={C.forecast} maxBarSize={24} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="目標売上" stroke={C.target} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                  </>
                ) : (
                  <>
                    <Bar dataKey="粗利計" fill={C.actual} maxBarSize={24} radius={[4, 4, 0, 0]} />
                    {/* 凡例・線の順は 必達 → 目標 → ジャンプ（低い順） */}
                    <Line type="monotone" dataKey="必達粗利" stroke={C.forecast} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                    <Line type="monotone" dataKey="目標粗利" stroke={C.target} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                    <Line type="monotone" dataKey="ジャンプ目標" stroke={C.must} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {!hasTargets && <p className="text-xs text-amber-700 mt-2">この期の目標が未設定です。「目標を設定」から売上・仕入・必達粗利などを入れると、必要売上・必要粗利が計算されます</p>}
        </CardContent>
      </Card>

      {/* 表 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">管理表（税別・円）</CardTitle>
          <CardDescription className="text-xs">粗利率は目標（{pct(grossMarginTarget)}）以上を緑、未満を赤で表示。必要売上・必要粗利はマイナスが不足</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-2 py-1.5 text-left font-medium w-16"></th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap w-44"></th>
                    {months.map((m) => <th key={m.key} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{m.label}</th>)}
                    <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap bg-slate-700">年計</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["目標", [
                      ["売上", "target", "sales"], ["仕入", "target", "purchase"], ["必達粗利", "target", "gross_must"],
                      ["目標粗利", "target", "gross"], ["目標粗利（ジャンプ）", "target", "gross_jump"], ["粗利率", "target", "margin", "pct"],
                    ]],
                    ["着地見込", [
                      ["売上（案件見込 A）", "forecast", "sales_a"], ["売上（要注意A）", "forecast", "sales_a2"],
                      ["発注見込 A", "forecast", "cost_a"], ["発注見込（要注意）", "forecast", "cost_a2"],
                      ["粗利", "forecast", "gross"], ["粗利率", "forecast", "margin", "pct"],
                      ["うち定期売上", "forecast", "recurring", "yen", true],
                      ["必要売上", "forecast", "need_sales"], ["必要粗利（必達）", "forecast", "need_gross_must"], ["必要粗利（目標）", "forecast", "need_gross"], ["必要粗利（ジャンプ）", "forecast", "need_gross_jump"],
                    ]],
                    ["実績", [
                      ["売上（請求）", "actual", "sales"], ["調達（仕入）", "actual", "purchase"], ["その他原価", "actual", "other_cost"],
                      ["粗利", "actual", "gross"], ["粗利率", "actual", "margin", "pct"],
                      ["必要売上", "actual", "need_sales"], ["必要粗利（必達）", "actual", "need_gross_must"], ["必要粗利（目標）", "actual", "need_gross"], ["必要粗利（ジャンプ）", "actual", "need_gross_jump"],
                    ]],
                    ["計", [
                      ["売上", "total", "sales"], ["仕入", "total", "purchase"], ["粗利", "total", "gross"], ["粗利率", "total", "margin", "pct"],
                      ["必要売上（目標）", "total", "need_sales"], ["必要粗利（必達）", "total", "need_gross_must"], ["必要粗利（目標）", "total", "need_gross"], ["必要粗利（ジャンプ）", "total", "need_gross_jump"],
                    ]],
                  ].map(([block, defs]) => defs.map(([label, b, key, kind = "yen", muted = false], i) => (
                    <tr key={`${block}-${key}`} className={`border-t ${i === 0 ? "border-t-2 border-t-slate-300" : ""} ${block === "計" ? "bg-muted/30" : ""}`}>
                      <td className="px-2 py-1 font-medium text-muted-foreground whitespace-nowrap">{i === 0 ? block : ""}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{label}</td>
                      {rows.map((r) => {
                        const v = r[b][key];
                        const isMargin = kind === "pct";
                        return (
                          <Cell
                            key={r.key} v={v} kind={kind} muted={muted}
                            warn={isMargin && v !== null && v < grossMarginTarget}
                            ok={isMargin && v !== null && v >= grossMarginTarget}
                          />
                        );
                      })}
                      {(() => { const v = annual[b][key]; const isMargin = kind === "pct"; return (
                        <Cell v={v} kind={kind} muted={muted} warn={isMargin && v !== null && v < grossMarginTarget} ok={isMargin && v !== null && v >= grossMarginTarget} />
                      ); })()}
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 見込の内訳 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">着地見込の内訳（案件）</CardTitle>
          <CardDescription className="text-xs">進行中で受注確度 A / A（定期売上）/ 要注意（A）の案件。完了予定日の月に計上し、請求済みの金額は除きます</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.filter((r) => r.forecast.projects.length > 0).length === 0 ? (
            <p className="text-xs text-muted-foreground">見込の案件がありません</p>
          ) : rows.filter((r) => r.forecast.projects.length > 0).map((r) => (
            <details key={r.key} className="text-xs">
              <summary className="cursor-pointer py-1">
                <span className="font-medium">{r.label}</span>　{r.forecast.projects.length}件　売上見込 ¥{yen(r.forecast.sales)}　粗利見込 ¥{yen(r.forecast.gross)}
              </summary>
              <div className="pl-4 pb-2 space-y-0.5">
                {r.forecast.projects.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <Link to={`/projects/${p.id}`} className="font-mono text-muted-foreground hover:underline">{p.project_number}</Link>
                    <Badge variant="outline" className="text-[9px] font-normal">{p.prob}</Badge>
                    <span className="truncate">{p.client_name} / {p.name}</span>
                    <span className="ml-auto tabular-nums">¥{yen(p.remaining)}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Pencil className="w-3 h-3" /> 実績の仕入は銀行明細の出金（入金確認で取り込んだもの）を使います。クレジットカード払いなどは「目標を編集」の「実績 その他原価」に月ごとに入力してください</p>

      <TargetsDialog open={targetsOpen} onOpenChange={setTargetsOpen} fiscalYear={fy} months={months} targets={targets} />
    </div>
  );
}
