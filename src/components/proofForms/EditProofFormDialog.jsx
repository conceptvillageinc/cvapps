import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import ProofFormFields, { cleanProofFields } from "@/components/proofForms/ProofFormFields";

/**
 * 作った校了フォームの中身を直す（タイトル・説明・校了の対象・質問・送信後のメッセージ）。
 *   URL はそのまま。保存すると、クライアントさんが次に開いたときから新しい内容で出る
 */
export default function EditProofFormDialog({ form, responseCount = 0, onClose }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!form) { setValue(null); return; }
    setValue({
      title: form.title || "", description: form.description || "", confirm_message: form.confirm_message || "",
      items: (form.items || []).map((it, i) => ({ ...it, _k: `it${i}` })),
      questions: (form.questions || []).map((q) => ({ ...q, options: q.options ? [...q.options] : undefined })),
    });
  }, [form]);
  const save = async () => {
    const { error, data } = cleanProofFields(value);
    if (error) { toast.error(error); return; }
    setBusy(true);
    try {
      await db.entities.ProofForm.update(form.id, data);
      qc.invalidateQueries({ queryKey: ["proofForms"] });
      toast.success("校了フォームを保存しました（URL はそのままです）");
      onClose();
    } catch (e) { toast.error("保存できませんでした: " + (e?.message || "")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!form} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-2xl [&>*]:min-w-0" data-testid="edit-proof-form">
        <DialogHeader>
          <DialogTitle>校了フォームを編集</DialogTitle>
          <DialogDescription>{form?.client_name}／{form?.project_name}（{form?.estimate_number}）　URL はそのままで、クライアントさんが次に開いたときから新しい内容で出ます</DialogDescription>
        </DialogHeader>
        {responseCount > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="edit-proof-has-answers">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            すでに {responseCount} 件の回答があります。届いた回答はそのまま残ります。質問を消すと、その質問への答えは回答の画面に出なくなります
          </p>
        )}
        <div className="max-h-[62vh] overflow-y-auto pr-1">
          {value && <ProofFormFields value={value} onChange={setValue} />}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>やめる</Button>
          <Button onClick={save} disabled={busy || !value} data-testid="edit-proof-save">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
