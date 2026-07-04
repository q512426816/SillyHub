/**
 * Git Gateway API client. Mirrors backend/app/modules/git_gateway/router.py.
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/git_gateway/schema.py。
export type GitOperationRequest = components["schemas"]["GitOperationRequest"];
export type GitOperationResponse = components["schemas"]["GitOperationResponse"];

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
