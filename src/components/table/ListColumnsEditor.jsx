import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUp, ArrowDown, Columns3, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { LIST_DEFS, LIST_KEYS, columnLabel, normalizeListColumns, useAllListColumns, useSaveListColumns } from "@/lib/listColumns";

/**
 * 一覧の列の並びと表示（全員共通）。↑↓ で並べ替え、チェックを外すと一覧に出さない。
 * @param {object} p
 * @param {string} p.list   estimates | delivery_notes | invoices | receipts | partner_orders
 * @param {() => void} [p.onSaved]
 */
export function ListColumnsEditor({ list, onSaved }) {
  const { all, row } = useAllListColumns();
  const save = useSaveListColumns();
  const [cols, setCols] = useState(all[list]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCols(all[list]); }, [all, list]);
  const dirty = JSON.stringify(cols) !== JSON.stringify(all[list]);

  const move = (i, d) => setCols((c) => {
    const j = i + d;
    if (j < 0 || j >= c.length) return c;
    const next = [...c];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const toggle = (i) => setCols((c) => c.map((x, k) => (k === i ? { ...x, visible: !x.visible } : x)));
  const commit = async () => {
    if (!cols.some((c) => c.visible)) { toast.error("1 つ以上の列を表示してください"); return; }
    setBusy(true);
    try { await save(row, all, list, cols); toast.success(`${LIST_DEFS[list].label}一覧の列を保存しました（全員の一覧に反映されます）`); onSaved?.(); }
    catch (e) { toast.error("保存できませんでした: " + e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2" data-testid={`list-columns-${list}`}>
      <div className="rounded-md border divide-y">
        {cols.map((c, i) => (
          <div key={c.key} className={`flex items-center gap-2 px-2 py-1.5 ${c.visible ? "" : "bg-muted/40"}`}>
            <span className="w-5 text-right text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
            <label className="flex items-center gap-2 flex-1 text-sm cursor-pointer">
              <input type="checkbox" checked={c.visible} onChange={() => toggle(i)} aria-label={`${columnLabel(list, c.key)} を表示`} />
              <span className={c.visible ? "" : "text-muted-foreground line-through"}>{columnLabel(list, c.key)}</span>
            </label>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${columnLabel(list, c.key)} を上へ`}><ArrowUp className="w-3.5 h-3.5" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === cols.length - 1} aria-label={`${columnLabel(list, c.key)} を下へ`}><ArrowDown className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-muted-foreground">上から順に、一覧の左から並びます。チェックを外した列は一覧に出しません。{list === "estimates" ? "「最新版」の文字は、一番左の列の上に出ます。" : ""}選択用のチェックと右端の矢印は固定です</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="text-xs gap-1" onClick={() => setCols(normalizeListColumns(list, []))} disabled={busy}><RotateCcw className="w-3.5 h-3.5" /> 初期の並びに戻す</Button>
        <Button type="button" size="sm" className="text-xs gap-1 ml-auto" onClick={commit} disabled={busy || !dirty}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 保存</Button>
      </div>
    </div>
  );
}

/** 一覧の右上の「列の設定」ボタン（押すとその一覧の設定を開く） */
export function ListColumnsButton({ list }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setOpen(true)} title="一覧の列の並び・表示（全員共通）"><Columns3 className="w-3.5 h-3.5" /> 列の設定</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{LIST_DEFS[list].label}一覧の列</DialogTitle>
            <DialogDescription className="text-xs">全員の一覧に反映されます。システム設定の「一覧の列」でも変えられます</DialogDescription>
          </DialogHeader>
          <ListColumnsEditor list={list} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** システム設定の「一覧の列」（一覧ごとのタブ） */
export function ListColumnsSettings() {
  const [list, setList] = useState(LIST_KEYS[0]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="tablist">
        {LIST_KEYS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={list === k} onClick={() => setList(k)} className={`h-8 px-3 rounded-md border text-xs ${list === k ? "bg-slate-800 text-white border-slate-800" : "bg-background hover:bg-muted"}`}>{LIST_DEFS[k].label}一覧</button>
        ))}
      </div>
      <div className="max-w-md"><ListColumnsEditor list={list} /></div>
    </div>
  );
}
