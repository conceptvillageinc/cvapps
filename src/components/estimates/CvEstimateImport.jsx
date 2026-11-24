import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, FileUp, AlertTriangle, X, Check, ClipboardPaste, FileText, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import NumericField from "@/components/estimates/NumericField";
import { lineAmount } from "@/lib/constants";
import { CATEGORY_LABELS, MAX_FILES, extractCvEstimate, normalizeRows, toLineItems } from "@/lib/cvEstimateImport";

const yen = (n) => `¥${(Number(n) || 0).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}`;
const ACCEPT = "application/pdf,image/*";
const isAccepted = (f) => f && (f.type === "application/pdf" || f.type.startsWith("image/"));

/**
 * CV の既存の見積書（PDF・スクショ）から明細をそのまま取り込む。
 * 金額は出し値（単価・金額）のまま。見出しはテキスト行、小計は小計行にする。
 *
 * props:
 *   onAdd(items)          明細を追加する
 *   onAppendNotes(text)   見積の備考に足す（任意）
 *   onClose()
 */
export default function CvEstimateImport({ onAdd, onAppendNotes, onClose }) {
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { info, rows }
  const [excluded, setExcluded] = useState(new Set());
  const [withNotes, setWithNotes] = useState(true);

  const addFiles = (list) => {
    const picked = Array.from(list || []).filter(isAccepted);
    if (picked.length === 0) { toast.error("PDF か画像を選んでください"); return; }
    setFiles((prev) => {
      const next = [...prev, ...picked];
      if (next.length > MAX_FILES) toast.warning(`一度に読めるのは ${MAX_FILES} つまでです（先の ${MAX_FILES} つを使います）`);
      return next.slice(0, MAX_FILES);
    });
  };

  // スクショは Ctrl+V（⌘+V）でそのまま貼り付けられる
  useEffect(() => {
    if (result) return undefined;
    const onPaste = (e) => {
      const imgs = Array.from(e.clipboardData?.files || []).filter(isAccepted);
      if (imgs.length === 0) return;
      e.preventDefault();
      addFiles(imgs.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `スクショ${Date.now()}_${i}.png`, { type: f.type || "image/png" }))));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [result]);

  const read = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await extractCvEstimate(files);
      const rows = normalizeRows(r);
      if (!rows.some((x) => x.kind === "item")) {
        setError("明細を読み取れませんでした。見積書の明細表が写ったファイルか確かめてください");
        return;
      }
      setResult({
        info: {
          subject: r?.subject || "",
          client: r?.client_name || "",
          number: r?.estimate_number || "",
          subtotal: Number(r?.subtotal) || 0,
          notes: String(r?.notes || "").normalize("NFC").trim(),
        },
        rows,
      });
      setExcluded(new Set());
    } catch (err) {
      setError(`読み取りに失敗しました: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const patchRow = (i, patch) =>
    setResult((prev) => ({ ...prev, rows: prev.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const toggle = (i) => setExcluded((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const rows = result?.rows || [];
  const chosenItems = useMemo(() => rows.filter((r, i) => r.kind === "item" && !excluded.has(i)), [rows, excluded]);
  const total = chosenItems.reduce((s, r) => s + lineAmount(r.quantity, r.unit_price), 0);
  const allItemsTotal = rows.filter((r) => r.kind === "item").reduce((s, r) => s + lineAmount(r.quantity, r.unit_price), 0);
  const docTotal = result?.info.subtotal || 0;
  const totalMatches = docTotal > 0 && Math.abs(allItemsTotal - docTotal) < 1;

  const submit = () => {
    if (chosenItems.length === 0) { toast.error("追加する明細を選んでください"); return; }
    onAdd(toLineItems(rows, excluded));
    if (withNotes && result.info.notes && onAppendNotes) onAppendNotes(result.info.notes);
    toast.success(`${chosenItems.length}行の明細を追加しました`);
    onClose();
  };

  // --- ファイルを選ぶ ---------------------------------------------------------
  if (!result) {
    return (
      <div className="space-y-3" data-testid="cv-estimate-import">
        <p className="text-xs text-muted-foreground">
          以前に作った CV の見積書（PDF・スクショ）を選ぶと、明細を AI が読み取って<strong>書かれているとおりに</strong>取り込みます。
          金額はそのまま単価・金額になり、見出しはテキスト行、小計は小計行になります（消費税・合計はこの画面で計算し直します）。
        </p>

        <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <div
          className="border-2 border-dashed border-sky-200 rounded-lg bg-sky-50/50 p-5 text-center space-y-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          data-testid="cv-drop"
        >
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={loading} onClick={() => fileRef.current?.click()}>
              <FileUp className="w-3.5 h-3.5" /> PDF・画像を選ぶ
            </Button>
          </div>
          <p className="text-[11px] text-sky-800 flex items-center justify-center gap-1">
            <ClipboardPaste className="w-3.5 h-3.5" /> スクショは <kbd className="px-1 rounded border bg-white text-[10px]">Ctrl</kbd>+<kbd className="px-1 rounded border bg-white text-[10px]">V</kbd>（Mac は ⌘+V）で貼り付けられます。ここにドラッグしても入ります
          </p>
          <p className="text-[10px] text-muted-foreground">複数ページの見積は、ページ順に {MAX_FILES} つまで入れられます</p>
        </div>

        {files.length > 0 && (
          <ul className="space-y-1" data-testid="cv-files">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                <span className="text-muted-foreground w-4 text-right">{i + 1}</span>
                {f.type === "application/pdf" ? <FileText className="w-3.5 h-3.5 text-red-600" /> : <ImageIcon className="w-3.5 h-3.5 text-sky-600" />}
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground">{Math.max(1, Math.round(f.size / 1024)).toLocaleString()}KB</span>
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label="外す" disabled={loading}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex gap-2">
          <Button size="sm" className="text-xs gap-1.5" disabled={files.length === 0 || loading} onClick={read} data-testid="cv-read">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {loading ? "読み取り中…（数十秒かかります）" : `読み取る${files.length ? `（${files.length}つ）` : ""}`}
          </Button>
          <Button size="sm" variant="ghost" className="text-xs" onClick={onClose}>キャンセル</Button>
        </div>
      </div>
    );
  }

  // --- 読み取り結果の確認・直す -----------------------------------------------
  const { info } = result;
  return (
    <div className="space-y-3" data-testid="cv-estimate-review">
      {(info.subject || info.client || info.number) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs bg-muted/40 rounded px-3 py-2">
          {info.subject && <span><span className="text-muted-foreground">件名</span> {info.subject}</span>}
          {info.client && <span><span className="text-muted-foreground">宛先</span> {info.client}</span>}
          {info.number && <span><span className="text-muted-foreground">見積番号</span> {info.number}</span>}
        </div>
      )}

      {docTotal > 0 && (
        totalMatches ? (
          <p className="text-xs text-emerald-700 flex items-center gap-1" data-testid="cv-total-check">
            <Check className="w-3.5 h-3.5" /> 読み取った明細の合計 {yen(allItemsTotal)} が、見積書の合計（税抜）と一致しました
          </p>
        ) : (
          <p className="text-xs text-amber-700 flex items-center gap-1" data-testid="cv-total-check">
            <AlertTriangle className="w-3.5 h-3.5" /> 明細の合計 {yen(allItemsTotal)} が、見積書の合計（税抜）{yen(docTotal)} と合いません（差 {yen(allItemsTotal - docTotal)}）。元の見積書と見比べて直してください
          </p>
        )
      )}

      <div className="max-h-[50vh] overflow-auto border rounded-md">
        <table className="text-xs w-full">
          <thead className="sticky top-0 bg-muted/90 z-10">
            <tr>
              <th className="px-2 py-1.5 w-6"></th>
              <th className="px-2 py-1.5 text-left font-medium w-32">大カテゴリ</th>
              <th className="px-2 py-1.5 text-left font-medium">名称</th>
              <th className="px-2 py-1.5 text-right font-medium w-20">数量</th>
              <th className="px-2 py-1.5 text-left font-medium w-16">単位</th>
              <th className="px-2 py-1.5 text-right font-medium w-24">単価</th>
              <th className="px-2 py-1.5 text-right font-medium w-24">金額</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const off = excluded.has(i);
              const check = <Checkbox checked={!off} onCheckedChange={() => toggle(i)} aria-label="この行を追加する" />;
              if (r.kind !== "item") {
                return (
                  <tr key={i} className={`border-t ${r.kind === "subtotal" ? "bg-slate-50" : "bg-muted/30"} ${off ? "opacity-40" : ""}`}>
                    <td className="px-2 py-1">{check}</td>
                    <td colSpan={6} className="px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <Input value={r.name} onChange={(e) => patchRow(i, { name: e.target.value })} className="h-7 text-xs font-medium" />
                        <Badge variant="outline" className="text-[9px] font-normal shrink-0">{r.kind === "subtotal" ? "小計行" : "テキスト行"}</Badge>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={i} className={`border-t ${off ? "opacity-40" : ""}`}>
                  <td className="px-2 py-1">{check}</td>
                  <td className="px-2 py-1">
                    <select value={r.category} onChange={(e) => patchRow(i, { category: e.target.value })} className="h-7 rounded border bg-background px-1 text-[11px] w-full">
                      {CATEGORY_LABELS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1"><Input value={r.name} onChange={(e) => patchRow(i, { name: e.target.value })} className="h-7 text-xs" /></td>
                  <td className="px-2 py-1"><NumericField value={r.quantity} onCommit={(v) => patchRow(i, { quantity: Number(v) || 0 })} className="h-7 text-xs text-right" /></td>
                  <td className="px-2 py-1"><Input value={r.unit} onChange={(e) => patchRow(i, { unit: e.target.value })} className="h-7 text-xs" /></td>
                  <td className="px-2 py-1"><NumericField value={r.unit_price} onCommit={(v) => patchRow(i, { unit_price: Number(v) || 0 })} className="h-7 text-xs text-right" /></td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium">{lineAmount(r.quantity, r.unit_price).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        {info.notes && onAppendNotes && (
          <label className="flex items-start gap-1.5 cursor-pointer max-w-xl" data-testid="cv-notes">
            <Checkbox checked={withNotes} onCheckedChange={(v) => setWithNotes(!!v)} className="mt-0.5" />
            <span>備考も見積の備考に足す<span className="block text-[10px] text-muted-foreground whitespace-pre-wrap line-clamp-3">{info.notes}</span></span>
          </label>
        )}
        <span className="ml-auto text-muted-foreground">{chosenItems.length}行　合計 {yen(total)}（税抜）</span>
      </div>

      <p className="text-[10px] text-muted-foreground">
        ※ AI の読み取りのため、まちがいがあることがあります。金額は必ず元の見積書と見比べてください。コンセプト・ディレクション・割引などの行も、書かれた金額のまま取り込みます。
      </p>

      <div className="flex justify-between">
        <Button size="sm" variant="ghost" className="text-xs" onClick={() => { setResult(null); setError(null); }}>ファイルを選び直す</Button>
        <Button size="sm" className="text-xs gap-1.5" onClick={submit} disabled={chosenItems.length === 0} data-testid="cv-submit">
          <Check className="w-3.5 h-3.5" /> 明細に追加（{chosenItems.length}行）
        </Button>
      </div>
    </div>
  );
}
