/**
 * Change Writer API client. Mirrors backend/app/modules/change_writer/router.py.
 */
import { apiFetch } from "@/lib/api";

// ── Types ──

export interface CreateChangeInput {
  title: string;
  change_type?: string;
  affected_components?: string[];
  lease_id?: string;
}

export interface CreateChangeResponse {
  id: string;
  workspace_id: string;
  change_key: string;
  title: string;
  status: string;
  path: string;
  created_at: string;
}

export interface GenerateDocsInput {
  doc_types: string[];
}

export interface BatchGenerateResponse {
  generated: string[];
}

// ── Endpoints ──

export function createChange(
  workspaceId: string,
  input: CreateChangeInput,
): Promise<CreateChangeResponse> {
  return apiFetch<CreateChangeResponse>(
    `/api/workspaces/${workspaceId}/changes/create`,
    { method: "POST", json: input },
  );
}

export function generateDocs(
  workspaceId: string,
  changeId: string,
  docTypes: string[],
): Promise<BatchGenerateResponse> {
  // Use batch-generate endpoint — the single /generate endpoint expects
  // {doc_type, content} which is for uploading, not batch creation.
  return batchGenerateDocuments(workspaceId, changeId, docTypes);
}

/** Batch-generate multiple document types in a single call. */
export function batchGenerateDocuments(
  workspaceId: string,
  changeId: string,
  docTypes: string[],
): Promise<BatchGenerateResponse> {
  return apiFetch<BatchGenerateResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/documents/batch-generate`,
    { method: "POST", json: { doc_types: docTypes } },
  );
}
