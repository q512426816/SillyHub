import type { components } from "./api-types";

import { apiFetch } from "./api";

// 直接复用 OpenAPI 生成类型，避免手写类型与后端 schema 分叉。
// 关键修正：details_json 后端是 JSON 字符串(Text 列)，生成类型为 string | null，
// 手写类型曾误写为 Record<string, unknown> | null 导致前端二次序列化。
export type AuditLogEntry = components["schemas"]["AuditLogEntry"];

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
