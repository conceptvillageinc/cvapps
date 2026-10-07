import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Layers, Plus, Trash2, ArrowUp, ArrowDown, Loader2, RotateCcw, Save, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import {
  useSalesCategories, useSaveSalesCategories, normalizeSalesCategories, classifySalesCategory, salesCategoryDef,
  DEFAULT_SALES_CATEGORIES, SALES_CATEGORY_COLORS,
} from "@/lib/salesCategory";

// ============================================================================
// 売上カテゴリーマスタ: 売上カテゴリー（freee の会計計上部門）の追加・名前の変更・表示順・色・
// 自動で振り分けるときの語。見積・納品書・請求書の明細と、売上粗利管理表の集計に使う。
// ============================================================================

const toText = (arr) => (arr || []).join("、");

export default function SalesCategoryMaster() {
  const { list, row, isLoading } = useSalesCategories();
  const save = useSaveSalesCategories();
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [test, setTest] = useState({ category: "", name: "" });

  useEffect(() => { if (!draft && !isLoading) setDraft(list.map((c) => ({ ...c, est_text: toText(c.est_words), kw_text: toText(c.keywords) }))); }, [list, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = draft || [];
  const asList = useMemo(() => normalizeSalesCategories(items.map(({ est_text, kw_text, ...c }) => ({ ...c, est_words: est_text, keywords: kw_text }))), [items]);
  const dirty = JSON.stringify(asList) !== JSON.stringify(list);

  const upd = (i, patch) => setDraft((d) => d.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const setFlag = (i, flag) => setDraft((d) => d.map((c, k) => ({ ...c, [flag]: k === i })));
  const move = (i, dir) => setDraft((d) => {
    const j = i + dir;
    if (j < 0 || j >= d.length) return d;
    const next = [...d];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const add = () => {
    const label = newName.trim();
    if (!label) return;
    if (items.some((c) => c.label === label)) { toast.error("同じ名前のカテゴリーがあります"); return; }
    const used = new Set(items.map((c) => c.color));
    const color = SALES_CATEGORY_COLORS.find((x) => !used.has(x)) || SALES_CATEGORY_COLORS[items.length % SALES_CATEGORY_COLORS.length];
    setDraft((d) => [...d, { key: `c_${Date.now().toString(36)}`, label, short: label, color, est_words: [], keywords: [], est_text: "", kw_text: "", discount: false, fallback: false, active: true }]);
    setNewName("");
  };
  const remove = (i) => {
    const c = items[i];
    if (!window.confirm(`「${c.label}」を削除しますか？\nこのカテゴリーを手で選んでいた明細は、自動の振り分けに戻ります。集計から外さずに残したい場合は「使う」のチェックを外してください。`)) return;
    setDraft((d) => d.filter((_, k) => k !== i));
  };
  const commit = async () => {
    if (asList.filter((c) => c.active).length === 0) { toast.error("使うカテゴリーを 1 つ以上残してください"); return; }
    setBusy(true);
    try {
      await save(row, asList.map(({ key, label, short, color, est_words, keywords, discount, fallback, active }) => ({ key, label, short, color, est_words, keywords, discount, fallback, active })));
      setDraft(null);
      toast.success("保存しました");
    } catch (e) {
      toast.error("保存できませんでした: " + e.message);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    if (!window.confirm("アプリの初期の一覧（7 カテゴリー）に戻します。追加したカテゴリーと変えた語は消えます（保存するまでは反映されません）。よろしいですか？")) return;
    setDraft(DEFAULT_SALES_CATEGORIES.map((c) => ({ ...c, est_text: toText(c.est_words), kw_text: toText(c.keywords) })));
  };

  const testKey = test.category || test.name ? classifySalesCategory({ row_type: "item", category: test.category, name: test.name, amount: 1 }, asList) : null;
  const testDef = salesCategoryDef(testKey, asList);

  if (isLoading || !draft) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-5" data-testid="sales-category-master">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Layers className="w-6 h-6" /> 売上カテゴリーマスタ</h1>
          <p className="text-sm text-muted-foreground mt-0.5">見積・納品書・請求書の明細ごとに付ける売上カテゴリー（freee の会計計上部門）です。この順番で選択欄と売上粗利管理表に並びます。</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={reset} disabled={busy}><RotateCcw className="w-3.5 h-3.5" /> 初期の一覧に戻す</Button>
          <Button size="sm" className="text-xs gap-1" onClick={commit} disabled={busy || !dirty}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 保存</Button>
        </div>
      </div>
      {dirty && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">変更があります。「保存」を押すと、見積・請求書の自動の振り分けと売上粗利管理表に反映されます</p>}

      <div className="space-y-2">
        {items.map((c, i) => (
          <Card key={c.key} className={c.active ? "" : "opacity-60"} data-testid="sales-category-item">
            <CardContent className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col">
                  <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${c.label} を上へ`}><ArrowUp className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`${c.label} を下へ`}><ArrowDown className="w-3 h-3" /></Button>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums w-5 text-right">{i + 1}</span>
                <ColorPicker value={c.color} onChange={(color) => upd(i, { color })} />
                <Input value={c.label} onChange={(e) => upd(i, { label: e.target.value, ...(c.short === c.label ? { short: e.target.value } : {}) })} className="h-8 text-sm font-medium flex-1 min-w-[220px]" aria-label="カテゴリー名" />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">略称
                  <Input value={c.short} onChange={(e) => upd(i, { short: e.target.value })} className="h-8 w-32 text-xs" aria-label={`${c.label} の略称`} />
                </label>
                <label className="flex items-center gap-1 text-[11px] whitespace-nowrap"><input type="checkbox" checked={c.active} onChange={(e) => upd(i, { active: e.target.checked })} /> 使う</label>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => remove(i)} aria-label={`${c.label} を削除`}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2 pl-[68px]">
                <label className="space-y-0.5">
                  <span className="text-[10.5px] text-muted-foreground">見積の区分にこの語があれば（品名より優先）</span>
                  <Input value={c.est_text} onChange={(e) => upd(i, { est_text: e.target.value })} placeholder="例: デザイン費" className="h-8 text-xs" aria-label={`${c.label} の見積の区分の語`} />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10.5px] text-muted-foreground">品名にこの語があれば（「、」区切り）</span>
                  <Textarea value={c.kw_text} onChange={(e) => upd(i, { kw_text: e.target.value })} rows={2} placeholder="例: 撮影、写真、動画" className="min-h-8 py-1.5 text-xs resize-y" aria-label={`${c.label} の品名の語`} />
                </label>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-[68px] text-[11px]">
                <label className="flex items-center gap-1"><input type="radio" name="discount" checked={!!c.discount} onChange={() => setFlag(i, "discount")} /> 割引の行（マイナスの行・自動計算の割引）をここに入れる</label>
                <label className="flex items-center gap-1"><input type="radio" name="fallback" checked={!!c.fallback} onChange={() => setFlag(i, "fallback")} /> どれにも当てはまらない行をここに入れる</label>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="カテゴリーを追加（例: イベント運営）" className="h-9 text-sm max-w-sm" />
        <Button variant="outline" size="sm" className="h-9 text-xs gap-1" onClick={add} disabled={!newName.trim()}><Plus className="w-3.5 h-3.5" /> 追加</Button>
      </div>

      {/* 振り分けを試す */}
      <Card className="border-dashed">
        <CardContent className="p-3 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> 振り分けを試す（保存前の内容で試せます）</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={test.category} onChange={(e) => setTest({ ...test, category: e.target.value })} placeholder="見積の区分（例: デザイン費）" className="h-8 text-xs w-48" aria-label="試す区分" />
            <Input value={test.name} onChange={(e) => setTest({ ...test, name: e.target.value })} placeholder="品名（例: 取材および原稿執筆）" className="h-8 text-xs flex-1 min-w-[220px]" aria-label="試す品名" />
            <span className="text-xs" data-testid="sales-category-test">→ {testDef ? <span className="font-semibold" style={{ color: testDef.color }}>{testDef.label}</span> : <span className="text-muted-foreground">区分か品名を入れてください</span>}</span>
          </div>
        </CardContent>
      </Card>

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>自動の振り分けの順番: ① 割引の行 → ② 見積の区分の語（上のカテゴリーから順に） → ③ 品名の語（いちばん長く一致した語。同じ長さなら上のカテゴリー） → ④ どれにも当てはまらない行</p>
        <p>名前を変えても、すでに付いている明細はそのまま新しい名前で集計されます。「使う」を外すと選択欄と自動の振り分けから外れますが、手で選んでいた明細の金額は売上粗利管理表に残ります</p>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-7 h-7 rounded-md border" style={{ background: value }} aria-label="色を選ぶ" />
      {open && (
        <div className="absolute z-20 top-8 left-0 bg-white border rounded-md shadow-lg p-1.5 grid grid-cols-6 gap-1 w-[164px]">
          {SALES_CATEGORY_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => { onChange(c); setOpen(false); }} className={`w-6 h-6 rounded ${c === value ? "ring-2 ring-offset-1 ring-slate-800" : ""}`} style={{ background: c }} aria-label={c} />
          ))}
        </div>
      )}
    </div>
  );
}
