import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight, MousePointerClick, X } from "lucide-react";
import { PinBadge, TaskCheck, UserAvatar } from "@/components/tasks/parts";

/** PDF の 1 ページを画像（data URL）にする。pdf.js は使うときだけ読み込む */
async function renderPdfPage(url, pageNo, width = 1400) {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument(url).promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return { src: canvas.toDataURL("image/png"), pages: doc.numPages };
}

const isPdf = (a) => /pdf/i.test(a?.mime_type || "") || /\.pdf$/i.test(a?.file_name || a?.path || "");

/** 添付の見た目（画像はそのまま、PDF はページを画像にする） */
export function useAttachmentImage(attachment, page = 1) {
  return useQuery({
    queryKey: ["taskAttachmentImage", attachment?.id, page],
    enabled: !!attachment?.path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const url = attachment.path.startsWith("data:") || attachment.path.startsWith("http") ? attachment.path : await db.storage.signedUrl(attachment.path);
      if (isPdf(attachment)) return renderPdfPage(url, page);
      return { src: url, pages: 1 };
    },
  });
}

/**
 * 校正の画面: 添付（画像・PDF のページ）の直してほしい場所をクリックしてコメントする。
 *   ピンは番号付きで、そのタスクの担当者のサブタスクになる（完了でピンが緑になる）。
 *   attachments: このタスクの添付（新しい版を上に）。subtasks: このタスクのサブタスク（ピン付きのものを出す）
 */
export default function ProofViewer({ open, onOpenChange, attachments, initialId, subtasks, byId, onAddPin, onToggle }) {
  const [attId, setAttId] = useState(initialId);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(null); // { x, y } 0〜1
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const imgRef = useRef(null);
  useEffect(() => { if (open) { setAttId(initialId || attachments?.[0]?.id); setPage(1); setDraft(null); } }, [open, initialId]); // eslint-disable-line react-hooks/exhaustive-deps
  const att = (attachments || []).find((a) => a.id === attId) || attachments?.[0];
  const { data: img, isLoading } = useAttachmentImage(att, page);
  const pins = (subtasks || []).filter((s) => s.pin && s.pin.attachment_id === att?.id && (Number(s.pin.page) || 1) === page);
  const allPins = (subtasks || []).filter((s) => s.pin && s.pin.attachment_id === att?.id);
  const pages = img?.pages || att?.page_count || 1;

  const clickImage = (e) => {
    const r = imgRef.current.getBoundingClientRect();
    setDraft({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    setText("");
  };
  const save = async () => {
    if (!text.trim() || !draft) return;
    setSaving(true);
    try { await onAddPin({ attachment: att, page, x: draft.x, y: draft.y, text: text.trim() }); setDraft(null); setText(""); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,1500px)] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden" data-testid="proof-viewer">
        <div className="flex items-center gap-3 border-b px-4 py-2.5">
          <DialogTitle className="text-sm">校正（直してほしい場所をクリックしてコメント）</DialogTitle>
          <select value={att?.id || ""} onChange={(e) => { setAttId(e.target.value); setPage(1); setDraft(null); }} className="h-8 rounded border px-2 text-xs max-w-[22rem]">
            {(attachments || []).map((a, i) => <option key={a.id} value={a.id}>{`${attachments.length - i}版　${a.file_name || "添付"}`}</option>)}
          </select>
          {pages > 1 && (
            <div className="flex items-center gap-1 text-xs">
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => { setPage(page - 1); setDraft(null); }}><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <span className="tabular-nums">{page} / {pages} ページ</span>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pages} onClick={() => { setPage(page + 1); setDraft(null); }}><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1"><MousePointerClick className="w-3.5 h-3.5" />ピンのコメントは、担当者のサブタスクになります</span>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-auto bg-slate-600 p-6 flex justify-center items-start">
            {isLoading || !img ? <Loader2 className="w-6 h-6 animate-spin text-white mt-20" /> : (
              <div className="relative inline-block shadow-xl">
                <img ref={imgRef} src={img.src} alt={att?.file_name || ""} onClick={clickImage} className="block max-w-full max-h-[78vh] cursor-crosshair select-none" draggable={false} data-testid="proof-image" />
                {pins.map((s) => (
                  <span key={s.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${s.pin.x * 100}%`, top: `${s.pin.y * 100}%` }} title={s.name}>
                    <PinBadge no={s.pin.no} done={s.completed} size={22} />
                  </span>
                ))}
                {draft && (
                  <div className="absolute z-10" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>
                    <span className="absolute -translate-x-1/2 -translate-y-1/2"><PinBadge no="＋" size={22} /></span>
                    <div className="absolute left-4 top-3 w-72 rounded-lg border bg-white p-2 shadow-lg space-y-1.5" onClick={(e) => e.stopPropagation()}>
                      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); if (e.key === "Escape") setDraft(null); }}
                        placeholder="直してほしいこと（例: 「:」を少し上げる）" rows={3} className="w-full rounded border px-2 py-1 text-xs" data-testid="pin-text" />
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDraft(null)}><X className="w-3 h-3" /></Button>
                        <Button size="sm" className="h-7 text-xs" disabled={!text.trim() || saving} onClick={save} data-testid="pin-save">{saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}コメントする</Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <aside className="w-80 shrink-0 border-l overflow-y-auto">
            <p className="px-3 pt-3 pb-1 text-xs font-semibold">この版の指摘（{allPins.length}）</p>
            {allPins.length === 0 && <p className="px-3 py-4 text-[11px] text-muted-foreground">画像の上をクリックすると、その場所にピンを打ってコメントできます</p>}
            <ul className="divide-y">
              {allPins.sort((a, b) => a.pin.no - b.pin.no).map((s) => (
                <li key={s.id} className={`flex items-start gap-2 px-3 py-2 ${(Number(s.pin.page) || 1) === page ? "" : "opacity-60"}`} data-testid="proof-pin-item">
                  <TaskCheck done={s.completed} onToggle={(v) => onToggle(s, v)} size={16} />
                  <PinBadge no={s.pin.no} done={s.completed} />
                  <button type="button" className={`flex-1 text-left text-xs ${s.completed ? "line-through text-muted-foreground" : ""}`} onClick={() => setPage(Number(s.pin.page) || 1)}>
                    {s.name}{pages > 1 && <span className="ml-1 text-[10px] text-muted-foreground">（{Number(s.pin.page) || 1}ページ）</span>}
                  </button>
                  <UserAvatar user={byId.users.get(s.assignee_id)} size={18} />
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
