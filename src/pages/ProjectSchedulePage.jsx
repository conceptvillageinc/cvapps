import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Loader2 } from "lucide-react";
import ScheduleTab from "@/components/schedule/ScheduleTab";

/** 工程表だけを大きく開く画面（/projects/:id/schedule。案件画面の工程表から新しいタブで開く） */
export default function ProjectSchedulePage() {
  const { id } = useParams();
  const { data: project, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => db.entities.Project.get(id), enabled: !!id });
  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!project) return <p className="py-16 text-center text-sm text-muted-foreground">案件が見つかりません</p>;
  return (
    <div className="-mt-2 lg:-mt-3">
      <ScheduleTab project={project} fullPage backTo={{ href: `/projects/${project.id}`, label: `案件に戻る　${project.project_number || ""} ${project.client_name || ""}　${project.name || ""}`.trim() }} />
    </div>
  );
}
