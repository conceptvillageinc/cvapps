import { db } from "@/api/db";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HelpCircle, Plus, Trash2, GripVertical, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

// AIに渡す AX CV KIT（CVアプリ）の機能概要（回答を実際の仕様に沿ったものにするためのコンテキスト）
const APP_CONTEXT = `
AX CV KIT（CVアプリ。旧称 CV見積アプリ）は、株式会社コンセプト・ヴィレッジ社内向けの見積作成・管理アプリです。主な機能は以下の通り。

- サイドバー構成：ダッシュボード、新規見積作成、見積一覧、提出見積履歴（以上「メイン」）、クライアント一覧、印刷所情報、価格マスタ、システム設定、ユーザー管理（以上「管理」）、Q&A（一番下）。
- 見積作成画面（QuoteEditor）：左側にクライアント提出用プレビュー（自動同期、原価非表示）、右側に入力画面。「+明細を追加」から大カテゴリ（デザイン費・印刷費（紙）・印刷費（紙以外）・web構築費・システム構築費・自由入力）を選び、デザイン費はデザイン費マスタから、印刷費は価格マスタで事前に選択しておいたセルから選ぶ。名称・数量・単位・単価・金額はクリックでその場編集、ドラッグで並び替え可。入力は1秒自動保存される（保存ボタンなし）。「社内確認用」トグルで原価・掛け率・粗利を表示・編集可能。「印刷用に新しいタブで開く」で原価非表示の印刷可能なページを生成。備考欄はシステム設定で登録した定型文をテンプレートとして挿入可能。
- 見積番号：「CV-YYMM-連番」形式（例: CV-2607-001）で月毎にリセット、重複時は自動でサフィックス。
- バージョン管理：同一案件の改訂版を「改訂版を作成」で作成し、「最新版」バッジは自動判定、「最終提出版」は手動でマーク。受注確度（A/A定期売上/要注意A/B/C/失注）とフェーズ（未着手/着手中）はシステム設定で選択肢を管理。
- 価格マスタ：印刷会社の価格ページURLまたはスクショを読み込み、枚数×納期の価格表（グリッド）を一括取得。実務で使うセルだけクリックで選択しておくと、見積作成時の候補に出る。
- クライアント一覧：名前・住所・電話等は一覧上でクリックしてその場編集可能。郵便番号は7桁数字で保存し、表示時に自動で「〒000-0000」形式に整形される。
- ユーザー管理：「+メンバー招待」からメールアドレス（concept-village.co.jp）を入力して招待。新規登録は自動で管理者権限になる。
- システム設定：掛け率、デフォルト校正費、受注確度・フェーズの選択肢、備考欄テンプレートを管理。変更は全て自動保存。
- Q&A：本ページ。質問・回答をクリックでその場編集、ドラッグで並び替え可能。
`;

// Q&A 1件：クリックでその場編集、ドラッグで並び替え
function FaqRow({ item, isDragging, onDragStart, onDragOver, onDrop, onDragEnd, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(item.question);
  const [answer, setAnswer] = useState(item.answer);

  const commit = () => {
    setEditing(false);
    if (question !== item.question || answer !== item.answer) {
      onUpdate({ question, answer });
    }
  };

  const cancel = () => {
    setQuestion(item.question);
    setAnswer(item.answer);
    setEditing(false);
  };

  if (editing) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Input value={question} onChange={e => setQuestion(e.target.value)} className="font-medium" placeholder="質問" autoFocus />
          <Textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={4} placeholder="回答" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel}>キャンセル</Button>
            <Button size="sm" onClick={commit}>完了</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`transition-opacity ${isDragging ? "opacity-40" : ""}`} onDragOver={onDragOver} onDrop={onDrop}>
      <CardContent className="p-4 flex items-start gap-2">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing mt-1 shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0 cursor-text" onClick={() => setEditing(true)}>
          <p className="text-sm font-semibold flex items-start gap-1.5">
            <span className="text-primary shrink-0">Q.</span>{item.question}
          </p>
          <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap break-words flex items-start gap-1.5">
            <span className="text-muted-foreground/60 shrink-0">A.</span>{item.answer}
          </p>
        </div>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </CardContent>
    </Card>
  );
}

export default function FaqPage() {
  const queryClient = useQueryClient();
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["faqItems"],
    queryFn: () => db.entities.FaqItem.list("sort_order"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["faqItems"] });

  const createMutation = useMutation({
    mutationFn: (data) => db.entities.FaqItem.create(data),
    onSuccess: () => {
      invalidate();
      toast.success("追加しました");
    },
    onError: (err) => toast.error("追加に失敗しました: " + err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.entities.FaqItem.update(id, data),
    onSuccess: invalidate,
    onError: (err) => toast.error("更新に失敗しました: " + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.entities.FaqItem.delete(id),
    onSuccess: () => {
      invalidate();
      toast.success("削除しました");
    },
    onError: (err) => toast.error("削除に失敗しました: " + err.message),
  });

  const handleAdd = () => {
    if (!newQuestion.trim() || !newAnswer.trim()) {
      toast.error("質問と回答の両方を入力してください");
      return;
    }
    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order || 0)) : -1;
    createMutation.mutate({ question: newQuestion.trim(), answer: newAnswer.trim(), sort_order: maxOrder + 1 });
    setNewQuestion("");
    setNewAnswer("");
  };

  const handleAskAi = async () => {
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    try {
      const existingQA = items.map(i => `Q: ${i.question}\nA: ${i.answer}`).join("\n\n");
      const result = await db.integrations.Core.InvokeLLM({
        prompt: `あなたは「AX CV KIT（CVアプリ）」の使い方サポートアシスタントです。以下のアプリの機能概要を参考に、メンバーからの質問に日本語で簡潔に回答してください。手順がある場合は番号付きリストで。コンテキストにない内容（アプリの仕様にない細かい仕様など）は想像で答えず、「この点は情報がないため、担当者に確認してください」と正直に伝えてください。

【アプリの機能概要】${APP_CONTEXT}

【既存のQ&A（参考・重複回答は避ける）】
${existingQA || "（まだ登録なし）"}

【質問】
${aiQuestion.trim()}`,
      });
      const answerText = typeof result === "string" ? result : (result?.text || JSON.stringify(result));
      const minOrder = items.length > 0 ? Math.min(...items.map(i => i.sort_order || 0)) : 0;
      await db.entities.FaqItem.create({ question: aiQuestion.trim(), answer: answerText, sort_order: minOrder - 1 });
      invalidate();
      toast.success("AIの回答をQ&Aに登録しました");
      setAiQuestion("");
    } catch (err) {
      toast.error("AIへの質問に失敗しました: " + err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const reorder = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx == null || toIdx == null) return;
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    // 並び替え後、それぞれのsort_orderを振り直して保存
    next.forEach((item, i) => {
      if (item.sort_order !== i) {
        db.entities.FaqItem.update(item.id, { sort_order: i }).then(invalidate);
      }
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <HelpCircle className="w-6 h-6" /> Q&amp;A
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          使い方の疑問や運用ルールをみんなで登録・編集できます。クリックでその場編集、ドラッグで並び替えできます。
        </p>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 space-y-2">
          <p className="text-xs font-medium text-primary flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> AIに質問する（回答を自動でQ&Aに登録）
          </p>
          <div className="flex gap-2 items-end">
            <Textarea
              value={aiQuestion}
              onChange={e => setAiQuestion(e.target.value)}
              placeholder="例: 見積の最新版と最終提出版の違いは？"
              rows={2}
              className="bg-white resize-none"
            />
            <Button onClick={handleAskAi} disabled={aiLoading || !aiQuestion.trim()} className="gap-1.5 shrink-0">
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              送信
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Enterキーで改行できます。送信は右のボタンから。回答は自動で一番上にQ&A登録されます。</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <FaqRow
              key={item.id}
              item={item}
              isDragging={dragIdx === i}
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { reorder(dragIdx, i); setDragIdx(null); }}
              onDragEnd={() => setDragIdx(null)}
              onUpdate={(data) => updateMutation.mutate({ id: item.id, data })}
              onRemove={() => deleteMutation.mutate(item.id)}
            />
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground font-medium">+ 新しい質問を追加（手動で回答も入力）</p>
          <Input value={newQuestion} onChange={e => setNewQuestion(e.target.value)} placeholder="質問（例: 見積番号のルールは？）" />
          <Textarea value={newAnswer} onChange={e => setNewAnswer(e.target.value)} rows={3} placeholder="回答" />
          <Button size="sm" className="gap-1.5" onClick={handleAdd} disabled={createMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> 追加
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
