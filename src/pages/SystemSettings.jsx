import { db } from "@/api/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Settings, Plus, X, ArrowUp, ArrowDown, FileText, GripVertical, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

// 設定1件をupsert（存在すれば更新、無ければ新規作成）
async function upsertSetting(existingList, key, value, description) {
  const existing = existingList.find(s => s.setting_key === key);
  const data = { setting_key: key, setting_value: value, description };
  if (existing) {
    await db.entities.SystemSettings.update(existing.id, data);
  } else {
    await db.entities.SystemSettings.create(data);
  }
}

// テンプレート1件：クリックでその場編集、ドラッグで並び替え
function TemplateRow({ template, isDragging, onDragStart, onDragOver, onDrop, onDragEnd, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(template.label);
  const [text, setText] = useState(template.text);

  const commit = () => {
    setEditing(false);
    if (label !== template.label || text !== template.text) {
      onUpdate({ label, text });
    }
  };

  const cancel = () => {
    setLabel(template.label);
    setText(template.text);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="p-2.5 rounded border bg-white space-y-1.5">
        <Input value={label} onChange={e => setLabel(e.target.value)} className="h-7 text-xs font-medium" placeholder="ラベル" autoFocus />
        <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} className="text-xs" placeholder="本文" />
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancel}>キャンセル</Button>
          <Button size="sm" className="h-7 text-xs" onClick={commit}>完了</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-start gap-1.5 p-2.5 rounded border bg-muted/30 transition-opacity ${isDragging ? "opacity-40" : ""}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing mt-0.5 shrink-0"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      <div className="flex-1 min-w-0 cursor-text" onClick={() => setEditing(true)}>
        <p className="text-xs font-medium">{template.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{template.text}</p>
      </div>
      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive shrink-0">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function SystemSettingsPage() {
  const queryClient = useQueryClient();

  const { data: settings = [] } = useQuery({
    queryKey: ["settings"],
    queryFn: () => db.entities.SystemSettings.list(),
  });

  const [markupLabel, setMarkupLabel] = useState("1.25");
  const [markupOther, setMarkupOther] = useState("1.30");
  const [proofreadingFee, setProofreadingFee] = useState("0");
  const [dealProbabilityList, setDealProbabilityList] = useState(["A", "A（定期売上）", "要注意A", "B", "C", "失注"]);
  const [phaseList, setPhaseList] = useState(["未着手", "着手中"]);
  const [notesTemplates, setNotesTemplates] = useState([]);
  const [newProbabilityInput, setNewProbabilityInput] = useState("");
  const [newPhaseInput, setNewPhaseInput] = useState("");
  const [newTemplateLabel, setNewTemplateLabel] = useState("");
  const [newTemplateText, setNewTemplateText] = useState("");
  const [dragTemplateIdx, setDragTemplateIdx] = useState(null);

  // 数値系フィールドの自動保存が、読み込み直後の初期値セットで誤って走らないようにするガード
  const skipMarkupAutosave = useRef(true);
  const skipProofAutosave = useRef(true);

  useEffect(() => {
    if (settings.length > 0) {
      const markup = settings.find(s => s.setting_key === "markup_rates");
      if (markup) {
        try {
          const val = JSON.parse(markup.setting_value);
          setMarkupLabel(String(val.package_label ?? 1.25));
          setMarkupOther(String(val.other ?? 1.30));
        } catch { /* ignore */ }
      }
      const proof = settings.find(s => s.setting_key === "default_proofreading_fee");
      if (proof) setProofreadingFee(proof.setting_value);

      const probability = settings.find(s => s.setting_key === "deal_probability_options");
      if (probability) {
        try { setDealProbabilityList(JSON.parse(probability.setting_value)); } catch { /* ignore */ }
      }
      const phase = settings.find(s => s.setting_key === "phase_options");
      if (phase) {
        try { setPhaseList(JSON.parse(phase.setting_value)); } catch { /* ignore */ }
      }
      const templates = settings.find(s => s.setting_key === "notes_templates");
      if (templates) {
        try { setNotesTemplates(JSON.parse(templates.setting_value)); } catch { /* ignore */ }
      }
    }
  }, [settings.length]);

  // 掛け率・デフォルト校正費：入力が落ち着いてから自動保存（読み込み直後の1回はスキップ）
  useEffect(() => {
    if (skipMarkupAutosave.current) { skipMarkupAutosave.current = false; return; }
    const t = setTimeout(() => {
      upsertSetting(settings, "markup_rates", JSON.stringify({ package_label: Number(markupLabel), other: Number(markupOther) }), "印刷物種別ごとの掛け率")
        .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
        .catch(err => toast.error("自動保存に失敗しました: " + err.message));
    }, 800);
    return () => clearTimeout(t);
  }, [markupLabel, markupOther]);

  useEffect(() => {
    if (skipProofAutosave.current) { skipProofAutosave.current = false; return; }
    const t = setTimeout(() => {
      upsertSetting(settings, "default_proofreading_fee", proofreadingFee, "デフォルト校正費")
        .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
        .catch(err => toast.error("自動保存に失敗しました: " + err.message));
    }, 800);
    return () => clearTimeout(t);
  }, [proofreadingFee]);

  // リスト系（受注確度・フェーズ・テンプレート）は各操作の直後に即座に保存する
  const saveList = (key, value, description) => {
    upsertSetting(settings, key, JSON.stringify(value), description)
      .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
      .catch(err => toast.error("自動保存に失敗しました: " + err.message));
  };

  const moveInList = (list, setList, key, description, index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    setList(next);
    saveList(key, next, description);
  };

  const removeFromList = (list, setList, key, description, index) => {
    const next = list.filter((_, i) => i !== index);
    setList(next);
    saveList(key, next, description);
  };

  const addToList = (list, setList, key, description, value, resetInput) => {
    if (!value.trim()) return;
    if (list.includes(value.trim())) {
      toast.error("すでに同じ選択肢があります");
      return;
    }
    const next = [...list, value.trim()];
    setList(next);
    saveList(key, next, description);
    resetInput("");
  };

  const addTemplate = () => {
    if (!newTemplateLabel.trim() || !newTemplateText.trim()) {
      toast.error("ラベルと本文の両方を入力してください");
      return;
    }
    const next = [...notesTemplates, { label: newTemplateLabel.trim(), text: newTemplateText.trim() }];
    setNotesTemplates(next);
    saveList("notes_templates", next, "備考欄の定型テンプレート文言");
    setNewTemplateLabel("");
    setNewTemplateText("");
  };

  const removeTemplate = (index) => {
    const next = notesTemplates.filter((_, i) => i !== index);
    setNotesTemplates(next);
    saveList("notes_templates", next, "備考欄の定型テンプレート文言");
  };

  const updateTemplate = (index, updated) => {
    const next = notesTemplates.map((t, i) => i === index ? updated : t);
    setNotesTemplates(next);
    saveList("notes_templates", next, "備考欄の定型テンプレート文言");
  };

  const reorderTemplates = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx == null || toIdx == null) return;
    const next = [...notesTemplates];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setNotesTemplates(next);
    saveList("notes_templates", next, "備考欄の定型テンプレート文言");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6" /> システム設定
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">掛け率・費用などのマスタデータを管理</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" /> 変更は自動的に保存されます
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">掛け率設定</CardTitle>
          <CardDescription className="text-xs">印刷物種別ごとの掛け率を設定します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">パッケージラベル印刷</Label>
              <Input
                type="number"
                step="0.01"
                value={markupLabel}
                onChange={e => setMarkupLabel(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">例: 1.25 = 原価×1.25</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">その他全種別</Label>
              <Input
                type="number"
                step="0.01"
                value={markupOther}
                onChange={e => setMarkupOther(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">例: 1.30 = 原価×1.30</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">デフォルト費用</CardTitle>
          <CardDescription className="text-xs">新規見積作成時のデフォルト値</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-w-xs">
            <Label className="text-xs">デフォルト校正費（円）</Label>
            <Input
              type="number"
              value={proofreadingFee}
              onChange={e => setProofreadingFee(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">受注確度・フェーズの選択肢</CardTitle>
          <CardDescription className="text-xs">見積詳細画面で選べる選択肢を管理します（上下で並び順を変更できます）</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-xs">受注確度</Label>
            <div className="space-y-1">
              {dealProbabilityList.map((item, i) => (
                <div key={item} className="flex items-center gap-1.5">
                  <span className="flex-1 text-sm px-2.5 py-1.5 rounded border bg-muted/30">{item}</span>
                  <button onClick={() => moveInList(dealProbabilityList, setDealProbabilityList, "deal_probability_options", "受注確度の選択肢", i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => moveInList(dealProbabilityList, setDealProbabilityList, "deal_probability_options", "受注確度の選択肢", i, 1)} disabled={i === dealProbabilityList.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeFromList(dealProbabilityList, setDealProbabilityList, "deal_probability_options", "受注確度の選択肢", i)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={newProbabilityInput}
                onChange={e => setNewProbabilityInput(e.target.value)}
                placeholder="新しい選択肢"
                className="h-8 text-xs"
                onKeyDown={e => e.key === "Enter" && addToList(dealProbabilityList, setDealProbabilityList, "deal_probability_options", "受注確度の選択肢", newProbabilityInput, setNewProbabilityInput)}
              />
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs shrink-0" onClick={() => addToList(dealProbabilityList, setDealProbabilityList, "deal_probability_options", "受注確度の選択肢", newProbabilityInput, setNewProbabilityInput)}>
                <Plus className="w-3.5 h-3.5" /> 追加
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">フェーズ</Label>
            <div className="space-y-1">
              {phaseList.map((item, i) => (
                <div key={item} className="flex items-center gap-1.5">
                  <span className="flex-1 text-sm px-2.5 py-1.5 rounded border bg-muted/30">{item}</span>
                  <button onClick={() => moveInList(phaseList, setPhaseList, "phase_options", "フェーズの選択肢", i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => moveInList(phaseList, setPhaseList, "phase_options", "フェーズの選択肢", i, 1)} disabled={i === phaseList.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeFromList(phaseList, setPhaseList, "phase_options", "フェーズの選択肢", i)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={newPhaseInput}
                onChange={e => setNewPhaseInput(e.target.value)}
                placeholder="新しい選択肢"
                className="h-8 text-xs"
                onKeyDown={e => e.key === "Enter" && addToList(phaseList, setPhaseList, "phase_options", "フェーズの選択肢", newPhaseInput, setNewPhaseInput)}
              />
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs shrink-0" onClick={() => addToList(phaseList, setPhaseList, "phase_options", "フェーズの選択肢", newPhaseInput, setNewPhaseInput)}>
                <Plus className="w-3.5 h-3.5" /> 追加
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" /> 備考欄のテンプレート
          </CardTitle>
          <CardDescription className="text-xs">
            見積画面の備考欄で「+ テンプレートを追加」から選べる定文を管理します。クリックでその場編集、ドラッグで並び替えできます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {notesTemplates.map((t, i) => (
            <TemplateRow
              key={i}
              template={t}
              isDragging={dragTemplateIdx === i}
              onDragStart={() => setDragTemplateIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { reorderTemplates(dragTemplateIdx, i); setDragTemplateIdx(null); }}
              onDragEnd={() => setDragTemplateIdx(null)}
              onUpdate={(updated) => updateTemplate(i, updated)}
              onRemove={() => removeTemplate(i)}
            />
          ))}

          <div className="p-2.5 rounded border border-dashed space-y-2">
            <Input
              value={newTemplateLabel}
              onChange={e => setNewTemplateLabel(e.target.value)}
              placeholder="ラベル（例: 送料の旨）"
              className="h-8 text-xs"
            />
            <Textarea
              value={newTemplateText}
              onChange={e => setNewTemplateText(e.target.value)}
              placeholder="本文（例: ※送料は別途ご請求となる場合がございます。）"
              rows={2}
              className="text-xs"
            />
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={addTemplate}>
              <Plus className="w-3.5 h-3.5" /> テンプレートを追加
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
