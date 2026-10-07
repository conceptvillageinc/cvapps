// ============================================================================
// 見積の提出ステータス（未提出／提出済み／失注）
//   最後にクライアントへ出した版を「提出済み」、通らなかった版を「失注」にする。
//   ある版を提出済みにすると、同じ見積（project_group_id）で前に提出済みだった版は失注になる。
//   これまでの「最終提出版」（is_final_submitted）は提出済みとして扱う（0030 の SQL を流す前も同じ表示）。
// ============================================================================
import { db } from "@/api/db";

export const SUBMISSION_STATUS = {
  unsubmitted: { label: "未提出", cls: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  submitted: { label: "提出済み", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  lost: { label: "失注", cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
};
export const SUBMISSION_KEYS = ["unsubmitted", "submitted", "lost"];

/** 見積の提出ステータス */
export function submissionOf(e) {
  if (e && SUBMISSION_STATUS[e.submission_status] && !(e.submission_status === "unsubmitted" && e.is_final_submitted)) return e.submission_status;
  return e?.is_final_submitted ? "submitted" : "unsubmitted";
}

/** 自動保存で送らない列（提出ステータスはボタン・メール送信・案件の失注でだけ変える） */
export const SUBMISSION_FIELDS = ["submission_status", "submitted_at", "is_final_submitted"];

/**
 * 提出ステータスを変える（この版と、提出済みにするときは同じ見積の他の版も）。
 * @returns {Promise<{ patch: object, lostIds: string[] }>}  この版に当てた値と、失注にした他の版
 */
export async function setSubmission(estimate, status) {
  const now = new Date().toISOString();
  const patch = {
    submission_status: status,
    is_final_submitted: status === "submitted",
    ...(status === "submitted" ? { submitted_at: now } : {}),
  };
  await db.entities.Estimate.update(estimate.id, patch);
  const lostIds = [];
  if (status === "submitted") {
    const groupId = estimate.project_group_id || estimate.id;
    const siblings = await db.entities.Estimate.filter({ project_group_id: groupId });
    for (const s of siblings) {
      if (s.id === estimate.id || submissionOf(s) !== "submitted") continue;
      await db.entities.Estimate.update(s.id, { submission_status: "lost", is_final_submitted: false });
      lostIds.push(s.id);
    }
  }
  return { patch, lostIds };
}
