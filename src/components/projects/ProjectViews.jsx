import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getDealProbabilityColor, getPhaseColor, PROJECT_STATUS_MAP } from "@/lib/constants";
import { todayString, fiscalYearOf, fiscalYearLabel } from "@/lib/fiscal";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { isOffDay } from "@/lib/jpHolidays";
import { toast } from "sonner";
import { Loader2, FolderKanban, ArrowUp, ArrowDown, ArrowUpDown, Filter, Target, Pencil, Check } from "lucide-react";
import { CondChip, ConditionsRow, joinValues, CheckListEditor, SortEditor } from "@/components/projects/ListConditions";

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

/** from〜to（YYYY-MM-DD、両端を含む）の営業日数（土日・祝日・年末年始を除く） */
function businessDays(from, to) {
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let n = 0;
  for (; d <= end; d.setDate(d.getDate() + 1)) if (!isOffDay(d)) n += 1;
  return n;
}
const addDaysYmd = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthEndYmd = (ymd) => {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00`);
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
};

function Empty({ text }) {
  return (
    <div className="text-center py-16">
      <FolderKanban className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* 並べ替え（受注確度・フェーズ）。システム設定の選択肢の順で並ぶ                 */
/* ------------------------------------------------------------------------ */

const SORTABLE = { deal_probability: "dealProbabilityOptions", phase: "phaseOptions" };

/** 見出しクリックで 昇順 → 降順 → 解除 */
function useColumnSort() {
  const [sort, setSort] = useState(null); // { key, dir: "asc" | "desc" } | null
  const toggle = (key) => setSort((cur) => (!cur || cur.key !== key ? { key, dir: "asc" } : cur.dir === "asc" ? { key, dir: "desc" } : null));
  return [sort, toggle, setSort];
}

/** 選択肢の順で並べる比較関数。空は最後。並べ替えが無ければ null */
function optionComparator(sort, settings) {
  if (!sort) return null;
  const options = settings[SORTABLE[sort.key]] || [];
  const rank = (v) => { const i = options.indexOf(v || ""); return i < 0 ? (v ? options.length : options.length + 1) : i; };
  return (a, b) => {
    const d = rank(a[sort.key]) - rank(b[sort.key]) || String(a[sort.key] || "").localeCompare(String(b[sort.key] || ""), "ja");
    return sort.dir === "asc" ? d : -d;
  };
}

const EMPTY_VALUE = "__empty__";

/** 列ごとの「表示する値」（チェックで複数選択）。null = 絞り込みなし */
function useColumnFilters(defaults = null) {
  const [filters, setFilters] = useState({});
  const setFilter = (key, values) => setFilters((cur) => ({ ...cur, [key]: values && values.length ? values : null }));
  // 初期値（まだ触っていない列だけに効く。「すべて」で解除すると null になり初期値も外れる）
  const applied = useMemo(() => ({ ...(defaults || {}), ...filters }), [defaults, filters]);
  return [applied, setFilter];
}

/** いちばん近いスクロールする枠（表のカード。無ければ Layout の main） */
const scrollParent = (el) => {
  let cur = el?.parentElement;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return document.querySelector("main") || document.scrollingElement;
};

/** 読み込み後に 1 回だけ、指定の行が見出しの直下に来るようにスクロールする */
function useScrollToRowOnce(ready, selector, headerSelector = "thead") {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    const row = document.querySelector(selector);
    if (!row) return;
    done.current = true;
    const sc = scrollParent(row);
    const head = row.closest("table")?.querySelector(headerSelector);
    const offset = (head?.getBoundingClientRect().height || 0) + 4;
    const top = row.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - offset;
    sc.scrollTo({ top: Math.max(0, top) });
    // 固定した見出しの下に行が隠れていたら、その分だけ戻す（見出しの固定位置は枠の余白で変わるため実測する）
    requestAnimationFrame(() => {
      if (!head) return;
      const hidden = head.getBoundingClientRect().bottom + 4 - row.getBoundingClientRect().top;
      if (hidden > 0) sc.scrollTo({ top: Math.max(0, sc.scrollTop - hidden) });
    });
  }, [ready, selector, headerSelector]);
}

const STICKY_HEAD = "sticky top-0 z-10 bg-slate-800 shadow-[0_1px_0_0_rgba(255,255,255,0.15)]"; // 表のカードの中で固定する

/** 見出しを画面上部に固定するための素の table（共通の Table はスクロール枠で包むため固定が効かない） */
const PlainTable = ({ children }) => <table className="w-full caption-bottom text-sm">{children}</table>;

/** 絞り込みに使う値の候補: システム設定の選択肢 + 実際に入っている値 + 空欄 */
function filterCandidates(key, projects, settings) {
  const options = settings[SORTABLE[key]] || [];
  const present = new Set(projects.map((p) => p[key] || ""));
  const extra = [...present].filter((v) => v && !options.includes(v)).sort((a, b) => a.localeCompare(b, "ja"));
  return [...options, ...extra, EMPTY_VALUE];
}

function applyFilters(projects, filters) {
  const keys = Object.keys(filters).filter((k) => filters[k]);
  if (keys.length === 0) return projects;
  return projects.filter((p) => keys.every((k) => filters[k].includes(p[k] || EMPTY_VALUE)));
}

function SortableHead({ col, sort, onToggle, defaultMark, className = "", filter, onFilter, candidates = [] }) {
  const sortable = col.key in SORTABLE;
  const active = sort?.key === col.key;
  const selected = filter || null;
  const toggleValue = (v) => {
    const cur = selected || [];
    onFilter(col.key, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  };
  return (
    <TableHead className={`text-xs text-white whitespace-nowrap ${col.num ? "text-right" : ""} ${className}`}>
      {sortable ? (
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={() => onToggle(col.key)} className="inline-flex items-center gap-1 hover:underline" title="クリックで並べ替え（昇順 → 降順 → 解除）">
            {col.label}
            {active ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-50" />}
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={`inline-flex items-center rounded px-1 py-0.5 ${selected ? "bg-amber-400 text-slate-900" : "opacity-60 hover:opacity-100"}`} title="表示する値を選ぶ（複数可）" aria-label={`${col.label}で絞り込み`}>
                <Filter className="w-3 h-3" />{selected && <span className="ml-0.5 text-[10px] font-bold">{selected.length}</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2 text-foreground">
              <p className="text-[11px] font-semibold mb-1">{col.label}：表示するもの</p>
              <div className="max-h-64 overflow-y-auto space-y-0.5">
                <label className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-muted/60 rounded px-1 font-semibold">
                  <input type="checkbox" className="w-3.5 h-3.5" checked={!selected} onChange={() => onFilter(col.key, null)} />
                  <span>すべて</span>
                </label>
                <div className="border-t my-0.5" />
                {candidates.map((v) => (
                  <label key={v} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer hover:bg-muted/60 rounded px-1">
                    <input type="checkbox" className="w-3.5 h-3.5" checked={!!selected?.includes(v)} onChange={() => toggleValue(v)} />
                    <span className={v === EMPTY_VALUE ? "text-muted-foreground" : ""}>{v === EMPTY_VALUE ? "（空欄）" : v}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t text-[11px]">
                <span className="text-muted-foreground">{selected ? `${selected.length} 件を表示` : "すべて表示"}</span>
                <button type="button" className="text-primary hover:underline disabled:opacity-40" disabled={!selected} onClick={() => onFilter(col.key, null)}>すべてに戻す</button>
              </div>
            </PopoverContent>
          </Popover>
        </span>
      ) : (
        <>{col.label}{!sort && defaultMark === col.key ? " ↑" : ""}</>
      )}
    </TableHead>
  );
}

/* ------------------------------------------------------------------------ */
/* 1 日あたりの粗利目標（期ごと。システム設定 daily_gross_target_fy<期首年> に保存） */
/* ------------------------------------------------------------------------ */

const targetKey = (fy) => `daily_gross_target_fy${fy}`;

function useDailyTarget(today) {
  const { settings, fiscalYearStartMonth } = useSystemSettings();
  const fy = fiscalYearOf(today, fiscalYearStartMonth);
  const row = settings.find((x) => x.setting_key === targetKey(fy));
  const target = row ? Number(row.setting_value) || 0 : 0;
  return { fy, fiscalYearStartMonth, target, row };
}

function DailyTargetCard({ today }) {
  const { fy, fiscalYearStartMonth, target, row } = useDailyTarget(today);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const value = String(Math.max(0, Math.round(Number(String(draft).replace(/[,¥￥円\s]/g, "")) || 0)));
      const data = { setting_key: targetKey(fy), setting_value: value, description: `${fy}年度 1日あたりの粗利目標（税抜）` };
      if (row) await db.entities.SystemSettings.update(row.id, data);
      else await db.entities.SystemSettings.create(data);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["settings"] }); setEditing(false); toast.success("粗利目標を保存しました"); },
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });
  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardContent className="p-4">
        <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" /> 1日あたりの粗利目標（{fiscalYearLabel(fy, fiscalYearStartMonth)}）</p>
        {editing ? (
          <form className="flex items-center gap-2 mt-1" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="例: 150000" className="h-8 w-36 text-sm" inputMode="numeric" />
            <Button type="submit" size="sm" className="h-8 text-xs gap-1" disabled={save.isPending}>{save.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} 保存</Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(false)}>やめる</Button>
          </form>
        ) : (
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-2xl font-bold tabular-nums">{target > 0 ? yen(target) : <span className="text-base text-muted-foreground">未設定</span>}</span>
            <button type="button" className="text-xs text-primary hover:underline inline-flex items-center gap-1" onClick={() => { setDraft(target ? String(target) : ""); setEditing(true); }}><Pencil className="w-3 h-3" /> {target > 0 ? "変更" : "設定する"}</button>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">計上するのは、受注確度が A・要注意（A）・A（定期売上）で、フェーズが着手中の案件の粗利（見込）です。期が変わったら、その期の目標をここで入れ直します</p>
      </CardContent>
    </Card>
  );
}

/**
 * 粗利目標に計上する案件: 受注確度が A／要注意（A）／A（定期売上）のいずれか、かつ フェーズが「着手中」
 */
export function countsTowardTarget(p) {
  const prob = String(p.deal_probability || "");
  const probOk = prob === "A" || prob.includes("要注意") || prob.includes("定期");
  return probOk && String(p.phase || "") === "着手中";
}
const TARGET_RULE = "計上: 受注確度が A・要注意（A）・A（定期売上）で、フェーズが着手中の案件の粗利（見込）";

/** 粗利（見込）が目標に届いているか */
function TargetBadge({ gross, target }) {
  if (!target) return null;
  const ok = gross >= target;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
      {ok ? `目標達成（+${yen(gross - target)}）` : `目標まで あと ${yen(target - gross)}`}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* 速報デイリー: 案件登録日順。開いた日を先頭に表示し、上に戻ると前の日。日ごとに小計 */
/* ------------------------------------------------------------------------ */

const DAILY_COLS = [
  { key: "registered_at", label: "案件登録日" },
  { key: "confirmed_revenue", label: "納品確定金額(税抜)", num: true },
  { key: "client_name", label: "顧客名称" },
  { key: "name", label: "案件名称" },
  { key: "deal_probability", label: "受注確度" },
  { key: "phase", label: "フェーズ" },
  { key: "expected_revenue", label: "売上見込（税別）", num: true },
  { key: "expected_gross_profit", label: "粗利(見込)", num: true },
  { key: "actual_gross_profit", label: "粗利(実績)", num: true },
];

export function DailyView({ projects, isLoading }) {
  const today = todayString();
  const settings = useSystemSettings();
  const [sort, toggleSort] = useColumnSort();
  const [filters, setFilter] = useColumnFilters();
  const filtered = useMemo(() => applyFilters(projects, filters), [projects, filters]);
  const { target } = useDailyTarget(today);
  const summary = useMemo(() => {
    const ws = weekStart(today);
    const ms = today.slice(0, 8) + "01";
    const agg = (from) => {
      const rows = projects.filter((p) => (p.registered_at || "") >= from);
      const counted = rows.filter(countsTowardTarget);
      return {
        count: rows.length,
        revenue: rows.reduce((s, p) => s + Number(p.expected_revenue || 0), 0),
        gross: rows.reduce((s, p) => s + Number(p.expected_gross_profit || 0), 0),
        counted: counted.reduce((s, p) => s + Number(p.expected_gross_profit || 0), 0),
        countedCount: counted.length,
      };
    };
    return { today: agg(today), week: { ...agg(ws), from: ws }, month: agg(ms) };
  }, [projects, today]);

  const groups = useMemo(() => {
    // 古い日 → 新しい日の順（今日が一番下。開いたときに今日まで自動でスクロールする）
    const sorted = [...filtered].sort((a, b) => (a.registered_at || "").localeCompare(b.registered_at || "") || (a.project_number || "").localeCompare(b.project_number || ""));
    const out = [];
    for (const p of sorted) {
      const key = p.registered_at || "";
      let g = out[out.length - 1];
      if (!g || g.date !== key) { g = { date: key, rows: [], revenue: 0, gross: 0, actual: 0, counted: 0, countedCount: 0 }; out.push(g); }
      g.rows.push(p);
      g.revenue += Number(p.expected_revenue || 0);
      g.gross += Number(p.expected_gross_profit || 0);
      if (countsTowardTarget(p)) { g.counted += Number(p.expected_gross_profit || 0); g.countedCount += 1; }
      g.actual += Number(p.actual_gross_profit || 0);
    }
    // 今日の案件が無くても「今日」のまとまりは出す（0 件・目標未達が分かるように）
    if (!out.some((g) => g.date === today)) out.push({ date: today, rows: [], revenue: 0, gross: 0, actual: 0, counted: 0, countedCount: 0 });
    out.sort((a, b) => a.date.localeCompare(b.date));
    // 受注確度・フェーズで並べ替えるときは、日ごとのまとまりはそのままで中の行だけ並べ替える
    const cmp = optionComparator(sort, settings);
    if (cmp) for (const g of out) g.rows.sort(cmp);
    return out;
  }, [filtered, sort, settings, today]);

  useScrollToRowOnce(!isLoading && groups.length > 0, `[data-day="${today}"]`);

  const monthLabel = `${Number(today.slice(5, 7))}月`;
  // 週・月の目標 = 1 日あたりの粗利目標 × その週・月の営業日数（土日・祝日・年末年始を除く）。1 日あたりの目標を変えると自動で変わる
  const weekDays = businessDays(summary.week.from, addDaysYmd(summary.week.from, 6));
  const monthDays = businessDays(today.slice(0, 8) + "01", monthEndYmd(today));
  const cards = [
    { label: `今日（${shortDate(today).replace("-", "/")}）の新規案件`, v: summary.today, target, isToday: true },
    { label: `今週（${shortDate(summary.week.from).replace("-", "/")}〜）の新規案件`, v: summary.week, target: target * weekDays, days: weekDays },
    { label: `今月（${monthLabel}）の新規案件`, v: summary.month, target: target * monthDays, days: monthDays },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <DailyTargetCard today={today} />
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
              {target > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1" data-testid="period-target">
                  <TargetBadge gross={c.v.counted} target={c.target} />
                  <span className="text-[10.5px] text-muted-foreground tabular-nums" title="1日あたりの粗利目標 × 営業日数（土日・祝日・年末年始を除く）">
                    目標 {yen(c.target)}{c.isToday ? "" : `（${c.days}営業日 × ${yen(target)}）`}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1">
                <span className="text-2xl font-bold tabular-nums">{c.v.count}<span className="text-sm font-medium ml-0.5">件</span></span>
                <span className="text-xs text-muted-foreground tabular-nums">受注見込 {yen(c.v.revenue)}　粗利見込 {yen(c.v.gross)}</span>
                <span className="text-xs tabular-nums font-medium" title={TARGET_RULE}>計上 {yen(c.v.counted)}（{c.countedCount ?? c.v.countedCount}件）</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : groups.length === 0 && !Object.values(filters).some(Boolean) ? (
            <Empty text="該当する案件がありません" />
          ) : (
            <div>
              <PlainTable>
                <TableHeader className={STICKY_HEAD}>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {DAILY_COLS.map((c) => (
                      <SortableHead key={c.key} col={c} sort={sort} onToggle={toggleSort} defaultMark="registered_at"
                        filter={filters[c.key]} onFilter={setFilter} candidates={c.key in SORTABLE ? filterCandidates(c.key, projects, settings) : []} />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.length === 0 && (
                    <TableRow><TableCell colSpan={DAILY_COLS.length} className="py-10 text-center text-sm text-muted-foreground">絞り込みに合う案件がありません。見出しの絞り込み（黄色のマーク）から解除できます</TableCell></TableRow>
                  )}
                  {groups.map((g) => (
                    <GroupRows key={g.date || "none"} group={g} target={target} isToday={g.date === today} />
                  ))}
                </TableBody>
              </PlainTable>
              {/* 今日のまとまりを見出しの直下に置けるように、下に余白を取る */}
              <div className="h-[85vh]" aria-hidden="true" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupRows({ group: g, target, isToday }) {
  return (
    <>
      <TableRow className={`${isToday ? "bg-blue-100/70 hover:bg-blue-100/70" : "bg-slate-100 hover:bg-slate-100"}`} data-day={g.date}>
        <TableCell colSpan={DAILY_COLS.length} className="py-1.5 text-[11px] font-semibold text-slate-700">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{withWeekday(g.date)}{isToday && "（今日）"}　新規 {g.rows.length}件　売上見込 {yen(g.revenue)}　粗利見込 {yen(g.gross)}　<span title={TARGET_RULE}>計上 {yen(g.counted)}（{g.countedCount}件）</span></span>
            <TargetBadge gross={g.counted} target={target} />
          </span>
        </TableCell>
      </TableRow>
      {g.rows.length === 0 && (
        <TableRow><TableCell colSpan={DAILY_COLS.length} className="py-3 text-center text-xs text-muted-foreground">今日はまだ新規の案件がありません</TableCell></TableRow>
      )}
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
          <TableCell>{p.phase && <Badge className={`text-[10px] whitespace-nowrap ${getPhaseColor(p.phase)}`}>{p.phase}</Badge>}</TableCell>
          <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">{yen(p.expected_revenue)}</TableCell>
          <TableCell className={`text-right text-sm tabular-nums whitespace-nowrap ${Number(p.expected_gross_profit) < 0 ? "text-destructive" : ""}`}>
            {countsTowardTarget(p) && <span className="mr-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-800 align-middle" title={TARGET_RULE}>計上</span>}
            {yen(p.expected_gross_profit)}
          </TableCell>
          <TableCell className={`text-right text-sm tabular-nums ${Number(p.actual_gross_profit) ? "" : "text-muted-foreground/60"}`}>{yen(p.actual_gross_profit)}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-blue-50/40 hover:bg-blue-50/40">
        <TableCell colSpan={6} className="py-1.5 text-right text-[11px] text-slate-600">日計</TableCell>
        <TableCell className="py-1.5 text-right text-xs tabular-nums font-medium">{yen(g.revenue)}</TableCell>
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

const sameStatus = (a, b) => !!a && !!b && a.length === b.length && a.every((x) => b.includes(x));

// 案件別ネクストアクションの状態の絞り込み（最初は進行中・完了）
const NEXT_STATUS_KEYS = Object.keys(PROJECT_STATUS_MAP);
const NEXT_DEFAULT_STATUS = ["open", "completed"];

export function NextActionView({ projects: allProjects, isLoading, search = "", onClearSearch }) {
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [statusFilter, setStatusFilter] = useState(NEXT_DEFAULT_STATUS); // null = すべて
  const projects = useMemo(() => (statusFilter ? allProjects.filter((p) => statusFilter.includes(p.status || "open")) : allProjects), [allProjects, statusFilter]);
  const today = todayString();
  const settings = useSystemSettings();
  const [sort, toggleSort, setSort] = useColumnSort();
  // 受注確度は「A」と「要注意（A）」を初期値にする（朝会で新規売上の進捗を見るため）
  const defaultFilters = useMemo(() => {
    const picks = (settings.dealProbabilityOptions || []).filter((v) => v === "A" || /要注意/.test(v));
    return picks.length ? { deal_probability: picks } : null;
  }, [settings.dealProbabilityOptions]);
  const [filters, setFilter] = useColumnFilters(defaultFilters);
  const monthStart = today.slice(0, 8) + "01";
  const nextMonthStart = useMemo(() => {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }, [today]);

  const groups = useMemo(() => {
    const list = applyFilters(projects, filters).filter((p) => !onlyEmpty || !(p.next_action || "").trim());
    const sorted = [...list].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || (a.project_number || "").localeCompare(b.project_number || ""));
    const mk = (key, label) => ({ key, label, rows: [], sums: { expected_revenue: 0, expected_cost: 0, confirmed_cost: 0, other_cost: 0 } });
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    const gs = [
      mk("past", "先月以前（完了予定日が先月以前）"),
      mk("month", `今月（${y}年${m}月）完了予定`),
      mk("later", `来月以降（${nextMonthStart.slice(0, 4)}年${Number(nextMonthStart.slice(5, 7))}月〜）`),
      mk("none", "完了予定日なし"),
    ];
    for (const p of sorted) {
      const d = p.due_date || "";
      const g = !d ? gs[3] : d < monthStart ? gs[0] : d < nextMonthStart ? gs[1] : gs[2];
      g.rows.push(p);
      for (const k of Object.keys(g.sums)) g.sums[k] += Number(p[k] || 0);
    }
    const cmp = optionComparator(sort, settings);
    if (cmp) for (const g of gs) g.rows.sort(cmp);
    return gs;
  }, [projects, filters, onlyEmpty, today, monthStart, nextMonthStart, sort, settings]);

  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  useScrollToRowOnce(!isLoading && !settings.isLoading, '[data-group="month"]');
  const emptyCount = projects.filter((p) => !(p.next_action || "").trim()).length;

  const colLabel = (key) => NEXT_COLS.find((c) => c.key === key)?.label || key;
  const valueLabel = (v) => (v === EMPTY_VALUE ? "（空欄）" : v);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* 今の条件を 1 行で（案件一覧の標準と同じ見た目） */}
      {/* 並び順 → 受注確度 → 状態 の順（フェーズは間に入る）。札をクリックするとその場で変えられる */}
      <ConditionsRow className="-mt-2">
        <span>すべての期</span>
        {search.trim() && <CondChip label="検索" value={`「${search.trim()}」`} onClear={onClearSearch} />}
        <CondChip
          label="並び順"
          value={sort ? `${colLabel(sort.key)}（${sort.dir === "desc" ? "降順" : "昇順"}）` : "完了予定（月ごと）"}
          editor={(close) => (
            <SortEditor
              options={[
                { id: "none", label: "完了予定（月ごと）", value: null },
                ...Object.keys(SORTABLE).flatMap((k) => [["asc", "昇順"], ["desc", "降順"]].map(([dir, w]) => ({ id: `${k}:${dir}`, label: `${colLabel(k)}（${w}）`, value: { key: k, dir } }))),
              ]}
              currentId={sort ? `${sort.key}:${sort.dir}` : "none"}
              onChange={setSort}
              close={close}
            />
          )}
        />
        {Object.keys(SORTABLE).filter((k) => filters[k]).map((k) => {
          const vals = filters[k].map(valueLabel);
          const options = filterCandidates(k, allProjects, settings);
          return (
            <CondChip key={k} label={colLabel(k)} value={joinValues(vals)} title={vals.join("・")} onClear={() => setFilter(k, null)}
              editor={() => <CheckListEditor options={options} selected={filters[k]} onChange={(next) => setFilter(k, next)} labelOf={valueLabel} />} />
          );
        })}
        <CondChip
          label="状態"
          value={statusFilter ? joinValues(statusFilter.map((k) => PROJECT_STATUS_MAP[k]?.label || k)) : "すべて"}
          onClear={statusFilter ? () => setStatusFilter(null) : undefined}
          editor={() => <CheckListEditor options={NEXT_STATUS_KEYS} selected={statusFilter} onChange={setStatusFilter} labelOf={(k) => PROJECT_STATUS_MAP[k]?.label || k} />}
        />
        {onlyEmpty && <CondChip label="ネクストアクション" value="空の案件だけ" onClear={() => setOnlyEmpty(false)} />}
        {!sameStatus(statusFilter, NEXT_DEFAULT_STATUS) && <button type="button" onClick={() => setStatusFilter(NEXT_DEFAULT_STATUS)} className="ml-1 text-primary hover:underline">状態を進行中・完了に戻す</button>}
      </ConditionsRow>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground shrink-0">
        <span>
          対象 {projects.length}件　／　表示 {total}件（先月以前 {groups[0].rows.length}・今月 {groups[1].rows.length}・来月以降 {groups[2].rows.length}・予定日なし {groups[3].rows.length}）
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="w-3.5 h-3.5" />
          ネクストアクションが空の案件だけ（{emptyCount}件）
        </label>
      </div>

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : projects.length === 0 ? (
            <Empty text="表示する案件がありません（状態の絞り込みを確認してください）" />
          ) : (
            <div>
              <PlainTable>
                <TableHeader className={STICKY_HEAD}>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {NEXT_COLS.map((c) => (
                      <SortableHead key={c.key} col={c} sort={sort} onToggle={toggleSort} defaultMark="due_date" className={c.key === "next_action" ? "min-w-[260px]" : ""}
                        filter={filters[c.key]} onFilter={setFilter} candidates={c.key in SORTABLE ? filterCandidates(c.key, projects, settings) : []} />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.filter((g) => g.rows.length > 0 || g.key === "month").map((g) => (
                    <NextGroupRows key={g.key} group={g} />
                  ))}
                </TableBody>
              </PlainTable>
              <div className="h-[60vh]" aria-hidden="true" />
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-[11px] text-muted-foreground shrink-0">ネクストアクションは、書いて Enter か枠の外をクリックすると保存されます。案件詳細の「進捗」にも同じ欄があります。</p>
    </div>
  );
}

function NextGroupRows({ group: g }) {
  return (
    <>
      <TableRow className={`${g.key === "month" ? "bg-blue-100/70 hover:bg-blue-100/70" : g.key === "past" ? "bg-rose-50 hover:bg-rose-50" : "bg-slate-100 hover:bg-slate-100"}`} data-group={g.key}>
        <TableCell colSpan={NEXT_COLS.length} className="py-1.5 text-[11px] font-semibold text-slate-700">
          {g.label}　{g.rows.length}件
          {g.key === "none" && <span className="ml-2 font-normal text-amber-700">完了予定日を入れると上のグループに移ります</span>}
        </TableCell>
      </TableRow>
      {g.rows.length === 0 && (
        <TableRow><TableCell colSpan={NEXT_COLS.length} className="py-3 text-center text-xs text-muted-foreground">表示する案件がありません（絞り込み中は見出しの黄色のマークから解除できます）</TableCell></TableRow>
      )}
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

  // 内容に合わせて高さが伸びる（長い文章は折り返して全文が見える）
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  return (
    <div className={`space-y-0.5 ${className}`}>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\r?\n/g, " "))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        placeholder="ネクストアクションを記載"
        aria-label="ネクストアクション"
        className={`block w-full min-h-8 px-2 py-1.5 rounded-md border text-xs leading-snug resize-none overflow-hidden outline-none transition-colors ${text ? "bg-amber-50/70 border-transparent hover:border-input focus:bg-background focus:border-primary" : "bg-amber-50 border-transparent placeholder:text-amber-700/70 hover:border-input focus:bg-background focus:border-primary"}`}
      />
      <div className="text-[9px] text-muted-foreground whitespace-nowrap h-3">
        {save.isPending ? "保存中…" : stamp || (text ? "" : "未記入")}
      </div>
    </div>
  );
}
