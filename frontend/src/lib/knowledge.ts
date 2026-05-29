/**
 * Knowledge & Quicklog API client. Mirrors backend/app/modules/knowledge/schema.py.
 */
import { apiFetch } from "@/lib/api";

export interface KnowledgeEntry {
  filename: string;
  path: string;
  title: string | null;
  content: string | null;
  last_modified_at: string | null;
}

export interface KnowledgeList {
  items: KnowledgeEntry[];
  total: number;
}

export interface QuicklogEntry {
  filename: string;
  path: string;
  title: string | null;
  content: string | null;
  last_modified_at: string | null;
}

export interface QuicklogList {
  items: QuicklogEntry[];
  total: number;
}

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
