import { apiFetch } from "./api";

export interface CreateChangeInput {
  title: string;
  affected_components?: string[];
}

export interface GenerateDocsInput {
  doc_types: string[];
}

export function createChange(workspaceId: string, input: CreateChangeInput) {
  return apiFetch<{ id: string; change_key: string; path: string }>(
    `/api/workspaces/${workspaceId}/changes/create`,
    { method: "POST", json: input },
  );
}

export function generateDocs(
  workspaceId: string,
  changeId: string,
  docTypes: string[],
) {
  return apiFetch<{ generated: string[] }>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/documents/generate`,
    { method: "POST", json: { doc_types: docTypes } },
  );
}
