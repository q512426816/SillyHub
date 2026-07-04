/**
 * Knowledge & Quicklog API client. Mirrors backend/app/modules/knowledge/schema.py.
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/knowledge/schema.py。
export type KnowledgeEntry = components["schemas"]["KnowledgeEntry"];
export type KnowledgeList = components["schemas"]["KnowledgeList"];
export type QuicklogEntry = components["schemas"]["QuicklogEntry"];
export type QuicklogList = components["schemas"]["QuicklogList"];

export async function listKnowledge(
  workspaceId: string,
): Promise<KnowledgeList> {
  return apiFetch<KnowledgeList>(
    `/api/workspaces/${workspaceId}/knowledge`,
  );
}

export async function getKnowledge(
  workspaceId: string,
  filename: string,
): Promise<KnowledgeEntry> {
  return apiFetch<KnowledgeEntry>(
    `/api/workspaces/${workspaceId}/knowledge/${encodeURIComponent(filename)}`,
  );
}

export async function listQuicklog(
  workspaceId: string,
): Promise<QuicklogList> {
  return apiFetch<QuicklogList>(
    `/api/workspaces/${workspaceId}/quicklog`,
  );
}

export async function getQuicklog(
  workspaceId: string,
  filename: string,
): Promise<QuicklogEntry> {
  return apiFetch<QuicklogEntry>(
    `/api/workspaces/${workspaceId}/quicklog/${encodeURIComponent(filename)}`,
  );
}
