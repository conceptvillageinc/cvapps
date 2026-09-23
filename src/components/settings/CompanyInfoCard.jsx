import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Upload, Loader2, Stamp } from "lucide-react";
import { toast } from "sonner";
import { companyInfoFromSettings } from "@/lib/documents";

/**
 * 会社情報（帳票の自社欄・登録番号・振込先・電子印鑑）。
 * system_settings の company_info に自動保存する。
 */
export default function CompanyInfoCard({ settings, upsertSetting }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [stampUrl, setStampUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const skipAutosave = useRef(true);

  useEffect(() => {
    if (settings.length === 0 || form) return;
    setForm(companyInfoFromSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.length]);

  // 印影のプレビュー（非公開バケットなので署名付きURL）
  useEffect(() => {
    let alive = true;
    if (!form?.stamp_path) { setStampUrl(null); return; }
    db.storage.signedUrl(form.stamp_path).then((u) => alive && setStampUrl(u)).catch(() => alive && setStampUrl(null));
    return () => { alive = false; };
  }, [form?.stamp_path]);

  useEffect(() => {
    if (!form) return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    const t = setTimeout(() => {
      upsertSetting(settings, "company_info", JSON.stringify(form), "会社情報（帳票用）")
        .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
        .catch((err) => toast.error("自動保存に失敗しました: " + err.message));
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  if (!form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLoc = (i, patch) => set("locations", form.locations.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setBank = (i, patch) => set("bank_accounts", form.bank_accounts.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const uploadStamp = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/png|jpe?g/i.test(file.type)) { toast.error("PNG または JPEG の画像を選んでください（背景透過のPNG推奨）"); return; }
    setUploading(true);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      set("stamp_path", file_url);
      toast.success("印影を登録しました。納品書・請求書のPDFに入ります");
    } catch (err) {
      toast.error("アップロードに失敗しました: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">会社情報（帳票用）</CardTitle>
        <CardDescription className="text-xs">納品書・請求書の自社欄、登録番号、振込先、電子印鑑。変更は自動保存されます</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">会社名</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">代表者・担当者名（自社欄に併記）</Label>
            <Input value={form.representative || ""} onChange={(e) => set("representative", e.target.value)} placeholder="例: 馬場大治" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">適格請求書発行事業者 登録番号</Label>
            <Input value={form.registration_number || ""} onChange={(e) => set("registration_number", e.target.value)} placeholder="T + 13桁" className="h-9 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">電話</Label>
              <Input value={form.tel || ""} onChange={(e) => set("tel", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">FAX</Label>
              <Input value={form.fax || ""} onChange={(e) => set("fax", e.target.value)} className="h-9" />
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold">所在地（納品書は1つ目だけ、請求書はすべて載ります）</p>
          {form.locations.map((l, i) => (
            <div key={i} className="grid grid-cols-[80px_110px_1fr_32px] gap-2 items-center">
              <Input value={l.label || ""} onChange={(e) => setLoc(i, { label: e.target.value })} placeholder="福島" className="h-9 text-xs" />
              <Input value={l.postal || ""} onChange={(e) => setLoc(i, { postal: e.target.value })} placeholder="9630117" className="h-9 text-xs font-mono" />
              <Input value={l.address || ""} onChange={(e) => setLoc(i, { address: e.target.value })} placeholder="住所" className="h-9 text-xs" />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => set("locations", form.locations.filter((_, j) => j !== i))}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => set("locations", [...form.locations, { label: "", postal: "", address: "" }])}>
            <Plus className="w-3.5 h-3.5" /> 所在地を追加
          </Button>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold">振込先（請求書に載ります）</p>
          {form.bank_accounts.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_60px_100px_1fr_32px] gap-2 items-center">
              <Input value={b.bank || ""} onChange={(e) => setBank(i, { bank: e.target.value })} placeholder="銀行名" className="h-9 text-xs" />
              <Input value={b.branch || ""} onChange={(e) => setBank(i, { branch: e.target.value })} placeholder="支店名" className="h-9 text-xs" />
              <Input value={b.type || ""} onChange={(e) => setBank(i, { type: e.target.value })} placeholder="普通" className="h-9 text-xs" />
              <Input value={b.number || ""} onChange={(e) => setBank(i, { number: e.target.value })} placeholder="口座番号" className="h-9 text-xs font-mono" />
              <Input value={b.holder || ""} onChange={(e) => setBank(i, { holder: e.target.value })} placeholder="口座名義" className="h-9 text-xs" />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => set("bank_accounts", form.bank_accounts.filter((_, j) => j !== i))}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => set("bank_accounts", [...form.bank_accounts, { bank: "", branch: "", type: "普通", number: "", holder: "" }])}>
            <Plus className="w-3.5 h-3.5" /> 振込先を追加
          </Button>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5"><Stamp className="w-3.5 h-3.5" /> 電子印鑑</p>
          <div className="flex items-center gap-4">
            <div className="w-32 h-32 rounded border bg-white flex items-center justify-center overflow-hidden">
              {stampUrl ? <img src={stampUrl} alt="印影" style={{ width: `${(Number(form.stamp_width) || 52) * 1.33}px`, maxWidth: "100%", maxHeight: "100%" }} /> : <span className="text-[10px] text-muted-foreground">未登録</span>}
            </div>
            <div className="space-y-1.5">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={uploadStamp} />
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} 印影の画像を選ぶ
              </Button>
              {form.stamp_path && (
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => set("stamp_path", "")}>印影を外す</Button>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Label className="text-[10px] whitespace-nowrap">印影の大きさ</Label>
                <input type="range" min="24" max="120" step="2" value={Number(form.stamp_width) || 52} onChange={(e) => set("stamp_width", Number(e.target.value))} className="w-40" />
                <span className="text-[10px] tabular-nums text-muted-foreground w-10">{Number(form.stamp_width) || 52}pt</span>
              </div>
              <p className="text-[10px] text-muted-foreground">背景が透過のPNGを推奨。見積書・納品書・請求書のPDFで自社欄の右端に重ねます（左のプレビューは実寸の目安）</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">納品書の備考（既定文）</Label>
            <Textarea value={form.delivery_notes || ""} onChange={(e) => set("delivery_notes", e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">請求書の備考（既定文）</Label>
            <Textarea value={form.invoice_notes || ""} onChange={(e) => set("invoice_notes", e.target.value)} rows={2} placeholder="例: お振込手数料はご負担ください。" />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
