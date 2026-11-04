import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, CircleCheck, AlertCircle } from "lucide-react";
import { validateAnswers } from "@/lib/proofForms";
import { COMPANY_INFO } from "@/lib/constants";

/**
 * クライアント向けの校了フォーム（/f/:token。ログイン不要）
 *   中身はサーバー（/api/proof-form）が受付中のフォームの表示に要る項目だけを返す
 */
export default function ProofFormPublic() {
  const { token } = useParams();
  const [state, setState] = useState({ status: "loading" });
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const refs = useRef({});

  useEffect(() => {
    const m = document.createElement("meta"); m.name = "robots"; m.content = "noindex, nofollow"; document.head.appendChild(m);
    (async () => {
      try {
        const res = await fetch("/api/proof-form", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", token }) });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.form) { setState({ status: body.form.enabled ? "ready" : "closed", form: body.form }); document.title = body.form.title || "校了確認フォーム"; }
        else setState({ status: "notfound" });
      } catch { setState({ status: "error" }); }
    })();
    return () => m.remove();
  }, [token]);

  const form = state.form;
  const set = (id, v) => { setAnswers((a) => ({ ...a, [id]: v })); setErrors((e) => { const n = { ...e }; delete n[id]; return n; }); };
  const toggle = (id, opt) => { const cur = Array.isArray(answers[id]) ? answers[id] : []; set(id, cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]); };

  const submit = async (e) => {
    e.preventDefault();
    const check = validateAnswers(form.questions, answers);
    if (!check.ok) {
      setErrors(check.errors);
      const first = form.questions.find((q) => check.errors[q.id]);
      refs.current[first?.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/proof-form", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", token, answers: check.clean }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setState((s) => ({ ...s, status: "done", message: body.confirm_message })); window.scrollTo({ top: 0 }); return; }
      if (body.error === "invalid") { setErrors(body.errors || {}); return; }
      if (body.error === "closed") { setState((s) => ({ ...s, status: "closed" })); return; }
      setState((s) => ({ ...s, sendError: body.error === "too_many" ? "回答の受付数の上限に達しました。お手数ですがお電話でご連絡ください。" : "送信できませんでした。時間をおいてもう一度お試しください。" }));
    } catch {
      setState((s) => ({ ...s, sendError: "送信できませんでした。通信状況をご確認のうえ、もう一度お試しください。" }));
    } finally { setSending(false); }
  };

  if (state.status === "loading") return <Center><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></Center>;
  if (state.status === "notfound" || state.status === "error") {
    return <Center><p className="text-sm text-slate-600">{state.status === "notfound" ? "フォームが見つかりません。URL をご確認ください。" : "読み込めませんでした。時間をおいて開き直してください。"}</p></Center>;
  }

  return (
    <div className="min-h-screen bg-violet-50/60 py-8 px-4" data-testid="proof-public">
      <div className="mx-auto max-w-2xl space-y-3">
        <header className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="h-2.5 bg-violet-600" />
          <div className="p-6 space-y-3">
            <h1 className="text-2xl font-bold text-slate-900">{form.title}</h1>
            {state.status !== "done" && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{form.description}</p>}
            {(form.client_name || form.project_name) && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                {form.client_name && <p className="font-semibold text-slate-800">{form.client_name} 御中</p>}
                {form.project_name && <p className="text-slate-600">案件：{form.project_name}</p>}
              </div>
            )}
            {form.items.length > 0 && state.status !== "done" && (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">校了の対象</p>
                <ul className="space-y-0.5 text-sm text-slate-800">
                  {form.items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-violet-600">・</span><span className="flex-1">{it.name}</span>{it.quantity ? <span className="text-slate-500 tabular-nums">{Number(it.quantity).toLocaleString("ja-JP")}{it.unit}</span> : null}</li>)}
                </ul>
              </div>
            )}
            {state.status !== "done" && <p className="text-xs text-rose-600">* 必須の質問です</p>}
          </div>
        </header>

        {state.status === "done" ? (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 space-y-3" data-testid="proof-done">
            <p className="flex items-center gap-2 text-lg font-bold text-emerald-700"><CircleCheck className="w-6 h-6" />送信しました</p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{state.message}</p>
          </div>
        ) : state.status === "closed" ? (
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 text-sm text-slate-600">このフォームの受付は終了しました。ご不明な点は担当者までご連絡ください。</div>
        ) : (
          <form onSubmit={submit} className="space-y-3" noValidate>
            {form.questions.map((q) => (
              <section key={q.id} ref={(el) => { refs.current[q.id] = el; }} className={`rounded-xl bg-white p-6 shadow-sm ring-1 ${errors[q.id] ? "ring-rose-400" : "ring-slate-200"}`} data-testid="proof-question">
                <p className="text-base font-medium text-slate-900">{q.label}{q.required && <span className="ml-1 text-rose-600">*</span>}</p>
                {q.help && <p className="mt-1 text-xs text-slate-500">{q.help}</p>}
                <div className="mt-3">
                  {q.type === "text" && <input value={answers[q.id] || ""} onChange={(e) => set(q.id, e.target.value)} placeholder="回答を入力" className="w-full border-0 border-b border-slate-300 px-0 py-1.5 text-sm focus:border-violet-600 focus:outline-none focus:ring-0" />}
                  {q.type === "paragraph" && <textarea value={answers[q.id] || ""} onChange={(e) => set(q.id, e.target.value)} rows={4} placeholder="回答を入力" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-600 focus:outline-none" />}
                  {q.type === "checkbox" && (q.options || []).map((opt) => (
                    <label key={opt} className="flex items-start gap-3 py-1.5 text-sm text-slate-800 cursor-pointer">
                      <input type="checkbox" checked={(answers[q.id] || []).includes(opt)} onChange={() => toggle(q.id, opt)} className="mt-0.5 h-4 w-4 accent-violet-600" />{opt}
                    </label>
                  ))}
                  {q.type === "radio" && (q.options || []).map((opt) => (
                    <label key={opt} className="flex items-start gap-3 py-1.5 text-sm text-slate-800 cursor-pointer">
                      <input type="radio" name={q.id} checked={answers[q.id] === opt} onChange={() => set(q.id, opt)} className="mt-0.5 h-4 w-4 accent-violet-600" />{opt}
                    </label>
                  ))}
                </div>
                {errors[q.id] && <p className="mt-2 flex items-center gap-1 text-xs text-rose-600"><AlertCircle className="w-3.5 h-3.5" />{errors[q.id]}</p>}
              </section>
            ))}
            {state.sendError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.sendError}</p>}
            <div className="flex items-center justify-between">
              <button type="submit" disabled={sending} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60" data-testid="proof-submit">
                {sending && <Loader2 className="w-4 h-4 animate-spin" />}送信
              </button>
              <button type="button" onClick={() => { setAnswers({}); setErrors({}); }} className="text-sm text-violet-700 hover:underline">フォームをクリア</button>
            </div>
          </form>
        )}
        <p className="pt-4 text-center text-[11px] text-slate-400">{COMPANY_INFO.name}</p>
      </div>
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">{children}</div>;
}
