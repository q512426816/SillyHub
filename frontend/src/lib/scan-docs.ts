import { apiFetch } from "./api";

export type ScanDocSummary = {
  id: string;
  doc_type: string;
  path: string;
  title: string | null;
  exists: boolean;
  last_modified_at: string | null;
  source_member_id: string | null;
  source_synced_at: string | null;
  source_mtime: string | null;
  content_hash: string | null;
  conflict_count: number;
};

export type ScanDocRead = {
  id: string;
  doc_type: string;
  path: string;
  title: string | null;
  exists: boolean;
  content: string | null;
  last_modified_at: string | null;
  source_member_id: string | null;
  source_synced_at: string | null;
  source_mtime: string | null;
  content_hash: string | null;
  conflict_count: number;
};

export type ScanDocList = {
  items: ScanDocSummary[];
  total: number;
};

export type ScanDocWarning = {
  code: string;
  detail: string;
  component_key: string | null;
  doc_type: string | null;
};

export type ScanDocReparseStats = {
  parsed: number;
  created: number;
  updated: number;
  deleted: number;
};

export type ScanDocReparseResponse = {
  workspace_id: string;
  stats: ScanDocReparseStats;
  warnings: ScanDocWarning[];
};

/**
 * Stale threshold in ms (default 1h). Override via env var.
 */
export const STALE_THRESHOLD_MS = Number(
  process.env.NEXT_PUBLIC_SCAN_DOC_STALE_MS ?? 60 * 60 * 1000,
);

export type ConflictHistoryItem = {
  id: string;
  old_content: string | null;
  old_source_member_id: string | null;
  old_mtime: string | null;
  created_at: string;
};

export function listScanDocs(workspaceId: string, query?: { q?: string }) {
  const qs = query?.q ? `?q=${encodeURIComponent(query.q)}` : "";
  return apiFetch<ScanDocList>(
    `/api/workspaces/${workspaceId}/scan-docs${qs}`,
  );
}

export function getScanDoc(
  workspaceId: string,
  docId: string,
) {
  return apiFetch<ScanDocRead>(
    `/api/workspaces/${workspaceId}/scan-docs/${docId}`,
  );
}

export function reparseScanDocs(workspaceId: string) {
  return apiFetch<ScanDocReparseResponse>(
    `/api/workspaces/${workspaceId}/scan-docs/reparse`,
    { method: "POST" },
  );
}

export function listDocConflicts(
  workspaceId: string,
  docId: string,
) {
  return apiFetch<{ items: ConflictHistoryItem[] }>(
    `/api/workspaces/${workspaceId}/scan-docs/${docId}/conflicts`,
  );
}
