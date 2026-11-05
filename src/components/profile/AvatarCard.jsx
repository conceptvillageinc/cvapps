import { useEffect, useRef, useState } from "react";
import { db } from "@/api/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("画像を読み込めませんでした")); i.src = src; });

/**
 * 画像の一部を正方形に切り抜き、小さく縮めて data URL にする（工程表・タスクのアイコン用）
 *   crop: { x, y, side }（元画像のピクセル）。省略すると中央
 */
export async function avatarDataUrl(file, size = 200, crop = null) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side0 = Math.min(img.naturalWidth, img.naturalHeight);
    const c = crop || { x: (img.naturalWidth - side0) / 2, y: (img.naturalHeight - side0) / 2, side: side0 };
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, c.x, c.y, c.side, c.side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const VIEW = 260; // 位置合わせの枠の大きさ（px）

/** 写真の位置合わせ: ドラッグで動かす・つまみで拡大。丸の中がアイコンになる */
function AvatarCropDialog({ file, onCancel, onDone, busy }) {
  const [src, setSrc] = useState("");
  const [nat, setNat] = useState(null); // { w, h }
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // 画像の左上（枠の左上から）
  const drag = useRef(null);
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setSrc(url); setNat(null); setZoom(1);
    loadImage(url).then((img) => {
      const w = img.naturalWidth, h = img.naturalHeight, sc = VIEW / Math.min(w, h);
      setNat({ w, h }); setPos({ x: (VIEW - w * sc) / 2, y: (VIEW - h * sc) / 2 });
    }, () => toast.error("画像を読み込めませんでした"));
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const scale = nat ? (VIEW / Math.min(nat.w, nat.h)) * zoom : 1;
  const dw = nat ? nat.w * scale : VIEW, dh = nat ? nat.h * scale : VIEW;
  const clamp = (p, w = dw, h = dh) => ({ x: Math.min(0, Math.max(VIEW - w, p.x)), y: Math.min(0, Math.max(VIEW - h, p.y)) });
  // 拡大・縮小は枠の真ん中を基準に
  const changeZoom = (z) => {
    if (!nat) return;
    const s0 = scale, s1 = (VIEW / Math.min(nat.w, nat.h)) * z;
    const cx = (VIEW / 2 - pos.x) / s0, cy = (VIEW / 2 - pos.y) / s0;
    setZoom(z);
    setPos(clamp({ x: VIEW / 2 - cx * s1, y: VIEW / 2 - cy * s1 }, nat.w * s1, nat.h * s1));
  };
  const onDown = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y }; };
  const onMove = (e) => { const d = drag.current; if (!d) return; setPos(clamp({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy })); };
  const onUp = () => { drag.current = null; };
  const onWheel = (e) => { changeZoom(Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))); };
  const done = () => onDone({ x: -pos.x / scale, y: -pos.y / scale, side: VIEW / scale });
  return (
    <Dialog open={!!file} onOpenChange={(v) => !v && !busy && onCancel()}>
      <DialogContent className="max-w-sm" data-testid="avatar-crop">
        <DialogHeader>
          <DialogTitle>顔写真の位置を合わせる</DialogTitle>
          <DialogDescription className="text-xs">写真をドラッグして動かし、下のつまみで大きさを変えます。丸の中がアイコンになります</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center">
          <div
            className="relative overflow-hidden rounded-lg bg-slate-900 touch-none select-none cursor-grab active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
            data-testid="avatar-crop-area"
          >
            {src && nat && <img src={src} alt="" draggable={false} className="absolute max-w-none pointer-events-none" style={{ left: pos.x, top: pos.y, width: dw, height: dh }} />}
            {/* 丸の外を暗く */}
            <div className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 999px rgba(15,23,42,0.55)" }} />
            <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/90" />
          </div>
        </div>
        <div className="flex items-center gap-2 px-2">
          <ZoomOut className="h-4 w-4 text-muted-foreground shrink-0" />
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} className="w-full accent-blue-600" aria-label="大きさ" data-testid="avatar-zoom" />
          <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>やめる</Button>
          <Button size="sm" className="gap-1.5" disabled={busy || !nat} onClick={done} data-testid="avatar-crop-save">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}この位置で保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 自分の顔写真（工程表・タスクの担当アイコンに出す） */
export default function AvatarCard({ user, onSaved }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null); // 位置合わせ中の写真
  const save = async (avatar) => {
    setBusy(true);
    try {
      await db.entities.User.update(user.id, { avatar_url: avatar });
      await onSaved?.();
      toast.success(avatar ? "顔写真を保存しました" : "顔写真を外しました");
      return true;
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
    setCropFile(file);
  };
  const saveCrop = async (crop) => {
    try { if (await save(await avatarDataUrl(cropFile, 200, crop))) setCropFile(null); } catch (err) { toast.error(err.message); }
  };
  const initial = (user?.short_name || user?.full_name || user?.email || "?").slice(0, 2);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">顔写真</CardTitle>
        <CardDescription className="text-xs">工程表・タスクの担当アイコンに出ます。写真を選ぶと、丸で出す位置と大きさを合わせられます。クライアント向けの工程表には「メンバー名を出す」にした工程だけ出ます</CardDescription>
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
        <AvatarCropDialog file={cropFile} busy={busy} onCancel={() => setCropFile(null)} onDone={saveCrop} />
      </CardContent>
    </Card>
  );
}
