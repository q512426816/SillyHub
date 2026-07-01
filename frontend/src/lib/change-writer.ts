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

// ── Quick Fix（task-11，FR-05）──────────────────────────────────────────

/** Quick 修复变更的请求参数（scope 固定 quick，独立 create 路径，不复用 verify 流转）。 */
export interface QuickFixChangeInput {
  title: string;
  description?: string;
  change_type?: string;
  affected_components?: string[];
  lease_id?: string;
}

/**
 * 快速修复变更入口 — POST /api/workspaces/{wid}/changes/create（scope=quick）
 *
 * FR-05：quick 是 skill 级独立触发，直接走 create+scope:quick 路径，
 * 不与 verify 结果联动（不复用已被 task-01 删除的 verify→quick→verify stage 流转）。
 * 后端 change_writer/router.py:create_change + changes/router.py 已支持 scope 字段。
 */
export function quickFixChange(
  workspaceId: string,
  input: QuickFixChangeInput,
): Promise<CreateChangeResponse> {
  return apiFetch<CreateChangeResponse>(
    `/api/workspaces/${workspaceId}/changes/create`,
    {
      method: "POST",
      json: { ...input, scope: "quick" },
    },
  );
}
