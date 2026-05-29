import { apiFetch } from "./api";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type RiskLevel = "low" | "medium" | "high" | "extreme";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  run_id: string;
  task_id: string;
  task_key: string;
  agent_name: string;
  risk_level: RiskLevel;
  tool_name: string;
  branch: string;
  target: string;
  commit_message: string;
  created_at: string;
  status: ApprovalStatus;
}

export interface ApprovalHistoryEntry extends ApprovalRequest {
  approver: string;
  resolved_at: string;
}

/* ------------------------------------------------------------------ */
/*  API functions                                                     */
/* ------------------------------------------------------------------ */

export function listPendingApprovals(workspaceId: string) {
  return apiFetch<ApprovalRequest[]>(
    `/api/workspaces/${workspaceId}/approvals/pending`,
  );
}

export function listApprovalHistory(workspaceId: string) {
  return apiFetch<ApprovalHistoryEntry[]>(
    `/api/workspaces/${workspaceId}/approvals/history`,
  );
}

export function approveRequest(workspaceId: string, requestId: string) {
  return apiFetch<ApprovalRequest>(
    `/api/workspaces/${workspaceId}/approvals/${requestId}/approve`,
    { method: "POST" },
  );
}

export function rejectRequest(workspaceId: string, requestId: string) {
  return apiFetch<ApprovalRequest>(
    `/api/workspaces/${workspaceId}/approvals/${requestId}/reject`,
    { method: "POST" },
  );
}
