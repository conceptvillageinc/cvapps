import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { StickyNote, Loader2, Check, Lock } from "lucide-react";

// ============================================================================
// 売上粗利管理表のメモ: 「着地見込のみ」「実績のみ」「シミュレーション」の表示ごとに、別々のメモを期ごとに残す
//   保存先は sales_report_memos（期 × 表示で 1 行）。見られる・書けるのは SALES_MEMO_EMAILS の人だけ
//   （データベースの決まりでも同じ人だけ。SQL 0060 の can_view_sales_memos()。変えるときは両方そろえる）
//   書いて枠の外をクリックするか、入力が落ち着いたら（1.5 秒）保存する。表示を切り替えたときも書きかけを保存する
//   （呼ぶ側で key={`${fy}-${mode}`} を付けて、表示ごとに作り直す）
// ============================================================================

export const SALES_MEMO_EMAILS = ["daichi@concept-village.co.jp"];
export function useSalesMemoAccess() {
  const { user } = useAuth();
  return SALES_MEMO_EMAILS.includes(String(user?.email || "").toLowerCase());
}

const DELAY = 1500;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function SalesReportMemo({ fy, mode, label }) {
  const allowed = useSalesMemoAccess();
  if (!allowed) return null;
  return <MemoBox fy={fy} mode={mode} label={label} />;
}

function MemoBox({ fy, mode, label }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = ["salesReportMemos", fy];
  const { data: rows = [], isFetched } = useQuery({ queryKey: key, queryFn: () => db.entities.SalesReportMemo.filter({ fiscal_year: fy }), retry: false });
  const row = rows.find((r) => r.mode === mode) || null;
  const [text, setText] = useState(row?.body || "");
  const dirty = useRef(false);
  const timer = useRef(null);
  // 読み込めたら・ほかの画面で保存されたら追従する（書きかけのときは上書きしない）
  useEffect(() => { if (!dirty.current) setText(row?.body || ""); }, [row?.body, isFetched]);

  // 保存は 1 つずつ順に（作成中にもう一度保存しても、行が 2 つできないように）
  const idRef = useRef(null);
  const lastSaved = useRef(null);
  const chain = useRef(Promise.resolve());
  const [pending, setPending] = useState(0);
  if (idRef.current === null && row?.id) idRef.current = row.id;
  if (lastSaved.current === null && isFetched) lastSaved.current = row?.body || "";
  const commit = (value = text) => {
    clearTimeout(timer.current);
    if (value === (lastSaved.current ?? row?.body ?? "")) { dirty.current = false; return; }
    lastSaved.current = value;
    setPending((n) => n + 1);
    chain.current = chain.current.then(async () => {
      const payload = { body: value, updated_by: user?.full_name || user?.email || "" };
      const id = idRef.current || (qc.getQueryData(key) || []).find((r) => r.mode === mode)?.id;
      if (id) await db.entities.SalesReportMemo.update(id, payload);
      else idRef.current = (await db.entities.SalesReportMemo.create({ fiscal_year: fy, mode, ...payload }))?.id || null;
      if (lastSaved.current === value) dirty.current = false;
      qc.invalidateQueries({ queryKey: key });
    }).catch((err) => {
      lastSaved.current = null;
      toast.error("メモを保存できませんでした: " + (err?.message || "不明なエラー"));
    }).finally(() => setPending((n) => n - 1));
  };
  const onChange = (v) => {
    setText(v); dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(v), DELAY);
  };
  // 表示を切り替える（この欄が消える）ときに、書きかけを保存する
  const latestText = useRef(text);
  latestText.current = text;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current) commitRef.current(latestText.current); }, []);

  return (
    <div className="rounded-xl border bg-card px-4 py-3 space-y-1.5" data-testid="sales-report-memo">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-semibold text-foreground">メモ（{label}）</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Lock className="w-3 h-3" />あなただけに見えています。表示ごとに別々のメモです（この期の分）</span>
        <span className="ml-auto text-[11px] text-muted-foreground inline-flex items-center gap-1">
          {pending > 0 ? <><Loader2 className="w-3 h-3 animate-spin" />保存中</> : dirty.current ? "入力中…" : row?.updated_at ? <><Check className="w-3 h-3 text-emerald-600" />{fmt(row.updated_at)}{row.updated_by ? `・${row.updated_by}` : ""}</> : null}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => commit()}
        rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
        placeholder={`${label}の表についてのメモ（前提・気になる案件・次にやることなど）`}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
        data-testid="sales-report-memo-text"
      />
    </div>
  );
}
