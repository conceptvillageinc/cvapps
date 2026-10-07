import { SUBMISSION_STATUS, submissionOf } from "@/lib/submission";

/** 見積の提出ステータスの印（未提出／提出済／失注） */
export default function SubmissionBadge({ estimate, size = "sm", hideUnsubmitted = false, className = "" }) {
  const key = submissionOf(estimate);
  if (hideUnsubmitted && key === "unsubmitted") return null;
  const st = SUBMISSION_STATUS[key];
  const sz = size === "xs" ? "text-[9px] px-1.5 h-4" : "text-[10px] px-2 h-5";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-medium shrink-0 ${sz} ${st.cls} ${className}`} data-testid="submission-badge">
      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
    </span>
  );
}
