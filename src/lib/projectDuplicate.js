// ============================================================================
// 案件の複製（過去とほぼ同じ内容の案件を作る）
//
//   写すもの   … クライアント・案件名・受注確度・見込みの金額（受注見込・発注見込・その他費用）・案件メモ
//   新しくするもの … 案件番号・登録日（今日）・フェーズ（未着手）・状態（進行中）・完了予定などの日付
//   写さないもの … 実績（受注合計・発注合計）・ネクストアクション・工程表・定期売上の設定
//                 ・納品書・請求書・発注書・入稿記録・議事録（これらは前の案件に残る）
//   見積        … 選んだものだけ、新しい見積番号の下書きとして写して新しい案件に紐づける
//                 （見積から見込みを入れていて、その見積も写したときは、見込みの入り方も写した見積に付け替える）
// ============================================================================
import { generateProjectNumber } from "@/lib/projectNumber";
import { generateEstimateNumber } from "@/lib/estimateNumber";
import { todayString } from "@/lib/fiscal";
import { submissionOf } from "@/lib/submission";
import { forecastSources } from "@/lib/projectForecast";

/** 最初にチェックしておく見積（同じ見積の版が複数あるときは一番新しい版だけ。失注の見積は外す） */
export function defaultDuplicateEstimateIds(estimates) {
  const latest = new Map();
  for (const e of (estimates || []).filter((x) => submissionOf(x) !== "lost")) {
    const gid = e.project_group_id || e.id;
    const cur = latest.get(gid);
    if (!cur || String(e.created_date || "") > String(cur.created_date || "")) latest.set(gid, e);
  }
  return [...latest.values()].map((e) => e.id);
}

/** 写した見積の中身（番号・状態・レビュー・提出・議事録とのつながりは新しくする） */
export function estimateCopyPayload(est, { projectId, estimateNumber, today }) {
  const {
    id, created_date, updated_date, created_at, updated_at, created_by_id, estimate_number, status,
    reviewer_id, reviewer_name, approved_date, review_comments, approval_checklist,
    review_requested_to_id, review_requested_to_name, review_requested_at,
    freee_deal_id, freee_estimate_id, freee_status, finalized_at, finalized_by,
    submitted_at, lost_reason, meeting_id, ...rest
  } = est;
  return {
    ...rest,
    project_id: projectId,
    estimate_number: estimateNumber,
    estimate_date: today,
    project_group_id: estimateNumber,
    parent_estimate_id: null,
    revision_label: "初回",
    is_final_submitted: false,
    submission_status: "unsubmitted",
    submitted_at: null,
    status: "draft",
    review_comments: [],
    approval_checklist: {},
  };
}

/** 新しい案件の中身 */
export function projectCopyPayload(project, { name, registeredAt, dueDate, copyNotes }) {
  return {
    client_id: project.client_id || null,
    client_name: project.client_name || "",
    name: name || project.name,
    deal_probability: project.deal_probability || null,
    phase: "未着手",
    status: "open",
    expected_revenue: Number(project.expected_revenue) || 0,
    expected_cost: Number(project.expected_cost) || 0,
    other_cost: Number(project.other_cost) || 0,
    confirmed_revenue: 0,
    confirmed_cost: 0,
    actual_revenue_manual: false,
    actual_cost_manual: false,
    registered_at: registeredAt || todayString(),
    due_date: dueDate || null,
    payment_due_date: null,
    vendor_payment_date: null,
    is_recurring: false,
    notes: copyNotes ? project.notes || null : null,
  };
}

/**
 * 複製する。{ project: 新しい案件, estimates: 写した見積 } を返す。
 *   途中で失敗したときは、そこまでに作ったものは残る（案件を開いて続きから直せる）
 */
export async function duplicateProject(db, project, { name, registeredAt, dueDate, copyNotes = true, estimates = [], userId = null }) {
  const payload = projectCopyPayload(project, { name, registeredAt, dueDate, copyNotes });
  const created = await db.entities.Project.create({
    ...payload,
    project_number: await generateProjectNumber(payload.registered_at),
    created_by: userId,
  });
  const today = todayString();
  const copies = [];
  const idMap = {};
  // 古い順に写す（見積番号が元と同じ並びになるように）
  for (const est of [...estimates].sort((a, b) => String(a.created_date || "").localeCompare(String(b.created_date || "")))) {
    const estimateNumber = await generateEstimateNumber(db);
    const copy = await db.entities.Estimate.create(estimateCopyPayload(est, { projectId: created.id, estimateNumber, today }));
    copies.push(copy);
    idMap[est.id] = copy;
  }
  // 見積から見込みを入れていた案件は、写した見積の分だけ、見込みの入り方を写した見積に付け替える
  const sources = forecastSources(project.forecast_source).filter((src) => idMap[src.estimate_id])
    .map((src) => ({ ...src, estimate_id: idMap[src.estimate_id].id, estimate_number: idMap[src.estimate_id].estimate_number || "" }));
  if (sources.length) {
    const { estimate_id, estimate_number, line_ids, unchecked_ids, ...rest } = project.forecast_source;
    const updated = await db.entities.Project.update(created.id, { forecast_source: { ...rest, sources, applied_at: new Date().toISOString(), dismissed_sig: null } });
    return { project: updated || created, estimates: copies };
  }
  return { project: created, estimates: copies };
}
