import { apiFetch } from "./api";

export interface AuditLogEntry {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details_json: Record<string, unknown> | null;
  timestamp: string;
}

export function listAuditLogs(
  workspaceId: string,
  params?: { resource_type?: string; limit?: number },
) {
  const searchParams = new URLSearchParams();
  if (params?.resource_type) searchParams.set("resource_type", params.resource_type);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const qs = searchParams.toString();
  return apiFetch<AuditLogEntry[]>(
    `/api/workspaces/${workspaceId}/audit${qs ? `?${qs}` : ""}`,
  );
}
