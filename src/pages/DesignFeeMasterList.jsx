import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { DESIGN_FEE_MASTER, DESIGN_FEE_MASTER_QUERY_KEY, groupDesignFeeRows, useDesignFeeMaster } from "@/lib/designFees";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Palette, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2, AlertTriangle, FolderPlus } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_HOURLY = 16000;

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const yen = (v) => (v === null || v === undefined || v === "" ? "—" : `¥${Number(v).toLocaleString()}`);

/**
 * デザイン費マスタ
 *
 * 見積明細の「+明細を追加 → デザイン費」に出る項目（大分類ごと）を編集する。
 * 出し値（selling_price）がそのまま見積の単価になる。時間・時間単価は根拠の参考値。
 */
export default function DesignFeeMasterList() {
  const queryClient = useQueryClient();
  const { rows, groups, fromDb, isLoading, error } = useDesignFeeMaster({ activeOnly: false });

  const [editing, setEditing] = useState(null); // { id?, category, name, detail, hours, unit_price, selling_price, is_active }
  const [categoryDialog, setCategoryDialog] = useState(null); // { mode: 'add' } | { mode: 'rename', from }
  const [categoryName, setCategoryName] = useState("");
  const [confirm, setConfirm] = useState(null); // { kind: 'item', row } | { kind: 'category', category }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: DESIGN_FEE_MASTER_QUERY_KEY });

  const saveMutation = useMutation({
    mutationFn: async (form) => {
      const payload = {
        category: form.category.trim(),
        category_order: form.category_order,
        name: form.name.trim(),
        detail: form.detail?.trim() || null,
        hours: num(form.hours),
        unit_price: num(form.unit_price),
        amount: num(form.hours) !== null && num(form.unit_price) !== null ? Math.round(num(form.hours) * num(form.unit_price)) : null,
        selling_price: num(form.selling_price) ?? 0,
        sort_order: form.sort_order,
        is_active: form.is_active !== false,
      };
      return form.id ? db.entities.DesignFeeMaster.update(form.id, payload) : db.entities.DesignFeeMaster.create(payload);
    },
    onSuccess: () => { invalidate(); setEditing(null); toast.success("保存しました"); },
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (target) => {
      if (target.kind === "item") return db.entities.DesignFeeMaster.delete(target.row.id);
      const ids = rows.filter((r) => r.category === target.category).map((r) => r.id);
      for (const id of ids) await db.entities.DesignFeeMaster.delete(id);
    },
    onSuccess: () => { invalidate(); setConfirm(null); toast.success("削除しました"); },
    onError: (e) => toast.error("削除できませんでした: " + e.message),
  });

  const reorderMutation = useMutation({
    mutationFn: async (updates) => {
      for (const u of updates) await db.entities.DesignFeeMaster.update(u.id, u.data);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error("並べ替えできませんでした: " + e.message),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ from, to }) => {
      const ids = rows.filter((r) => r.category === from).map((r) => r.id);
      for (const id of ids) await db.entities.DesignFeeMaster.update(id, { category: to });
    },
    onSuccess: () => { invalidate(); setCategoryDialog(null); toast.success("大分類名を変更しました"); },
    onError: (e) => toast.error("変更できませんでした: " + e.message),
  });

  // 固定一覧しか無い（マイグレーション未実行）ときに DB へ取り込む
  const seedMutation = useMutation({
    mutationFn: async () => {
      const seed = [];
      DESIGN_FEE_MASTER.forEach((c, ci) => c.items.forEach((it, i) => seed.push({
        category: c.category, category_order: ci * 10, name: it.name, detail: it.detail || null,
        hours: it.hours, unit_price: it.unit_price, amount: it.amount, selling_price: it.selling_price, sort_order: i * 10, is_active: true,
      })));
      return db.entities.DesignFeeMaster.createMany(seed);
    },
    onSuccess: () => { invalidate(); toast.success("初期データを登録しました"); },
    onError: (e) => toast.error("登録できませんでした: " + e.message),
  });

  const dbGroups = useMemo(() => groupDesignFeeRows(rows), [rows]);
  const shown = fromDb ? dbGroups : groups;

  // ---- 操作 ----
  const openNewItem = (group) => {
    const maxSort = Math.max(-10, ...group.items.map((r) => r.sort_order ?? 0));
    setEditing({ category: group.category, category_order: group.category_order ?? 0, name: "", detail: "", hours: "", unit_price: DEFAULT_HOURLY, selling_price: "", sort_order: maxSort + 10, is_active: true });
  };
  const openEditItem = (row) => setEditing({
    id: row.id, category: row.category, category_order: row.category_order ?? 0, name: row.name, detail: row.detail || "",
    hours: row.hours ?? "", unit_price: row.unit_price ?? "", selling_price: row.selling_price ?? "", sort_order: row.sort_order ?? 0, is_active: row.is_active !== false,
  });

  const moveItem = (group, idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= group.items.length) return;
    // sort_order が同じ値のときも入れ替わるように、並び位置から全行に振り直す
    const order = group.items.map((r, i) => ({ id: r.id, pos: i }));
    order[idx].pos = target; order[target].pos = idx;
    reorderMutation.mutate(order.map((o) => ({ id: o.id, data: { sort_order: o.pos * 10 } })));
  };

  const moveCategory = (gi, dir) => {
    const target = gi + dir;
    if (target < 0 || target >= shown.length) return;
    const updates = [];
    shown.forEach((g, i) => {
      const pos = i === gi ? target : i === target ? gi : i;
      for (const r of g.items) updates.push({ id: r.id, data: { category_order: pos * 10 } });
    });
    reorderMutation.mutate(updates);
  };

  const openAddCategory = () => { setCategoryName(""); setCategoryDialog({ mode: "add" }); };
  const openRenameCategory = (category) => { setCategoryName(category); setCategoryDialog({ mode: "rename", from: category }); };
  const submitCategory = () => {
    const name = categoryName.trim();
    if (!name) { toast.error("大分類名を入力してください"); return; }
    if (categoryDialog.mode === "rename") {
      if (name === categoryDialog.from) { setCategoryDialog(null); return; }
      if (shown.some((g) => g.category === name)) { toast.error("同じ名前の大分類があります"); return; }
      renameMutation.mutate({ from: categoryDialog.from, to: name });
      return;
    }
    if (shown.some((g) => g.category === name)) { toast.error("同じ名前の大分類があります"); return; }
    // 大分類は項目を持って初めて存在するので、最初の項目の入力画面を開く
    const maxCat = Math.max(-10, ...shown.map((g) => g.category_order ?? 0));
    setCategoryDialog(null);
    setEditing({ category: name, category_order: maxCat + 10, name: "", detail: "", hours: "", unit_price: DEFAULT_HOURLY, selling_price: "", sort_order: 0, is_active: true });
  };

  const busy = saveMutation.isPending || deleteMutation.isPending || reorderMutation.isPending || renameMutation.isPending;
  const calcAmount = editing && num(editing.hours) !== null && num(editing.unit_price) !== null ? Math.round(num(editing.hours) * num(editing.unit_price)) : null;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Palette className="w-6 h-6" /> デザイン費マスタ
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            見積明細の「+明細を追加 → デザイン費」に出る項目。出し値（税別）がそのまま見積の単価になります
          </p>
        </div>
        <Button onClick={openAddCategory} className="gap-2" disabled={!fromDb}>
          <FolderPlus className="w-4 h-4" /> 大分類を追加
        </Button>
      </div>

      {!isLoading && !fromDb && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 space-y-2">
            <p>
              {error
                ? "デザイン費マスタのテーブルがまだありません。supabase/migrations/0013_design_fee_masters.sql を Supabase の SQL Editor で実行してください（初期データも入ります）。"
                : "デザイン費マスタがまだ空です。アプリ内の初期一覧を登録すると、ここで編集できるようになります。"}
            </p>
            {!error && (
              <Button size="sm" variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} className="gap-1.5">
                {seedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 初期一覧を登録する
              </Button>
            )}
            <p className="text-xs text-amber-800">それまでは下の固定一覧（編集不可）が見積に使われます。</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        shown.map((group, gi) => (
          <Card key={group.category}>
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-sm font-semibold truncate">{group.category}</h2>
                  <span className="text-[10px] text-muted-foreground shrink-0">{group.items.length}項目</span>
                </div>
                {fromDb && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="上へ" disabled={busy || gi === 0} onClick={() => moveCategory(gi, -1)}><ArrowUp className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="下へ" disabled={busy || gi === shown.length - 1} onClick={() => moveCategory(gi, 1)}><ArrowDown className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => openRenameCategory(group.category)}><Pencil className="w-3 h-3" /> 名称変更</Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirm({ kind: "category", category: group.category })}><Trash2 className="w-3 h-3" /> 大分類を削除</Button>
                    <Button size="sm" className="h-7 gap-1 text-xs ml-1" disabled={busy} onClick={() => openNewItem(group)}><Plus className="w-3 h-3" /> 項目を追加</Button>
                  </div>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">項目名</TableHead>
                    <TableHead className="text-xs">内容・備考</TableHead>
                    <TableHead className="text-xs text-right w-20">時間</TableHead>
                    <TableHead className="text-xs text-right w-24">時間単価</TableHead>
                    <TableHead className="text-xs text-right w-28">計算値</TableHead>
                    <TableHead className="text-xs text-right w-28">出し値（税別）</TableHead>
                    <TableHead className="text-xs w-16">状態</TableHead>
                    {fromDb && <TableHead className="w-32"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((row, idx) => (
                    <TableRow key={row.id || idx} className={row.is_active === false ? "opacity-50" : ""}>
                      <TableCell className="text-sm">{row.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px]">{row.detail || ""}</TableCell>
                      <TableCell className="text-xs text-right">{row.hours ?? "—"}{row.hours != null && "h"}</TableCell>
                      <TableCell className="text-xs text-right">{yen(row.unit_price)}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{yen(row.amount)}</TableCell>
                      <TableCell className="text-sm text-right font-semibold text-primary">{yen(row.selling_price)}</TableCell>
                      <TableCell>
                        {row.is_active === false
                          ? <Badge variant="outline" className="text-[10px]">使わない</Badge>
                          : <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">使用中</Badge>}
                      </TableCell>
                      {fromDb && (
                        <TableCell>
                          <div className="flex items-center justify-end gap-0.5">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="上へ" disabled={busy || idx === 0} onClick={() => moveItem(group, idx, -1)}><ArrowUp className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="下へ" disabled={busy || idx === group.items.length - 1} onClick={() => moveItem(group, idx, 1)}><ArrowDown className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="編集" disabled={busy} onClick={() => openEditItem(row)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="削除" disabled={busy} onClick={() => setConfirm({ kind: "item", row })}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      {/* 項目の追加・編集 */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "項目を編集" : "項目を追加"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">大分類</Label>
                <Input value={editing.category} readOnly className="h-9 text-sm bg-muted/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">項目名 <span className="text-destructive">*</span></Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="例: チラシ ベースデザイン（A4表面のみ）" className="h-9 text-sm" autoFocus />
                <p className="text-[10px] text-muted-foreground">見積明細の品名にそのまま入ります</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">内容・備考</Label>
                <Textarea value={editing.detail} onChange={(e) => setEditing({ ...editing, detail: e.target.value })} placeholder="例: 1〜2案、写真・テキスト完全支給" rows={2} className="text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">想定時間（h）</Label>
                  <Input type="number" step="0.1" min="0" value={editing.hours} onChange={(e) => setEditing({ ...editing, hours: e.target.value })} className="h-9 text-sm text-right" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">時間単価（円）</Label>
                  <Input type="number" step="1000" min="0" value={editing.unit_price} onChange={(e) => setEditing({ ...editing, unit_price: e.target.value })} className="h-9 text-sm text-right" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">計算値</Label>
                  <div className="h-9 flex items-center justify-end px-3 rounded-md border bg-muted/40 text-sm text-muted-foreground">{yen(calcAmount)}</div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">出し値（税別・円） <span className="text-destructive">*</span></Label>
                <div className="flex items-center gap-2">
                  <Input type="number" step="1000" min="0" value={editing.selling_price} onChange={(e) => setEditing({ ...editing, selling_price: e.target.value })} className="h-9 text-sm text-right font-semibold" />
                  {calcAmount !== null && (
                    <Button type="button" variant="outline" size="sm" className="h-9 text-xs shrink-0" onClick={() => setEditing({ ...editing, selling_price: calcAmount })}>計算値を入れる</Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">見積の単価になる金額。時間×時間単価から丸めた値を入れるのが目安です</p>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="text-xs font-medium">見積で使う</p>
                  <p className="text-[10px] text-muted-foreground">OFF にすると一覧には残したまま、見積の候補から外れます</p>
                </div>
                <Switch checked={editing.is_active !== false} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saveMutation.isPending}>キャンセル</Button>
            <Button
              onClick={() => {
                if (!editing.name.trim()) { toast.error("項目名を入力してください"); return; }
                if (editing.selling_price === "" || Number.isNaN(Number(editing.selling_price))) { toast.error("出し値を入力してください"); return; }
                saveMutation.mutate(editing);
              }}
              disabled={saveMutation.isPending}
              className="gap-1.5"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 大分類の追加・名称変更 */}
      <Dialog open={!!categoryDialog} onOpenChange={(o) => { if (!o) setCategoryDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{categoryDialog?.mode === "rename" ? "大分類の名称変更" : "大分類を追加"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">大分類名</Label>
            <Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="例: 動画制作" className="h-9 text-sm" autoFocus onKeyDown={(e) => { if (e.key === "Enter") submitCategory(); }} />
            {categoryDialog?.mode === "add" && <p className="text-[10px] text-muted-foreground">続けて最初の項目を入力します</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialog(null)}>キャンセル</Button>
            <Button onClick={submitCategory} disabled={renameMutation.isPending} className="gap-1.5">
              {renameMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {categoryDialog?.mode === "rename" ? "変更" : "次へ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "category" ? "大分類を削除しますか？" : "項目を削除しますか？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "category"
                ? `「${confirm.category}」の項目 ${rows.filter((r) => r.category === confirm.category).length} 件をすべて削除します。作成済みの見積には影響しません。`
                : `「${confirm?.row?.name}」を削除します。作成済みの見積には影響しません。一時的に外すだけなら、編集で「見積で使う」を OFF にしてください。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteMutation.mutate(confirm)} disabled={deleteMutation.isPending}>削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
