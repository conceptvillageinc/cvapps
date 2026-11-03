import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Inbox as InboxIcon, Loader2, CheckCheck, AtSign, UserPlus, MessageSquare } from "lucide-react";
import { useInbox, INBOX_KEY, NOTIFICATION_KIND } from "@/lib/useInbox";
import { useTaskData } from "@/lib/useTaskData";
import { userLabel, todayYmd, dueOf } from "@/lib/tasks";
import { UserAvatar, TaskPlaceChip } from "@/components/tasks/parts";
import { useAuth } from "@/lib/AuthContext";

const ICON = { mention: AtSign, assigned: UserPlus, comment: MessageSquare };
const fmtAt = (s) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** 受信トレイ: メンション・担当になった・担当のタスクへのコメント。期限が今日・明日の自分のタスクも上に出す */
export default function Inbox() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { items, unread, isLoading } = useInbox();
  const data = useTaskData();
  const today = todayYmd();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const dueSoon = data.tasks.filter((t) => t.assignee_id === user?.id && !t.completed && dueOf(t) && dueOf(t) <= tomorrow);
  const markRead = async (n) => { if (n.read_at) return; await db.entities.Notification.update(n.id, { read_at: new Date().toISOString() }); qc.invalidateQueries({ queryKey: INBOX_KEY }); };
  const markAll = async () => { await Promise.all(items.filter((n) => !n.read_at).map((n) => db.entities.Notification.update(n.id, { read_at: new Date().toISOString() }))); qc.invalidateQueries({ queryKey: INBOX_KEY }); };
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2"><InboxIcon className="w-5 h-5" />受信トレイ</h1>
        <span className="text-xs text-muted-foreground">未読 {unread} 件</span>
        <Button size="sm" variant="outline" className="ml-auto h-8 gap-1 text-xs" onClick={markAll} disabled={!unread}><CheckCheck className="w-3.5 h-3.5" />すべて既読にする</Button>
      </div>
      {dueSoon.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid="inbox-due">
          <p className="text-xs font-semibold text-amber-900 mb-1">期限が近い担当のタスク（今日・明日・期限切れ）</p>
          <ul className="space-y-0.5">{dueSoon.map((t) => <li key={t.id}><Link to={`/tasks?task=${t.id}`} className="text-sm hover:underline">{t.name}</Link><span className={`ml-2 text-[11px] ${dueOf(t) < today ? "text-rose-600 font-semibold" : "text-amber-800"}`}>{dueOf(t) < today ? "期限切れ" : dueOf(t) === today ? "今日まで" : "明日まで"}</span></li>)}</ul>
        </div>
      )}
      <div className="rounded-xl border bg-white divide-y" data-testid="inbox-list">
        {isLoading && <Loader2 className="w-5 h-5 animate-spin m-6 text-muted-foreground" />}
        {!isLoading && items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">お知らせはまだありません</p>}
        {items.map((n) => {
          const actor = data.byId.users.get(n.actor_id); const Icon = ICON[n.kind] || MessageSquare; const t = data.byId.tasks.get(n.task_id);
          return (
            <Link key={n.id} to={`/tasks?task=${n.task_id}`} onClick={() => markRead(n)} className={`flex gap-3 px-4 py-3 hover:bg-muted/40 ${n.read_at ? "" : "bg-blue-50/50"}`} data-testid="inbox-item">
              <div className="relative"><UserAvatar user={actor} size={30} /><Icon className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white p-0.5 text-primary ring-1 ring-slate-200" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-xs"><span className="font-semibold">{userLabel(actor)}</span> さんが{NOTIFICATION_KIND[n.kind] || "お知らせ"}<span className="ml-2 text-muted-foreground">{fmtAt(n.created_at)}</span></p>
                <p className="text-sm font-medium truncate">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">{n.body}</p>}
                {t && <TaskPlaceChip task={t} byId={data.byId} className="mt-1" />}
              </div>
              {!n.read_at && <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
