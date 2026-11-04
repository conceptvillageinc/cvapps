import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Search, Check, Loader2, FolderKanban, FileText, Copy, ExternalLink, ChevronLeft } from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";
import { PROOF_TITLE, PROOF_DESCRIPTION, PROOF_QUESTIONS, proofConfirmMessage, QUESTION_TYPE_LABEL, newProofToken } from "@/lib/proofForms";
import { submissionOf, SUBMISSION_STATUS } from "@/lib/submission";

const STEPS = ["案件を選ぶ", "見積書を選ぶ", "項目を選ぶ", "内容を確かめる", "URL を共有"];
const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;
export const proofUrl = (token) => `${window.location.origin}/f/${token}`;

/** 見積の明細のうち、校了フォームに入れられる項目（見出し・小計・自動計算の行・提出しない行は除く） */
export const proofItemsOf = (estimate) => (estimate?.line_items || [])
  .map((li, i) => ({ ...li, _k: li.id || `row${i}` }))
  .filter((li) => li.row_type !== "text" && li.row_type !== "subtotal" && li.source_type !== "rule" && li.internal_only !== true && (li.name || "").trim());

/**
 * 新規校了フォーム: 案件を検索して選ぶ → 案件の見積書を選ぶ → 見積書の中で校了フォームに入れる項目を選ぶ
 *   → フォームの内容（ひな形の文）を確かめる → 作成して URL を共有
 */
export default function NewProofFormDialog({ open, onOpenChange }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState("");
  const [project, setProject] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [title, setTitle] = useState(PROOF_TITLE);
  const [description, setDescription] = useState(PROOF_DESCRIPTION);
  const [confirm, setConfirm] = useState(proofConfirmMessage(COMPANY_INFO.tel));
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: projects = [] } = useQuery({ queryKey: ["projects", "forProofForms"], enabled: open, queryFn: () => db.entities.Project.listAll("-registered_at"), staleTime: 60_000 });
  const { data: estimates = [], isLoading: estLoading } = useQuery({ queryKey: ["estimates", "byProject", project?.id], enabled: !!project?.id, queryFn: () => db.entities.Estimate.filter({ project_id: project.id }, "-created_date") });

  useEffect(() => {
    if (!open) return;
    setStep(0); setQ(""); setEstimate(null); setPicked(new Set()); setCreated(null);
    setTitle(PROOF_TITLE); setDescription(PROOF_DESCRIPTION); setConfirm(proofConfirmMessage(COMPANY_INFO.tel));
    setProject(null);
  }, [open]);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return projects
      .filter((p) => p.status !== "cancelled" && (!k || [p.project_number, p.client_name, p.name].filter(Boolean).join(" ").toLowerCase().includes(k)))
      .sort((a, b) => Number(b.status === "open") - Number(a.status === "open"))
      .slice(0, 40);
  }, [projects, q]);
  const items = proofItemsOf(estimate);
  const pickEstimate = (e) => { setEstimate(e); setPicked(new Set(proofItemsOf(e).map((li) => li._k))); setStep(2); };
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const create = async () => {
    setBusy(true);
    try {
      const row = await db.entities.ProofForm.create({
        token: newProofToken(),
        project_id: project.id, estimate_id: estimate.id,
        client_name: estimate.client_name || project.client_name || "", project_name: project.name || "", estimate_number: estimate.estimate_number || "",
        items: items.filter((li) => picked.has(li._k)).map((li) => ({ id: li.id || null, name: li.name, quantity: li.quantity ?? null, unit: li.unit || "" })),
        title: title.trim() || PROOF_TITLE, description, questions: PROOF_QUESTIONS, confirm_message: confirm, enabled: true,
      });
      qc.invalidateQueries({ queryKey: ["proofForms"] });
      setCreated(row); setStep(4);
    } catch (e) { toast.error("作れませんでした: " + (e?.message || "")); } finally { setBusy(false); }
  };
  const copy = () => { navigator.clipboard?.writeText(proofUrl(created.token)); toast.success("URL をコピーしました。クライアントさんに送ってください"); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl [&>*]:min-w-0" data-testid="new-proof-form">
        <DialogHeader>
          <DialogTitle>新規校了フォーム</DialogTitle>
          <DialogDescription>案件の見積書から、クライアントさんがログインなしで回答できる校了フォームを作ります</DialogDescription>
        </DialogHeader>
        {/* 手順 */}
        <ol className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="proof-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${i === step ? "bg-primary text-primary-foreground font-semibold" : i < step ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
              {i < step ? <Check className="w-3 h-3" /> : <span className="tabular-nums">{i + 1}</span>}{s}
            </li>
          ))}
        </ol>

        <div className="min-h-[18rem] max-h-[60vh] overflow-y-auto">
          {step === 0 && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件番号・クライアント名・案件名で探す" className="h-9 w-full rounded-lg border pl-8 pr-2 text-sm" data-testid="proof-project-search" />
              </div>
              <div className="rounded-lg border divide-y">
                {list.map((p) => (
                  <button key={p.id} type="button" onClick={() => { setProject(p); setEstimate(null); setStep(1); }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" data-testid="proof-project">
                    <FolderKanban className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">{p.project_number}</span>
                    <span className="min-w-0 flex-1 truncate">{p.client_name ? `${p.client_name}／` : ""}{p.name}</span>
                    {p.status !== "open" && <span className="text-[10px] text-slate-400">{p.status === "completed" ? "完了" : p.status === "lost" ? "失注" : ""}</span>}
                  </button>
                ))}
                {list.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">見つかりません</p>}
              </div>
            </div>
          )}

          {step === 1 && project && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{project.client_name}／{project.name} の見積書</p>
              {estLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto mt-6" /> : estimates.length === 0 ? (
                <p className="rounded-lg border px-3 py-6 text-center text-xs text-slate-400">この案件には見積書がありません</p>
              ) : (
                <div className="rounded-lg border divide-y">
                  {estimates.map((e) => {
                    const st = SUBMISSION_STATUS[submissionOf(e)];
                    return (
                      <button key={e.id} type="button" onClick={() => pickEstimate(e)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50" data-testid="proof-estimate">
                        <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">{e.estimate_number}</span>
                        <span className="min-w-0 flex-1 truncate">{e.estimate_title || e.print_type || "（件名なし）"}</span>
                        {st && <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">{st.label}</span>}
                        <span className="text-xs tabular-nums text-slate-600">{e.total_amount ? yen(e.total_amount) : ""}</span>
                        <span className="text-[10px] text-slate-400">{proofItemsOf(e).length} 項目</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 2 && estimate && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-500">{estimate.estimate_number} の中から、校了フォームの「校了の対象」に入れる項目を選んでください</p>
                <button type="button" className="ml-auto text-[11px] text-primary hover:underline" onClick={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map((li) => li._k)))}>{picked.size === items.length ? "すべて外す" : "すべて選ぶ"}</button>
              </div>
              <div className="rounded-lg border divide-y">
                {items.map((li) => (
                  <label key={li._k} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50" data-testid="proof-item">
                    <input type="checkbox" checked={picked.has(li._k)} onChange={() => toggle(li._k)} className="h-4 w-4 accent-primary" />
                    <span className="min-w-0 flex-1">{li.name}{li.category && <span className="ml-1.5 text-[10px] text-slate-400">{li.category}</span>}</span>
                    <span className="text-xs tabular-nums text-slate-500">{li.quantity ? `${Number(li.quantity).toLocaleString("ja-JP")}${li.unit || ""}` : ""}</span>
                  </label>
                ))}
                {items.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">この見積書には項目がありません</p>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <label className="block space-y-1"><span className="block text-xs text-slate-500">フォームタイトル</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-lg border px-3 text-sm font-semibold" data-testid="proof-title" /></label>
              <label className="block space-y-1"><span className="block text-xs text-slate-500">フォームの説明</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed" /></label>
              <div className="space-y-1">
                <p className="text-xs text-slate-500">校了の対象（{picked.size} 項目）</p>
                <ul className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 space-y-0.5">{items.filter((li) => picked.has(li._k)).map((li) => <li key={li._k}>・{li.name}</li>)}</ul>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-500">質問（ひな形）</p>
                <ol className="rounded-lg border divide-y text-xs">
                  {PROOF_QUESTIONS.map((qq, i) => (
                    <li key={qq.id} className="px-3 py-1.5">
                      <span className="text-slate-400 mr-1">質問{i + 1}</span><span className="font-medium text-slate-800">{qq.label}</span>{qq.required && <span className="ml-1 text-rose-600">（必須）</span>}
                      <span className="ml-2 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{QUESTION_TYPE_LABEL[qq.type]}</span>
                      {qq.options && <span className="block pl-10 text-[11px] text-slate-500">{qq.options.join("／")}</span>}
                    </li>
                  ))}
                </ol>
              </div>
              <label className="block space-y-1"><span className="block text-xs text-slate-500">送信後の確認メッセージ</span>
                <textarea value={confirm} onChange={(e) => setConfirm(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed" data-testid="proof-confirm" /></label>
            </div>
          )}

          {step === 4 && created && (
            <div className="space-y-3 pt-2" data-testid="proof-created">
              <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5"><Check className="w-4 h-4" />校了フォームを作りました</p>
              <p className="text-xs text-slate-500">この URL をクライアントさんに送ると、ログインなしで回答できます。回答があると、あなたの受信トレイにお知らせが届きます</p>
              <div className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="proof-url">{proofUrl(created.token)}</span>
                <Button size="sm" className="h-8 gap-1 text-xs" onClick={copy} data-testid="proof-copy"><Copy className="w-3.5 h-3.5" />コピー</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => window.open(proofUrl(created.token), "_blank", "noopener")}><ExternalLink className="w-3.5 h-3.5" />開く</Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {step > 0 && step < 4 ? <Button variant="ghost" className="gap-1" onClick={() => setStep(step - 1)}><ChevronLeft className="w-4 h-4" />戻る</Button> : <span />}
          <div className="flex gap-2">
            {step < 4 && <Button variant="outline" onClick={() => onOpenChange(false)}>やめる</Button>}
            {step === 2 && <Button onClick={() => setStep(3)} disabled={picked.size === 0} data-testid="proof-next">次へ</Button>}
            {step === 3 && <Button onClick={create} disabled={busy || !title.trim()} data-testid="proof-create">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}フォームを作成</Button>}
            {step === 4 && <Button onClick={() => onOpenChange(false)}>閉じる</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
