import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { emptyTargets } from "@/lib/salesReport";
import { StickyNote, Loader2, Check } from "lucide-react";

// ============================================================================
// 売上粗利管理表のメモ: 「着地見込のみ」「実績のみ」「シミュレーション」の表示ごとに、別々のメモを期ごとに残す
//   保存先は fiscal_targets.memos（{ forecast: { text, updated_at, updated_by }, actual: {...}, simulation: {...} }）
//   書いて枠の外をクリックするか、入力が落ち着いたら（1.5 秒）保存する。表示を切り替えたときも書きかけを保存する
//   （呼ぶ側で key={`${fy}-${mode}`} を付けて、表示ごとに作り直す）
// ============================================================================

const DELAY = 1500;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function SalesReportMemo({ fy, targets, mode, label }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const memos = (targets?.memos && typeof targets.memos === "object") ? targets.memos : {};
  const saved = memos[mode] || {};
  const [text, setText] = useState(saved.text || "");
  const dirty = useRef(false);
  const timer = useRef(null);
  // ほかの人の保存に追従（書きかけのときは上書きしない）
  useEffect(() => { if (!dirty.current) setText(saved.text || ""); }, [saved.text]);

  const save = useMutation({
    mutationFn: async (value) => {
      // ほかの表示のメモを消さないよう、いちばん新しい行に足す
      const latest = (qc.getQueryData(["fiscalTargets"]) || []).find((t) => Number(t.fiscal_year) === Number(fy)) || targets;
      const base = latest?.memos && typeof latest.memos === "object" ? latest.memos : memos;
      const next = { ...base, [mode]: { text: value, updated_at: new Date().toISOString(), updated_by: user?.full_name || user?.email || "" } };
      if (latest?.id) return db.entities.FiscalTarget.update(latest.id, { memos: next });
      return db.entities.FiscalTarget.create({ ...emptyTargets(fy), memos: next });
    },
    onSuccess: () => { dirty.current = false; qc.invalidateQueries({ queryKey: ["fiscalTargets"] }); },
    onError: (err) => toast.error("メモを保存できませんでした: " + (err?.message || "不明なエラー")),
  });
  const commit = (value = text) => {
    clearTimeout(timer.current);
    if (value === (saved.text || "")) { dirty.current = false; return; }
    save.mutate(value);
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
    <div className="rounded-xl border bg-yellow-50/60 border-yellow-200 px-4 py-3 space-y-1.5" data-testid="sales-report-memo">
      <div className="flex items-center gap-2 text-xs">
        <StickyNote className="w-3.5 h-3.5 text-yellow-700" />
        <span className="font-semibold text-yellow-900">メモ（{label}）</span>
        <span className="text-[11px] text-muted-foreground">表示ごとに別々のメモです（この期の分）</span>
        <span className="ml-auto text-[11px] text-muted-foreground inline-flex items-center gap-1">
          {save.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />保存中</> : dirty.current ? "入力中…" : saved.updated_at ? <><Check className="w-3 h-3 text-emerald-600" />{fmt(saved.updated_at)}{saved.updated_by ? `・${saved.updated_by}` : ""}</> : null}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => commit()}
        rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
        placeholder={`${label}の表についてのメモ（前提・気になる案件・次にやることなど）`}
        className="w-full rounded-md border border-yellow-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-yellow-300"
        data-testid="sales-report-memo-text"
      />
    </div>
  );
}
