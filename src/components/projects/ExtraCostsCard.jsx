import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { todayString } from "@/lib/fiscal";
import { isImeEnter } from "@/lib/ime";
import { extraCostsTotal } from "@/lib/extraCosts";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const newId = () => `xc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * 見積外の原価（見積には入っていないが、仕入で後から原価に入る金額）。原価計算表の「掛け率 1.00 の行」にあたる。
 *   行は projects.extra_costs に持ち、合計は「その他費用」（other_cost）に足し込む
 *   （粗利見込・売上粗利管理表・資金繰りはその他費用を見るので、そのまま反映される）。
 *   見積書・請求書には出ない。売価には足さない。
 */
export default function ExtraCostsCard({ project }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const serverRows = Array.isArray(project.extra_costs) ? project.extra_costs : [];
  // その他費用 = 手で入れた分 + 見積外の原価の合計。手で入れた分はこの欄では変わらない
  const manualOther = Math.max(0, (Number(project.other_cost) || 0) - extraCostsTotal(serverRows));
  // 続けて直しても前の変更を消さないよう、手元の行を正にして、保存は 1 つずつ順番に（最後の内容を必ず保存する）
  const [rows, setRows] = useState(serverRows);
  // サーバーの値が「変わったとき」だけ手元に合わせる（保存の直後に届く古い値で、手元の入力を戻さない）
  const [seen, setSeen] = useState(JSON.stringify(serverRows));
  const [saving, setSaving] = useState(false);
  const latest = useRef(serverRows);
  const dirty = useRef(false);
  const inflight = useRef(false);
  const serverJson = JSON.stringify(serverRows);
  if (serverJson !== seen) {
    setSeen(serverJson);
    if (!inflight.current && !dirty.current && serverJson !== JSON.stringify(latest.current)) { setRows(serverRows); latest.current = serverRows; }
  }
  const total = extraCostsTotal(rows);

  const flush = async () => {
    if (inflight.current) return;
    inflight.current = true; setSaving(true);
    try {
      while (dirty.current) {
        dirty.current = false;
        const next = latest.current;
        await db.entities.Project.update(project.id, { extra_costs: next, other_cost: manualOther + extraCostsTotal(next) });
      }
    } catch (err) {
      toast.error("見積外の原価を保存できませんでした: " + (err?.message || "不明なエラー"));
    } finally {
      inflight.current = false; setSaving(false);
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  };
  const commit = (next) => { setRows(next); latest.current = next; dirty.current = true; flush(); };
  const setRow = (id, patch) => {
    const next = latest.current.map((r) => (r.id === id ? { ...r, ...patch } : r));
    if (JSON.stringify(next) !== JSON.stringify(latest.current)) commit(next);
  };
  const addRow = () => commit([...latest.current, { id: newId(), date: todayString(), author: user?.full_name || user?.email || "", name: "", vendor: "", amount: 0, memo: "" }]);
  const removeRow = (id) => commit(latest.current.filter((r) => r.id !== id));

  return (
    <Card data-testid="extra-costs">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2"><PackagePlus className="w-4 h-4" /> 見積外の原価 <span className="text-[11px] font-normal text-muted-foreground">見積には入っていないが、仕入で後から原価に入る金額（税抜）</span></CardTitle>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addRow} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 行を追加
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">まだありません。「行を追加」から、あとで仕入に入った金額を記録できます（合計はその他費用に足され、粗利見込に反映されます）</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground border-b">
                  <th className="text-left font-medium py-1 pr-2 w-32">記入日</th>
                  <th className="text-left font-medium py-1 pr-2 w-28">記入者</th>
                  <th className="text-left font-medium py-1 pr-2">項目</th>
                  <th className="text-left font-medium py-1 pr-2 w-36">仕入先</th>
                  <th className="text-right font-medium py-1 pr-2 w-28">金額（税抜）</th>
                  <th className="text-left font-medium py-1 pr-2">メモ</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1 pr-2"><input type="date" defaultValue={r.date || ""} onBlur={(e) => setRow(r.id, { date: e.target.value })} className={CELL} aria-label="記入日" /></td>
                    <td className="py-1 pr-2"><TextCell value={r.author} onCommit={(v) => setRow(r.id, { author: v })} label="記入者" /></td>
                    <td className="py-1 pr-2"><TextCell value={r.name} onCommit={(v) => setRow(r.id, { name: v })} label="項目" placeholder="例: マッチ売りの少女（追加仕入）" /></td>
                    <td className="py-1 pr-2"><TextCell value={r.vendor} onCommit={(v) => setRow(r.id, { vendor: v })} label="仕入先" placeholder="例: グラフィック" /></td>
                    <td className="py-1 pr-2"><TextCell value={r.amount ? Number(r.amount).toLocaleString() : ""} onCommit={(v) => setRow(r.id, { amount: Number(String(v).replace(/[,，¥円\s]/g, "")) || 0 })} label="金額" placeholder="0" className="text-right tabular-nums" inputMode="decimal" /></td>
                    <td className="py-1 pr-2"><TextCell value={r.memo} onCommit={(v) => setRow(r.id, { memo: v })} label="メモ" placeholder="例: 色校正で追加" /></td>
                    <td className="py-1 text-right"><button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => removeRow(r.id)} aria-label="この行を消す"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="pt-1.5 text-right text-[11px] text-muted-foreground">合計（その他費用に入っています）</td>
                  <td className="pt-1.5 pr-2 text-right font-semibold tabular-nums">{yen(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">見積書・請求書には出ません。売価には足さず、原価（その他費用）にだけ入ります。実績の発注合計は、これまでどおり案件の「編集」で入れてください</p>
      </CardContent>
    </Card>
  );
}

const CELL = "w-full h-7 rounded border border-transparent bg-slate-50 px-1.5 text-xs outline-none hover:border-input focus:bg-background focus:border-primary";

/** 書いて Enter か枠の外で保存する 1 行の入力 */
function TextCell({ value, onCommit, label, placeholder = "", className = "", inputMode }) {
  const [text, setText] = useState(value ?? "");
  const [base, setBase] = useState(value ?? "");
  if ((value ?? "") !== base) { setBase(value ?? ""); setText(value ?? ""); }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== (value ?? "")) onCommit(text.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter" && !isImeEnter(e)) { e.preventDefault(); e.currentTarget.blur(); } }}
      placeholder={placeholder}
      aria-label={label}
      inputMode={inputMode}
      className={`${CELL} ${className}`}
    />
  );
}
