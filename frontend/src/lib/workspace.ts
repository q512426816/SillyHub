/**
 * PPM 项目 ↔ 工作区 关联 API 客户端(change 2026-07-28-ppm-project-link-workspace task-09)。
 *
 * 双边对称,6 个函数与 backend 端点 1:1,操作同一张 ``ppm_project_workspace`` 表:
 *
 * 工作区侧(`/api/workspaces/{workspace_id}/ppm-projects`,workspace/link_router.py):
 *   - listLinkedProjects / linkProject / unlinkProject
 *
 * 项目侧(`/api/ppm/projects/{project_id}/workspaces`,ppm/project/router.py):
 *   - listProjectWorkspaces / linkWorkspace / unlinkWorkspace
 *
 * 错误统一由 ``apiFetch`` 抛 ``ApiError``(401 自动 refresh + 403/404/409 透传),
 * 本 client 不本地处理,调用方(弹窗/区块组件)按 status 决定提示。
 *
 * 类型暂手写与 backend schema DTO 字段名 1:1;task-13 由 ``pnpm gen:types`` 对齐。
 */

import { apiFetch } from "@/lib/api";

// ── Response DTOs(与 backend schema.py PpmProjectBrief / WorkspaceBrief 字段名 1:1)──

/** 工作区侧列表项:展示关联的 PPM 项目摘要(FR-03)。 */
export interface PpmProjectBrief {
  project_id: string; // backend: uuid.UUID → 前端 string
  project_name: string | null;
  project_status: string | null;
}

/** 项目侧列表项:展示关联的工作区摘要(FR-02)。 */
export interface WorkspaceBrief {
  workspace_id: string;
  name: string;
  status: string;
  type: string | null;
}

// ── Request DTOs ──

export interface BindPpmProjectRequest {
  ppm_project_id: string;
}

export interface BindWorkspaceRequest {
  workspace_id: string;
}

// ── 内部 helper:拼双侧 base 路径 ──

function workspacePpmBase(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/ppm-projects`;
}

function projectWorkspaceBase(projectId: string): string {
  return `/api/ppm/projects/${encodeURIComponent(projectId)}/workspaces`;
}

// ── 工作区侧 3 函数 ──

/**
 * 列出工作区关联的 PPM 项目(过滤软删除工作区,FR-06)。权限:工作区可见。
 * GET /api/workspaces/{workspace_id}/ppm-projects → PpmProjectBrief[]
 */
export async function listLinkedProjects(
  workspaceId: string,
): Promise<PpmProjectBrief[]> {
  try {
    return await apiFetch<PpmProjectBrief[]>(workspacePpmBase(workspaceId));
  } catch (err) {
    // 保留 try/catch 作为 telemetry hook 预留位置(同 workspace-members.ts)。
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 绑定 PPM 项目到工作区。权限:工作区成员管理。
 * 重复绑定 409、目标项目不存在 404。POST → 201 PpmProjectBrief
 */
export async function linkProject(
  workspaceId: string,
  ppmProjectId: string,
): Promise<PpmProjectBrief> {
  try {
    const payload: BindPpmProjectRequest = { ppm_project_id: ppmProjectId };
    return await apiFetch<PpmProjectBrief>(workspacePpmBase(workspaceId), {
      method: "POST",
      json: payload,
    });
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 解绑 PPM 项目。权限:工作区成员管理。幂等(不存在静默 204)。
 * DELETE /api/workspaces/{workspace_id}/ppm-projects/{ppm_project_id} → 204
 */
export async function unlinkProject(
  workspaceId: string,
  ppmProjectId: string,
): Promise<void> {
  try {
    await apiFetch<void>(
      `${workspacePpmBase(workspaceId)}/${encodeURIComponent(ppmProjectId)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

// ── 项目侧 3 函数 ──

/**
 * 列出 PPM 项目关联的工作区(过滤软删除工作区,FR-06)。权限:登录用户(项目可见)。
 * GET /api/ppm/projects/{project_id}/workspaces → WorkspaceBrief[]
 */
export async function listProjectWorkspaces(
  projectId: string,
): Promise<WorkspaceBrief[]> {
  try {
    return await apiFetch<WorkspaceBrief[]>(projectWorkspaceBase(projectId));
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 绑定工作区到 PPM 项目。权限:项目 manager(非 manager 403,FR-05)。
 * 重复绑定 409、目标工作区不存在 404。POST → 201 WorkspaceBrief
 */
export async function linkWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<WorkspaceBrief> {
  try {
    const payload: BindWorkspaceRequest = { workspace_id: workspaceId };
    return await apiFetch<WorkspaceBrief>(projectWorkspaceBase(projectId), {
      method: "POST",
      json: payload,
    });
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 解绑工作区。权限:项目 manager(非 manager 403)。幂等(不存在静默 204)。
 * DELETE /api/ppm/projects/{project_id}/workspaces/{workspace_id} → 204
 */
export async function unlinkWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<void> {
  try {
    await apiFetch<void>(
      `${projectWorkspaceBase(projectId)}/${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}
