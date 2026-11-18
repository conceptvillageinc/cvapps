import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { History, Loader2 } from "lucide-react";
import { HISTORY_TABLE_LABEL, fieldLabel, visibleFields, formatValue } from "@/lib/recordHistory";

// ============================================================================
// 作成者・最終更新者と、変更の履歴（案件・見積書・納品書・請求書・領収書・発注書・定期売上・クライアント）
//   <RecordHistory table="invoices" record={invoice} />
//   ・1 行目: 「作成 11/18 10:00 馬場 ・ 最終更新 11/18 11:20 服部」
//   ・「変更の履歴」を押すと、いつ・誰が・どの項目を（前 → 後）変えたかの一覧
//   履歴は SQL 0062 のトリガーが書く（それより前の変更は無い。作成者は created_by があれば出す）
// ============================================================================

const when = (iso) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const whenFull = (iso) => (iso ? new Date(iso).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export function useRecordHistory(table, recordId, version = "") {
  return useQuery({
    // 記録が保存されて更新日時が変わったら読み直す
    queryKey: ["recordHistory", table, recordId, version],
    queryFn: () => db.entities.RecordHistory.filter({ table_name: table, record_id: recordId }, "-created_at", 200),
    enabled: !!recordId,
    retry: false,
    staleTime: 30 * 1000,
  });
}

export default function RecordHistory({ table, record, className = "" }) {
  const [open, setOpen] = useState(false);
  const { data: rows = [], isLoading } = useRecordHistory(table, record?.id, record?.updated_at || record?.updated_date || "");
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => db.entities.User.list("full_name"), staleTime: 10 * 60 * 1000 });
  const nameOf = (id) => { const u = users.find((x) => x.id === id); return u ? (u.full_name || u.email) : ""; };
  // 作成: 履歴の「作成」があればそれ、無ければ created_by（この SQL より前に作ったもの）
  const created = useMemo(() => {
    const ins = rows.find((r) => r.action === "insert");
    if (ins) return { at: ins.created_at, by: ins.user_name };
    return { at: record?.created_at || record?.created_date, by: nameOf(record?.created_by) || "" };
  }, [rows, record, users]);
  // 最終更新: いちばん新しい「変更」の履歴。無ければ updated_by
  const updated = useMemo(() => {
    const up = rows.find((r) => r.action === "update" && visibleFields(r.changed_fields).length > 0);
    if (up) return { at: up.updated_at, by: up.user_name };
    return record?.updated_by ? { at: record?.updated_at || record?.updated_date, by: nameOf(record.updated_by) } : null;
  }, [rows, record, users]);
  if (!record?.id) return null;
  const count = rows.filter((r) => r.action !== "update" || visibleFields(r.changed_fields).length > 0).length;

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground ${className}`} data-testid="record-history">
      <span>作成 {when(created.at) || "—"}{created.by ? ` ${created.by}` : "（作成者の記録なし）"}</span>
      {updated && <span>・ 最終更新 {when(updated.at)} {updated.by}</span>}
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-0.5 text-primary hover:underline" data-testid="record-history-open">
        <History className="h-3 w-3" />変更の履歴{count > 0 ? `（${count}）` : ""}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{HISTORY_TABLE_LABEL[table] || ""}の変更の履歴</DialogTitle>
            <DialogDescription className="text-xs">
              変更履歴の確認ができます。同じユーザーが 10 分以内に続けて変更した場合でも1行に集約されます。システム側での記録（メール送付の記録・毎月の自動作成など）は「システム（自動）」と表示されます。
            </DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />読み込み中</p>
          ) : (
            <ol className="space-y-2" data-testid="record-history-list">
              {rows.map((r) => {
                const fields = visibleFields(r.changed_fields || []);
                if (r.action === "update" && fields.length === 0) return null;
                return (
                  <li key={r.id} className="rounded-md border px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold">{r.action === "insert" ? "作成" : r.action === "delete" ? "削除" : "変更"}</span>
                      <span>{r.user_name}</span>
                      <span className="text-muted-foreground tabular-nums">{whenFull(r.created_at)}{r.action === "update" && r.updated_at && when(r.updated_at) !== when(r.created_at) ? ` 〜 ${when(r.updated_at)}` : ""}</span>
                    </div>
                    {fields.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {fields.map((f) => {
                          const d = r.changes?.[f];
                          return (
                            <li key={f} className="flex flex-wrap gap-x-1.5">
                              <span className="text-muted-foreground">{fieldLabel(table, f)}</span>
                              {Array.isArray(d) ? <span><span className="text-slate-500 line-through decoration-slate-300">{formatValue(table, f, d[0])}</span> → <span className="font-medium">{formatValue(table, f, d[1])}</span></span> : <span className="text-slate-500">（変更あり）</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
              {(!created.by || rows.length === 0) && (
                <li className="px-1 text-[11px] text-muted-foreground">
                  {created.at ? `${whenFull(created.at)} 作成${created.by ? `（${created.by}）` : ""}。` : ""}変更があった場合、履歴として記録されます。
                </li>
              )}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
