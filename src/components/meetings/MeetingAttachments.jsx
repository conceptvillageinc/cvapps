import { useEffect, useRef, useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Paperclip, ImagePlus, FileText, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

// ============================================================================
// 議事録の「参考資料」: スクリーンショットや資料ファイルを添付する。
//   画像はサムネイル、それ以外はファイル名で並ぶ。クリックで開く。各ファイルにひとことメモを付けられる。
//   追加のしかた: 「ファイルを選ぶ」／ この枠へドラッグ＆ドロップ ／ 枠をクリックしてから Ctrl+V（⌘+V）でスクショを貼り付け。
//   保存先は Storage の uploads/meetings/<議事録ID>/attachments/、一覧は meetings.summary.attachments。
// ============================================================================

const MAX_MB = 20;
const isImage = (a) => /^image\//.test(a.type || "") || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.path || "");
const sizeLabel = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

function useSignedUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    db.storage.signedUrl(path).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [path]);
  return url;
}

function Tile({ a, onCaption, onRemove, readOnly }) {
  const url = useSignedUrl(a.path);
  const img = isImage(a);
  return (
    <div className="w-[168px] rounded-md border bg-background overflow-hidden flex flex-col" data-testid="meeting-attachment">
      <a href={url || "#"} target="_blank" rel="noreferrer" className="block h-[110px] bg-muted/30 hover:opacity-90" title={`${a.name} を開く`}>
        {img && url ? (
          <img src={url} alt={a.caption || a.name} className="w-full h-full object-contain bg-white" />
        ) : (
          <span className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground text-[10px] px-2 text-center">
            {img ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-6 h-6" />}
            {!img && <span className="line-clamp-2 break-all">{a.name}</span>}
          </span>
        )}
      </a>
      <div className="p-1.5 space-y-1">
        {readOnly ? (
          a.caption ? <p className="text-[11px] leading-snug">{a.caption}</p> : null
        ) : (
          <Input value={a.caption || ""} onChange={(e) => onCaption(e.target.value)} placeholder="メモ（任意）" className="h-7 text-[11px] px-1.5" aria-label={`${a.name} のメモ`} />
        )}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="truncate flex-1" title={a.name}>{a.name}</span>
          {a.size ? <span className="shrink-0">{sizeLabel(a.size)}</span> : null}
          {url && <a href={url} target="_blank" rel="noreferrer" className="shrink-0 hover:text-primary" aria-label="開く"><ExternalLink className="w-3 h-3" /></a>}
          {!readOnly && <button type="button" onClick={onRemove} className="shrink-0 hover:text-destructive" aria-label={`${a.name} を削除`} title="削除"><Trash2 className="w-3 h-3" /></button>}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} p.meetingId
 * @param {object[]} p.value             summary.attachments
 * @param {(next:object[], opts?:{ save?: boolean, removed?: string[] })=>void} p.onChange
 *        ファイルの追加・削除はすぐ保存（save: true）。メモの書き換えは他の項目と同じく「保存」で
 * @param {string} [p.userName]
 */
export default function MeetingAttachments({ meetingId, value, onChange, userName = "", readOnly = false }) {
  const list = Array.isArray(value) ? value : [];
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);

  const addFiles = async (files) => {
    const picked = Array.from(files || []).filter(Boolean);
    if (picked.length === 0) return;
    const tooBig = picked.filter((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig.length) toast.error(`${MAX_MB}MB を超えるファイルは添付できません（${tooBig.map((f) => f.name).join("、")}）`);
    const ok = picked.filter((f) => f.size <= MAX_MB * 1024 * 1024);
    if (ok.length === 0) return;
    setUploading((n) => n + ok.length);
    const added = [];
    for (const f of ok) {
      try {
        const now = new Date();
        const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
        const ext = (f.name.match(/\.[a-zA-Z0-9]+$/) || [f.type === "image/png" ? ".png" : f.type === "image/jpeg" ? ".jpg" : ".bin"])[0].toLowerCase();
        const p2 = (n) => String(n).padStart(2, "0");
        const local = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
        const name = f.name && f.name !== "image.png" ? f.name : `スクリーンショット_${local}${ext}`;
        const path = `meetings/${meetingId}/attachments/${stamp}-${crypto.randomUUID().slice(0, 8)}${ext}`;
        await db.integrations.Core.UploadFile({ file: f, path });
        added.push({ id: crypto.randomUUID(), path, name, type: f.type || "", size: f.size, caption: "", uploaded_at: now.toISOString(), uploaded_by: userName });
      } catch (e) {
        toast.error(`${f.name || "ファイル"} を添付できませんでした: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (added.length) { onChange([...list, ...added], { save: true }); toast.success(`${added.length} 件を参考資料に添付しました`); }
  };

  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const remove = (a) => {
    if (!window.confirm(`「${a.caption || a.name}」を参考資料から削除しますか？`)) return;
    onChange(list.filter((x) => x.id !== a.id), { save: true, removed: [a.path] });
  };

  if (readOnly) {
    return list.length === 0 ? null : <div className="flex flex-wrap gap-2">{list.map((a) => <Tile key={a.id || a.path} a={a} readOnly />)}</div>;
  }

  return (
    <div
      tabIndex={0}
      onPaste={onPaste}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer?.files); }}
      className={`rounded-md border border-dashed p-2 outline-none focus:ring-2 focus:ring-primary/30 ${over ? "border-primary bg-primary/5" : "border-muted-foreground/30"}`}
      data-testid="meeting-attachments"
      aria-label="参考資料（ここをクリックしてから Ctrl+V でスクリーンショットを貼り付け）"
    >
      {list.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {list.map((a) => (
            <Tile key={a.id || a.path} a={a} onCaption={(v) => onChange(list.map((x) => (x.id === a.id ? { ...x, caption: v } : x)))} onRemove={() => remove(a)} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" multiple accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt,.txt,.zip" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => inputRef.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {uploading > 0 ? `添付中…（${uploading}）` : "ファイルを選ぶ"}
        </Button>
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Paperclip className="w-3 h-3" /> ここへドラッグ＆ドロップ、または枠をクリックしてから Ctrl+V（⌘+V）でスクリーンショットを貼り付け。1 ファイル {MAX_MB}MB まで</span>
      </div>
    </div>
  );
}
