/**
 * Tool Gateway API client. Mirrors backend/app/modules/tool_gateway/router.py.
 */
import { apiFetch } from "@/lib/api";

// ── Types ──

export type ToolType =
  | "file_read"
  | "file_write"
  | "file_list"
  | "file_search"
  | "shell_exec";

export interface ToolExecuteRequest {
  tool_type: ToolType;
  params: Record<string, unknown>;
}

export interface ToolExecuteResponse {
  id: string;
  tool_type: string;
  result_code: number;
  redacted_output: string;
  timestamp: string;
}

// ── Endpoints ──

/** Execute a tool inside a worktree lease. */
export function executeTool(
  leaseId: string,
  input: ToolExecuteRequest,
): Promise<ToolExecuteResponse> {
  return apiFetch<ToolExecuteResponse>(`/api/worktrees/${leaseId}/tools`, {
    method: "POST",
    json: input,
  });
}
