import { useRef, useState } from "react";
import { db } from "@/api/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

/** 画像を中央で正方形に切り抜き、小さく縮めて data URL にする（工程表のアイコン用） */
export async function avatarDataUrl(file, size = 160) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("画像を読み込めませんでした")); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 自分の顔写真（工程表・タスクの担当アイコンに出す） */
export default function AvatarCard({ user, onSaved }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const save = async (avatar) => {
    setBusy(true);
    try {
      await db.entities.User.update(user.id, { avatar_url: avatar });
      await onSaved?.();
      toast.success(avatar ? "顔写真を保存しました" : "顔写真を外しました");
    } catch (e) {
      toast.error("保存できませんでした: " + e.message);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("画像ファイルを選んでください"); return; }
    try { await save(await avatarDataUrl(file)); } catch (err) { toast.error(err.message); }
  };
  const initial = (user?.short_name || user?.full_name || user?.email || "?").slice(0, 2);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">顔写真</CardTitle>
        <CardDescription className="text-xs">工程表の担当アイコンに出ます。クライアント向けの工程表には「メンバー名を出す」にした工程だけ出ます</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        {user?.avatar_url
          ? <img src={user.avatar_url} alt="顔写真" className="h-16 w-16 rounded-full object-cover ring-2 ring-blue-500 ring-offset-2" />
          : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-lg font-bold text-white">{initial}</span>}
        <div className="flex gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={pick} />
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} 写真を選ぶ
          </Button>
          {user?.avatar_url && <Button variant="ghost" size="sm" className="gap-1.5" disabled={busy} onClick={() => save(null)}><Trash2 className="h-4 w-4" /> 外す</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
