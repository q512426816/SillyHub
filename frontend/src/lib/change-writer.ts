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
