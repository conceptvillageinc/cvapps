import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Copy, ArrowUp, ArrowDown, ArrowLeftRight, Download, Settings2, FolderInput, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  DEAL_COLORS, DEAL_COLOR_KEYS, MAX_DEAL_TAGS, DEFAULT_PER_PERSON, SECTIONS,
  newDeal, renumber, totalsOf, pipelineSummary, dealFromProject, pipelineToCsv,
} from "@/lib/dealPipeline";

// ============================================================================
// 案件の積み上げ（確定／見込）
//   シートの「15期（確定）」「15期見込み（未確定）」をアプリに持ってきたもの。パターンごとに保存。
//   行ごとに区分（色）を付け、下に売上・仕入・粗利（税別／税込）、最低粗利目標との差、売上／人・粗利／人を出す。
// ============================================================================

const yen = (v) => (v === null || v === undefined ? "—" : `¥${Math.round(Number(v) || 0).toLocaleString()}`);
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
const toInt = (v) => Math.round(Number(String(v ?? "").replace(/[,¥￥\s]/g, "")) || 0);

/** 金額の入力欄（表示はカンマ付き、入力中はそのまま） */
function YenInput({ value, onChange, className = "", ...rest }) {
  const [text, setText] = useState(null);
  const shown = text !== null ? text : (value ? Number(value).toLocaleString() : "");
  return (
    <Input
      value={shown}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setText(value ? String(value) : "")}
      onBlur={() => { if (text !== null) onChange(toInt(text)); setText(null); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      inputMode="numeric"
      className={`h-7 text-xs text-right tabular-nums px-1.5 ${className}`}
      {...rest}
    />
  );
}

function TagSelect({ value, tags, onChange }) {
  const tag = tags.find((t) => t.id === value);
  const color = tag ? DEAL_COLORS[tag.color] : null;
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={`h-7 rounded-md border px-1 text-[11px] w-full ${color ? `${color.row} ${color.text}` : "bg-background"}`} aria-label="区分" title={tag?.label || "区分なし"}>
      <option value="">—</option>
      {tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  );
}

function SectionTable({ sectionKey, label, rows, tags, projectsById, onPatch, onAdd, onRemove, onDuplicate, onMove, onSwap, readOnly }) {
  const t = totalsOf(rows);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-[11px] text-muted-foreground">{rows.length} 件</span>
          {!readOnly && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1 ml-auto" onClick={() => onAdd(sectionKey)}><Plus className="w-3 h-3" /> 行を追加</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs table-fixed min-w-[640px]" data-section={sectionKey}>
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="text-left px-2 py-1.5 w-[88px] whitespace-nowrap">区分</th>
                <th className="text-left px-2 py-1.5 whitespace-nowrap">クライアント名・件名</th>
                <th className="text-right px-2 py-1.5 w-[104px] whitespace-nowrap">売上（税別）</th>
                <th className="text-right px-2 py-1.5 w-[104px] whitespace-nowrap">仕入（税別）</th>
                <th className="text-left px-2 py-1.5 w-[22%] whitespace-nowrap">備考</th>
                {!readOnly && <th className="w-[112px]"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={readOnly ? 5 : 6} className="px-3 py-6 text-center text-muted-foreground">まだ行がありません{!readOnly && "。「行を追加」か「案件一覧から取り込む」から"}</td></tr>
              )}
              {rows.map((d, i) => {
                const tag = tags.find((x) => x.id === d.tag);
                const color = tag ? DEAL_COLORS[tag.color] : null;
                const proj = d.project_id ? projectsById[d.project_id] : null;
                return (
                  <tr key={d.id} className={`border-t ${color ? color.row : ""}`} data-deal={d.id}>
                    <td className="px-1 py-1"><TagSelect value={d.tag} tags={tags} onChange={(v) => onPatch(d.id, { tag: v })} /></td>
                    <td className="px-1 py-1">
                      <div className="flex items-center gap-1">
                        <Input value={d.name} onChange={(e) => onPatch(d.id, { name: e.target.value })} className="h-7 text-xs bg-background/70" aria-label="クライアント名・件名" readOnly={readOnly} />
                        {proj && <Link to={`/projects/${proj.id}`} className="text-muted-foreground hover:text-primary shrink-0" title={`案件 ${proj.project_number || ""} を開く`}><ExternalLink className="w-3.5 h-3.5" /></Link>}
                      </div>
                    </td>
                    <td className="px-1 py-1"><YenInput value={d.sales} onChange={(v) => onPatch(d.id, { sales: v })} aria-label="売上" className="bg-background/70" readOnly={readOnly} /></td>
                    <td className="px-1 py-1"><YenInput value={d.purchase} onChange={(v) => onPatch(d.id, { purchase: v })} aria-label="仕入" className="bg-background/70" readOnly={readOnly} /></td>
                    <td className="px-1 py-1"><Input value={d.memo} onChange={(e) => onPatch(d.id, { memo: e.target.value })} className="h-7 text-xs bg-background/70" aria-label="備考" readOnly={readOnly} title={d.memo} /></td>
                    {!readOnly && (
                      <td className="px-1 py-1">
                        <div className="flex items-center justify-end gap-0.5 text-muted-foreground">
                          <button type="button" className="p-0.5 hover:text-foreground disabled:opacity-30" onClick={() => onMove(d.id, -1)} disabled={i === 0} title="上へ" aria-label="上へ"><ArrowUp className="w-3.5 h-3.5" /></button>
                          <button type="button" className="p-0.5 hover:text-foreground disabled:opacity-30" onClick={() => onMove(d.id, 1)} disabled={i === rows.length - 1} title="下へ" aria-label="下へ"><ArrowDown className="w-3.5 h-3.5" /></button>
                          <button type="button" className="p-0.5 hover:text-foreground" onClick={() => onSwap(d.id)} title={sectionKey === "confirmed" ? "見込へ移す" : "確定へ移す"} aria-label={sectionKey === "confirmed" ? "見込へ移す" : "確定へ移す"}><ArrowLeftRight className="w-3.5 h-3.5" /></button>
                          <button type="button" className="p-0.5 hover:text-foreground" onClick={() => onDuplicate(d.id)} title="複製" aria-label="複製"><Copy className="w-3.5 h-3.5" /></button>
                          <button type="button" className="p-0.5 hover:text-destructive" onClick={() => onRemove(d.id)} title="削除" aria-label="削除"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="text-xs">
              <tr className="border-t bg-muted/30 font-medium"><td colSpan={2} className="px-2 py-1 text-right">売上／仕入（税別）</td><td className="px-2 py-1 text-right tabular-nums">{yen(t.sales)}</td><td className="px-2 py-1 text-right tabular-nums">{yen(t.purchase)}</td><td colSpan={readOnly ? 1 : 2}></td></tr>
              <tr className="bg-muted/30"><td colSpan={2} className="px-2 py-1 text-right">売上／仕入（税込）</td><td className="px-2 py-1 text-right tabular-nums">{yen(t.sales_tax)}</td><td className="px-2 py-1 text-right tabular-nums">{yen(t.purchase_tax)}</td><td colSpan={readOnly ? 1 : 2}></td></tr>
              <tr className="bg-muted/30"><td colSpan={2} className="px-2 py-1 text-right">粗利（税別）</td><td className="px-2 py-1 text-right tabular-nums font-semibold">{yen(t.gross)}</td><td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{pct(t.margin)}</td><td colSpan={readOnly ? 1 : 2} className="px-2 py-1 text-[10px] text-muted-foreground">← 粗利率</td></tr>
              <tr className="bg-muted/30"><td colSpan={2} className="px-2 py-1 text-right">粗利（税込）</td><td className="px-2 py-1 text-right tabular-nums">{yen(t.gross_tax)}</td><td colSpan={readOnly ? 2 : 3}></td></tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** 区分（色と意味）と人数・1 人あたりの目標の設定 */
function SettingsDialog({ open, onOpenChange, tags, meta, onSave }) {
  const [list, setList] = useState(tags);
  const [headcount, setHeadcount] = useState(String(meta.headcount || ""));
  const [memo, setMemo] = useState(meta.headcount_memo || "");
  const [ps, setPs] = useState(String(meta.per_person_sales || DEFAULT_PER_PERSON.sales));
  const [pg, setPg] = useState(String(meta.per_person_gross || DEFAULT_PER_PERSON.gross));
  const patch = (id, data) => setList((l) => l.map((t) => (t.id === id ? { ...t, ...data } : t)));
  const used = new Set(list.map((t) => t.color));
  const save = () => {
    const cleaned = list.map((t) => ({ ...t, label: t.label.trim() })).filter((t) => t.label);
    if (cleaned.length === 0) { toast.error("区分を 1 つ以上入れてください"); return; }
    onSave({ tags: cleaned, headcount: toInt(headcount), headcount_memo: memo.trim(), per_person_sales: toInt(ps) || DEFAULT_PER_PERSON.sales, per_person_gross: toInt(pg) || DEFAULT_PER_PERSON.gross });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>区分と人数の設定</DialogTitle>
          <DialogDescription className="text-xs">区分は行の色とその意味です（見込の角度など）。人数は売上／人・粗利／人の計算に使います。どのパターンでも共通です</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label className="text-xs">区分（最大 {MAX_DEAL_TAGS} つ）</Label>
            {list.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <select value={t.color} onChange={(e) => patch(t.id, { color: e.target.value })} className={`h-8 rounded-md border px-1 text-xs w-28 ${DEAL_COLORS[t.color].row}`} aria-label="色">
                  {DEAL_COLOR_KEYS.map((c) => <option key={c} value={c}>{DEAL_COLORS[c].label}{used.has(c) && c !== t.color ? "（使用中）" : ""}</option>)}
                </select>
                <Input value={t.label} onChange={(e) => patch(t.id, { label: e.target.value })} className="h-8 text-sm" placeholder="意味（例：確度 高）" aria-label="区分の名前" />
                <button type="button" className="p-1 text-muted-foreground hover:text-destructive" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))} aria-label="区分を削除" title="削除"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            {list.length < MAX_DEAL_TAGS && (
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setList((l) => [...l, { id: crypto.randomUUID(), label: "", color: DEAL_COLOR_KEYS.find((c) => !used.has(c)) || "slate" }])}><Plus className="w-3 h-3" /> 区分を追加</Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">人数</Label>
              <Input type="number" min={0} value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="h-8" aria-label="人数" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">メモ（名前など）</Label>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} className="h-8" placeholder="馬場／服部／…" aria-label="人数のメモ" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">売上／人 の目標（税別）</Label>
              <Input value={ps} onChange={(e) => setPs(e.target.value)} className="h-8 tabular-nums" inputMode="numeric" aria-label="売上／人の目標" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">粗利／人 の目標（税別）</Label>
              <Input value={pg} onChange={(e) => setPg(e.target.value)} className="h-8 tabular-nums" inputMode="numeric" aria-label="粗利／人の目標" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={save}>この内容にする</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 案件一覧から見込の行として取り込む */
function ImportDialog({ open, onOpenChange, projects, deals, tags, onImport }) {
  const [checked, setChecked] = useState(() => new Set());
  const [q, setQ] = useState("");
  const already = useMemo(() => new Set(deals.map((d) => d.project_id).filter(Boolean)), [deals]);
  const candidates = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (projects || [])
      .filter((p) => p.status === "open")
      .filter((p) => !s || `${p.client_name || ""} ${p.name || ""} ${p.project_number || ""}`.toLowerCase().includes(s))
      .sort((a, b) => String(a.deal_probability || "").localeCompare(String(b.deal_probability || "")) || String(b.registered_at || "").localeCompare(String(a.registered_at || "")));
  }, [projects, q]);
  const toggle = (id) => setChecked((s) => { const t = new Set(s); if (t.has(id)) t.delete(id); else t.add(id); return t; });
  const doImport = () => {
    const picked = candidates.filter((p) => checked.has(p.id));
    if (picked.length === 0) return;
    onImport(picked.map((p) => dealFromProject(p, tags)));
    setChecked(new Set());
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>案件一覧から取り込む</DialogTitle>
          <DialogDescription className="text-xs">進行中の案件を「見込」の行としてコピーします。売上は見込売上、仕入は見込原価＋その他経費（いずれも税別）。コピー後に一覧側で直しても案件は変わりません。確度 A→{tags[0]?.label || "—"}、B→{tags[1]?.label || "—"}、C→{tags[2]?.label || "—"} の区分を付けます</DialogDescription>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="クライアント名・件名・番号で絞る" className="h-8 text-sm" />
        <div className="rounded-md border max-h-[50vh] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white sticky top-0"><tr><th className="w-8"></th><th className="text-left px-2 py-1.5 w-20">確度</th><th className="text-left px-2 py-1.5">クライアント・件名</th><th className="text-right px-2 py-1.5 w-28">見込売上</th><th className="text-right px-2 py-1.5 w-28">見込原価</th><th className="w-20"></th></tr></thead>
            <tbody>
              {candidates.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">該当する案件がありません</td></tr>}
              {candidates.map((p) => {
                const done = already.has(p.id);
                return (
                  <tr key={p.id} className={`border-t ${done ? "opacity-50" : "cursor-pointer hover:bg-muted/40"}`} onClick={() => !done && toggle(p.id)}>
                    <td className="px-2 py-1 text-center"><Checkbox checked={checked.has(p.id)} disabled={done} onCheckedChange={() => toggle(p.id)} aria-label={`${p.client_name || ""} ${p.name || ""} を選ぶ`} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="px-2 py-1">{p.deal_probability || "—"}</td>
                    <td className="px-2 py-1"><span className="font-medium">{p.client_name}</span> <span className="text-muted-foreground">{p.name}</span> <span className="text-[10px] text-muted-foreground">{p.project_number}</span></td>
                    <td className="px-2 py-1 text-right tabular-nums">{yen(p.expected_revenue)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{yen(toInt(p.expected_cost) + toInt(p.other_cost))}</td>
                    <td className="px-2 py-1 text-[10px] text-muted-foreground">{done ? "取込済み" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={doImport} disabled={checked.size === 0}>{checked.size} 件を見込に追加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * @param {object} p
 * @param {object[]} p.deals            表示中のパターンの行
 * @param {(deals:object[])=>void} p.onChangeDeals
 * @param {object[]} p.tags             区分
 * @param {object} p.meta               { headcount, headcount_memo, per_person_sales, per_person_gross }
 * @param {(patch:object)=>void} p.onChangeMeta   区分・人数の保存（パターンをまたいで共通）
 * @param {number} p.grossMust          最低粗利目標（必達粗利の年間合計）
 * @param {object} p.appAnnual          アプリ側の年計 { total: {sales, gross}, actual: {...}, forecast: {...} }
 * @param {object[]} p.projects
 * @param {string} p.fiscalLabel
 */
export default function DealPipeline({ deals, onChangeDeals, tags, meta, onChangeMeta, grossMust, appAnnual, projects, fiscalLabel, readOnly = false }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const projectsById = useMemo(() => Object.fromEntries((projects || []).map((p) => [p.id, p])), [projects]);
  const summary = useMemo(() => pipelineSummary({ deals, grossMust, headcount: meta.headcount, perPersonSales: meta.per_person_sales, perPersonGross: meta.per_person_gross }), [deals, grossMust, meta]);

  const set = (next) => onChangeDeals(renumber(next));
  const patch = (id, data) => set(deals.map((d) => (d.id === id ? { ...d, ...data } : d)));
  const add = (section) => set([...deals, newDeal(section, { sort: 9999 })]);
  const remove = (id) => { const d = deals.find((x) => x.id === id); if (d && (d.name || d.sales || d.purchase) && !window.confirm(`「${d.name || "（名前なし）"}」を削除しますか？`)) return; set(deals.filter((x) => x.id !== id)); };
  const duplicate = (id) => { const i = deals.findIndex((x) => x.id === id); if (i < 0) return; const copy = { ...deals[i], id: crypto.randomUUID(), project_id: null }; set([...deals.slice(0, i + 1), copy, ...deals.slice(i + 1)]); };
  const swap = (id) => patch(id, { section: deals.find((x) => x.id === id)?.section === "confirmed" ? "forecast" : "confirmed", sort: 9999 });
  const move = (id, dir) => {
    const d = deals.find((x) => x.id === id); if (!d) return;
    const same = deals.filter((x) => x.section === d.section);
    const i = same.findIndex((x) => x.id === id); const j = i + dir;
    if (j < 0 || j >= same.length) return;
    const order = same.map((x) => x.id); [order[i], order[j]] = [order[j], order[i]];
    set(deals.map((x) => (x.section === d.section ? { ...x, sort: order.indexOf(x.id) } : x)));
  };
  const exportCsv = () => {
    const blob = new Blob([pipelineToCsv({ deals, tags, summary, fiscalLabel })], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `案件の積み上げ_${fiscalLabel || ""}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const Stat = ({ label, value, sub, tone }) => (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-base font-bold tabular-nums ${tone || ""}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
  const all = summary.all;
  const hc = summary.headcount;
  const perOk = (v, target) => (v === null ? "" : v >= target ? "text-emerald-700" : "text-red-700");

  return (
    <div className="space-y-3" data-testid="deal-pipeline">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">案件の積み上げ（確定／見込）</span>
        <span className="text-[11px] text-muted-foreground">税別・円で入力。税込は ×1.1 で表示</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {tags.map((t) => <span key={t.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${DEAL_COLORS[t.color].row} ${DEAL_COLORS[t.color].text}`}><span className={`w-2 h-2 rounded-full ${DEAL_COLORS[t.color].chip}`} />{t.label}</span>)}
          {!readOnly && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setSettingsOpen(true)}><Settings2 className="w-3.5 h-3.5" /> 区分と人数</Button>}
          {!readOnly && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setImportOpen(true)}><FolderInput className="w-3.5 h-3.5" /> 案件一覧から取り込む</Button>}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportCsv} disabled={deals.length === 0}><Download className="w-3.5 h-3.5" /> CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
        {SECTIONS.map(([key, label]) => (
          <SectionTable key={key} sectionKey={key} label={label} rows={deals.filter((d) => d.section === key)} tags={tags} projectsById={projectsById}
            onPatch={patch} onAdd={add} onRemove={remove} onDuplicate={duplicate} onMove={move} onSwap={swap} readOnly={readOnly} />
        ))}
      </div>

      <Card className="bg-muted/20">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">確定＋見込</span>
            <span className="text-[11px] text-muted-foreground">最低粗利目標は目標設定の「必達粗利」の年間合計（{yen(summary.grossMust)}）</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2" data-testid="pipeline-summary">
            <Stat label="売上（税別）" value={yen(all.sales)} sub={`税込 ${yen(all.sales_tax)}`} />
            <Stat label="仕入（税別）" value={yen(all.purchase)} sub={`税込 ${yen(all.purchase_tax)}`} />
            <Stat label="粗利（税別）" value={yen(all.gross)} sub={`税込 ${yen(all.gross_tax)}`} />
            <Stat label="粗利率" value={pct(all.margin)} />
            <Stat label="最低粗利目標との差" value={yen(all.target.diff)} sub={all.target.rate === null ? "目標が未設定" : `達成率 ${pct(all.target.rate)}`} tone={all.target.diff < 0 ? "text-red-700" : "text-emerald-700"} />
            <Stat label="確定だけの達成率" value={pct(summary.confirmed.target.rate)} sub={`確定の粗利 ${yen(summary.confirmed.gross)}`} tone={summary.confirmed.target.diff < 0 ? "text-red-700" : "text-emerald-700"} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label={`売上／人${hc ? `（${hc} 人）` : ""}`} value={hc ? yen(all.per_person.sales) : "人数が未設定"} sub={`目標 ${yen(summary.perPersonSales)}${hc ? `　確定だけ ${yen(summary.confirmed.per_person.sales)}` : ""}`} tone={hc ? perOk(all.per_person.sales, summary.perPersonSales) : ""} />
            <Stat label={`粗利／人${hc ? `（${hc} 人）` : ""}`} value={hc ? yen(all.per_person.gross) : "人数が未設定"} sub={`目標 ${yen(summary.perPersonGross)}${hc ? `　確定だけ ${yen(summary.confirmed.per_person.gross)}` : ""}`} tone={hc ? perOk(all.per_person.gross, summary.perPersonGross) : ""} />
            <Stat label="アプリの実績＋着地見込（売上）" value={yen(appAnnual?.total?.sales)} sub={`実績 ${yen(appAnnual?.actual?.sales)}／着地見込 ${yen(appAnnual?.forecast?.sales)}`} />
            <Stat label="アプリの実績＋着地見込（粗利）" value={yen(appAnnual?.total?.gross)} sub="請求書と案件一覧から。一覧との差の確認用" />
          </div>
          {meta.headcount_memo && <p className="text-[11px] text-muted-foreground">人数のメモ: {meta.headcount_memo}</p>}
        </CardContent>
      </Card>

      {settingsOpen && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} tags={tags} meta={meta} onSave={onChangeMeta} />}
      {importOpen && <ImportDialog open={importOpen} onOpenChange={setImportOpen} projects={projects} deals={deals} tags={tags} onImport={(rows) => set([...deals, ...rows.map((r) => ({ ...r, sort: 9999 }))])} />}
    </div>
  );
}
