import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paperclip } from "lucide-react";
import MeetingAttachments from "@/components/meetings/MeetingAttachments";

// ============================================================================
// 案件の「参考資料」: 画像・PDF・Excel・Word などを案件に添付する（議事録の参考資料と同じ部品）
//   ファイルは Storage の uploads/projects/<案件ID>/attachments/、一覧は projects.attachments（jsonb）
//   追加・削除はすぐ保存。メモは入力が落ち着いたら（0.8 秒）保存
// ============================================================================

export default function ProjectAttachmentsCard({ project }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [list, setList] = useState(() => (Array.isArray(project.attachments) ? project.attachments : []));
  const timer = useRef(null);
  // 別の画面で更新されたら追従する（自分の保存待ちのあいだは上書きしない）
  const remote = JSON.stringify(project.attachments || []);
  useEffect(() => { if (!timer.current) setList(Array.isArray(project.attachments) ? project.attachments : []); }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (next, removed = []) => {
    try {
      await db.entities.Project.update(project.id, { attachments: next });
      if (removed.length) await db.storage.remove(removed).catch(() => {});
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    } catch (err) {
      toast.error("参考資料を保存できませんでした: " + (err?.message || "不明なエラー"));
    }
  };
  const onChange = (next, opts = {}) => {
    setList(next);
    clearTimeout(timer.current);
    if (opts.save) { timer.current = null; persist(next, opts.removed || []); return; }
    timer.current = setTimeout(() => { timer.current = null; persist(next); }, 800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Card data-testid="project-attachments-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Paperclip className="w-4 h-4" /> 参考資料（{list.length}件）</CardTitle>
      </CardHeader>
      <CardContent>
        <MeetingAttachments
          meetingId={project.id}
          pathPrefix={`projects/${project.id}/attachments`}
          value={list}
          onChange={onChange}
          userName={user?.full_name || user?.email || ""}
        />
      </CardContent>
    </Card>
  );
}
