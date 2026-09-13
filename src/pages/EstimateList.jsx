import { db } from "@/api/db";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, ArrowRight, Loader2, FileText, Filter, Check, ArrowUpDown } from "lucide-react";
import { getDealProbabilityColor, getPhaseColor, PRINT_TYPES } from "@/lib/constants";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

// スプレッドシート同様、列内に実在する値（または選択肢マスタ）をチェックボックスで選ぶフィルター
function ColumnFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const isFiltered = selected !== null;
  const activeSet = selected === null ? new Set(options) : new Set(selected);
  const filteredOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  const toggleValue = (value) => {
    const next = new Set(activeSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // 全選択状態に戻ったらフィルター解除（null）にする
    onChange(next.size === options.length ? null : Array.from(next));
  };

  const selectAll = () => onChange(null);
  const clearAll = () => onChange([]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={`ml-1 align-middle ${isFiltered ? "text-primary" : "text-white/50 hover:text-white"}`}>
          <Filter className="w-3 h-3" fill={isFiltered ? "currentColor" : "none"} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`${label}を検索`}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 border-b text-[10px]">
          <button onClick={selectAll} className="text-primary hover:underline">すべて選択</button>
          <button onClick={clearAll} className="text-muted-foreground hover:underline">クリア</button>
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {filteredOptions.length === 0 && (
            <p className="text-[10px] text-muted-foreground text-center py-3">該当する値がありません</p>
          )}
          {filteredOptions.map(opt => {
            const checked = activeSet.has(opt);
            return (
              <button
                key={opt}
                onClick={() => toggleValue(opt)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/50 text-left"
              >
                <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${checked ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                  {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </span>
                <span className="truncate">{opt || "（空欄）"}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// 法人格表記（ソート対象外）
const CORP_AFFIXES = ["株式会社", "有限会社", "一般社団法人", "NPO法人"];
function stripCorpAffix(str = "") {
  let s = str;
  CORP_AFFIXES.forEach(p => {
    if (s.startsWith(p)) s = s.slice(p.length);
    if (s.endsWith(p)) s = s.slice(0, -p.length);
  });
  return s.trim();
}

// 並び替え（昇順・降順など）ボタン
function SortButton({ options, sortKey, currentSort, onChange }) {
  const [open, setOpen] = useState(false);
  const active = currentSort?.key === sortKey;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={`ml-1 align-middle ${active ? "text-primary" : "text-white/50 hover:text-white"}`}>
          <ArrowUpDown className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {options.map(opt => {
          const isActive = active && currentSort.direction === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => { onChange(isActive ? null : { key: sortKey, direction: opt.value }); setOpen(false); }}
              className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/50 flex items-center gap-1.5 ${isActive ? "text-primary font-medium" : ""}`}
            >
              {isActive && <Check className="w-3 h-3" />}
              {opt.label}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export default function EstimateList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState(null); // { key, direction: 'asc'|'desc' }

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["estimates"],
    queryFn: () => db.entities.Estimate.list("-created_date", 100),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-name"),
  });
  const clientKanaMap = useMemo(() => {
    const m = {};
    clients.forEach(c => { m[c.name] = c.name_kana || ""; });
    return m;
  }, [clients]);

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => db.entities.SystemSettings.list(),
  });

  const dealProbabilityMaster = useMemo(() => {
    const s = settings.find(x => x.setting_key === "deal_probability_options");
    try { return s ? JSON.parse(s.setting_value) : ["A", "A（定期売上）", "要注意A", "B", "C", "失注"]; } catch { return []; }
  }, [settings]);

  const phaseMaster = useMemo(() => {
    const s = settings.find(x => x.setting_key === "phase_options");
    try { return s ? JSON.parse(s.setting_value) : ["未着手", "着手中"]; } catch { return []; }
  }, [settings]);

  // 列ごとの値取得・表示整形
  const columnDefs = useMemo(() => ({
    estimate_number: { label: "見積番号", getValue: e => e.estimate_number || "" },
    client_name: { label: "クライアント", getValue: e => e.client_name || "" },
    print_type: { label: "印刷物種別", getValue: e => e.print_type || "", master: PRINT_TYPES },
    deal_probability: { label: "受注確度", getValue: e => e.deal_probability || "", master: dealProbabilityMaster },
    phase: { label: "フェーズ", getValue: e => e.phase || "", master: phaseMaster },
    total_amount: { label: "合計金額", getValue: e => e.total_amount ? `¥${e.total_amount.toLocaleString()}` : "—" },
    desired_delivery_date: { label: "希望納期", getValue: e => e.desired_delivery_date || "—" },
    created_date: { label: "作成日", getValue: e => format(new Date(e.created_date), "yyyy-MM-dd") },
    person_in_charge: { label: "作成担当者", getValue: e => e.person_in_charge || "" },
  }), [dealProbabilityMaster, phaseMaster]);

  // 各列の選択肢（マスタ + 実データにある値の和集合。存在するものだけ表示）
  const columnOptions = useMemo(() => {
    const result = {};
    Object.entries(columnDefs).forEach(([key, def]) => {
      const fromData = new Set(estimates.map(def.getValue));
      const fromMaster = def.master || [];
      const merged = Array.from(new Set([...fromMaster, ...fromData]));
      result[key] = merged.sort((a, b) => a.localeCompare(b, "ja"));
    });
    return result;
  }, [estimates, columnDefs]);

  // 注意：見積番号/合計金額/作成日は並び替え専用のため、リストはcolumnDefsには含めず別途フィルター対象外にする
  const FILTERABLE_KEYS = ["client_name", "print_type", "deal_probability", "phase", "desired_delivery_date", "person_in_charge"];

  const setColumnFilter = (key, values) => {
    setColumnFilters(prev => ({ ...prev, [key]: values }));
  };

  const filtered = estimates.filter(est => {
    const matchSearch = !search ||
      est.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      est.estimate_number?.toLowerCase().includes(search.toLowerCase()) ||
      est.print_type?.toLowerCase().includes(search.toLowerCase()) ||
      est.usage?.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;

    for (const key of FILTERABLE_KEYS) {
      const def = columnDefs[key];
      const selected = columnFilters[key];
      if (selected === null || selected === undefined) continue; // フィルター未適用
      const value = def.getValue(est);
      if (!selected.includes(value)) return false;
    }
    return true;
  });

  const sorted = useMemo(() => {
    if (!sortConfig) return filtered;
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortConfig.key === "estimate_number") {
        cmp = (a.estimate_number || "").localeCompare(b.estimate_number || "", "ja", { numeric: true });
      } else if (sortConfig.key === "client_name") {
        const ak = clientKanaMap[a.client_name] || stripCorpAffix(a.client_name || "");
        const bk = clientKanaMap[b.client_name] || stripCorpAffix(b.client_name || "");
        cmp = ak.localeCompare(bk, "ja");
      } else if (sortConfig.key === "total_amount") {
        cmp = (a.total_amount || 0) - (b.total_amount || 0);
      } else if (sortConfig.key === "created_date") {
        cmp = new Date(a.created_date) - new Date(b.created_date);
      }
      return sortConfig.direction === "desc" ? -cmp : cmp;
    });
    return list;
  }, [filtered, sortConfig, clientKanaMap]);

  // 同一案件（project_group_id）内で作成日時が最新のものを「最新版」として判定
  // （取得済みの100件の範囲内での簡易判定）
  const latestIdByGroup = {};
  estimates.forEach(e => {
    const gid = e.project_group_id || e.id;
    const current = latestIdByGroup[gid];
    if (!current || new Date(e.created_date) > new Date(current.date)) {
      latestIdByGroup[gid] = { id: e.id, date: e.created_date };
    }
  });

  const activeFilterCount = Object.values(columnFilters).filter(v => v !== null && v !== undefined).length;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">見積一覧</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length}件 / 全{estimates.length}件
            {activeFilterCount > 0 && (
              <button onClick={() => setColumnFilters({})} className="ml-2 text-primary hover:underline">
                列フィルターをすべて解除（{activeFilterCount}件適用中）
              </button>
            )}
          </p>
        </div>
        <Link to="/estimates/new">
          <Button className="gap-2">
            <Plus className="w-4 h-4" /> 新規作成
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="クライアント名・見積番号・商品名で検索"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">該当する見積がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-800 hover:bg-slate-800">
                    {Object.entries(columnDefs).map(([key, def]) => (
                      <TableHead key={key} className="text-xs text-white whitespace-nowrap">
                        {def.label}
                        {key === "estimate_number" && (
                          <SortButton
                            sortKey="estimate_number"
                            currentSort={sortConfig}
                            onChange={setSortConfig}
                            options={[{ value: "asc", label: "昇順" }, { value: "desc", label: "降順" }]}
                          />
                        )}
                        {key === "client_name" && (
                          <>
                            <ColumnFilter
                              label={def.label}
                              options={columnOptions[key]}
                              selected={columnFilters[key] ?? null}
                              onChange={(v) => setColumnFilter(key, v)}
                            />
                            <SortButton
                              sortKey="client_name"
                              currentSort={sortConfig}
                              onChange={setSortConfig}
                              options={[{ value: "asc", label: "昇順（あ／A〜）" }, { value: "desc", label: "降順（ん／Z〜）" }]}
                            />
                          </>
                        )}
                        {key === "total_amount" && (
                          <SortButton
                            sortKey="total_amount"
                            currentSort={sortConfig}
                            onChange={setSortConfig}
                            options={[{ value: "desc", label: "金額大" }, { value: "asc", label: "金額小" }]}
                          />
                        )}
                        {key === "created_date" && (
                          <SortButton
                            sortKey="created_date"
                            currentSort={sortConfig}
                            onChange={setSortConfig}
                            options={[{ value: "desc", label: "新しい順" }, { value: "asc", label: "古い順" }]}
                          />
                        )}
                        {FILTERABLE_KEYS.includes(key) && key !== "client_name" && (
                          <ColumnFilter
                            label={def.label}
                            options={columnOptions[key]}
                            selected={columnFilters[key] ?? null}
                            onChange={(v) => setColumnFilter(key, v)}
                          />
                        )}
                      </TableHead>
                    ))}
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(est => {
                    const gid = est.project_group_id || est.id;
                    const isLatest = latestIdByGroup[gid]?.id === est.id;
                    return (
                      <TableRow key={est.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/estimates/${est.id}`)}>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {est.estimate_number}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{est.client_name}</div>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {est.revision_label && (
                              <Badge variant="outline" className="text-[9px] font-normal">{est.revision_label}</Badge>
                            )}
                            {isLatest && (
                              <Badge className="text-[9px] bg-blue-100 text-blue-700 hover:bg-blue-100">最新版</Badge>
                            )}
                            {est.is_final_submitted && (
                              <Badge className="text-[9px] bg-amber-100 text-amber-700 hover:bg-amber-100">最終提出版</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{est.print_type || "—"}</TableCell>
                        <TableCell>
                          {est.deal_probability && (
                            <Badge className={`text-[10px] ${getDealProbabilityColor(est.deal_probability)}`}>{est.deal_probability}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {est.phase && (
                            <Badge className={`text-[10px] ${getPhaseColor(est.phase)}`}>{est.phase}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums">
                          {est.total_amount ? `¥${est.total_amount.toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {est.desired_delivery_date || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(est.created_date), "M/d", { locale: ja })}
                        </TableCell>
                        <TableCell className="text-sm">
                          {est.person_in_charge || "—"}
                        </TableCell>
                        <TableCell>
                          <Link to={`/estimates/${est.id}`}>
                            <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
