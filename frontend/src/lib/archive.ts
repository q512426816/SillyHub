/**
 * Archive API client. Mirrors backend/app/modules/archive/router.py.
 */
import { apiFetch } from "@/lib/api";

export interface ArchivedChange {
  id: string;
  workspace_id: string;
  workspace_ids: string[];
  change_key: string;
  title: string;
  status: string;
  location: string;
  path: string;
  affected_components: string[];
  change_type: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** Archive a change – move it to the archive directory and mark archived. */
export function archiveChange(
  workspaceId: string,
  changeId: string,
): Promise<ArchivedChange> {
  return apiFetch<ArchivedChange>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/archive`,
    { method: "POST" },
  );
}

/** Distill knowledge from a change and write to knowledge base. */
export function distillChange(
  workspaceId: string,
  changeId: string,
): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/distill`,
    { method: "POST" },
  );
}
