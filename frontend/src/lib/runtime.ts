/**
 * Runtime progress API client. Mirrors backend/app/modules/runtime/schema.py.
 */
import { apiFetch } from "@/lib/api";

export interface StageStep {
  name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  output: string | null;
}

export interface StageProgress {
  status: string;
  steps: StageStep[];
  started_at: string | null;
  completed_at: string | null;
}

export interface RuntimeProgress {
  version: number;
  project: string | null;
  current_stage: string | null;
  current_change: string | null;
  stages: Record<string, StageProgress>;
  last_active: string | null;
}

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
