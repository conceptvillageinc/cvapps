import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight, FileText, Receipt, UserRound } from "lucide-react";
import DeliveryBadge from "@/components/documents/DeliveryBadge";
import { projectDelivery, estimateDelivery, DELIVERY_STATE, DELIVERY_STATE_ORDER, monthEndOf } from "@/lib/deliveryStatus";
import { submissionOf } from "@/lib/submission";
import { todayString } from "@/lib/fiscal";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const md = (s) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : "—");
const shiftMonth = (ym, d) => { const [y, m] = ym.split("-").map(Number); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
const NO_PERSON = "担当者未設定";

/**
 * 月末チェック（納品・請求）: 全体 MTG で、月末の納品書・請求書の漏れを担当者ごとに確かめる。
 *   出す案件: 完了予定がその月の案件（失注・取消を除く）と、前の月までに完了予定で請求がまだの案件。
 *   担当者: 案件に紐づく見積の「見積作成担当者」（提出済の見積 → 新しい見積の順）。
 * @param {object} p
 * @param {object[]} p.projects       すべての期の案件
 * @param {{ byProject: Map }} p.deliveryIndex
 */
export default function MonthEndView({ projects, isLoading, deliveryIndex }) {
  const today = todayString();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [stateFilter, setStateFilter] = useState(null); // null = すべて
  const { data: estimates = [] } = useQuery({ queryKey: ["estimates", "all", "monthend"], queryFn: () => db.entities.Estimate.list("-created_date", 2000) });

  // 案件 → 担当者と、納品書を作るときの見積（提出済の見積を優先）
  const estByProject = useMemo(() => {
    const m = new Map();
    for (const e of estimates) {
      if (!e.project_id) continue;
      const cur = m.get(e.project_id);
      const better = !cur || (submissionOf(e) === "submitted" && submissionOf(cur) !== "submitted");
      if (better) m.set(e.project_id, e);
    }
    return m;
  }, [estimates]);

  const monthStart = `${month}-01`;
  const monthEnd = monthEndOf(monthStart);
  const rows = useMemo(() => projects
    .filter((p) => p.status !== "lost" && p.status !== "cancelled" && p.due_date)
    .map((p) => {
      const est = estByProject.get(p.id) || null;
      const d = projectDelivery(p, deliveryIndex.byProject);
      // 分納: 見積のうち納品書にした割合（見積が分かるときだけ）
      const partial = est && d.state !== "none" ? estimateDelivery(est, deliveryIndex.byEstimate, { submitted: true }).partial : null;
      return { p, d: { ...d, partial }, est };
    })
    .filter(({ p, d }) => {
      const due = String(p.due_date);
      if (due >= monthStart && due <= monthEnd) return true; // その月の完了予定
      return due < monthStart && d.state !== "invoiced"; // 前の月までで、請求がまだ
    }), [projects, deliveryIndex, estByProject, monthStart, monthEnd]);

  const count = (st) => rows.filter((r) => r.d.state === st).length;
  const shown = stateFilter ? rows.filter((r) => r.d.state === stateFilter) : rows;
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of shown) {
      const person = r.est?.person_in_charge || NO_PERSON;
      m.set(person, [...(m.get(person) || []), r]);
    }
    return [...m.entries()]
      .map(([person, list]) => [person, list.sort((a, b) => String(a.p.due_date).localeCompare(String(b.p.due_date)))])
      .sort(([a], [b]) => (a === NO_PERSON) - (b === NO_PERSON) || a.localeCompare(b, "ja"));
  }, [shown]);

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3" data-testid="monthend-view">
      {/* 月の切り替えと、状態ごとの件数（押すとその状態だけ） */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border bg-white">
          <button type="button" className="px-2 py-1.5 hover:bg-muted/50" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="前の月"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-2 text-sm font-semibold tabular-nums">{Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月</span>
          <button type="button" className="px-2 py-1.5 hover:bg-muted/50" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="次の月"><ChevronRight className="w-4 h-4" /></button>
        </div>
        {month !== today.slice(0, 7) && <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMonth(today.slice(0, 7))}>今月に戻る</Button>}
        <div className="flex flex-wrap items-center gap-1.5 ml-auto text-xs" data-testid="monthend-summary">
          <button type="button" onClick={() => setStateFilter(null)} className={`rounded-full border px-2.5 py-1 ${!stateFilter ? "bg-slate-800 text-white border-slate-800" : "bg-white hover:bg-muted/50"}`}>すべて {rows.length}件</button>
          {DELIVERY_STATE_ORDER.map((st) => (
            <button key={st} type="button" onClick={() => setStateFilter(stateFilter === st ? null : st)} className={`rounded-full border px-2.5 py-1 ${stateFilter === st ? "ring-2 ring-primary/40" : ""} ${DELIVERY_STATE[st].cls}`}>
              {DELIVERY_STATE[st].label} <b className="tabular-nums">{count(st)}</b>
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">この月に完了予定の案件はありません</CardContent></Card>
      ) : groups.map(([person, list]) => {
        const c = (st) => list.filter((r) => r.d.state === st).length;
        return (
          <Card key={person} className="overflow-hidden" data-testid="monthend-group">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-slate-800 text-white">
              <span className="font-semibold inline-flex items-center gap-1.5"><UserRound className="w-4 h-4" /> {person}</span>
              <span className="text-xs text-white/80">{list.length}件</span>
              <span className="text-xs text-white/80 ml-auto">
                {DELIVERY_STATE_ORDER.filter((st) => c(st) > 0).map((st) => `${DELIVERY_STATE[st].label} ${c(st)}`).join("　")}
              </span>
            </div>
            <div className="divide-y">
              {list.map(({ p, d, est }) => {
                const overdue = String(p.due_date) < today && d.state === "none";
                const firstUninvoiced = d.notes.find((n) => n.status === "issued" && !n.invoice_id);
                return (
                  <div key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm ${d.state === "none" && String(p.due_date) <= monthEnd ? "bg-red-50/40" : ""}`} data-testid="monthend-row">
                    <span className={`w-14 shrink-0 tabular-nums text-xs ${overdue ? "text-red-700 font-semibold" : "text-muted-foreground"}`} title="完了予定">{md(p.due_date)}</span>
                    <span className="w-28 shrink-0"><DeliveryBadge info={d} due={p.status === "open" && String(p.due_date) <= monthEnd} /></span>
                    <Link to={`/projects/${p.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 hover:underline">
                      <span className="text-[11px] text-muted-foreground mr-2">{p.client_name}</span>
                      <span className="font-medium">{p.name}</span>
                    </Link>
                    <span className="tabular-nums text-xs text-muted-foreground w-24 text-right">{yen(p.expected_revenue)}</span>
                    <span className="w-36 shrink-0 text-right">
                      {d.state === "none" && est && <Link to={`/delivery-notes/new?estimate=${est.id}`} className="inline-flex items-center gap-1 rounded border border-primary/40 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/5"><FileText className="w-3 h-3" /> 納品書を作る</Link>}
                      {d.state === "none" && !est && <Link to={`/delivery-notes/new?project=${p.id}`} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50"><FileText className="w-3 h-3" /> 納品書を作る</Link>}
                      {d.state === "draft" && <Link to={`/delivery-notes/${d.notes[0].id}`} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-muted/50"><FileText className="w-3 h-3" /> 下書きを開く</Link>}
                      {firstUninvoiced && <Link to={`/invoices/new?delivery=${firstUninvoiced.id}`} className="inline-flex items-center gap-1 rounded border border-amber-400 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-50"><Receipt className="w-3 h-3" /> 請求書を作る</Link>}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      <p className="text-[11px] text-muted-foreground">完了予定がこの月の案件と、前の月までに完了予定で請求がまだの案件です（失注・取消は除く）。担当者は、案件の見積の「見積作成担当者」。印は納品書・請求書のつながりから自動で決まり、完了予定が今月中か過ぎている未納品は赤で出します</p>
    </div>
  );
}
