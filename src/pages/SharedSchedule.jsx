import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Lock, CalendarRange, CircleCheck } from "lucide-react";
import ScheduleTimeline, { PartyChips, PartyAvatars } from "@/components/schedule/ScheduleTimeline";
import { expandCompanyHolidays } from "@/lib/jpHolidays";
import { toYmd, taskRange, jpDate, md, addDays, diffDays } from "@/lib/schedule";

/**
 * クライアント向けの工程表（/s/:token。ログイン不要・見るだけ）。
 * 中身はサーバー（/api/schedule-share）が「工程表に出す」工程だけを返す。
 */
export default function SharedSchedule() {
  const { token } = useParams();
  const [state, setState] = useState({ status: "loading" });
  const [password, setPassword] = useState("");
  const narrow = typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 768px)").matches;
  const [scale, setScale] = useState(narrow ? "week" : "day");
  const [view, setView] = useState("timeline");

  const load = async (pw) => {
    setState((s) => ({ ...s, status: s.status === "ready" ? "ready" : "loading", error: null }));
    try {
      const res = await fetch("/api/schedule-share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", token, password: pw || undefined }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setState({ status: "ready", data: body }); document.title = body.title || "工程表"; return; }
      if (body.error === "needs_password") setState({ status: "password" });
      else if (body.error === "wrong_password") setState({ status: "password", error: "パスワードが違います" });
      else if (body.error === "expired") setState({ status: "expired" });
      else setState({ status: "notfound" });
    } catch {
      setState({ status: "error" });
    }
  };
  useEffect(() => {
    const m = document.createElement("meta"); m.name = "robots"; m.content = "noindex, nofollow"; document.head.appendChild(m);
    load();
    return () => m.remove();
  }, [token]);

  const d = state.data;
  const holidays = useMemo(() => expandCompanyHolidays(d?.company_holiday_lines || []), [d]);
  const today = toYmd(new Date());
  const memberName = (x) => x;

  if (state.status === "loading") return <Center><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></Center>;
  if (state.status === "password") {
    return (
      <Center>
        <form className="w-full max-w-xs space-y-3 rounded-lg border bg-white p-6 shadow-sm" onSubmit={(e) => { e.preventDefault(); load(password); }}>
          <p className="flex items-center gap-2 font-semibold"><Lock className="w-4 h-4" /> 工程表のパスワード</p>
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" placeholder="パスワード" />
          {state.error && <p className="text-xs text-red-600">{state.error}</p>}
          <button className="w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!password}>開く</button>
        </form>
      </Center>
    );
  }
  if (state.status !== "ready") {
    const msg = { expired: "この工程表の公開期限が過ぎています。", notfound: "工程表が見つかりません。URL をご確認ください。", error: "読み込めませんでした。時間をおいて開き直してください。" }[state.status];
    return <Center><p className="text-sm text-slate-600">{msg}</p></Center>;
  }

  const tasks = d.tasks || [];
  const done = tasks.filter((t) => t.completed).length;
  // クライアント様にお願いしたいこと（これから 2 週間・未完了・クライアントの担当）
  const soon = addDays(today, 14);
  const clientTodo = tasks.filter((t) => !t.completed && (t.parties || []).includes("client") && taskRange(t) && taskRange(t).start <= soon && taskRange(t).end >= today).sort((a, b) => taskRange(a).start.localeCompare(taskRange(b).start));
  const nextKey = (d.key_dates || []).filter((k) => k.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const seg = (active) => `px-3 py-1 text-xs rounded-md transition-colors ${active ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-500 hover:text-slate-800"}`;
  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <div className="mx-auto max-w-[1400px] px-4 py-6 space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400"><CalendarRange className="h-3.5 w-3.5" />SCHEDULE</p>
              <h1 className="text-xl font-bold leading-snug">{d.title}</h1>
              <div className="flex flex-wrap gap-2">
                {(d.key_dates || []).map((k) => <span key={k.date + k.label} className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-200"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{k.label}　{jpDate(k.date)}</span>)}
              </div>
            </div>
            <div className="flex gap-6">
              <div>
                <p className="text-[11px] text-slate-400">進み具合</p>
                <p className="text-lg font-bold">{tasks.length ? Math.round((done / tasks.length) * 100) : 0}<span className="text-xs font-normal text-slate-400">%</span></p>
                <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div>
              </div>
              {nextKey && (
                <div>
                  <p className="text-[11px] text-slate-400">{nextKey.label}まで</p>
                  <p className="text-lg font-bold">あと {diffDays(today, nextKey.date)}<span className="text-xs font-normal text-slate-400"> 日</span></p>
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            {(d.parties || []).map((p) => <span key={p.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.label}</span>)}
            {d.updated_at && <span className="ml-auto">最終更新 {jpDate(String(d.updated_at).slice(0, 10))}</span>}
          </div>
        </header>

        {clientTodo.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-bold">{d.client_name ? `${d.client_name}様` : "ご担当者様"}にお願いしたいこと（2週間以内）</p>
            <ul className="divide-y divide-slate-100">
              {clientTodo.map((t) => {
                const r = taskRange(t);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
                    <PartyAvatars task={t} parties={d.parties} memberName={memberName} />
                    <span className="min-w-0 flex-1 break-words">{t.category ? <span className="text-slate-400">{t.category}／</span> : null}{t.name}</span>
                    <span className="w-full pl-8 text-xs text-slate-500 sm:w-auto sm:pl-0 sm:shrink-0">{r.start === r.end ? jpDate(r.start) : `${md(r.start)} – ${jpDate(r.end)}`}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="flex gap-2">
          <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
            {[["timeline", "タイムライン"], ["list", "一覧"]].map(([v, l]) => <button key={v} onClick={() => setView(v)} className={seg(view === v)}>{l}</button>)}
          </div>
          {view === "timeline" && (
            <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
              {[["day", "日"], ["week", "週"], ["dekad", "上中下"]].map(([v, l]) => <button key={v} onClick={() => setScale(v)} className={seg(scale === v)}>{l}</button>)}
            </div>
          )}
        </div>
        {tasks.length === 0 ? <p className="text-sm text-slate-500 py-10 text-center">まだ工程がありません。</p> : view === "timeline" ? (
          <ScheduleTimeline tasks={tasks} parties={d.parties} keyDates={d.key_dates} holidays={holidays} scale={scale} columns={narrow ? "mini" : "full"} memberName={memberName} today={today} fitHeight />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-xs min-w-[640px]">
              <thead><tr className="border-b border-slate-200 text-[11px] text-slate-500"><th className="px-3 py-2 text-left font-normal">タスク名</th><th className="px-2 py-2 font-normal">工程</th><th className="px-2 py-2 text-left font-normal">担当</th><th className="px-2 py-2 font-normal">期間</th><th className="px-2 py-2 font-normal">状況</th></tr></thead>
              <tbody>
                {tasks.map((t, i) => {
                  const r = taskRange(t);
                  const first = i === 0 || (tasks[i - 1].category || "") !== (t.category || "");
                  return [
                    first && <tr key={`s${t.id}`}><td colSpan={5} className="border-b border-slate-200 px-3 pt-4 pb-1.5 text-[13px] font-bold">{t.category || "（カテゴリーなし）"}</td></tr>,
                    <tr key={t.id} className="border-b border-slate-100">
                      <td className="px-3 py-2"><span className="flex items-center gap-2">{t.is_milestone ? <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-fuchsia-500" /> : <CircleCheck className={`h-4 w-4 ${t.completed ? "text-emerald-500" : "text-slate-300"}`} />}<span className={t.completed ? "text-slate-400 line-through" : ""}>{t.name}</span></span></td>
                      <td className="px-2 py-2 text-center text-slate-500">{t.phase}</td>
                      <td className="px-2 py-2"><PartyChips task={t} parties={d.parties} memberName={memberName} /></td>
                      <td className="px-2 py-2 text-center whitespace-nowrap text-slate-600">{r ? (r.start === r.end ? md(r.start) : `${md(r.start)} – ${md(r.end)}`) : ""}</td>
                      <td className="px-2 py-2 text-center">{t.completed ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">完了</span> : r && r.start <= today && r.end >= today ? <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">進行中</span> : ""}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="pt-2 text-right text-[11px] tracking-wide text-slate-400">concept-village inc.</p>
      </div>
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">{children}</div>;
}
