import type { components } from "./api-types";
import { apiFetch } from "./api";

// 直接复用 OpenAPI 生成的类型，避免手写类型与后端 schema 漂移。
export type ScanDocSummary = components["schemas"]["ScanDocSummary"];
export type ScanDocRead = components["schemas"]["ScanDocRead"];
export type ScanDocList = components["schemas"]["ScanDocList"];
export type ScanDocWarning = components["schemas"]["ScanDocWarning"];
export type ScanDocReparseStats = components["schemas"]["ScanDocReparseStats"];
export type ScanDocReparseResponse = components["schemas"]["ScanDocReparseResponse"];
// 单条冲突历史归档记录（对应后端 ScanDocConflictRead）。
export type ConflictHistoryItem = components["schemas"]["ScanDocConflictRead"];

/**
 * Stale threshold in ms (default 1h). Override via env var.
 */
export const STALE_THRESHOLD_MS = Number(
  process.env.NEXT_PUBLIC_SCAN_DOC_STALE_MS ?? 60 * 60 * 1000,
);

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
