import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mic, Plus, Search, Loader2, Smartphone } from "lucide-react";
import { MEETING_STATUS, PROCESSING, useMeetingSettings, fmtClock } from "@/lib/meetings";

/** 議事録一覧 */
export default function MeetingList() {
  const navigate = useNavigate();
  const { typeLabel } = useMeetingSettings();
  const [search, setSearch] = useState("");
  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => db.entities.Meeting.list("-held_at", 300),
    refetchInterval: (q) => ((q.state.data || []).some((m) => PROCESSING.has(m.status)) ? 8000 : false),
  });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...meetings]
      .sort((a, b) => String(b.held_at || "").localeCompare(String(a.held_at || "")) || String(b.created_date || "").localeCompare(String(a.created_date || "")))
      .filter((m) => {
        if (!q) return true;
        const text = [m.title, m.client_name, typeLabel(m.meeting_type), m.summary?.overview, ...(m.transcript || []).map((t) => t.text)].filter(Boolean).join(" ").toLowerCase();
        return text.includes(q);
      });
  }, [meetings, search, typeLabel]);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Mic className="w-6 h-6" /> 議事録</h1>
          <p className="text-sm text-muted-foreground mt-0.5">打ち合わせを録音すると、文字起こしと議事録（決定事項・ToDo・確認漏れ）を自動で作ります</p>
        </div>
        <Button onClick={() => navigate("/meetings/new")} className="gap-1.5 shrink-0"><Plus className="w-4 h-4" /> 新しい議事録</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="件名・クライアント・本文で検索" className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : list.length === 0 ? (
            <div className="text-center py-16">
              <Smartphone className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{search ? "該当する議事録がありません" : "まだ議事録がありません"}</p>
              {!search && <p className="text-xs text-muted-foreground mt-1">スマホでこの画面を開き、「新しい議事録」から録音できます</p>}
            </div>
          ) : (
            <div className="divide-y">
              {list.map((m) => {
                const st = MEETING_STATUS[m.status] || MEETING_STATUS.draft;
                const todos = (m.summary?.todos || []);
                const openTodos = todos.filter((t) => !t.done).length;
                const unconfirmed = (m.checkpoints || []).filter((c) => c.status === "unconfirmed").length;
                return (
                  <Link key={m.id} to={`/meetings/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{m.held_at ? String(m.held_at).replace(/-/g, "/") : "—"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{m.title || "（件名なし）"}</p>
                        <Badge className={`text-[9px] shrink-0 ${st.color} hover:${st.color}`}>{PROCESSING.has(m.status) ? <span className="inline-flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> {st.label}</span> : st.label}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[m.client_name, typeLabel(m.meeting_type), m.audio_duration_sec ? fmtClock(m.audio_duration_sec) : null, m.created_by].filter(Boolean).join(" ・ ")}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {openTodos > 0 && <Badge variant="outline" className="text-[9px] font-normal">ToDo {openTodos}</Badge>}
                      {unconfirmed > 0 && <Badge variant="outline" className="text-[9px] font-normal text-amber-700 border-amber-300">未確認 {unconfirmed}</Badge>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
