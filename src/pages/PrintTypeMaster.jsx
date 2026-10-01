import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, Plus, Trash2, ArrowUp, ArrowDown, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { usePrintTypes, useSavePrintTypes, PAPER_GROUPS, defaultPrintTypes } from "@/lib/printTypes";

/**
 * 印刷種別マスタ: 印刷物種別（印刷費の大カテゴリ）の追加・削除・表示順・紙／紙以外の区分。
 * 見積の印刷仕様、ネット印刷の取込、議事録の見積条件の候補に使う。
 */
export default function PrintTypeMaster() {
  const { types, row, isLoading, fromSettings } = usePrintTypes();
  const save = useSavePrintTypes();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const commit = async (next, msg) => {
    setBusy(true);
    try { await save(row, next); if (msg) toast.success(msg); }
    catch (e) { toast.error("保存できませんでした: " + e.message); }
    finally { setBusy(false); }
  };

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (types.some((t) => t.name === n)) { toast.error("同じ名前の種別があります"); return; }
    await commit([...types, { name: n, paper_group: "紙" }], `「${n}」を追加しました`);
    setName("");
  };
  const remove = (i) => {
    const t = types[i];
    if (!window.confirm(`「${t.name}」をマスタから外します。すでに作ってある見積や価格マスタの名前はそのまま残ります。よろしいですか？`)) return;
    commit(types.filter((_, k) => k !== i), `「${t.name}」を外しました`);
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= types.length) return;
    const next = [...types];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const setGroup = (i, g) => commit(types.map((t, k) => (k === i ? { ...t, paper_group: g } : t)));
  const reset = () => {
    if (!window.confirm("アプリの初期の一覧に戻します。追加した種別は消えます。よろしいですか？")) return;
    commit(defaultPrintTypes(), "初期の一覧に戻しました");
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Printer className="w-6 h-6" /> 印刷種別マスタ</h1>
          <p className="text-sm text-muted-foreground mt-0.5">印刷物種別（印刷費の大カテゴリ）の一覧です。見積の印刷仕様、ネット印刷の取込、議事録の見積条件の候補に使われます。</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={reset} disabled={busy}><RotateCcw className="w-3.5 h-3.5" /> 初期の一覧に戻す</Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 名刺印刷、封筒印刷" className="h-9 max-w-xs" />
            <Button type="submit" size="sm" className="h-9 gap-1" disabled={busy || !name.trim()}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 追加</Button>
            <span className="text-[11px] text-muted-foreground">追加・並べ替え・削除はその場で保存されます{!fromSettings && "（まだ初期の一覧です）"}</span>
          </form>

          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-xs">
                  <th className="text-left px-3 py-2 w-12">順</th>
                  <th className="text-left px-3 py-2">印刷物種別</th>
                  <th className="text-left px-3 py-2 w-40">印刷費の区分</th>
                  <th className="px-3 py-2 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {types.map((t, i) => (
                  <tr key={t.name} className="border-b hover:bg-muted/40">
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2">
                      <select value={t.paper_group} onChange={(e) => setGroup(i, e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" disabled={busy} aria-label={`${t.name}の区分`}>
                        {PAPER_GROUPS.map((g) => <option key={g} value={g}>印刷費（{g}）</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label="上へ"><ArrowUp className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={busy || i === types.length - 1} aria-label="下へ"><ArrowDown className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(i)} disabled={busy} aria-label="削除"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-muted-foreground">「印刷費の区分」は、ネット印刷から取り込んだ価格を「印刷費（紙）」「印刷費（紙以外）」のどちらに入れるかに使います。種別を外しても、すでに作ってある見積・価格マスタの名前は変わりません。</p>
        </CardContent>
      </Card>
    </div>
  );
}
