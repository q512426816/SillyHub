/**
 * Git Gateway API client. Mirrors backend/app/modules/git_gateway/router.py.
 */
import { apiFetch } from "@/lib/api";

// ── Types ──

export interface GitOperationRequest {
  operation: string;
  args?: string[];
}

export interface GitOperationResponse {
  id: string;
  operation: string;
  result_code: number;
  redacted_output: string;
  timestamp: string;
}

// ── Endpoints ──

/** Execute a git operation inside a worktree lease. */
export function executeGitOperation(
  leaseId: string,
  input: GitOperationRequest,
): Promise<GitOperationResponse> {
  return apiFetch<GitOperationResponse>(`/api/worktrees/${leaseId}/git`, {
    method: "POST",
    json: input,
  });
}
