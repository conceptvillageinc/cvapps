import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, UserPlus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useLiveRecordings, startedAt, fmtTime, elapsedMin } from "@/lib/liveRecordings";

/**
 * 「レコーディング中（n件）」の帯。議事録一覧と新規議事録の上に出す。
 *   highlight: { client_name, project_id } 同じクライアント／案件の録音があれば強調する
 *   excludeMeetingId: 自分がいま開いている議事録は出さない
 */
export default function LiveRecordingBanner({ highlight = null, excludeMeetingId = null, className = "" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { live } = useLiveRecordings();
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => db.entities.Project.list("-registered_at") });
  const projectOf = useMemo(() => { const m = {}; for (const p of projects) m[p.id] = p; return (id) => (id ? m[id] : null); }, [projects]);
  const [joining, setJoining] = useState(null);

  const me = user?.full_name || user?.email || "";
  const rows = live.filter((m) => m.id !== excludeMeetingId);
  if (rows.length === 0) return null;

  const isSame = (m) => !!highlight && ((highlight.project_id && m.project_id === highlight.project_id) || (highlight.client_name && m.client_name && m.client_name === highlight.client_name));
  const strong = rows.some(isSame);

  const join = async (m) => {
    setJoining(m.id);
    try {
      const participants = Array.isArray(m.participants) ? m.participants : [];
      if (me && !participants.includes(me)) await db.entities.Meeting.update(m.id, { participants: [...participants, me] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["meeting", m.id] });
      toast.success(`「${m.title || "議事録"}」に出席者として加わりました（録音は始めません）`);
      navigate(`/meetings/${m.id}`);
    } catch (e) {
      toast.error("加われませんでした: " + e.message);
    } finally {
      setJoining(null);
    }
  };

  const shell = strong
    ? "border-red-800 bg-red-800 text-white"
    : "border-red-300 bg-red-50 text-red-900";
  const sub = strong ? "text-red-100" : "text-red-700";

  return (
    <div className={`rounded-xl border px-4 py-3 space-y-2 ${shell} ${className}`} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`inline-block w-2.5 h-2.5 rounded-full animate-pulse ${strong ? "bg-white" : "bg-red-600"}`} />
        <span className="font-bold">{strong ? "同じ案件・クライアントの録音が進行中です" : `レコーディング中（${rows.length} 件）`}</span>
        <span className={`text-[11px] ${sub}`}>
          {rows.length > 1 ? "別々の打ち合わせです。自分が出ている打ち合わせがあれば合流し、無ければ新しい議事録から録音してください" : "同じ打ち合わせに出ているなら、録音は 1 本で十分です。合流すると自分が出席者に加わります"}
        </span>
      </div>
      {rows.map((m) => {
        const mine = m.created_by && m.created_by === me;
        const pj = projectOf(m.project_id);
        const st = startedAt(m);
        return (
          <div key={m.id} className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${strong ? "border-red-300/50 bg-red-900/40" : "border-red-200 bg-white"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${strong ? "bg-white/15 text-white" : "bg-red-100 text-red-800"}`}>{(m.created_by || "?").slice(0, 1)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">
                {mine ? "あなた" : (m.created_by || "メンバー")} が「{m.title || "議事録"}」を録音中
                {st && <span className={`ml-2 font-normal ${strong ? "text-red-100" : "text-red-600"}`}>{fmtTime(st)}〜（{elapsedMin(st)} 分経過）</span>}
              </p>
              <p className={`text-[11px] truncate ${sub}`}>
                {[m.client_name, pj ? `${pj.project_number} ${pj.name}` : null, (m.participants || []).length ? `出席: ${m.participants.join("、")}` : null].filter(Boolean).join(" ｜ ")}
                {isSame(m) && <span className="ml-2 font-semibold">← いま入力している案件・クライアントと同じ</span>}
              </p>
            </div>
            {!mine && (
              <Button type="button" size="sm" className={`h-8 text-xs gap-1 ${strong ? "bg-white text-red-900 hover:bg-red-50" : ""}`} onClick={() => join(m)} disabled={joining === m.id}>
                {joining === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} 同じ打ち合わせなので合流する
              </Button>
            )}
            <Link to={`/meetings/${m.id}`} className={`inline-flex items-center gap-1 h-8 px-3 rounded-md border text-xs ${strong ? "border-red-200 text-white hover:bg-red-900/60" : "border-red-200 text-red-900 bg-white hover:bg-red-50"}`}>
              <Mic className="w-3.5 h-3.5" /> 開く <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
