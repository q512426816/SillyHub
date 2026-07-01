/**
 * Spec Workspace API client. Mirrors backend spec_workspace endpoints.
 */
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/stores/session";
import type { AgentRunStatus } from "@/lib/agent";

export type SpecStrategy = "platform-managed" | "repo-mirrored" | "repo-native";
export type SyncStatus = "pending" | "clean" | "dirty" | "conflicted";

export interface SpecWorkspace {
  id: string;
  workspace_id: string;
  spec_root: string;
  strategy: SpecStrategy;
  repo_sillyspec_path: string | null;
  profile_version: string;
  sync_status: SyncStatus;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSpecWorkspace(
  workspaceId: string,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace`,
  );
}

export type ImportPhase =
  | "packing"
  | "packed"
  | "applying"
  | "reparsing_docs"
  | "reparsing_changes"
  | "done"
  | "error";

export interface ImportSseHandlers {
  onProgress?: (phase: ImportPhase, data?: Record<string, unknown>) => void;
}

/**
 * 流式导入 spec（D-001 SSE，2026-07-01-spec-import-async-and-change-reparse）。
 *
 * POST /import 返回 text/event-stream，分阶段推 packing/packed/applying/
 * reparsing_docs/reparsing_changes/done/error。原生 fetch + ReadableStream 解析
 * （不复用 apiFetch——它 JSON parse）；error 事件 → throw ApiError；done → resolve。
 * 调用方通过 onProgress 更新阶段进度 UI，done 后自行刷新 spec_ws + 变更中心。
 */
export async function importSpecWorkspace(
  workspaceId: string,
  handlers: ImportSseHandlers = {},
): Promise<void> {
  const { onProgress } = handlers;
  const { accessToken } = useSession.getState();
  const resp = await fetch(
    `/api/workspaces/${workspaceId}/spec-workspace/import`,
    {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    },
  );
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    let payload: { code?: string; message?: string } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    throw new ApiError(resp.status, {
      code: payload?.code ?? "import_failed",
      message: payload?.message ?? `导入失败 (HTTP ${resp.status})`,
      request_id: null,
      details: null,
    });
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string): void => {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(":")) return; // keepalive / comment
    let event = "";
    let dataStr = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (!event) return;
    let data: Record<string, unknown> = {};
    if (dataStr) {
      try {
        data = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        data = { raw: dataStr };
      }
    }
    const phase = event as ImportPhase;
    onProgress?.(phase, data);
    if (phase === "error") {
      throw new ApiError(0, {
        code: (data.code as string) ?? "import_error",
        message: (data.message as string) ?? "导入失败",
        request_id: null,
        details: null,
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) flush(block);
  }
  if (buffer.trim()) flush(buffer);
}

export interface BootstrapResult {
  agent_run_id: string;
  stream_url: string;
  status: AgentRunStatus;
  spec_root: string;
  message: string;
}

export async function bootstrapSpecWorkspace(
  workspaceId: string,
): Promise<BootstrapResult> {
  return apiFetch<BootstrapResult>(
    `/api/workspaces/${workspaceId}/spec-bootstrap`,
    { method: "POST" },
  );
}

export interface GenerateProjectsResult {
  generated_files: number;
  reparse: {
    parsed: number;
    created: number;
    updated: number;
    deleted: number;
  };
  children: { id: string; name: string; component_key: string; slug: string }[];
}

export async function generateProjects(
  workspaceId: string,
): Promise<GenerateProjectsResult> {
  return apiFetch<GenerateProjectsResult>(
    `/api/workspaces/${workspaceId}/generate-projects`,
    { method: "POST" },
  );
}

// ── Spec Workspace Update ──

export interface SpecWorkspaceUpdateInput {
  strategy?: SpecStrategy;
  repo_sillyspec_path?: string | null;
  profile_version?: string;
}

export async function updateSpecWorkspace(
  workspaceId: string,
  input: SpecWorkspaceUpdateInput,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace`,
    { method: "PATCH", json: input },
  );
}

// ── Spec Conflicts ──

export type SpecConflictStatus = "open" | "approved" | "rejected" | "resolved";

export interface SpecConflictRead {
  id: string;
  workspace_id: string;
  change_id: string | null;
  task_id: string | null;
  stage: string;
  conflict_type: string;
  details_json: string | null;
  status: SpecConflictStatus;
  created_at: string;
}

export interface SpecConflictListResponse {
  items: SpecConflictRead[];
  total: number;
}

export interface SpecConflictResolveInput {
  status: SpecConflictStatus;
  details_json?: string | null;
}

export function listSpecConflicts(
  workspaceId: string,
  params?: {
    status_filter?: string;
    limit?: number;
    offset?: number;
  },
): Promise<SpecConflictListResponse> {
  return apiFetch<SpecConflictListResponse>(
    `/api/workspaces/${workspaceId}/spec-conflicts`,
    { query: params as Record<string, string | number | undefined> },
  );
}

export function resolveSpecConflict(
  workspaceId: string,
  conflictId: string,
  input: SpecConflictResolveInput,
): Promise<SpecConflictRead> {
  return apiFetch<SpecConflictRead>(
    `/api/workspaces/${workspaceId}/spec-conflicts/${conflictId}/resolve`,
    { method: "POST", json: input },
  );
}
