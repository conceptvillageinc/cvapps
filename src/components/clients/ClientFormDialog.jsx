import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { isValidPostalCode, formatPostalCode, formatPostalInput, normalizePostalCode } from "@/lib/postalCode";
import { INVOICE_DELIVERY_METHODS } from "@/lib/constants";
import ClientImageReader from "@/components/clients/ClientImageReader";

const emptyForm = { name: "", name_kana: "", contact_person: "", contact_person_kana: "", email: "", phone: "", postal_code: "", address: "", notes: "", invoice_delivery_method: "", invoice_delivery_notes: "", has_recurring_billing: false, cc_emails: ["", ""] };

const fromClient = (client) => ({ name: client.name || "", name_kana: client.name_kana || "", contact_person: client.contact_person || "", contact_person_kana: client.contact_person_kana || "", email: client.email || "", phone: client.phone || "", postal_code: client.postal_code || "", address: client.address || "", notes: client.notes || "", invoice_delivery_method: client.invoice_delivery_method || "", invoice_delivery_notes: client.invoice_delivery_notes || "", has_recurring_billing: !!client.has_recurring_billing, cc_emails: [0, 1].map((i) => (Array.isArray(client.cc_emails) ? client.cc_emails[i] : "") || "") });

/**
 * クライアントの新規登録・編集のダイアログ（クライアント一覧と、議事録の新規登録から共通で使う）。
 *   editing      編集するクライアント。null なら新規
 *   initialName  新規のときに最初から入れておく名前
 *   onSaved(row) 保存できたときに呼ぶ（保存した行を渡す）
 */
export default function ClientFormDialog({ open, onOpenChange, editing = null, initialName = "", onSaved }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  useEffect(() => {
    if (!open) return;
    setForm(editing ? fromClient(editing) : { ...emptyForm, name: initialName || "" });
  }, [open, editing, initialName]);

  const saveMutation = useMutation({
    mutationFn: (data) => (editing ? db.entities.Client.update(editing.id, data) : db.entities.Client.create(data)),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onOpenChange(false);
      onSaved?.(row && row.id ? row : { ...(editing || {}), ...form });
    },
    onError: (e) => toast.error("保存できませんでした: " + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "クライアント編集" : "クライアント新規追加"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <ClientImageReader
            onResult={(r) => setForm((f) => {
              // 読み取れた項目だけ入れる。既に入力してある項目は読み取り結果で上書きし、備考は末尾に足す
              const next = { ...f };
              for (const k of ["name", "name_kana", "contact_person", "contact_person_kana", "email", "phone", "postal_code", "address"]) if (r[k]) next[k] = r[k];
              if (r.notes) next.notes = [f.notes, r.notes].filter(Boolean).join("\n");
              return next;
            })}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">クライアント名 <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="株式会社サンプル" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">フリガナ</Label>
              <Input value={form.name_kana} onChange={e => setForm(f => ({ ...f, name_kana: e.target.value }))} placeholder="カブシキガイシャサンプル" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">担当者名</Label>
              <Input value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="山田 太郎" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">フリガナ</Label>
              <Input value={form.contact_person_kana} onChange={e => setForm(f => ({ ...f, contact_person_kana: e.target.value }))} placeholder="ヤマダ タロウ" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">メール（To）</Label>
              <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@example.com" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">電話番号</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="03-0000-0000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-1">
                <Label className="text-xs">メール（CC {i + 1}）</Label>
                <Input
                  value={form.cc_emails?.[i] || ""}
                  onChange={e => setForm(f => { const cc = [...(f.cc_emails || ["", ""])]; cc[i] = e.target.value; return { ...f, cc_emails: cc }; })}
                  placeholder="cc@example.com"
                />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">納品書・請求書・見積書をメールで送るとき、To と CC（最大2件）に送ります</p>
          <div className="space-y-1">
            <Label className="text-xs">郵便番号</Label>
            <Input
              value={formatPostalInput(form.postal_code)}
              onChange={e => setForm(f => ({ ...f, postal_code: normalizePostalCode(e.target.value) }))}
              placeholder="963 0117（7桁数字、ハイフン不要）"
              className={`max-w-[160px] ${form.postal_code && !isValidPostalCode(form.postal_code) ? "border-destructive" : ""}`}
              maxLength={8}
            />
            {form.postal_code && !isValidPostalCode(form.postal_code) && (
              <p className="text-[10px] text-destructive">7桁の数字で入力してください（現在{form.postal_code.length}桁）</p>
            )}
            {form.postal_code && isValidPostalCode(form.postal_code) && (
              <p className="text-[10px] text-muted-foreground">見積書では {formatPostalCode(form.postal_code)} と表示されます</p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">住所</Label>
            <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="東京都渋谷区..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">請求書の送付方法</Label>
              <select
                value={form.invoice_delivery_method}
                onChange={e => setForm(f => ({ ...f, invoice_delivery_method: e.target.value }))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">未設定</option>
                {Object.entries(INVOICE_DELIVERY_METHODS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">定期売上</Label>
              <label className="flex items-center gap-2 h-9 text-sm cursor-pointer">
                <input type="checkbox" checked={form.has_recurring_billing} onChange={e => setForm(f => ({ ...f, has_recurring_billing: e.target.checked }))} />
                毎月の請求がある
              </label>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">送付に関する補足</Label>
            <Input value={form.invoice_delivery_notes} onChange={e => setForm(f => ({ ...f, invoice_delivery_notes: e.target.value }))} placeholder="例: ○○様宛 / CCあり / 送付方法要確認" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">備考</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
          <Button onClick={() => saveMutation.mutate({ ...form, invoice_delivery_method: form.invoice_delivery_method || null, cc_emails: (form.cc_emails || []).map((v) => String(v || "").trim()).filter(Boolean).slice(0, 2) })} disabled={!form.name || (form.postal_code && !isValidPostalCode(form.postal_code)) || saveMutation.isPending}>
            {saveMutation.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
