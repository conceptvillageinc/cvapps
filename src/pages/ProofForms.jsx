import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileCheck2, Plus, Copy, ExternalLink, Trash2, Loader2, Search, MessageSquareText } from "lucide-react";
import NewProofFormDialog, { proofUrl } from "@/components/proofForms/NewProofFormDialog";
import { RESULT_LABEL } from "@/lib/proofForms";
import { useInbox, unreadProofNotices, INBOX_KEY } from "@/lib/useInbox";

const fmtDate = (s) => { if (!s) return ""; const d = new Date(s); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const fmtAt = (s) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const RESULT_CLS = { approved: "bg-emerald-50 text-emerald-700 border-emerald-200", revise: "bg-amber-50 text-amber-800 border-amber-200" };

function ResultBadge({ result }) {
  if (!result) return <span className="text-[11px] text-slate-400">—</span>;
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${RESULT_CLS[result]}`}>{RESULT_LABEL[result]}</span>;
}

/** 校了フォーム登録（管理）: 作ったフォームの一覧・URL の共有・受付の停止・回答の確認 */
export default function ProofForms() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: forms = [], isLoading } = useQuery({ queryKey: ["proofForms"], queryFn: () => db.entities.ProofForm.listAll("-created_at") });
  const { data: responses = [] } = useQuery({ queryKey: ["proofForms", "responses"], queryFn: () => db.entities.ProofFormResponse.listAll("-submitted_at") });
  const byForm = useMemo(() => {
    const m = new Map();
    for (const r of responses) { if (!m.has(r.form_id)) m.set(r.form_id, []); m.get(r.form_id).push(r); }
    for (const list of m.values()) list.sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
    return m;
  }, [responses]);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return forms.filter((f) => !k || [f.client_name, f.project_name, f.estimate_number, f.title].filter(Boolean).join(" ").toLowerCase().includes(k));
  }, [forms, q]);
  const openId = params.get("form");
  const openForm = forms.find((f) => f.id === openId) || null;
  const { all: notices } = useInbox();
  // 回答を開いたら、そのフォームの回答のお知らせを既読にする（受信トレイとサイドバーの件数が減る）
  useEffect(() => {
    if (!openForm) return;
    const unread = unreadProofNotices(notices, openForm.id);
    if (!unread.length) return;
    const at = new Date().toISOString();
    Promise.all(unread.map((n) => db.entities.Notification.update(n.id, { read_at: at }))).then(() => qc.invalidateQueries({ queryKey: INBOX_KEY }), () => null);
  }, [openForm, notices, qc]);
  const setOpen = (id) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("form", id); else n.delete("form"); return n; }, { replace: true });

  const copy = (f) => { navigator.clipboard?.writeText(proofUrl(f.token)); toast.success("URL をコピーしました"); };
  const toggleEnabled = async (f, enabled) => {
    await db.entities.ProofForm.update(f.id, { enabled });
    qc.invalidateQueries({ queryKey: ["proofForms"] });
    toast.success(enabled ? "受付を再開しました" : "受付を止めました（URL を開いても回答できません）");
  };
  const remove = async (f) => {
    if (!window.confirm(`「${f.project_name || f.title}」の校了フォームを削除しますか？\n届いた回答も消え、URL は開けなくなります。`)) return;
    await db.entities.ProofForm.delete(f.id);
    qc.invalidateQueries({ queryKey: ["proofForms"] });
    toast.success("削除しました");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2"><FileCheck2 className="w-5 h-5" />校了フォーム登録</h1>
        <p className="text-xs text-muted-foreground">クライアントさんがログインなしで最終デザインを確認・回答できるフォームを作り、URL を共有します</p>
        <Button className="ml-auto gap-1" onClick={() => setNewOpen(true)} data-testid="proof-new"><Plus className="w-4 h-4" />新規校了フォーム</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="クライアント名・案件名・見積番号で探す" className="h-9 w-full rounded-lg border bg-white pl-8 pr-2 text-sm" />
      </div>

      <div className="rounded-xl border bg-white overflow-x-auto" data-testid="proof-list">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">作成日</th>
              <th className="px-3 py-2 text-left font-medium">クライアント／案件</th>
              <th className="px-3 py-2 text-left font-medium">見積</th>
              <th className="px-3 py-2 text-right font-medium">項目</th>
              <th className="px-3 py-2 text-left font-medium">回答</th>
              <th className="px-3 py-2 text-left font-medium">受付</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && <tr><td colSpan={7}><Loader2 className="w-5 h-5 animate-spin m-6 text-muted-foreground" /></td></tr>}
            {!isLoading && shown.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center">
                <p className="text-sm text-muted-foreground">{forms.length ? "見つかりません" : "校了フォームはまだありません"}</p>
                {!forms.length && <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" />新規校了フォーム</Button>}
              </td></tr>
            )}
            {shown.map((f) => {
              const rs = byForm.get(f.id) || [];
              return (
                <tr key={f.id} className="hover:bg-slate-50/60" data-testid="proof-row">
                  <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmtDate(f.created_at)}</td>
                  <td className="px-3 py-2.5 min-w-[14rem]">
                    <p className="text-[11px] text-slate-500">{f.client_name}</p>
                    {f.project_id ? <Link to={`/projects/${f.project_id}`} className="font-medium hover:underline">{f.project_name || "（案件）"}</Link> : <span className="font-medium">{f.project_name}</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">{f.estimate_id ? <Link to={`/estimates/${f.estimate_id}`} className="hover:underline">{f.estimate_number}</Link> : f.estimate_number}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{(f.items || []).length}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <button type="button" onClick={() => setOpen(f.id)} className="inline-flex items-center gap-1.5 hover:underline" data-testid="proof-answers-open">
                      {unreadProofNotices(notices, f.id).length > 0 && <span className="h-2 w-2 rounded-full bg-red-500" title="まだ見ていない回答があります" data-testid="proof-row-new" />}
                      <ResultBadge result={rs[0]?.result} />
                      <span className="text-[11px] text-slate-500">{rs.length ? `${rs.length} 件` : "未回答"}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5"><Switch checked={!!f.enabled} onCheckedChange={(v) => toggleEnabled(f, v)} aria-label="受付" /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => copy(f)} data-testid="proof-row-copy"><Copy className="w-3.5 h-3.5" />URL</Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-1" title="フォームを開く" onClick={() => window.open(proofUrl(f.token), "_blank", "noopener")}><ExternalLink className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600" title="削除" onClick={() => remove(f)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <NewProofFormDialog open={newOpen} onOpenChange={setNewOpen} />
      <AnswersDialog form={openForm} responses={openForm ? byForm.get(openForm.id) || [] : []} onClose={() => setOpen(null)} />
    </div>
  );
}

/** 届いた回答（新しい順） */
function AnswersDialog({ form, responses, onClose }) {
  const questions = form?.questions || [];
  return (
    <Dialog open={!!form} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl [&>*]:min-w-0" data-testid="proof-answers">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageSquareText className="w-5 h-5" />校了フォームの回答</DialogTitle>
          <DialogDescription>{form?.client_name}／{form?.project_name}（{form?.estimate_number}）</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto space-y-3">
          {responses.length === 0 && <p className="rounded-lg border px-3 py-8 text-center text-sm text-muted-foreground">まだ回答はありません。URL をクライアントさんに送ってください</p>}
          {responses.map((r, i) => (
            <div key={r.id} className={`rounded-xl border p-4 space-y-2 ${i === 0 ? "" : "opacity-80"}`} data-testid="proof-answer">
              <div className="flex items-center gap-2">
                <ResultBadge result={r.result} />
                <span className="text-sm font-semibold">{[r.company_name, r.person_name].filter(Boolean).join(" ") || "（名前なし）"}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{fmtAt(r.submitted_at)}{i === 0 && responses.length > 1 ? "（最新）" : ""}</span>
              </div>
              <dl className="grid grid-cols-[11rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                {questions.filter((q) => q.id !== "company" && q.id !== "person").map((q) => {
                  const v = r.answers?.[q.id];
                  const text = Array.isArray(v) ? v.join("／") : v;
                  const fix = Array.isArray(v) && v.includes("修正あり");
                  return (
                    <div key={q.id} className="contents">
                      <dt className="text-slate-500">{q.label}</dt>
                      <dd className={`whitespace-pre-line ${fix ? "font-semibold text-amber-700" : "text-slate-800"}`}>{text || <span className="text-slate-300">—</span>}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
