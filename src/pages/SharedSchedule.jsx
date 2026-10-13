import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Lock, CalendarRange } from "lucide-react";
import ScheduleTimeline, { PartyChips } from "@/components/schedule/ScheduleTimeline";
import { expandCompanyHolidays } from "@/lib/jpHolidays";
import { toYmd, taskRange, jpDate, md, categoryTints } from "@/lib/schedule";

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
  const tints = categoryTints(tasks);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[1400px] px-4 py-5 space-y-3">
        <header className="space-y-1.5">
          <h1 className="text-lg font-bold flex items-center gap-2"><CalendarRange className="w-5 h-5 text-slate-500" />{d.title}</h1>
          <div className="flex flex-wrap gap-2">
            {(d.key_dates || []).map((k) => <span key={k.date + k.label} className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{k.label}　{jpDate(k.date)}</span>)}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-2">担当:{(d.parties || []).map((p) => <span key={p.key} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</span>)}</span>
            {d.updated_at && <span>更新: {jpDate(String(d.updated_at).slice(0, 10))}</span>}
          </div>
        </header>
        <div className="flex gap-2">
          <div className="inline-flex rounded-md border bg-white p-0.5">
            {[["timeline", "タイムライン"], ["list", "一覧"]].map(([v, l]) => <button key={v} onClick={() => setView(v)} className={`px-3 py-1 text-xs rounded ${view === v ? "bg-slate-800 text-white" : ""}`}>{l}</button>)}
          </div>
          {view === "timeline" && (
            <div className="inline-flex rounded-md border bg-white p-0.5">
              {[["day", "日"], ["week", "週"]].map(([v, l]) => <button key={v} onClick={() => setScale(v)} className={`px-3 py-1 text-xs rounded ${scale === v ? "bg-slate-800 text-white" : ""}`}>{l}</button>)}
            </div>
          )}
        </div>
        {tasks.length === 0 ? <p className="text-sm text-slate-500 py-10 text-center">まだ工程がありません。</p> : view === "timeline" ? (
          <ScheduleTimeline tasks={tasks} parties={d.parties} keyDates={d.key_dates} holidays={holidays} scale={scale} columns={narrow ? "mini" : "full"} memberName={memberName} today={today} />
        ) : (
          <div className="overflow-x-auto rounded-md border bg-white">
            <table className="w-full text-xs min-w-[640px]">
              <thead><tr className="bg-[#1e3a5f] text-white"><th className="px-2 py-1.5 text-left">カテゴリー</th><th className="px-2 py-1.5 text-left">タスク名</th><th className="px-2 py-1.5">工程</th><th className="px-2 py-1.5">担当</th><th className="px-2 py-1.5">期間</th><th className="px-2 py-1.5">状況</th></tr></thead>
              <tbody>
                {tasks.map((t, i) => {
                  const r = taskRange(t);
                  const first = i === 0 || (tasks[i - 1].category || "") !== (t.category || "");
                  return (
                    <tr key={t.id} className="border-t" style={{ background: tints.get(t.category || "") }}>
                      <td className="px-2 py-1.5 font-semibold">{first ? t.category : ""}</td>
                      <td className="px-2 py-1.5">{t.is_milestone ? "◆ " : ""}{t.name}</td>
                      <td className="px-2 py-1.5 text-center">{t.phase}</td>
                      <td className="px-2 py-1.5"><PartyChips task={t} parties={d.parties} memberName={memberName} /></td>
                      <td className="px-2 py-1.5 text-center whitespace-nowrap">{r ? (r.start === r.end ? md(r.start) : `${md(r.start)}〜${md(r.end)}`) : ""}</td>
                      <td className="px-2 py-1.5 text-center">{t.completed ? <span className="text-emerald-700 font-semibold">完了</span> : r && r.end < today ? <span className="text-slate-500">予定日を過ぎています</span> : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-slate-400 text-right">株式会社コンセプト・ヴィレッジ</p>
      </div>
    </div>
  );
}

function Center({ children }) {
  return <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">{children}</div>;
}
