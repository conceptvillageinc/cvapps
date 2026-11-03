import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { FileText, Plus, ChevronDown, MoreHorizontal, Landmark, Layers } from "lucide-react";
import { STATUS_MAP } from "@/lib/constants";
import SubmissionBadge from "@/components/estimates/SubmissionBadge";
import { SECTION_PRESETS, sectionsFromPreset, newSection, sectionsOf, groupBySection, sectionRoleLabels } from "@/lib/estimateSections";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;

/** 区分の役割の印（見込みに入れる／納品書・請求書の元／参考） */
export function SectionRoleChips({ section, className = "" }) {
  if (!section) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {sectionRoleLabels(section).map((r) => (
        <span key={r.key} className={`rounded px-1.5 text-[10px] leading-4 ring-1 ${r.cls}`}>{r.label}</span>
      ))}
    </span>
  );
}

/** 見積の区分を選ぶ（案件詳細の行・見積の画面で共通） */
export function SectionPicker({ sections, value, onChange, size = "xs", testId, className = "max-w-[12rem]" }) {
  const cur = sections.find((s) => s.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} className={`inline-flex items-center gap-1 rounded border bg-white px-1.5 ${size === "xs" ? "text-[10px] h-6" : "text-xs h-8 px-2.5"} text-muted-foreground hover:bg-muted/50 ${className}`} title="この見積の区分を変える" data-testid={testId}>
          <Layers className="w-3 h-3 shrink-0" /><span className="truncate flex-1 text-left">{cur ? cur.name : "未分類"}</span><ChevronDown className="w-3 h-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">見積の区分</DropdownMenuLabel>
        {sections.map((s) => (
          <DropdownMenuItem key={s.id} className="text-xs gap-2" onClick={() => onChange(s.id)}>
            <span className={value === s.id ? "font-semibold" : ""}>▼{s.name}</span><SectionRoleChips section={s} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onClick={() => onChange(null)}>未分類にする</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ▼見出し（名前はその場で直す）と、役割・並べ替え・削除のメニュー */
function SectionHeading({ section, index, count, sum, onPatch, onMove, onRemove, isFirst, isLast }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== section.name) onPatch({ name: v }); else setDraft(section.name); };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-300 pb-1.5 pt-3 first:pt-0" data-testid="estimate-section">
      {editing ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) commit(); if (e.key === "Escape") { setDraft(section.name); setEditing(false); } }}
          className="h-7 min-w-[16rem] rounded border px-2 text-sm font-semibold" data-testid="section-name-input" />
      ) : (
        <button type="button" onClick={() => { setDraft(section.name); setEditing(true); }} className="text-sm font-semibold hover:underline underline-offset-2" title="押すと名前を直せます" data-testid="section-name">▼{section.name}</button>
      )}
      <SectionRoleChips section={section} />
      <span className="text-[11px] text-muted-foreground">{count}件{count > 0 && `・${yen(sum)}`}</span>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="区分のメニュー" data-testid={`section-menu-${index}`}><MoreHorizontal className="w-4 h-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">この区分の見積を</DropdownMenuLabel>
          <DropdownMenuCheckboxItem className="text-xs" checked={!!section.forecast} onCheckedChange={(v) => onPatch({ forecast: !!v })}>見込みに入れる（受注見込・発注見込）</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem className="text-xs" checked={!!section.billing} onCheckedChange={(v) => onPatch({ billing: !!v })}>納品書・請求書の元にする</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs" onClick={() => { setDraft(section.name); setEditing(true); }}>名前を変える</DropdownMenuItem>
          <DropdownMenuItem className="text-xs" disabled={isFirst} onClick={() => onMove(-1)}>上へ</DropdownMenuItem>
          <DropdownMenuItem className="text-xs" disabled={isLast} onClick={() => onMove(1)}>下へ</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs text-destructive" onClick={onRemove}>区分を消す（見積は未分類へ）</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function EstimateRow({ e, sections, onMove }) {
  const es = STATUS_MAP[e.status] || STATUS_MAP.draft;
  const internalCount = (e.line_items || []).filter((li) => li?.internal_only === true).length;
  return (
    <div className="py-2.5 hover:bg-muted/40 -mx-2 px-2 rounded" data-testid="project-estimate-row">
      <div className="flex items-center gap-3">
        <Link to={`/estimates/${e.id}`} className="flex flex-1 min-w-0 items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground w-28 shrink-0">{e.estimate_number}</span>
          <span className="text-sm flex-1 truncate">{e.estimate_title || e.print_type || "（件名なし）"}</span>
          {e.revision_label && <Badge variant="outline" className="text-[9px] font-normal">{e.revision_label}</Badge>}
          <SubmissionBadge estimate={e} size="xs" />
          <Badge className={`text-[9px] ${es.color}`}>{es.label}</Badge>
          <span className="text-sm tabular-nums w-28 text-right">{e.total_amount ? yen(e.total_amount) : "—"}</span>
          <span className="text-[10px] text-muted-foreground w-12 text-right">{format(new Date(e.created_date), "M/d")}</span>
        </Link>
        {sections.length > 0 && <SectionPicker sections={sections} value={sections.some((s) => s.id === e.estimate_section) ? e.estimate_section : null} onChange={(sid) => onMove(e, sid)} testId="estimate-section-picker" className="w-44 shrink-0" />}
      </div>
      {(e.internal_memo || "").trim() && (
        // 社内メモ（全文）
        <p className="mt-1 ml-[7.75rem] whitespace-pre-line break-words rounded bg-violet-50 px-2 py-1 text-[11px] leading-relaxed text-violet-900" data-testid="project-estimate-memo">
          <span className="mr-1 font-semibold">社内メモ</span>{e.internal_memo.trim()}
        </p>
      )}
      {internalCount > 0 && <p className="mt-0.5 ml-[7.75rem] text-[10px] text-amber-700">提出しない明細 {internalCount} 行（社内用に残した別案など）</p>}
    </div>
  );
}

/**
 * 案件詳細の「見積」の欄。区分（▼の見出し）を付けた案件は、区分ごとに分けて出す
 */
export default function EstimateSectionsCard({ project, estimates }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sections = sectionsOf(project);
  const groups = groupBySection(project, estimates);

  const saveProject = async (patch, msg) => {
    try {
      await db.entities.Project.update(project.id, patch);
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (msg) toast.success(msg);
    } catch (err) { toast.error("保存できませんでした: " + (err?.message || "不明なエラー")); }
  };
  const setSections = (next, msg) => saveProject({ estimate_sections: next.length ? next : null }, msg);
  const patchSection = (sid, patch) => setSections(sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  const moveSection = (i, dir) => { const n = [...sections]; const j = i + dir; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setSections(n); };
  const applyPreset = (key) => {
    const p = SECTION_PRESETS[key];
    saveProject({ estimate_sections: sectionsFromPreset(key), ...(p.subsidy ? { uses_subsidy: true } : {}) }, `区分（${p.label}）を付けました。見積ごとに右の「未分類」から区分を選んでください`);
  };
  const moveEstimate = async (e, sid) => {
    try {
      await db.entities.Estimate.update(e.id, { estimate_section: sid });
      qc.invalidateQueries({ queryKey: ["estimates"] });
    } catch (err) { toast.error("移せませんでした: " + (err?.message || "不明なエラー")); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" /> 見積（{estimates.length}件）
            {project.uses_subsidy && <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 text-[10px] font-semibold text-orange-800" data-testid="subsidy-badge"><Landmark className="w-3 h-3" /> 補助金</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer" title="案件一覧に「補助金」の印を出し、絞り込めるようにします">
              <input type="checkbox" className="h-3.5 w-3.5 accent-orange-600" checked={!!project.uses_subsidy} onChange={(ev) => saveProject({ uses_subsidy: ev.target.checked })} data-testid="subsidy-toggle" />
              補助金の案件
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1 text-xs h-8" data-testid="sections-menu">
                  <Layers className="w-3.5 h-3.5" /> {sections.length ? "区分" : "区分を付ける"} <ChevronDown className="w-3 h-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {sections.length === 0 ? (
                  <>
                    <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground">見積を ▼ の見出しで分けます（見出しの名前はあとで直せます）</DropdownMenuLabel>
                    {Object.entries(SECTION_PRESETS).map(([key, p]) => (
                      <DropdownMenuItem key={key} className="text-xs flex-col items-start gap-0.5" onClick={() => applyPreset(key)} data-testid={`preset-${key}`}>
                        <span className="font-semibold">{p.label}</span>
                        <span className="text-[10px] text-muted-foreground">{p.sections.map((s) => `▼${s.name}`).join("／")}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : (
                  <>
                    <DropdownMenuItem className="text-xs" onClick={() => setSections([...sections, newSection()])} data-testid="section-add">区分を追加</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-xs text-destructive" onClick={() => setSections([], "区分をやめました（見積はそのまま残ります）")}>区分をやめる（1 つのリストに戻す）</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="gap-1.5 text-xs h-8" onClick={() => navigate(`/estimates/new?project=${project.id}`)}>
              <Plus className="w-3.5 h-3.5" /> この案件の見積を作成
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {estimates.length === 0 && sections.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">まだ見積がありません</p>
        ) : sections.length === 0 ? (
          <div className="divide-y">{estimates.map((e) => <EstimateRow key={e.id} e={e} sections={sections} onMove={moveEstimate} />)}</div>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => {
              const i = g.section ? sections.findIndex((s) => s.id === g.section.id) : -1;
              const sum = g.estimates.reduce((s, e) => s + (Number(e.total_amount) || 0), 0);
              return (
                <div key={g.section?.id || "none"}>
                  {g.section ? (
                    <SectionHeading section={g.section} index={i} count={g.estimates.length} sum={sum} isFirst={i === 0} isLast={i === sections.length - 1}
                      onPatch={(patch) => patchSection(g.section.id, patch)} onMove={(dir) => moveSection(i, dir)}
                      onRemove={() => setSections(sections.filter((s) => s.id !== g.section.id), `「${g.section.name}」を消しました（見積は未分類へ）`)} />
                  ) : (
                    <div className="flex items-center gap-2 border-b border-dashed pb-1.5 pt-3" data-testid="estimate-section-none">
                      <span className="text-sm font-semibold text-muted-foreground">▼未分類</span>
                      <span className="text-[11px] text-muted-foreground">{g.estimates.length}件　右の「未分類」から区分を選んでください（それまでは見込みにも納品書・請求書の元にも使います）</span>
                    </div>
                  )}
                  {g.estimates.length === 0 ? (
                    <p className="py-2 text-[11px] text-muted-foreground">この区分の見積はまだありません</p>
                  ) : (
                    <div className="divide-y">{g.estimates.map((e) => <EstimateRow key={e.id} e={e} sections={sections} onMove={moveEstimate} />)}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
