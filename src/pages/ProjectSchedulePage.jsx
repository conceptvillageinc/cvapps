import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { ArrowLeft, Loader2 } from "lucide-react";
import ScheduleTab from "@/components/schedule/ScheduleTab";

/** 工程表だけを大きく開く画面（/projects/:id/schedule。案件画面の工程表から新しいタブで開く） */
export default function ProjectSchedulePage() {
  const { id } = useParams();
  const { data: project, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => db.entities.Project.get(id), enabled: !!id });
  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!project) return <p className="py-16 text-center text-sm text-muted-foreground">案件が見つかりません</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to={`/projects/${project.id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />案件に戻る</Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">{project.project_number}</span>
        <span className="font-semibold">{project.client_name}　{project.name}</span>
      </div>
      <ScheduleTab project={project} fullPage />
    </div>
  );
}
