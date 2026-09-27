import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDealProbabilityColor, getPhaseColor } from "@/lib/constants";
import { todayString } from "@/lib/fiscal";
import { toast } from "sonner";
import { Loader2, FolderKanban } from "lucide-react";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const withWeekday = (d) => {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : `${d}（${WEEKDAYS[dt.getDay()]}）`;
};
const shortDate = (d) => (d ? `${d.slice(5, 7)}-${d.slice(8, 10)}` : "");
const fmtStamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 今日を含む週の月曜日（YYYY-MM-DD） */
function weekStart(today) {
  const d = new Date(`${today}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 月曜=0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Empty({ text }) {
  return (
    <div className="text-center py-16">
      <FolderKanban className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* 速報デイリー: 案件登録日の新しい順。日ごとに小計                              */
/* ------------------------------------------------------------------------ */

const DAILY_COLS = [
  { key: "registered_at", label: "案件登録日" },
  { key: "confirmed_revenue", label: "納品確定金額(税抜)", num: true },
  { key: "client_name", label: "顧客名称" },
  { key: "name", label: "案件名称" },
  { key: "deal_probability", label: "受注確度" },
  { key: "expected_gross_profit", label: "粗利(見込)", num: true },
  { key: "actual_gross_profit", label: "粗利(実績)", num: true },
];

export function DailyView({ projects, isLoading }) {
  const today = todayString();
  const summary = useMemo(() => {
    const ws = weekStart(today);
    const ms = today.slice(0, 8) + "01";
    const agg = (from) => {
      const rows = projects.filter((p) => (p.registered_at || "") >= from);
      return {
        count: rows.length,
        revenue: rows.reduce((s, p) => s + Number(p.expected_revenue || 0), 0),
        gross: rows.reduce((s, p) => s + Number(p.expected_gross_profit || 0), 0),
      };
    };
    return { today: agg(today), week: { ...agg(ws), from: ws }, month: agg(ms) };
  }, [projects, today]);

  const groups = useMemo(() => {
    const sorted = [...projects].sort((a, b) => (b.registered_at || "").localeCompare(a.registered_at || "") || (b.project_number || "").localeCompare(a.project_number || ""));
    const out = [];
    for (const p of sorted) {
      const key = p.registered_at || "";
      let g = out[out.length - 1];
      if (!g || g.date !== key) { g = { date: key, rows: [], revenue: 0, gross: 0, actual: 0 }; out.push(g); }
      g.rows.push(p);
      g.revenue += Number(p.expected_revenue || 0);
      g.gross += Number(p.expected_gross_profit || 0);
      g.actual += Number(p.actual_gross_profit || 0);
    }
    return out;
  }, [projects]);

  const monthLabel = `${Number(today.slice(5, 7))}月`;
  const cards = [
    { label: `今日（${shortDate(today).replace("-", "/")}）の新規案件`, v: summary.today },
    { label: `今週（${shortDate(summary.week.from).replace("-", "/")}〜）の新規案件`, v: summary.week },
    { label: `今月（${monthLabel}）の新規案件`, v: summary.month },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-2xl font-bold tabular-nums">{c.v.count}<span className="text-sm font-medium ml-0.5">件</span></span>
                <span className="text-xs text-muted-foreground tabular-nums">受注見込 {yen(c.v.revenue)}　粗利見込 {yen(c.v.gross)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : groups.length === 0 ? (
            <Empty text="該当する案件がありません" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {DAILY_COLS.map((c) => (
                      <TableHead key={c.key} className={`text-xs text-white whitespace-nowrap ${c.num ? "text-right" : ""}`}>{c.label}{c.key === "registered_at" ? " ↓" : ""}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <GroupRows key={g.date || "none"} group={g} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupRows({ group: g }) {
  return (
    <>
      <TableRow className="bg-slate-100 hover:bg-slate-100">
        <TableCell colSpan={DAILY_COLS.length} className="py-1.5 text-[11px] font-semibold text-slate-700">
          {withWeekday(g.date)}　新規 {g.rows.length}件
        </TableCell>
      </TableRow>
      {g.rows.map((p) => (
        <TableRow key={p.id} className="group hover:bg-muted/40">
          <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{withWeekday(p.registered_at)}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">{yen(p.confirmed_revenue)}</TableCell>
          <TableCell className="text-sm max-w-[220px] truncate" title={p.client_name}>{p.client_name}</TableCell>
          <TableCell className="text-sm max-w-[360px]">
            <Link to={`/projects/${p.id}`} className="hover:underline hover:text-primary" title={p.name}>{p.name}</Link>
            <span className="block text-[10px] font-mono text-muted-foreground">{p.project_number}</span>
          </TableCell>
          <TableCell>{p.deal_probability && <Badge className={`text-[10px] whitespace-nowrap ${getDealProbabilityColor(p.deal_probability)}`}>{p.deal_probability}</Badge>}</TableCell>
          <TableCell className={`text-right text-sm tabular-nums ${Number(p.expected_gross_profit) < 0 ? "text-destructive" : ""}`}>{yen(p.expected_gross_profit)}</TableCell>
          <TableCell className={`text-right text-sm tabular-nums ${Number(p.actual_gross_profit) ? "" : "text-muted-foreground/60"}`}>{yen(p.actual_gross_profit)}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-blue-50/40 hover:bg-blue-50/40">
        <TableCell colSpan={5} className="py-1.5 text-right text-[11px] text-slate-600">日計　受注見込 {yen(g.revenue)}</TableCell>
        <TableCell className="py-1.5 text-right text-xs tabular-nums font-medium">{yen(g.gross)}</TableCell>
        <TableCell className="py-1.5 text-right text-xs tabular-nums font-medium">{yen(g.actual)}</TableCell>
      </TableRow>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* 案件別ネクストアクション: 完了予定日で 今月／来月以降／予定日なし に分ける      */
/* ------------------------------------------------------------------------ */

const NEXT_COLS = [
  { key: "due_date", label: "完了予定日" },
  { key: "confirmed_revenue", label: "納品確定金額(税抜)", num: true },
  { key: "name", label: "案件名称" },
  { key: "deal_probability", label: "受注確度" },
  { key: "phase", label: "フェーズ" },
  { key: "expected_revenue", label: "受注見込", num: true },
  { key: "expected_cost", label: "発注見込", num: true },
  { key: "confirmed_cost", label: "仕入合計(税抜)", num: true },
  { key: "other_cost", label: "その他費用", num: true },
  { key: "next_action", label: "ネクストアクション" },
];

export function NextActionView({ projects, isLoading }) {
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const today = todayString();
  const nextMonthStart = useMemo(() => {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }, [today]);

  const groups = useMemo(() => {
    const list = projects.filter((p) => !onlyEmpty || !(p.next_action || "").trim());
    const sorted = [...list].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || (a.project_number || "").localeCompare(b.project_number || ""));
    const mk = (key, label) => ({ key, label, rows: [], sums: { expected_revenue: 0, expected_cost: 0, confirmed_cost: 0, other_cost: 0 } });
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    const gs = [
      mk("month", `今月（${y}年${m}月）完了予定`),
      mk("later", `来月以降（${nextMonthStart.slice(0, 4)}年${Number(nextMonthStart.slice(5, 7))}月〜）`),
      mk("none", "完了予定日なし"),
    ];
    for (const p of sorted) {
      const d = p.due_date || "";
      const g = !d ? gs[2] : d < nextMonthStart ? gs[0] : gs[1];
      g.rows.push(p);
      for (const k of Object.keys(g.sums)) g.sums[k] += Number(p[k] || 0);
    }
    return gs;
  }, [projects, onlyEmpty, today, nextMonthStart]);

  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const emptyCount = projects.filter((p) => !(p.next_action || "").trim()).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          進行中 {projects.length}件　／　今月完了予定 {groups[0].rows.length}件・来月以降 {groups[1].rows.length}件・予定日なし {groups[2].rows.length}件
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="w-3.5 h-3.5" />
          ネクストアクションが空の案件だけ（{emptyCount}件）
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : total === 0 ? (
            <Empty text={onlyEmpty ? "ネクストアクションが空の案件はありません" : "進行中の案件がありません"} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {NEXT_COLS.map((c) => (
                      <TableHead key={c.key} className={`text-xs text-white whitespace-nowrap ${c.num ? "text-right" : ""} ${c.key === "next_action" ? "min-w-[260px]" : ""}`}>{c.label}{c.key === "due_date" ? " ↑" : ""}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.filter((g) => g.rows.length > 0).map((g) => (
                    <NextGroupRows key={g.key} group={g} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-[11px] text-muted-foreground">ネクストアクションは、書いて Enter か枠の外をクリックすると保存されます。案件詳細の「進捗」にも同じ欄があります。</p>
    </div>
  );
}

function NextGroupRows({ group: g }) {
  return (
    <>
      <TableRow className="bg-slate-100 hover:bg-slate-100">
        <TableCell colSpan={NEXT_COLS.length} className="py-1.5 text-[11px] font-semibold text-slate-700">
          {g.label}　{g.rows.length}件
          {g.key === "none" && <span className="ml-2 font-normal text-amber-700">完了予定日を入れると上のグループに移ります</span>}
        </TableCell>
      </TableRow>
      {g.rows.map((p) => (
        <TableRow key={p.id} className="hover:bg-muted/40">
          <TableCell className="text-xs whitespace-nowrap">{p.due_date ? withWeekday(p.due_date).slice(5) : <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">{yen(p.confirmed_revenue)}</TableCell>
          <TableCell className="text-sm max-w-[320px]">
            <Link to={`/projects/${p.id}`} className="hover:underline hover:text-primary" title={p.name}>{p.name}</Link>
            <span className="block text-[10px] text-muted-foreground truncate">{p.client_name}</span>
          </TableCell>
          <TableCell>{p.deal_probability && <Badge className={`text-[10px] whitespace-nowrap ${getDealProbabilityColor(p.deal_probability)}`}>{p.deal_probability}</Badge>}</TableCell>
          <TableCell>{p.phase && <Badge className={`text-[10px] whitespace-nowrap ${getPhaseColor(p.phase)}`}>{p.phase}</Badge>}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">{yen(p.expected_revenue)}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">{yen(p.expected_cost)}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">{yen(p.confirmed_cost)}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">{yen(p.other_cost)}</TableCell>
          <TableCell className="py-1.5"><NextActionCell project={p} /></TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-blue-50/40 hover:bg-blue-50/40">
        <TableCell colSpan={5} className="py-1.5 text-right text-[11px] text-slate-600">小計（{g.rows.length}件）</TableCell>
        <TableCell className="py-1.5 text-right text-xs tabular-nums font-medium">{yen(g.sums.expected_revenue)}</TableCell>
        <TableCell className="py-1.5 text-right text-xs tabular-nums font-medium">{yen(g.sums.expected_cost)}</TableCell>
        <TableCell className="py-1.5 text-right text-xs tabular-nums font-medium">{yen(g.sums.confirmed_cost)}</TableCell>
        <TableCell className="py-1.5 text-right text-xs tabular-nums font-medium">{yen(g.sums.other_cost)}</TableCell>
        <TableCell></TableCell>
      </TableRow>
    </>
  );
}

/** その場で書いて保存するネクストアクション欄（一覧・案件詳細で共用） */
export function NextActionCell({ project, className = "" }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState(project.next_action || "");
  const [base, setBase] = useState(project.next_action || "");
  // 別の場所で更新されたら追従する
  if ((project.next_action || "") !== base) {
    setBase(project.next_action || "");
    setText(project.next_action || "");
  }

  const save = useMutation({
    mutationFn: (value) => db.entities.Project.update(project.id, {
      next_action: value,
      next_action_updated_at: new Date().toISOString(),
      next_action_updated_by: user?.full_name || user?.email || "",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => toast.error("ネクストアクションを保存できませんでした: " + (err?.message || "不明なエラー")),
  });

  const commit = () => {
    const v = text.trim();
    if (v === (project.next_action || "").trim()) return;
    save.mutate(v);
  };

  const stamp = project.next_action_updated_at
    ? `${fmtStamp(project.next_action_updated_at)} ${project.next_action_updated_by || ""}`.trim()
    : "";

  return (
    <div className={`space-y-0.5 ${className}`}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        placeholder="次にやることを書く…"
        aria-label="ネクストアクション"
        className={`w-full h-8 px-2 rounded-md border text-xs outline-none transition-colors ${text ? "bg-amber-50/70 border-transparent hover:border-input focus:bg-background focus:border-primary" : "bg-amber-50 border-transparent placeholder:text-amber-700/70 hover:border-input focus:bg-background focus:border-primary"}`}
      />
      <div className="text-[9px] text-muted-foreground whitespace-nowrap h-3">
        {save.isPending ? "保存中…" : stamp || (text ? "" : "未記入")}
      </div>
    </div>
  );
}
