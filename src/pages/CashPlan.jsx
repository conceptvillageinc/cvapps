import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Wallet, Loader2, Plus, Trash2, Pencil, ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, CalendarDays, Settings2, ListPlus, BookOpen } from "lucide-react";
import PassbookImportDialog from "@/components/payments/PassbookImportDialog";
import { useAuth } from "@/lib/AuthContext";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { useCashAccess } from "@/lib/useCashAccess";
import { todayString } from "@/lib/fiscal";
import { buildCashPlan, autoSafetyLine, CATEGORIES, directionOf } from "@/lib/cashPlan";

const yen = (v) => `¥${Math.round(Number(v) || 0).toLocaleString()}`;
const man = (v) => `${Math.round(Number(v) / 10000).toLocaleString()}万`;
const jp = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const jpFull = (d) => (d ? `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const C = { sure: "#2a78d6", all: "#eb6834", line: "#d64545", zero: "#1f2937", inBar: "#1baf7a", outBar: "#d64545", grid: "#e5e7eb", text: "#52514e" };


function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto tabular-nums">{yen(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 資金繰り表（CV の口座）
 *   今日の安全度 → 日ごとの残高の推移（確定／見込込み）→ 日ごとの内訳。
 *   定期支払・一時的な予定の登録と、安全ライン・カード引落日・閲覧者の設定。
 */
export default function CashPlan() {
  const { allowed, isLoading: accessLoading } = useCashAccess();
  const [tab, setTab] = useState("plan"); // plan | items | settings
  const [horizon, setHorizon] = useState(90);
  const today = todayString();
  const { cashSafetyLine, cardPayDay } = useSystemSettings();

  const { data: bankTxs = [], isLoading: l1 } = useQuery({ queryKey: ["bankTransactions"], queryFn: () => db.entities.BankTransaction.list("-transaction_date", 1000), enabled: allowed });
  const { data: invoices = [], isLoading: l2 } = useQuery({ queryKey: ["invoices", "all"], queryFn: () => db.entities.Invoice.list("-invoice_date"), enabled: allowed });
  const { data: projects = [], isLoading: l3 } = useQuery({ queryKey: ["projects", "all"], queryFn: () => db.entities.Project.list("-registered_at"), enabled: allowed });
  const { data: payables = [] } = useQuery({ queryKey: ["payables", "all"], queryFn: () => db.entities.Payable.listAll("pay_month"), retry: false, enabled: allowed });
  const { data: cardCharges = [] } = useQuery({ queryKey: ["cardCharges", "all"], queryFn: () => db.entities.CardCharge.listAll("charged_at"), retry: false, enabled: allowed });
  const { data: items = [] } = useQuery({ queryKey: ["cashPlanItems"], queryFn: () => db.entities.CashPlanItem.list("sort_order"), retry: false, enabled: allowed });

  const auto = useMemo(() => autoSafetyLine({ items, payables, today }), [items, payables, today]);
  const safetyLine = cashSafetyLine ?? auto;
  const plan = useMemo(
    () => buildCashPlan({ today, horizonDays: horizon, bankTxs, invoices, projects, payables, cardCharges, items, safetyLine, cardPayDay }),
    [today, horizon, bankTxs, invoices, projects, payables, cardCharges, items, safetyLine, cardPayDay],
  );

  if (accessLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-2">
        <ShieldX className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="font-medium">この画面は閲覧できません</p>
        <p className="text-sm text-muted-foreground">資金繰り表は、許可されたアカウントだけが見られます。</p>
      </div>
    );
  }
  const loading = l1 || l2 || l3;

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Wallet className="w-6 h-6" /> 資金繰り表</h1>
          <p className="text-sm text-muted-foreground mt-0.5">銀行明細の残高を起点に、請求・案件・支払い先まとめ・カード・定期支払から、CV の口座残高の先行きを日ごとに見ます（税込）</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={tab === "plan" ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setTab("plan")}><CalendarDays className="w-4 h-4" /> 資金繰り</Button>
          <Button variant={tab === "items" ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setTab("items")}><ListPlus className="w-4 h-4" /> 定期支払・予定の登録（{items.length}）</Button>
          <Button variant={tab === "settings" ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setTab("settings")}><Settings2 className="w-4 h-4" /> 設定</Button>
        </div>
      </div>

      {tab === "items" && <ItemsTab items={items} />}
      {tab === "settings" && <SettingsTab auto={auto} />}
      {tab === "plan" && (loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <PlanView plan={plan} today={today} horizon={horizon} setHorizon={setHorizon} safetyLine={safetyLine} autoLine={cashSafetyLine === null} itemsCount={items.length} />
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === "danger") return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white px-3 py-1 text-sm font-bold"><ShieldX className="w-4 h-4" /> 危険</span>;
  if (status === "warn") return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 text-white px-3 py-1 text-sm font-bold"><ShieldAlert className="w-4 h-4" /> 注意</span>;
  if (status === "ok") return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 text-white px-3 py-1 text-sm font-bold"><ShieldCheck className="w-4 h-4" /> 安全</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-400 text-white px-3 py-1 text-sm font-bold">残高なし</span>;
}

function PlanView({ plan, today, horizon, setHorizon, safetyLine, autoLine, itemsCount }) {
  const [open, setOpen] = useState(() => new Set());
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // 通帳・画面の画像・明細 CSV をここから取り込む。ここで入れたもの（scope=cashplan）は最新の残高だけを
  // 資金繰り表の残高の起点に使い、入金確認などほかの画面には出さない。入金確認で取り込んだ明細はそのままここでも使う
  const [passbookOpen, setPassbookOpen] = useState(false);
  const refreshBank = () => queryClient.invalidateQueries({ queryKey: ["bankTransactions"] });
  const chartData = useMemo(() => plan.days.map((d) => ({
    label: jp(d.date), date: d.date,
    "残高（確定）": d.balance_sure, "残高（見込込み）": d.balance_all,
    "入金（確定）": d.in_sure, "支払（確定）": -d.out_sure,
  })), [plan.days]);
  const eventDays = plan.days.filter((d, i) => i === 0 || d.events.length > 0);
  const statusText = {
    ok: `${horizon} 日先まで、確定の予定だけで安全ライン（${yen(safetyLine)}）を下回りません`,
    warn: `${jpFull(plan.firstBelow)} に残高が安全ライン（${yen(safetyLine)}）を下回ります。入金の前倒しか支払の調整を考えてください`,
    danger: `${jpFull(plan.firstNegative)} に残高がマイナスになります。それまでに資金の手当てが必要です`,
    unknown: "残高の起点がありません。下の「通帳・画面の画像・明細CSV」から、通帳の画像・残高照会の画面・明細 CSV を取り込んでください",
  }[plan.status];
  const toggle = (date) => setOpen((s) => { const t = new Set(s); if (t.has(date)) t.delete(date); else t.add(date); return t; });
  const tick = (v, i) => (i % Math.max(1, Math.round(horizon / 12)) === 0 ? v : "");

  return (
    <>
      <Card className={plan.status === "danger" ? "border-red-300 bg-red-50/40" : plan.status === "warn" ? "border-amber-300 bg-amber-50/40" : plan.status === "ok" ? "border-emerald-300 bg-emerald-50/30" : ""}>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={plan.status} />
            <div>
              <p className="text-sm font-medium">{statusText}</p>
              <p className="text-[11px] text-muted-foreground">判定は「確定」の線（請求済の入金・支払い先まとめ・カード・登録した定期支払）だけで行います。未請求の案件の見込は入れていません</p>
            </div>
          </div>
          <div className="flex gap-1 md:ml-auto">
            {[30, 90, 180].map((n) => <Button key={n} size="sm" variant={horizon === n ? "default" : "outline"} className="text-xs" onClick={() => setHorizon(n)}>{n}日</Button>)}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-[11px] text-muted-foreground">いまの口座残高（合計）</p>
          <p className="text-lg font-bold tabular-nums">{yen(plan.anchor.total)}</p>
          {plan.anchor.accounts.map((a) => <p key={a.key || a.bank} className="text-[10px] text-muted-foreground tabular-nums">{a.label} {yen(a.balance)}（{jpFull(a.date)} 時点）</p>)}
          {plan.stale !== null && plan.stale > 7 && <p className="text-[10px] text-amber-700 flex items-center gap-1 mt-0.5"><AlertTriangle className="w-3 h-3" /> 明細が {plan.stale} 日前のものです</p>}
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => setPassbookOpen(true)} title="通帳のページの写真、ネットバンキングの残高照会・入出金明細の画面のスクリーンショット、明細 CSV から最新の残高を取り込む"><BookOpen className="w-3 h-3" /> 通帳・画面の画像・明細CSV</Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">ここで取り込んだ明細は資金繰り表だけで使います。入金確認で取り込んだ明細もここに反映されます</p>
        </CardContent></Card>
      <PassbookImportDialog open={passbookOpen} onOpenChange={setPassbookOpen} userId={user?.id} scope="cashplan" acceptCsv onDone={refreshBank} />
        <Card><CardContent className="p-3">
          <p className="text-[11px] text-muted-foreground">安全ライン{autoLine ? "（自動）" : ""}</p>
          <p className="text-lg font-bold tabular-nums">{yen(safetyLine)}</p>
          <p className="text-[10px] text-muted-foreground">{autoLine ? "（毎月の定期支払＋直近 3 か月の仕入平均）× 2" : "設定で指定した金額"}</p>
        </CardContent></Card>
        <Card className={plan.min.balance < 0 ? "border-red-300" : plan.min.balance < safetyLine ? "border-amber-300" : ""}><CardContent className="p-3">
          <p className="text-[11px] text-muted-foreground">{horizon} 日間の最低残高（確定）</p>
          <p className={`text-lg font-bold tabular-nums ${plan.min.balance < 0 ? "text-red-700" : plan.min.balance < safetyLine ? "text-amber-700" : ""}`}>{yen(plan.min.balance)}</p>
          <p className="text-[10px] text-muted-foreground">{jpFull(plan.min.date)} 時点</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-[11px] text-muted-foreground">最低残高（見込込み）</p>
          <p className="text-lg font-bold tabular-nums">{yen(plan.minAll.balance)}</p>
          <p className="text-[10px] text-muted-foreground">{jpFull(plan.minAll.date)} 時点。未請求の案件の入金・発注を足した場合</p>
        </CardContent></Card>
        <Card className={plan.overdue.length ? "border-red-200" : ""}><CardContent className="p-3">
          <p className="text-[11px] text-muted-foreground">期日超過の未入金</p>
          <p className={`text-lg font-bold tabular-nums ${plan.overdue.length ? "text-red-700" : ""}`}>{plan.overdue.length}<span className="text-xs font-medium ml-0.5">件</span> <span className="text-sm">{yen(plan.overdue.reduce((s, i) => s + (Number(i.total) || 0), 0))}</span></p>
          <p className="text-[10px] text-muted-foreground">確定の線には入れていません（見込込みでは今日に置く）</p>
        </CardContent></Card>
      </div>

      {itemsCount === 0 && (
        <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 定期支払（給与・役員報酬・家賃・借入返済など）がまだ登録されていません。「定期支払・予定の登録」で入れると、残高の予測が実態に近づきます</p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">口座残高の推移（今日から {horizon} 日）</CardTitle>
          <CardDescription className="text-xs">青＝確定の予定だけ、オレンジ＝未請求の案件の見込も足した場合。赤い横線が安全ライン。棒はその日の確定の入金（緑）と支払（赤）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80" data-testid="cashplan-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} stackOffset="sign">
                <CartesianGrid vertical={false} stroke={C.grid} strokeWidth={1} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.text }} tickFormatter={tick} axisLine={{ stroke: C.grid }} tickLine={false} interval={0} />
                <YAxis tickFormatter={man} tick={{ fontSize: 11, fill: C.text }} axisLine={false} tickLine={false} width={64} />
                <Tooltip content={<TooltipBox />} cursor={{ stroke: C.grid }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke={C.zero} strokeWidth={1} />
                <ReferenceLine y={safetyLine} stroke={C.line} strokeDasharray="4 4" label={{ value: "安全ライン", position: "insideTopRight", fontSize: 10, fill: C.line }} />
                <Bar dataKey="入金（確定）" stackId="d" fill={C.inBar} maxBarSize={8} />
                <Bar dataKey="支払（確定）" stackId="d" fill={C.outBar} maxBarSize={8} />
                <Line type="stepAfter" dataKey="残高（見込込み）" stroke={C.all} strokeWidth={2} dot={false} strokeDasharray="5 3" />
                <Line type="stepAfter" dataKey="残高（確定）" stroke={C.sure} strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">日ごとの入金・支払と残高</CardTitle>
          <CardDescription className="text-xs">予定がある日だけ並べています。行を押すと内訳が開きます。「確定」は請求済・支払い先まとめ・カード・登録した予定、「見込」は未請求の案件と期日超過の未入金</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 w-28">日付</th>
                <th className="text-right px-3 py-2">入金（確定）</th>
                <th className="text-right px-3 py-2">支払（確定）</th>
                <th className="text-right px-3 py-2">残高（確定）</th>
                <th className="text-right px-3 py-2 text-white/70">入金（見込）</th>
                <th className="text-right px-3 py-2 text-white/70">支払（見込）</th>
                <th className="text-right px-3 py-2 text-white/70">残高（見込込み）</th>
              </tr>
            </thead>
            <tbody>
              {eventDays.map((d) => {
                const isOpen = open.has(d.date);
                const low = d.balance_sure < 0 ? "text-red-700 font-bold" : d.balance_sure < safetyLine ? "text-amber-700 font-medium" : "font-medium";
                return [
                  <tr key={d.date} className={`border-t cursor-pointer hover:bg-muted/30 ${d.date === today ? "bg-blue-50/40" : ""}`} onClick={() => d.events.length && toggle(d.date)}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{jpFull(d.date)}{d.date === today && <Badge variant="outline" className="ml-1 text-[9px] font-normal">今日</Badge>}{d.events.length > 0 && <span className="ml-1 text-muted-foreground">{isOpen ? "▾" : "▸"}</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{d.in_sure ? yen(d.in_sure) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-red-700">{d.out_sure ? `-${yen(d.out_sure)}` : ""}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${low}`}>{yen(d.balance_sure)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{d.in_fc ? yen(d.in_fc) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{d.out_fc ? `-${yen(d.out_fc)}` : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{yen(d.balance_all)}</td>
                  </tr>,
                  isOpen && (
                    <tr key={d.date + "-d"} className="bg-muted/20">
                      <td colSpan={7} className="px-5 py-2">
                        <div className="space-y-0.5">
                          {d.events.map((e, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[9px] font-normal ${e.sure ? "" : "text-muted-foreground"}`}>{e.sure ? "確定" : "見込"}</Badge>
                              <span className="text-muted-foreground w-40 shrink-0 truncate">{e.group}</span>
                              {e.link ? <Link to={e.link} className="truncate flex-1 hover:underline">{e.label}</Link> : <span className="truncate flex-1">{e.label}</span>}
                              <span className={`tabular-nums ${e.amount < 0 ? "text-red-700" : "text-emerald-700"}`}>{e.amount < 0 ? `-${yen(-e.amount)}` : yen(e.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground">
        残高の起点は、入金確認で取り込んだ銀行明細の最後の残高です。その日付より前の予定は残高に含まれているものとして飛ばし、今日より前で未処理のものは今日に置きます。入金予定は請求書の入金期日（未設定なら請求日の翌月末）、支払い先まとめは支払月の月末、カードは利用月の翌月の引落日（設定）、未請求の案件は入金予定日・仕入先支払予定日（未設定なら完了予定日の翌月末）です。cv digital・Cool Agri の分は含めていません。
      </p>
    </>
  );
}

/** 定期支払・一時的な予定の登録 */
function ItemsTab({ items }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | {} | item
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cashPlanItems"] });
  const remove = useMutation({ mutationFn: (id) => db.entities.CashPlanItem.delete(id), onSuccess: () => { invalidate(); toast.success("削除しました"); }, onError: (e) => toast.error("削除できませんでした: " + e.message) });
  const toggle = useMutation({ mutationFn: ({ id, is_active }) => db.entities.CashPlanItem.update(id, { is_active }), onSuccess: invalidate, onError: (e) => toast.error("保存できませんでした: " + e.message) });
  const recurring = items.filter((i) => i.kind === "recurring");
  const oneoff = items.filter((i) => i.kind === "oneoff").sort((a, b) => String(a.on_date).localeCompare(String(b.on_date)));
  const monthlyOut = recurring.filter((i) => i.is_active !== false && i.direction === "out").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const row = (it) => (
    <tr key={it.id} className={`border-b hover:bg-muted/30 ${it.is_active === false ? "opacity-50" : ""}`}>
      <td className="px-3 py-1.5"><input type="checkbox" checked={it.is_active !== false} onChange={(e) => toggle.mutate({ id: it.id, is_active: e.target.checked })} aria-label={`${it.name} 有効`} /></td>
      <td className="px-3 py-1.5 font-medium">{it.name}{it.memo && <span className="block text-[10px] text-muted-foreground font-normal">{it.memo}</span>}</td>
      <td className="px-3 py-1.5 text-xs">{it.category}</td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${it.direction === "in" ? "text-emerald-700" : ""}`}>{it.direction === "in" ? "+" : "-"}{yen(it.amount)}</td>
      <td className="px-3 py-1.5 text-xs">{it.kind === "recurring" ? `毎月 ${it.day_of_month === 31 || !it.day_of_month ? "末" : it.day_of_month} 日${it.start_month ? `　${it.start_month}〜` : ""}${it.end_month ? `${it.start_month ? "" : "　〜"}${it.end_month}` : ""}` : jpFull(it.on_date)}</td>
      <td className="px-1 py-1.5 text-right whitespace-nowrap">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(it)} aria-label="編集"><Pencil className="w-3.5 h-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm(`「${it.name}」を削除します。よろしいですか？`)) remove.mutate(it.id); }} aria-label="削除"><Trash2 className="w-3.5 h-3.5" /></Button>
      </td>
    </tr>
  );
  const head = (
    <thead><tr className="bg-slate-800 text-white text-xs"><th className="w-10 px-3 py-2 text-left">有効</th><th className="text-left px-3 py-2">名前</th><th className="text-left px-3 py-2 w-28">区分</th><th className="text-right px-3 py-2 w-32">金額（税込）</th><th className="text-left px-3 py-2 w-48">日付</th><th className="w-20"></th></tr></thead>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">給与・役員報酬・社会保険料・家賃・通信費・借入返済のような毎月の支払と、税金・賞与・融資の入金のような 1 回の予定を登録します。金額は実際に口座から出る額（税込）です</p>
        <div className="flex-1" />
        <Button size="sm" className="gap-1.5" onClick={() => setEditing({})}><Plus className="w-4 h-4" /> 追加</Button>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">毎月の定期支払・定期収入（{recurring.length}）<span className="ml-3 text-xs font-normal text-muted-foreground">毎月の支払 合計 {yen(monthlyOut)}</span></CardTitle></CardHeader>
        <CardContent className="p-0">
          {recurring.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">まだありません。「追加」から給与や家賃などを登録してください</p> : <table className="w-full text-sm">{head}<tbody>{recurring.map(row)}</tbody></table>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">1 回の予定（税金・賞与・融資の入金など）（{oneoff.length}）</CardTitle></CardHeader>
        <CardContent className="p-0">
          {oneoff.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">まだありません。CV は 9 月末決算なので、12 月末の法人税・消費税の納付などを入れておくと安心です</p> : <table className="w-full text-sm">{head}<tbody>{oneoff.map(row)}</tbody></table>}
        </CardContent>
      </Card>
      {editing !== null && <ItemDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { invalidate(); setEditing(null); }} nextOrder={items.length} />}
    </div>
  );
}

function ItemDialog({ item, onClose, onSaved, nextOrder }) {
  const isNew = !item?.id;
  const [form, setForm] = useState({
    kind: item?.kind || "recurring", name: item?.name || "", category: item?.category || "人件費", amount: item?.amount ? String(item.amount) : "",
    day_of_month: item?.day_of_month ? String(item.day_of_month) : "25", start_month: item?.start_month || "", end_month: item?.end_month || "",
    on_date: item?.on_date || "", memo: item?.memo || "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const amount = Math.round(Number(String(form.amount).replace(/[,¥￥円\s]/g, "")) || 0);
    if (!form.name.trim()) { toast.error("名前を入れてください"); return; }
    if (amount <= 0) { toast.error("金額を入れてください"); return; }
    if (form.kind === "oneoff" && !form.on_date) { toast.error("日付を入れてください"); return; }
    const data = {
      kind: form.kind, name: form.name.trim(), category: form.category, direction: directionOf(form.category), amount,
      day_of_month: form.kind === "recurring" ? Math.min(31, Math.max(1, Number(form.day_of_month) || 31)) : null,
      start_month: form.kind === "recurring" && form.start_month ? form.start_month : null,
      end_month: form.kind === "recurring" && form.end_month ? form.end_month : null,
      on_date: form.kind === "oneoff" ? form.on_date : null,
      memo: form.memo || null,
    };
    setSaving(true);
    try {
      if (isNew) await db.entities.CashPlanItem.create({ ...data, is_active: true, sort_order: nextOrder });
      else await db.entities.CashPlanItem.update(item.id, data);
      toast.success(isNew ? "追加しました" : "保存しました");
      onSaved();
    } catch (e) { toast.error("保存できませんでした: " + e.message); }
    finally { setSaving(false); }
  };
  const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isNew ? "定期支払・予定を追加" : "編集"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {[["recurring", "毎月"], ["oneoff", "1 回だけ"]].map(([k, l]) => <Button key={k} type="button" size="sm" variant={form.kind === k ? "default" : "outline"} onClick={() => set("kind", k)}>{l}</Button>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2"><Label className="text-xs">名前</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例: 給与、家賃、消費税（確定申告）" className="h-9" /></div>
            <div className="space-y-1"><Label className="text-xs">区分</Label>
              <select value={form.category} onChange={(e) => set("category", e.target.value)} className={sel} aria-label="区分">
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.key}（{c.direction === "in" ? "入金" : "支払"}）</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label className="text-xs">金額（税込・口座から動く額）</Label><Input value={form.amount} onChange={(e) => set("amount", e.target.value)} inputMode="numeric" placeholder="例: 1200000" className="h-9 text-right" /></div>
            {form.kind === "recurring" ? (
              <>
                <div className="space-y-1"><Label className="text-xs">毎月の支払日（31 = 月末）</Label><Input type="number" min={1} max={31} value={form.day_of_month} onChange={(e) => set("day_of_month", e.target.value)} className="h-9" /></div>
                <div></div>
                <div className="space-y-1"><Label className="text-xs">開始月（任意）</Label><Input type="month" value={form.start_month} onChange={(e) => set("start_month", e.target.value)} className="h-9" /></div>
                <div className="space-y-1"><Label className="text-xs">終了月（任意。借入の最終回など）</Label><Input type="month" value={form.end_month} onChange={(e) => set("end_month", e.target.value)} className="h-9" /></div>
              </>
            ) : (
              <div className="space-y-1"><Label className="text-xs">日付</Label><Input type="date" value={form.on_date} onChange={(e) => set("on_date", e.target.value)} className="h-9" /></div>
            )}
            <div className="space-y-1 col-span-2"><Label className="text-xs">メモ（任意）</Label><Input value={form.memo} onChange={(e) => set("memo", e.target.value)} className="h-9" placeholder="例: 残り 24 回、2028/9 まで" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>キャンセル</Button>
          <Button onClick={save} disabled={saving}>{saving ? "保存中..." : isNew ? "追加" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 設定: 安全ライン・カード引落日・閲覧できる人 */
function SettingsTab({ auto }) {
  const { settings, cashSafetyLine, cardPayDay, cashflowAllowedEmails } = useSystemSettings();
  const queryClient = useQueryClient();
  const [line, setLine] = useState(cashSafetyLine === null ? "" : String(cashSafetyLine));
  const [day, setDay] = useState(String(cardPayDay));
  const [emails, setEmails] = useState(cashflowAllowedEmails.join(", "));
  const upsert = async (key, value, description) => {
    const row = settings.find((x) => x.setting_key === key);
    if (row) await db.entities.SystemSettings.update(row.id, { setting_key: key, setting_value: value, description });
    else await db.entities.SystemSettings.create({ setting_key: key, setting_value: value, description });
  };
  const save = useMutation({
    mutationFn: async () => {
      const list = emails.split(/[,\s、]+/).map((e) => e.trim().toLowerCase()).filter((e) => /@/.test(e));
      if (list.length === 0) throw new Error("閲覧できるアドレスを 1 つ以上入れてください");
      await upsert("cashflow_safety_line", line.trim() === "" ? "" : String(Math.round(Number(line.replace(/[,¥￥円\s]/g, "")) || 0)), "資金繰り表の安全ライン（空=自動）");
      await upsert("cashflow_card_pay_day", String(Math.min(31, Math.max(1, Number(day) || 27))), "カード利用の引落日（利用月の翌月）");
      await upsert("cashflow_allowed_emails", JSON.stringify(list), "資金繰り表を見られるアドレス");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["settings"] }); toast.success("設定を保存しました"); },
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });
  return (
    <Card>
      <CardContent className="p-4 space-y-4 max-w-2xl">
        <div className="space-y-1">
          <Label className="text-xs">安全ライン（残高がこれを下回ると「注意」）</Label>
          <Input value={line} onChange={(e) => setLine(e.target.value)} inputMode="numeric" placeholder={`空欄なら自動: ${yen(auto)}`} className="h-9" />
          <p className="text-[11px] text-muted-foreground">自動は「毎月の定期支払 ＋ 直近 3 か月の仕入（CV 分）の平均」の 2 か月分です。目安として 2〜3 か月分の支出を置くのが一般的です</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">カードの引落日（利用月の翌月 ○ 日）</Label>
          <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} className="h-9 w-32" />
          <p className="text-[11px] text-muted-foreground">カード利用明細まとめの CV 分を、この日にまとめて支払う予定として置きます。途中でチャージした分は銀行明細に出るので、残高の起点に反映されます</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">資金繰り表と「案件の積み上げ」を見られるアドレス（カンマ区切り）</Label>
          <Input value={emails} onChange={(e) => setEmails(e.target.value)} className="h-9" />
          <p className="text-[11px] text-muted-foreground">ここに無いアカウントには資金繰り表のメニューも画面も出ません。売上粗利管理表のシミュレーションにある「案件の積み上げ」も同じアドレスだけに出ます</p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "保存中..." : "保存"}</Button>
      </CardContent>
    </Card>
  );
}
