import { apiFetch } from "./api";

export interface ReviewEntry {
  id: string;
  change_id: string;
  reviewer_id: string;
  verdict: "approve" | "reject";
  comment: string | null;
  created_at: string;
}

export function transitionChange(
  workspaceId: string,
  changeId: string,
  targetStage: string,
  reason?: string,
) {
  const body: Record<string, unknown> = { target_stage: targetStage };
  if (reason !== undefined) body.reason = reason;
  return apiFetch<{ id: string; status: string }>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/transition`,
    { method: "POST", json: body },
  );
}

export function submitReview(
  workspaceId: string,
  changeId: string,
  verdict: "approve" | "reject",
  comment?: string,
) {
  return apiFetch<ReviewEntry>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/reviews`,
    { method: "POST", json: { verdict, comment } },
  );
}

export function listReviews(workspaceId: string, changeId: string) {
  return apiFetch<ReviewEntry[]>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/reviews`,
  );
}

export function transitionTask(
  workspaceId: string,
  taskId: string,
  targetStatus: string,
) {
  return apiFetch<{ id: string; status: string }>(
    `/api/workspaces/${workspaceId}/tasks/${taskId}/transition`,
    { method: "POST", json: { target: targetStatus } },
  );
}
