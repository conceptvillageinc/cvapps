import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, ArrowRight, Loader2, FolderKanban, Repeat } from "lucide-react";
import { ColumnFilter, SortButton, stripCorpAffix } from "@/components/table/ColumnControls";
import { useSystemSettings } from "@/lib/useSystemSettings";
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, todayString } from "@/lib/fiscal";
import { getDealProbabilityColor, getPhaseColor, PROJECT_STATUS_MAP } from "@/lib/constants";
import ProjectFormDialog from "@/components/projects/ProjectFormDialog";

const yen = (n) => (n === null || n === undefined ? "—" : `¥${Math.round(Number(n)).toLocaleString()}`);
const ALL_YEARS = "all";

export default function ProjectList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { dealProbabilityOptions, phaseOptions, fiscalYearStartMonth } = useSystemSettings();

  const currentFy = fiscalYearOf(todayString(), fiscalYearStartMonth);
  const [fiscalYear, setFiscalYear] = useState(String(currentFy));
  const [search, setSearch] = useState(searchParams.get("q") || "");
  // 既定では進行中の案件だけを表示する
  const [columnFilters, setColumnFilters] = useState({ status: [PROJECT_STATUS_MAP.open.label] });
  const [sortConfig, setSortConfig] = useState({ key: "registered_at", direction: "desc" });
  const [createOpen, setCreateOpen] = useState(false);

  const range = fiscalYear === ALL_YEARS ? null : fiscalYearRange(Number(fiscalYear), fiscalYearStartMonth);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", fiscalYear, fiscalYearStartMonth],
    queryFn: () => range
      ? db.entities.Project.between("registered_at", range.from, range.to, "-registered_at")
      : db.entities.Project.list("-registered_at"),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });
  const clientKanaMap = useMemo(() => {
    const m = {};
    clients.forEach((c) => { m[c.name] = c.name_kana || ""; });
    return m;
  }, [clients]);

  // 期の選択肢: 今期を含めて過去3期分 + すべて
  const yearOptions = useMemo(() => {
    const years = [];
    for (let y = currentFy + 1; y >= currentFy - 3; y--) years.push(y);
    return years;
  }, [currentFy]);

  const columnDefs = useMemo(() => ({
    project_number: { label: "案件番号", getValue: (p) => p.project_number || "" },
    client_name: { label: "クライアント", getValue: (p) => p.client_name || "" },
    name: { label: "案件名", getValue: (p) => p.name || "" },
    deal_probability: { label: "受注確度", getValue: (p) => p.deal_probability || "", master: dealProbabilityOptions },
    phase: { label: "フェーズ", getValue: (p) => p.phase || "", master: phaseOptions },
    status: { label: "状態", getValue: (p) => PROJECT_STATUS_MAP[p.status]?.label || p.status || "", master: Object.values(PROJECT_STATUS_MAP).map((v) => v.label) },
    expected_revenue: { label: "受注見込", getValue: (p) => yen(p.expected_revenue) },
    expected_gross_profit: { label: "粗利見込", getValue: (p) => yen(p.expected_gross_profit) },
    due_date: { label: "完了予定", getValue: (p) => p.due_date || "" },
    payment_due_date: { label: "入金予定", getValue: (p) => p.payment_due_date || "" },
    registered_at: { label: "登録日", getValue: (p) => p.registered_at || "" },
  }), [dealProbabilityOptions, phaseOptions]);

  const FILTERABLE_KEYS = ["client_name", "deal_probability", "phase", "status"];

  const columnOptions = useMemo(() => {
    const result = {};
    for (const key of FILTERABLE_KEYS) {
      const def = columnDefs[key];
      const fromData = new Set(projects.map(def.getValue));
      const merged = Array.from(new Set([...(def.master || []), ...fromData]));
      result[key] = merged.sort((a, b) => a.localeCompare(b, "ja"));
    }
    return result;
     
  }, [projects, columnDefs]);

  const setColumnFilter = (key, values) => setColumnFilters((prev) => ({ ...prev, [key]: values }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (q) {
        const hay = [p.project_number, p.client_name, p.name, p.notes].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const key of FILTERABLE_KEYS) {
        const selected = columnFilters[key];
        if (selected === null || selected === undefined) continue;
        if (!selected.includes(columnDefs[key].getValue(p))) return false;
      }
      return true;
    });
     
  }, [projects, search, columnFilters, columnDefs]);

  const sorted = useMemo(() => {
    if (!sortConfig) return filtered;
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortConfig.key) {
        case "project_number":
          cmp = (a.project_number || "").localeCompare(b.project_number || "", "ja", { numeric: true });
          break;
        case "client_name": {
          const ak = clientKanaMap[a.client_name] || stripCorpAffix(a.client_name || "");
          const bk = clientKanaMap[b.client_name] || stripCorpAffix(b.client_name || "");
          cmp = ak.localeCompare(bk, "ja");
          break;
        }
        case "expected_revenue":
          cmp = Number(a.expected_revenue || 0) - Number(b.expected_revenue || 0);
          break;
        case "expected_gross_profit":
          cmp = Number(a.expected_gross_profit || 0) - Number(b.expected_gross_profit || 0);
          break;
        case "due_date":
        case "payment_due_date":
        case "registered_at":
          cmp = (a[sortConfig.key] || "").localeCompare(b[sortConfig.key] || "");
          break;
        default:
          cmp = 0;
      }
      return sortConfig.direction === "desc" ? -cmp : cmp;
    });
    return list;
  }, [filtered, sortConfig, clientKanaMap]);

  const totals = useMemo(() => ({
    revenue: filtered.reduce((s, p) => s + Number(p.expected_revenue || 0), 0),
    gross: filtered.reduce((s, p) => s + Number(p.expected_gross_profit || 0), 0),
  }), [filtered]);

  const activeFilterCount = Object.values(columnFilters).filter((v) => v !== null && v !== undefined).length;

  const sortOpts = {
    text: [{ value: "asc", label: "昇順" }, { value: "desc", label: "降順" }],
    amount: [{ value: "desc", label: "金額大" }, { value: "asc", label: "金額小" }],
    date: [{ value: "desc", label: "新しい順" }, { value: "asc", label: "古い順" }],
  };
  const sortKinds = {
    project_number: "text", client_name: "text", expected_revenue: "amount", expected_gross_profit: "amount",
    due_date: "date", payment_due_date: "date", registered_at: "date",
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">案件一覧</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length}件 / {fiscalYear === ALL_YEARS ? "全期間" : fiscalYearLabel(Number(fiscalYear), fiscalYearStartMonth)} {projects.length}件
            {activeFilterCount > 0 && (
              <button onClick={() => setColumnFilters({})} className="ml-2 text-primary hover:underline">
                列フィルターをすべて解除（{activeFilterCount}件適用中）
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={fiscalYear} onValueChange={setFiscalYear}>
            <SelectTrigger className="h-9 w-[230px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-xs">
                  {fiscalYearLabel(y, fiscalYearStartMonth)}{y === currentFy ? "　今期" : ""}
                </SelectItem>
              ))}
              <SelectItem value={ALL_YEARS} className="text-xs">すべての期</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2" onClick={() => navigate("/projects/recurring")}>
            <Repeat className="w-4 h-4 text-teal-600" /> 定期売上
          </Button>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> 新規案件
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="案件番号・クライアント名・案件名・メモで検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <FolderKanban className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">該当する案件がありません</p>
              {projects.length === 0 && fiscalYear !== ALL_YEARS && (
                <button onClick={() => setFiscalYear(ALL_YEARS)} className="text-xs text-primary hover:underline mt-2">すべての期を表示</button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {Object.entries(columnDefs).map(([key, def]) => (
                      <TableHead key={key} className={`text-xs text-white whitespace-nowrap ${key.includes("revenue") || key.includes("profit") ? "text-right" : ""}`}>
                        {def.label}
                        {FILTERABLE_KEYS.includes(key) && (
                          <ColumnFilter
                            label={def.label}
                            options={columnOptions[key]}
                            selected={columnFilters[key] ?? null}
                            onChange={(v) => setColumnFilter(key, v)}
                          />
                        )}
                        {sortKinds[key] && (
                          <SortButton
                            sortKey={key}
                            currentSort={sortConfig}
                            onChange={setSortConfig}
                            options={sortOpts[sortKinds[key]]}
                          />
                        )}
                      </TableHead>
                    ))}
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((p) => {
                    const st = PROJECT_STATUS_MAP[p.status] || PROJECT_STATUS_MAP.open;
                    return (
                      <TableRow key={p.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/projects/${p.id}`)}>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">{p.project_number}</TableCell>
                        <TableCell className="text-sm font-medium max-w-[220px] truncate" title={p.client_name}>{p.client_name}</TableCell>
                        <TableCell className="text-sm max-w-[320px]">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate" title={p.name}>{p.name}</span>
                            {p.is_recurring && <Repeat className="w-3 h-3 text-teal-600 shrink-0" title="定期売上" />}
                          </div>
                        </TableCell>
                        <TableCell>
                          {p.deal_probability && (
                            <Badge className={`text-[10px] whitespace-nowrap ${getDealProbabilityColor(p.deal_probability)}`}>{p.deal_probability}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.phase && <Badge className={`text-[10px] ${getPhaseColor(p.phase)}`}>{p.phase}</Badge>}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] whitespace-nowrap ${st.color}`}>{st.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{yen(p.expected_revenue)}</TableCell>
                        <TableCell className={`text-right text-sm tabular-nums ${Number(p.expected_gross_profit) < 0 ? "text-destructive" : ""}`}>
                          {yen(p.expected_gross_profit)}
                          {Number(p.expected_revenue) > 0 && <span className="block text-[10px] text-muted-foreground">{Math.round((Number(p.expected_gross_profit) / Number(p.expected_revenue)) * 100)}%</span>}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{p.due_date || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{p.payment_due_date || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{p.registered_at}</TableCell>
                        <TableCell>
                          <Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>
                            <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30 hover:bg-muted/30 font-medium">
                    <TableCell colSpan={6} className="text-xs text-muted-foreground">表示中の合計（{filtered.length}件）</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{yen(totals.revenue)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{yen(totals.gross)}</TableCell>
                    <TableCell colSpan={4}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(row) => navigate(`/projects/${row.id}`)}
      />
    </div>
  );
}
