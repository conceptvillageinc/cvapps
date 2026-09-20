import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FileUp, Download, Table2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { LINE_ITEM_CATEGORIES } from "@/lib/constants";
import { parseSheetItems, templateCsv } from "@/lib/sheetImport";

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;
const CATEGORY_LABELS = LINE_ITEM_CATEGORIES.map((c) => c.label);

/**
 * スプレッドシートからの明細取込。
 * Google スプレッドシート／Excel で範囲をコピーして貼り付けるか、CSV を選ぶ。
 * 見出し行（大カテゴリ・名称・数量・単位・単価・金額・原価・備考）は自動判定。
 */
export default function SheetImport({ onAdd, onClose }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [excluded, setExcluded] = useState(new Set());
  const [headings, setHeadings] = useState(true);
  const [subtotals, setSubtotals] = useState(true);
  const [catOverride, setCatOverride] = useState({}); // rowIndex → category
  const fileRef = useRef(null);

  const run = (src) => {
    const r = parseSheetItems(src);
    setParsed(r);
    setExcluded(new Set());
    setCatOverride({});
    const items = r.rows.filter((x) => x.kind === "item").length;
    if (items === 0) toast.error("明細として読み取れる行がありません");
    else toast.success(`${items}行の明細を読み取りました。内容を確認して追加してください`);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    let t;
    try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { t = new TextDecoder("shift_jis").decode(buf); }
    setText(t);
    run(t);
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob([templateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "見積明細テンプレート.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const rows = parsed?.rows || [];
  const visible = useMemo(() => rows.map((r, i) => ({ ...r, i })).filter((r) => r.kind !== "skip"), [rows]);
  const included = visible.filter((r) => r.kind === "item" && !excluded.has(r.i));
  const total = included.reduce((s, r) => s + Number(r.amount || 0), 0);

  const submit = () => {
    if (included.length === 0) { toast.error("追加する明細を選んでください"); return; }
    const out = [];
    let groupItems = [];
    let groupName = "";
    const flush = () => {
      if (subtotals && groupItems.length > 1 && groupName) {
        out.push({ row_type: "subtotal", name: `${groupName} 小計`, amount: 0, source_type: "subtotal" });
      }
      groupItems = [];
    };
    for (const r of visible) {
      if (r.kind === "heading") {
        if (headings) { flush(); groupName = r.name; out.push({ row_type: "text", text: r.name }); }
        continue;
      }
      if (excluded.has(r.i)) continue;
      const item = {
        row_type: "item",
        category: catOverride[r.i] || r.category,
        name: r.level > 0 ? `${"　".repeat(r.level)}${r.name}` : r.name,
        quantity: r.quantity, unit: r.unit, unit_price: r.unit_price, amount: r.amount,
        ...(r.cost_price != null ? { cost_price: r.cost_price } : {}),
        ...(r.notes ? { notes: r.notes } : {}),
        source_type: "sheet_import",
      };
      out.push(item);
      groupItems.push(item);
    }
    flush();
    onAdd(out);
    toast.success(`${included.length}行を明細に追加しました`);
    onClose();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="hidden" onChange={onFile} />
        <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => fileRef.current?.click()}><FileUp className="w-3.5 h-3.5" /> CSVを選ぶ</Button>
        <Button size="sm" variant="ghost" className="text-xs gap-1.5" onClick={downloadTemplate}><Download className="w-3.5 h-3.5" /> テンプレートCSV</Button>
        <span className="text-[10px] text-muted-foreground">Google スプレッドシート／Excel は、範囲を選んでコピー → 下に貼り付けでも取り込めます</span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.includes("\t")) { e.preventDefault(); setText(t); run(t); } }}
        rows={parsed ? 3 : 8}
        placeholder={"ここにシートの内容を貼り付け（見出し行を含めると列を自動判定します）\n例:\n項目\t数量\t単位\t単価（税別）\t金額（税別）\t備考\nデザイン費関連\nTOPページ\t1\tページ\t200000\t200000"}
        className="text-xs font-mono"
      />
      {!parsed && (
        <Button size="sm" className="text-xs gap-1.5" onClick={() => run(text)} disabled={!text.trim()}><Table2 className="w-3.5 h-3.5" /> 読み取る</Button>
      )}

      {parsed && (
        <>
          {parsed.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {w}</p>
          ))}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer"><Checkbox checked={headings} onCheckedChange={(v) => setHeadings(!!v)} /> 見出し行も追加する（テキスト行）</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><Checkbox checked={subtotals} onCheckedChange={(v) => setSubtotals(!!v)} /> 見出しごとに小計行を付ける</label>
            <span className="ml-auto text-muted-foreground">{included.length}行　合計 {yen(total)}（税抜）</span>
          </div>
          <div className="max-h-[45vh] overflow-auto border rounded-md">
            <table className="text-xs w-full">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-2 py-1.5 w-6"></th>
                  <th className="px-2 py-1.5 text-left font-medium w-32">大カテゴリ</th>
                  <th className="px-2 py-1.5 text-left font-medium">名称</th>
                  <th className="px-2 py-1.5 text-right font-medium">数量</th>
                  <th className="px-2 py-1.5 text-left font-medium">単位</th>
                  <th className="px-2 py-1.5 text-right font-medium">単価</th>
                  <th className="px-2 py-1.5 text-right font-medium">金額</th>
                  <th className="px-2 py-1.5 text-right font-medium">原価</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => r.kind === "heading" ? (
                  <tr key={r.i} className="bg-muted/30">
                    <td></td>
                    <td colSpan={7} className="px-2 py-1 font-medium">{r.name} <Badge variant="outline" className="text-[9px] font-normal ml-1">見出し</Badge></td>
                  </tr>
                ) : (
                  <tr key={r.i} className={`border-t ${excluded.has(r.i) ? "opacity-40" : ""}`}>
                    <td className="px-2 py-1"><Checkbox checked={!excluded.has(r.i)} onCheckedChange={() => setExcluded((prev) => { const n = new Set(prev); n.has(r.i) ? n.delete(r.i) : n.add(r.i); return n; })} /></td>
                    <td className="px-2 py-1">
                      <select value={catOverride[r.i] || r.category} onChange={(e) => setCatOverride({ ...catOverride, [r.i]: e.target.value })} className="h-7 rounded border bg-background px-1 text-[11px] w-full">
                        {CATEGORY_LABELS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1"><span style={{ paddingLeft: `${r.level * 12}px` }}>{r.name}</span>{r.percent && <Badge variant="outline" className="text-[9px] font-normal ml-1">{r.percent}%</Badge>}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{Number(r.quantity).toLocaleString()}</td>
                    <td className="px-2 py-1">{r.unit}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{Number(r.unit_price).toLocaleString()}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">{Number(r.amount).toLocaleString()}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.cost_price != null ? Number(r.cost_price).toLocaleString() : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">「コンセプト設計（全体予算の5%）」のような行は、シートの金額のまま取り込みます。追加後に自動計算行へ置き換えることもできます</p>
          <div className="flex justify-between">
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => { setParsed(null); }}>読み取り直す</Button>
            <Button size="sm" className="text-xs" onClick={submit} disabled={included.length === 0}>明細に追加（{included.length}行）</Button>
          </div>
        </>
      )}
    </div>
  );
}
