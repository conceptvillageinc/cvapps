import { db } from "@/api/db";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Pencil, Trash2, Tag, Loader2, Link2, FileUp, AlertTriangle,
  ExternalLink, Sparkles, Grid3x3, Save,
} from "lucide-react";
import { toast } from "sonner";

const UPDATE_DUE_DAYS = 90;
const OTHER_VENDOR = "__other__";

// URL/スクショ取込用の抽出スキーマ：仕様＋縦(枚数)×横(納期)のマス目全体
const GRID_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    spec_summary: { type: "string", description: "仕様の要約（紙質・厚さ・面など）。わかる場合のみ" },
    price_grid: {
      type: "array",
      description: "縦=枚数・横=納期の価格表。ページに記載の枚数パターンをすべて行にし、それぞれの納期パターンと価格をcellsに入れる",
      items: {
        type: "object",
        properties: {
          quantity: { type: "number" },
          cells: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, price: { type: "number" } },
            },
          },
        },
      },
    },
    notes: { type: "string", description: "特記事項があれば簡潔に" },
  },
};

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function UpdateStatusBadge({ lastUpdated }) {
  const days = daysSince(lastUpdated);
  if (days === null) return <Badge variant="outline" className="text-[10px]">未更新</Badge>;
  if (days >= UPDATE_DUE_DAYS) {
    return <Badge className="text-[10px] bg-red-100 text-red-700 hover:bg-red-100">更新期限切れ（{days}日経過）</Badge>;
  }
  if (days >= UPDATE_DUE_DAYS - 14) {
    return <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">まもなく期限（{days}日経過）</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">{days}日前に更新</Badge>;
}

function countSelected(grid) {
  return (grid || []).reduce((sum, row) => sum + (row.cells || []).filter(c => c.selected).length, 0);
}

// 既存グリッドと新グリッドを「和集合」でマージする。
// 既存の行・セルは残したまま、新しいデータにある行・セルだけ追加・上書きする（選択状態は引き継がれる）。
// スクショを何回にも分けてアップロードし、少しずつ表を組み立てられるようにするため、
// 以前の「完全置き換え」方式だと新しいスクショに写っていない行が消えてしまう問題があった。
function mergeGrid(oldGrid, newGrid) {
  const rowMap = new Map();

  (oldGrid || []).forEach(row => {
    const cellMap = new Map((row.cells || []).map(c => [c.label, { ...c }]));
    rowMap.set(row.quantity, { quantity: row.quantity, cellMap });
  });

  (newGrid || []).forEach(row => {
    if (!rowMap.has(row.quantity)) {
      rowMap.set(row.quantity, { quantity: row.quantity, cellMap: new Map() });
    }
    const existing = rowMap.get(row.quantity);
    (row.cells || []).forEach(cell => {
      const prevSelected = existing.cellMap.get(cell.label)?.selected || false;
      existing.cellMap.set(cell.label, { label: cell.label, price: cell.price, selected: prevSelected });
    });
  });

  return Array.from(rowMap.values())
    .map(row => ({ quantity: row.quantity, cells: Array.from(row.cellMap.values()) }))
    .sort((a, b) => (a.quantity || 0) - (b.quantity || 0));
}

// グリッドの列（納期ラベル）一覧を、各行に出てくる順序を尊重しつつ統合
function collectColumns(grid) {
  const cols = [];
  (grid || []).forEach(row => {
    (row.cells || []).forEach(cell => {
      if (!cols.includes(cell.label)) cols.push(cell.label);
    });
  });
  return cols;
}

// ==================== グリッド閲覧・編集ダイアログ ====================
function GridEditorDialog({ record, open, onClose, onSave }) {
  const [grid, setGrid] = useState([]);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (open && record) setGrid(record.price_grid || []);
  }, [open, record]);

  if (!record) return null;

  const columns = collectColumns(grid);

  const toggleCell = (qIdx, label) => {
    setGrid(prev => prev.map((row, i) => i !== qIdx ? row : {
      ...row,
      cells: row.cells.map(c => c.label === label ? { ...c, selected: !c.selected } : c),
    }));
  };

  const updateCellValue = (qIdx, label, price) => {
    setGrid(prev => prev.map((row, i) => i !== qIdx ? row : {
      ...row,
      cells: row.cells.map(c => c.label === label ? { ...c, price: Number(price) || 0 } : c),
    }));
  };

  const updateQuantity = (qIdx, quantity) => {
    setGrid(prev => prev.map((row, i) => i !== qIdx ? row : { ...row, quantity: Number(quantity) || 0 }));
  };

  const addRow = () => {
    setGrid(prev => [...prev, { quantity: 0, cells: columns.map(label => ({ label, price: 0, selected: false })) }]);
  };

  const removeRow = (qIdx) => {
    setGrid(prev => prev.filter((_, i) => i !== qIdx));
  };

  const selectedCount = countSelected(grid);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3x3 className="w-4 h-4" /> {record.category}（{record.vendor_name}）の価格表
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          セルをクリックすると選択（見積作成時の候補に反映）のON/OFFを切り替えられます。現在<strong className="text-primary">{selectedCount}件</strong>選択中。
        </p>

        <div className="flex items-center justify-between">
          <Button size="sm" variant="outline" className="text-xs h-8 gap-1.5" onClick={() => setEditMode(m => !m)}>
            <Pencil className="w-3.5 h-3.5" /> {editMode ? "選択モードに戻る" : "数値を編集する"}
          </Button>
          {editMode && (
            <Button size="sm" variant="ghost" className="text-xs h-8 gap-1.5" onClick={addRow}>
              <Plus className="w-3.5 h-3.5" /> 枚数の行を追加
            </Button>
          )}
        </div>

        {grid.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            価格表がまだありません。「URLで更新」または「スクショで更新」で取り込んでください。
          </p>
        ) : (
          <div className="overflow-auto max-h-[55vh] border rounded-md">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-20 bg-slate-800 text-white px-2 py-1.5 text-left">枚数</th>
                  {columns.map(col => (
                    <th key={col} className="sticky top-0 z-10 bg-slate-800 text-white px-2 py-1.5 min-w-[70px]">{col}</th>
                  ))}
                  {editMode && <th className="sticky top-0 z-10 bg-slate-800 w-8"></th>}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, qIdx) => (
                  <tr key={qIdx} className="border-b">
                    <td className="sticky left-0 z-[5] bg-white px-2 py-1 font-medium whitespace-nowrap">
                      {editMode ? (
                        <Input
                          type="number"
                          value={row.quantity}
                          onChange={e => updateQuantity(qIdx, e.target.value)}
                          className="h-7 w-16 text-xs"
                        />
                      ) : `${(row.quantity || 0).toLocaleString()}枚`}
                    </td>
                    {columns.map(col => {
                      const cell = row.cells.find(c => c.label === col);
                      if (!cell) return <td key={col} className="px-2 py-1 text-center text-muted-foreground/30">—</td>;
                      return (
                        <td key={col} className="px-1 py-1 text-center">
                          {editMode ? (
                            <Input
                              type="number"
                              value={cell.price}
                              onChange={e => updateCellValue(qIdx, col, e.target.value)}
                              className="h-7 w-20 text-xs text-center mx-auto"
                            />
                          ) : (
                            <button
                              onClick={() => toggleCell(qIdx, col)}
                              className={`w-full px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                                cell.selected
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted/50 hover:bg-muted text-foreground"
                              }`}
                            >
                              ¥{(cell.price || 0).toLocaleString()}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    {editMode && (
                      <td className="px-1">
                        <button onClick={() => removeRow(qIdx)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <Button size="sm" className="gap-1.5 flex-1" onClick={() => onSave(grid)}>
            <Save className="w-3.5 h-3.5" /> この内容で保存
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>閉じる</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ==================== 各行の「URLで更新」「スクショで更新」パネル ====================
function RefreshPanel({ record, onClose, onApplied }) {
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const applyResult = (data, screenshotUrl) => {
    const merged = mergeGrid(record.price_grid, data.price_grid || []);
    onApplied({
      price_grid: merged,
      spec_summary: data.spec_summary || record.spec_summary,
      last_updated: new Date().toISOString().slice(0, 10),
      ...(screenshotUrl ? { screenshot_url: screenshotUrl } : {}),
      ...(data.notes ? { notes: data.notes } : {}),
    });
  };

  const runUrlUpdate = async () => {
    if (!record.source_url) {
      toast.error("参照元URLが登録されていません");
      return;
    }
    setMode("url");
    setLoading(true);
    setError(null);
    try {
      const res = await db.functions.invoke("fetchPriceFromUrl", {
        url: record.source_url,
        spec_summary: record.spec_summary,
      });
      if (res?.data?.error) {
        setError(res.data.error);
      } else if (!res?.data?.price_grid || res.data.price_grid.length === 0) {
        setError("URLから価格表を読み取れませんでした。スクショでの更新をお試しください。");
      } else {
        applyResult(res.data, null);
        toast.success("価格表を更新しました（選択状態は引き継がれています）");
      }
    } catch (err) {
      setError("読み取りに失敗しました: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshotSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMode("screenshot");
    setLoading(true);
    setError(null);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      const res = await db.integrations.Core.InvokeLLM({
        prompt: `添付した印刷価格ページのスクリーンショットを読み取り、縦(枚数)×横(納期)の価格表全体と、紙質・厚さ・面などの仕様を抽出してください。価格は税込の数値のみで返してください（カンマは除去）。`,
        file_urls: [file_url],
        model: "claude_opus_4_8",
        response_json_schema: GRID_EXTRACT_SCHEMA,
      });
      if (!res?.price_grid || res.price_grid.length === 0) {
        setError("画像から価格表を読み取れませんでした。手動でグリッド編集してください。");
      } else {
        applyResult(res, file_url);
        toast.success("価格表を更新しました（選択状態は引き継がれています）");
      }
    } catch (err) {
      setError("読み取りに失敗しました: " + err.message);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="p-3 bg-muted/30 border-t space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="text-xs h-8 gap-1.5" onClick={runUrlUpdate} disabled={loading || !record.source_url}>
          {loading && mode === "url" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          URLで更新
        </Button>
        <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleScreenshotSelect} />
        <Button size="sm" variant="outline" className="text-xs h-8 gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={loading}>
          {loading && mode === "screenshot" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
          スクショで更新
        </Button>
        <Button size="sm" variant="ghost" className="text-xs h-8 ml-auto" onClick={onClose}>閉じる</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        更新すると既存の行は残したまま、読み取った内容だけが追加・上書きされます（選択済みセルは引き継がれます）。スクショは何回に分けてアップロードしても大丈夫です。
      </p>
      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-red-50 border border-red-200">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}

// ==================== 新規追加ダイアログ内の「URLから読込」「スクショから読込」バー ====================
function DialogAutoFill({ form, onDetected }) {
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const applyDetected = (data) => {
    onDetected(data);
    toast.success("読み取り結果を反映しました。内容を確認してください");
  };

  const runUrlLoad = async () => {
    if (!form.source_url) {
      toast.error("先に参照元URLを入力してください");
      return;
    }
    setMode("url");
    setLoading(true);
    setError(null);
    try {
      const res = await db.functions.invoke("fetchPriceFromUrl", {
        url: form.source_url,
        spec_summary: form.spec_summary,
      });
      if (res?.data?.error) {
        setError(res.data.error);
      } else if (!res?.data?.price_grid || res.data.price_grid.length === 0) {
        setError("URLから価格表を読み取れませんでした。スクショをお試しください。");
      } else {
        applyDetected(res.data);
      }
    } catch (err) {
      setError("読み取りに失敗しました: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshotSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMode("screenshot");
    setLoading(true);
    setError(null);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      const res = await db.integrations.Core.InvokeLLM({
        prompt: `添付した印刷価格ページのスクリーンショットを読み取り、縦(枚数)×横(納期)の価格表全体と、紙質・厚さ・面などの仕様を抽出してください。価格は税込の数値のみで返してください（カンマは除去）。`,
        file_urls: [file_url],
        model: "claude_opus_4_8",
        response_json_schema: GRID_EXTRACT_SCHEMA,
      });
      if (!res?.price_grid || res.price_grid.length === 0) {
        setError("画像から価格表を読み取れませんでした。手動で入力してください。");
      } else {
        applyDetected(res);
      }
    } catch (err) {
      setError("読み取りに失敗しました: " + err.message);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="p-3 rounded-md bg-primary/5 border border-primary/20 space-y-2">
      <p className="text-xs font-medium text-primary flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" /> URL・スクショから自動入力（任意）
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="text-xs h-8 gap-1.5 bg-white" onClick={runUrlLoad} disabled={loading}>
          {loading && mode === "url" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          URLから読込
        </Button>
        <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleScreenshotSelect} />
        <Button size="sm" variant="outline" className="text-xs h-8 gap-1.5 bg-white" onClick={() => fileInputRef.current?.click()} disabled={loading}>
          {loading && mode === "screenshot" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
          スクショから読込
        </Button>
      </div>
      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-red-50 border border-red-200">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        価格表を丸ごと取り込みます。取り込み後、詳細画面で使うセルだけを選択してください。大カテゴリ・参照メーカーは自動入力されません。
      </p>
    </div>
  );
}

const emptyForm = {
  category: "", vendor_name: "", vendorSelectValue: "", paper_type_group: "紙",
  spec_summary: "", price_grid: [], source_url: "", notes: "",
};

export default function PriceMasterList() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [refreshingId, setRefreshingId] = useState(null);
  const [gridEditingRecord, setGridEditingRecord] = useState(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["priceMaster"],
    queryFn: () => db.entities.PriceMaster.list("-last_updated"),
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["printVendors"],
    queryFn: () => db.entities.PrintVendor.list("name"),
  });

  const saveMutation = useMutation({
    mutationFn: (data) => editing
      ? db.entities.PriceMaster.update(editing.id, data)
      : db.entities.PriceMaster.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priceMaster"] });
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      toast.success(editing ? "更新しました" : "追加しました");
    },
    onError: (err) => {
      toast.error("保存に失敗しました: " + (err?.message || "不明なエラー"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.entities.PriceMaster.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priceMaster"] });
      toast.success("削除しました");
    },
    onError: (err) => {
      toast.error("削除に失敗しました: " + (err?.message || "不明なエラー"));
    },
  });

  const refreshMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.PriceMaster.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priceMaster"] });
      setRefreshingId(null);
    },
    onError: (err) => {
      toast.error("更新の保存に失敗しました: " + (err?.message || "不明なエラー"));
    },
  });

  const gridSaveMutation = useMutation({
    mutationFn: ({ id, price_grid }) => db.entities.PriceMaster.update(id, { price_grid }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priceMaster"] });
      setGridEditingRecord(null);
      toast.success("価格表を保存しました");
    },
    onError: (err) => {
      toast.error("価格表の保存に失敗しました: " + (err?.message || "不明なエラー"));
    },
  });

  const openNew = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (r) => {
    setEditing(r);
    const isKnownVendor = vendors.some(v => v.name === r.vendor_name);
    setForm({
      ...r,
      paper_type_group: r.paper_type_group || "紙",
      price_grid: r.price_grid || [],
      vendorSelectValue: isKnownVendor ? r.vendor_name : OTHER_VENDOR,
    });
    setDialogOpen(true);
  };

  const applyAutoFill = (detected) => {
    setForm(prev => ({
      ...prev,
      spec_summary: detected.spec_summary || prev.spec_summary,
      price_grid: detected.price_grid && detected.price_grid.length > 0
        ? detected.price_grid.map(row => ({
            quantity: row.quantity,
            cells: (row.cells || []).map(c => ({ label: c.label, price: c.price, selected: false })),
          }))
        : prev.price_grid,
    }));
  };

  const handleSubmit = () => {
    if (!form.category || !form.vendor_name) {
      toast.error("大カテゴリと参照メーカーは必須です");
      return;
    }
    const { vendorSelectValue: _vsv, ...data } = form;
    saveMutation.mutate({
      ...data,
      last_updated: new Date().toISOString().slice(0, 10),
    });
  };

  // 更新期限が近い順（経過日数が大きい順）に並べ替え
  const sorted = [...records].sort((a, b) => (daysSince(b.last_updated) ?? -1) - (daysSince(a.last_updated) ?? -1));

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Tag className="w-6 h-6" /> 価格マスタ
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            商品カテゴリ別の原価テンプレート。3ヶ月ごとにURL再取得・スクショOCRで更新
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" /> 新規追加
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">まだ価格データがありません</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">大カテゴリ</TableHead>
                  <TableHead className="text-xs">分類</TableHead>
                  <TableHead className="text-xs">参照メーカー</TableHead>
                  <TableHead className="text-xs">仕様</TableHead>
                  <TableHead className="text-xs">見積候補</TableHead>
                  <TableHead className="text-xs">更新状況</TableHead>
                  <TableHead className="text-xs w-36"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(r => {
                  const selCount = countSelected(r.price_grid);
                  return (
                    <Fragment key={r.id}>
                      <TableRow key={r.id}>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{r.category}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{r.paper_type_group || "紙"}</Badge></TableCell>
                        <TableCell className="text-sm">{r.vendor_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[180px]">{r.spec_summary || "—"}</TableCell>
                        <TableCell>
                          <button
                            onClick={() => setGridEditingRecord(r)}
                            className={`text-[10px] px-2 py-1 rounded-full font-medium ${
                              selCount > 0 ? "bg-primary/10 text-primary hover:bg-primary/20" : "bg-muted text-muted-foreground hover:bg-muted/70"
                            }`}
                          >
                            {selCount > 0 ? `${selCount}件選択中` : "未選択"} ・ {(r.price_grid || []).length}行
                          </button>
                        </TableCell>
                        <TableCell><UpdateStatusBadge lastUpdated={r.last_updated} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {r.source_url && (
                              <a href={r.source_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              onClick={() => setRefreshingId(refreshingId === r.id ? null : r.id)}
                              className="text-xs text-primary hover:underline"
                            >
                              更新
                            </button>
                            <button onClick={() => openEdit(r)} className="text-muted-foreground hover:text-foreground">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteMutation.mutate(r.id)} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {refreshingId === r.id && (
                        <TableRow key={`${r.id}-refresh`}>
                          <TableCell colSpan={7} className="p-0">
                            <RefreshPanel
                              record={r}
                              onClose={() => setRefreshingId(null)}
                              onApplied={(data) => refreshMutation.mutate({ id: r.id, data })}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 新規追加／基本情報編集ダイアログ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "価格データを編集" : "価格データを追加"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <DialogAutoFill form={form} onDetected={applyAutoFill} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">大カテゴリ *</Label>
                <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="例: チラシ印刷費" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">分類 *</Label>
                <Select value={form.paper_type_group} onValueChange={v => setForm({ ...form, paper_type_group: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="紙">印刷費（紙）</SelectItem>
                    <SelectItem value="紙以外">印刷費（紙以外）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">参照メーカー *</Label>
              <Select
                value={form.vendorSelectValue}
                onValueChange={v => setForm({ ...form, vendorSelectValue: v, vendor_name: v === OTHER_VENDOR ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="印刷所情報から選択" /></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => (
                    <SelectItem key={v.id} value={v.name}>{v.name}</SelectItem>
                  ))}
                  <SelectItem value={OTHER_VENDOR}>その他（自由入力）</SelectItem>
                </SelectContent>
              </Select>
              {form.vendorSelectValue === OTHER_VENDOR && (
                <Input
                  value={form.vendor_name}
                  onChange={e => setForm({ ...form, vendor_name: e.target.value })}
                  placeholder="例: ○○ネット印刷"
                  className="mt-1.5"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">仕様（紙質・厚さ・面など）</Label>
              <Input value={form.spec_summary} onChange={e => setForm({ ...form, spec_summary: e.target.value })} placeholder="例: 両面印刷・上質紙・110kg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">参照元URL</Label>
              <Input value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">備考</Label>
              <Input value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            {form.price_grid.length > 0 && (
              <div className="p-2.5 rounded-md bg-muted/40 border space-y-1.5">
                <p className="text-[10px] text-muted-foreground">
                  価格表を{form.price_grid.length}行分取り込み済みです。保存後、一覧の「見積候補」から使うセルを選択してください。
                  {form.price_grid.length > 30 && (
                    <span className="text-amber-600"> ※行数が多めです。ページのノイズを誤認識している可能性があるので、下のプレビューで内容をご確認ください。</span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {form.price_grid.slice(0, 20).map((row, i) => (
                    <Badge key={i} variant="outline" className="text-[9px] font-normal">
                      {row.quantity}枚（{(row.cells || []).length}パターン）
                    </Badge>
                  ))}
                  {form.price_grid.length > 20 && (
                    <Badge variant="outline" className="text-[9px] font-normal">他{form.price_grid.length - 20}行</Badge>
                  )}
                </div>
              </div>
            )}
            <Button className="w-full" onClick={handleSubmit} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editing ? "更新" : "追加"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* グリッド閲覧・選択ダイアログ */}
      <GridEditorDialog
        record={gridEditingRecord}
        open={!!gridEditingRecord}
        onClose={() => setGridEditingRecord(null)}
        onSave={(grid) => gridSaveMutation.mutate({ id: gridEditingRecord.id, price_grid: grid })}
      />
    </div>
  );
}
