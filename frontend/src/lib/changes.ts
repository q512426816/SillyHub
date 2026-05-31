import { apiFetch } from "./api";

export type ChangeSummary = {
  id: string;
  change_key: string;
  title: string | null;
  status: string;
  location: string;
  change_type: string | null;
  affected_components: string[];
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangeRead = ChangeSummary & {
  path: string;
  archived_at: string | null;
  current_stage: string | null;
  stages: Record<string, any> | null;
  approval_status: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
};

export type ChangeList = {
  items: ChangeSummary[];
  total: number;
};

export type ChangeDocMatrixEntry = {
  doc_type: string;
  exists: boolean;
  path: string;
  status: string | null;
  last_modified_at: string | null;
};

export type ChangeDocMatrix = {
  change_id: string;
  documents: ChangeDocMatrixEntry[];
  prototypes: string[];
  references: string[];
};

export type ChangeDocContent = {
  doc_type: string;
  path: string;
  content: string | null;
  exists: boolean;
};

export type ChangeWarning = {
  code: string;
  detail: string;
  change_key: string | null;
  doc_type: string | null;
};

export type ChangeReparseStats = {
  parsed: number;
  created: number;
  updated: number;
  deleted: number;
};

export type ChangeReparseResponse = {
  workspace_id: string;
  stats: ChangeReparseStats;
  warnings: ChangeWarning[];
};

export function listChanges(
  workspaceId: string,
  params?: { location?: string; status?: string; owner?: string },
) {
  const searchParams = new URLSearchParams();
  if (params?.location) searchParams.set("location", params.location);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.owner) searchParams.set("owner", params.owner);
  const qs = searchParams.toString();
  return apiFetch<ChangeList>(
    `/api/workspaces/${workspaceId}/changes${qs ? `?${qs}` : ""}`,
  );
}

export function getChange(workspaceId: string, changeId: string) {
  return apiFetch<ChangeRead>(
    `/api/workspaces/${workspaceId}/changes/${changeId}`,
  );
}

export function getChangeDocuments(workspaceId: string, changeId: string) {
  return apiFetch<ChangeDocMatrix>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/documents`,
  );
}

export function getChangeDocumentContent(
  workspaceId: string,
  changeId: string,
  docType: string,
  path?: string,
) {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return apiFetch<ChangeDocContent>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/documents/${docType}${qs}`,
  );
}

export function reparseChanges(workspaceId: string) {
  return apiFetch<ChangeReparseResponse>(
    `/api/workspaces/${workspaceId}/changes/reparse`,
    { method: "POST" },
  );
}

// 获取审批状态
export function getChangeApproval(workspaceId: string, changeKey: string) {
  return apiFetch<{ status: string; reason: string | null }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/approval`,
  );
}

// 批准
export function approveChange(workspaceId: string, changeKey: string, approvedBy: string) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/approve`,
    {
      method: "POST",
      json: { approved_by: approvedBy },
    },
  );
}

// 驳回
export function rejectChange(workspaceId: string, changeKey: string, reason: string) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/reject`,
    {
      method: "POST",
      json: { reason },
    },
  );
}

// 更新进度
export function updateChangeProgress(
  workspaceId: string,
  changeKey: string,
  data: { currentStage: string; stages: Record<string, any>; lastActive: string },
) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/progress`,
    {
      method: "POST",
      json: data,
    },
  );
}
