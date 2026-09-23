import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Users, UserSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { normalizePostalCode, isValidPostalCode, formatPostalCode, formatPostalInput } from "@/lib/postalCode";
import { INVOICE_DELIVERY_METHODS } from "@/lib/constants";

const emptyForm = { name: "", name_kana: "", contact_person: "", contact_person_kana: "", email: "", phone: "", postal_code: "", address: "", notes: "", invoice_delivery_method: "", invoice_delivery_notes: "", has_recurring_billing: false, cc_emails: ["", ""] };

// クリックしてその場で編集できるセル。フォーカスを外すと自動保存される。
// normalize: 入力中に値を正規化（例: 郵便番号のハイフン除去）
// validate: 正規化後の値が有効かを判定（無効なら保存を中止し元の値に戻す）
// displayFormatter: 非編集時の表示を整形（例: 〒000-0000）
// liveFormat: 編集中の表示を整形（例: 000 0000とスペースを挿入）
function InlineEditCell({ value, onSave, placeholder = "—", className = "", inputClassName = "", normalize, validate, displayFormatter, liveFormat, invalidMessage = "入力内容をご確認ください" }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");

  const startEdit = () => {
    setText(value || "");
    setEditing(true);
  };

  const handleChange = (raw) => {
    setText(normalize ? normalize(raw) : raw);
  };

  const commit = () => {
    if (validate && text && !validate(text)) {
      toast.error(invalidMessage);
      setText(value || "");
      setEditing(false);
      return;
    }
    setEditing(false);
    if (text !== (value || "")) {
      onSave(text);
    }
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={liveFormat ? liveFormat(text) : text}
        onChange={e => handleChange(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setText(value || ""); setEditing(false); }
        }}
        className={`h-7 text-sm ${inputClassName}`}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); startEdit(); }}
      className={`px-1.5 py-1 -mx-1.5 rounded cursor-text hover:bg-muted/60 transition-colors min-h-[1.5rem] ${className}`}
    >
      {value ? (displayFormatter ? displayFormatter(value) : value) : <span className="text-muted-foreground/50">{placeholder}</span>}
    </div>
  );
}

export default function ClientManagement() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: () => db.entities.Client.list("-created_date"),
  });

  const saveMutation = useMutation({
    mutationFn: (data) =>
      editing ? db.entities.Client.update(editing.id, data) : db.entities.Client.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setDialogOpen(false);
    },
  });

  const inlineUpdateMutation = useMutation({
    mutationFn: ({ id, field, value }) => db.entities.Client.update(id, { [field]: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.entities.Client.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
  });

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (client) => {
    setEditing(client);
    setForm({ name: client.name || "", name_kana: client.name_kana || "", contact_person: client.contact_person || "", contact_person_kana: client.contact_person_kana || "", email: client.email || "", phone: client.phone || "", postal_code: client.postal_code || "", address: client.address || "", notes: client.notes || "", invoice_delivery_method: client.invoice_delivery_method || "", invoice_delivery_notes: client.invoice_delivery_notes || "", has_recurring_billing: !!client.has_recurring_billing, cc_emails: [0, 1].map((i) => (Array.isArray(client.cc_emails) ? client.cc_emails[i] : "") || "") });
    setDialogOpen(true);
  };

  const filtered = clients.filter(c =>
    c.name?.includes(search) || c.contact_person?.includes(search) || c.email?.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">クライアント一覧</h1>
          <p className="text-sm text-muted-foreground mt-0.5">取引先情報を管理します（各項目はクリックでその場編集できます）</p>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="w-4 h-4 mr-1" /> 新規追加
        </Button>
      </div>

      <Input
        placeholder="クライアント名・担当者・メールで検索..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">読み込み中...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">クライアントがありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">クライアント名</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">担当者</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell w-36">請求書送付</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell">メール</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell">電話番号</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell w-28">郵便番号</th>
                    <th className="text-left p-3 font-medium text-muted-foreground hidden xl:table-cell">住所</th>
                    <th className="p-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(client => (
                    <tr key={client.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-medium">
                        <InlineEditCell
                          value={client.name}
                          onSave={(v) => inlineUpdateMutation.mutate({ id: client.id, field: "name", value: v })}
                        />
                      </td>
                      <td className="p-3 text-muted-foreground hidden md:table-cell">
                        <InlineEditCell
                          value={client.contact_person}
                          onSave={(v) => inlineUpdateMutation.mutate({ id: client.id, field: "contact_person", value: v })}
                        />
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <select
                            value={client.invoice_delivery_method || ""}
                            onChange={e => inlineUpdateMutation.mutate({ id: client.id, field: "invoice_delivery_method", value: e.target.value || null })}
                            className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground"
                            title={client.invoice_delivery_notes || ""}
                          >
                            <option value="">—</option>
                            {Object.entries(INVOICE_DELIVERY_METHODS).map(([k, v]) => (
                              <option key={k} value={k}>{v}</option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap cursor-pointer" title="定期売上（毎月の請求）がある">
                            <input
                              type="checkbox"
                              checked={!!client.has_recurring_billing}
                              onChange={e => inlineUpdateMutation.mutate({ id: client.id, field: "has_recurring_billing", value: e.target.checked })}
                            />
                            定期
                          </label>
                        </div>
                        {client.invoice_delivery_notes && (
                          <div className="text-[10px] text-amber-700 mt-0.5 truncate max-w-[140px]" title={client.invoice_delivery_notes}>{client.invoice_delivery_notes}</div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground hidden lg:table-cell">
                        <InlineEditCell
                          value={client.email}
                          onSave={(v) => inlineUpdateMutation.mutate({ id: client.id, field: "email", value: v })}
                        />
                        {Array.isArray(client.cc_emails) && client.cc_emails.filter(Boolean).length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">CC: {client.cc_emails.filter(Boolean).join(", ")}</div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground hidden lg:table-cell">
                        <InlineEditCell
                          value={client.phone}
                          onSave={(v) => inlineUpdateMutation.mutate({ id: client.id, field: "phone", value: v })}
                        />
                      </td>
                      <td className="p-3 text-muted-foreground hidden lg:table-cell">
                        <InlineEditCell
                          value={client.postal_code}
                          onSave={(v) => inlineUpdateMutation.mutate({ id: client.id, field: "postal_code", value: v })}
                          inputClassName="w-24"
                          normalize={normalizePostalCode}
                          validate={isValidPostalCode}
                          displayFormatter={formatPostalCode}
                          liveFormat={formatPostalInput}
                          invalidMessage="郵便番号は7桁の数字で入力してください（例: 9630117）"
                        />
                      </td>
                      <td className="p-3 text-muted-foreground hidden xl:table-cell">
                        <InlineEditCell
                          value={client.address}
                          onSave={(v) => inlineUpdateMutation.mutate({ id: client.id, field: "address", value: v })}
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="カルテ" onClick={() => navigate(`/clients/${client.id}`)}>
                            <UserSquare className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(client)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(client.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "クライアント編集" : "クライアント新規追加"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button onClick={() => saveMutation.mutate({ ...form, invoice_delivery_method: form.invoice_delivery_method || null, cc_emails: (form.cc_emails || []).map((v) => String(v || "").trim()).filter(Boolean).slice(0, 2) })} disabled={!form.name || (form.postal_code && !isValidPostalCode(form.postal_code)) || saveMutation.isPending}>
              {saveMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
