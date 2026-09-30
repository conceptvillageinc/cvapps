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
import { buildSalesReport, emptyTargets, splitAnnual, applySimulation, SIM_KEYS } from "@/lib/salesReport";
import { useAuth } from "@/lib/AuthContext";

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

// シミュレーション用の入力セル。実データと違う値は色を付け、元の値をツールチップに出す
function SimCell({ value, original, edited, onCommit }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [base, setBase] = useState(value);
  if (value !== base) { setBase(value); setText(value == null ? "" : String(value)); }
  const commit = () => {
    const raw = text.replace(/[,¥￥円\s]/g, "");
    if (raw === "" || raw === String(original)) { onCommit(null); return; }
    const num = Number(raw);
    if (!Number.isFinite(num)) { setText(String(value ?? "")); return; }
    onCommit(Math.round(num));
  };
  return (
    <td className="px-1 py-0.5 text-right">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        onFocus={(e) => e.currentTarget.select()}
        inputMode="numeric"
        title={edited ? `実データ: ¥${yen(original)}（空にすると実データに戻ります）` : "数字を入れると試算に使います"}
        aria-label="シミュレーションの値"
        className={`w-[92px] h-6 px-1.5 text-right text-xs tabular-nums rounded border outline-none focus:border-primary ${edited ? "bg-amber-50 border-amber-300 font-medium text-amber-900" : "bg-background border-input hover:border-slate-400"}`}
      />
    </td>
  );
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
  // 「計」の集計範囲: forecast=着地見込だけ / actual=実績だけ / simulation=着地見込を手で置き換えて試算
  const [totalMode, setTotalMode] = useState("forecast");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // シミュレーションの上書き値（期ごとに fiscal_targets.simulation へ保存）
  const [sim, setSim] = useState({});
  const [simDirty, setSimDirty] = useState(false);
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
  const savedSim = targets?.simulation || {};
  useEffect(() => { setSim(savedSim); setSimDirty(false); }, [targets?.id, targets?.updated_date]); // eslint-disable-line react-hooks/exhaustive-deps
  const isSim = totalMode === "simulation";
  const view = useMemo(() => (isSim ? applySimulation(report, sim, grossMarginTarget) : report), [isSim, report, sim, grossMarginTarget]);
  const { rows, annual, months } = view;
  const simEditedCount = SIM_KEYS.reduce((c, k) => c + (sim[k] || []).filter((v) => v !== null && v !== undefined && v !== "").length, 0);
  const setSimValue = (key, monthIdx, value) => {
    setSim((prev) => {
      const arr = Array.from({ length: 12 }, (_, i) => prev[key]?.[i] ?? null);
      arr[monthIdx] = value;
      return { ...prev, [key]: arr };
    });
    setSimDirty(true);
  };
  const saveSim = useMutation({
    mutationFn: async (next) => {
      const payload = { simulation: { ...next, updated_at: new Date().toISOString(), updated_by: user?.full_name || user?.email || "" } };
      if (targets?.id) return db.entities.FiscalTarget.update(targets.id, payload);
      return db.entities.FiscalTarget.create({ ...emptyTargets(fy), ...payload });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fiscalTargets"] }); setSimDirty(false); toast.success("シミュレーションを保存しました"); },
    onError: (err) => toast.error("保存できませんでした: " + (err?.message || "不明なエラー")),
  });
  const resetSim = () => { const empty = {}; setSim(empty); setSimDirty(true); saveSim.mutate(empty); };

  // 表示モードに応じた「計」の値（月ごと・年計とも同じ形にそろえる）
  const totalOf = (r) => {
    if (totalMode === "forecast" || totalMode === "simulation") {
      const f = r.forecast;
      return { sales: f.sales, purchase: f.cost, gross: f.gross, margin: f.margin, need_sales: f.need_sales, need_gross_must: f.need_gross_must, need_gross: f.need_gross, need_gross_jump: f.need_gross_jump, margin_ok: f.margin === null ? null : f.margin >= grossMarginTarget };
    }
    if (totalMode === "actual") {
      const a = r.actual;
      return { sales: a.sales, purchase: a.purchase + a.other_cost, gross: a.gross, margin: a.margin, need_sales: a.need_sales, need_gross_must: a.need_gross_must, need_gross: a.need_gross, need_gross_jump: a.need_gross_jump, margin_ok: a.margin === null ? null : a.margin >= grossMarginTarget };
    }
    return r.total;
  };
  const annualTotal = totalOf(annual);
  const TOTAL_MODES = [["forecast", "着地見込のみ"], ["actual", "実績のみ"], ["simulation", "シミュレーション"]];
  const totalLabel = TOTAL_MODES.find(([k]) => k === totalMode)[1];
  const TotalModeSwitch = ({ className = "" }) => (
    <div className={`inline-flex gap-0.5 p-0.5 rounded-full bg-muted ${className}`} role="group" aria-label="計の集計範囲">
      {TOTAL_MODES.map(([k, label]) => (
        <button key={k} type="button" onClick={() => setTotalMode(k)} className={`h-6 px-2.5 rounded-full text-[11px] whitespace-nowrap ${totalMode === k ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
      ))}
    </div>
  );
  const hasTargets = !!targets && annual.target.sales > 0;
  const years = [];
  for (let y = currentFy + 1; y >= currentFy - 3; y--) years.push(y);

  const chartData = rows.map((r) => ({
    label: r.label,
    実績売上: r.actual.sales,
    見込売上: r.forecast.sales,
    目標売上: r.target.sales,
    粗利計: totalOf(r).gross,
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
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">「計」の集計範囲:</span>
        <TotalModeSwitch />
        <span className="text-[11px] text-muted-foreground">要約・グラフの粗利・表の「計」に反映されます</span>
      </div>
      {isSim && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-semibold text-amber-900">シミュレーション</span>
          <span className="text-muted-foreground">管理表の「着地見込」の売上（案件見込A・要注意A）・発注見込（A・要注意）・うち定期売上を月ごとに書き換えて試算できます。粗利・粗利率・必要額・年計・計は自動で計算し直します。実データの着地見込は変わりません。</span>
          <span className="ml-auto text-muted-foreground whitespace-nowrap">
            書き換え {simEditedCount} か所{savedSim.updated_at ? `　最終保存 ${new Date(savedSim.updated_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })} ${savedSim.updated_by || ""}` : ""}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={resetSim} disabled={saveSim.isPending || simEditedCount === 0}>実データに戻す</Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => saveSim.mutate(sim)} disabled={saveSim.isPending || !simDirty}>
            {saveSim.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : simDirty ? "保存" : "保存済み"}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          [`売上（${totalLabel}）`, annualTotal.sales, `目標 ${man(annual.target.sales)}`],
          [`粗利（${totalLabel}）`, annualTotal.gross, `目標 ${man(annual.target.gross)} / 必達 ${man(annual.target.gross_must)}`],
          ["粗利率", annualTotal.margin, null, "pct"],
          ["必要粗利（目標まで）", annualTotal.need_gross, annualTotal.need_gross >= 0 ? "達成" : "不足"],
        ].map(([label, value, sub, kind]) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold tabular-nums ${kind === "pct" ? (annualTotal.margin_ok === false ? "text-red-700" : "text-emerald-700") : Number(value) < 0 ? "text-red-700" : ""}`}>
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
              <CardTitle className="text-sm">{chart === "sales" ? "月別の売上（実績・見込）と目標" : `月別の粗利（${totalLabel}）と目標`}</CardTitle>
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
                      <td className="px-2 py-1 font-medium text-muted-foreground whitespace-nowrap align-top">{i === 0 ? block : ""}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {label}
                        {block === "計" && i === 0 && <TotalModeSwitch className="ml-2 align-middle" />}
                      </td>
                      {rows.map((r, mi) => {
                        const v = b === "total" ? totalOf(r)[key] : r[b][key];
                        const isMargin = kind === "pct";
                        if (isSim && b === "forecast" && SIM_KEYS.includes(key)) {
                          return (
                            <SimCell
                              key={r.key}
                              value={v}
                              original={report.rows[mi].forecast[key]}
                              edited={!!r.forecast.simulated?.[key]}
                              onCommit={(val) => setSimValue(key, mi, val)}
                            />
                          );
                        }
                        return (
                          <Cell
                            key={r.key} v={v} kind={kind} muted={muted}
                            warn={isMargin && v !== null && v < grossMarginTarget}
                            ok={isMargin && v !== null && v >= grossMarginTarget}
                          />
                        );
                      })}
                      {(() => { const v = b === "total" ? annualTotal[key] : annual[b][key]; const isMargin = kind === "pct"; return (
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
