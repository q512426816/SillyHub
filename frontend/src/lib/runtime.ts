/**
 * Runtime progress API client. Mirrors backend/app/modules/runtime/schema.py.
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 复用 OpenAPI 生成的 RuntimeProgress / StageProgress / StageStep 类型，
// 字段命名与后端 snake_case DTO 一致。
export type StageStep = components["schemas"]["StageStep"];
export type StageProgress = components["schemas"]["StageProgress"];
export type RuntimeProgress = components["schemas"]["RuntimeProgress"];

export async function getRuntimeProgress(
  workspaceId: string,
): Promise<RuntimeProgress | null> {
  return apiFetch<RuntimeProgress | null>(
    `/api/workspaces/${workspaceId}/runtime`,
  );
}

export interface ArtifactEntry {
  filename: string;
  size_bytes: number;
  last_modified: string | null;
}

export async function getRuntimeUserInputsRaw(
  workspaceId: string,
): Promise<string> {
  const res = await apiFetch<string>(
    `/api/workspaces/${workspaceId}/runtime/user-inputs/raw`,
    { headers: { accept: "text/plain" } },
  );
  return typeof res === "string" ? res : "";
}

export async function getRuntimeArtifacts(
  workspaceId: string,
): Promise<ArtifactEntry[]> {
  return apiFetch<ArtifactEntry[]>(
    `/api/workspaces/${workspaceId}/runtime/artifacts`,
  );
}

export async function getRuntimeArtifactContent(
  workspaceId: string,
  filename: string,
): Promise<string> {
  const res = await apiFetch<string>(
    `/api/workspaces/${workspaceId}/runtime/artifacts/${encodeURIComponent(filename)}`,
    { headers: { accept: "text/plain" } },
  );
  return typeof res === "string" ? res : "";
}
