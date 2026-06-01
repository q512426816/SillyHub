import { apiFetch } from "./api";

export type ScanDocSummary = {
  id: string;
  doc_type: string;
  path: string;
  title: string | null;
  exists: boolean;
  last_modified_at: string | null;
};

export type ScanDocRead = {
  id: string;
  doc_type: string;
  path: string;
  title: string | null;
  exists: boolean;
  content: string | null;
  last_modified_at: string | null;
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

export function listScanDocs(workspaceId: string) {
  return apiFetch<ScanDocList>(
    `/api/workspaces/${workspaceId}/scan-docs`,
  );
}

export function getScanDoc(
  workspaceId: string,
  docType: string,
) {
  return apiFetch<ScanDocRead>(
    `/api/workspaces/${workspaceId}/scan-docs/${docType}`,
  );
}

export function reparseScanDocs(workspaceId: string) {
  return apiFetch<ScanDocReparseResponse>(
    `/api/workspaces/${workspaceId}/scan-docs/reparse`,
    { method: "POST" },
  );
}
