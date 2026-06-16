/**
 * Workspace Members API client (workspace-members 变更)。
 *
 * 6 个函数与 backend `/api/workspaces/{workspace_id}/members/*` 端点 1:1。
 * 错误统一由 `apiFetch` 抛出 `ApiError`（401 refresh + 403/404/400 透传），
 * 本 client 不本地处理。
 */

import { apiFetch } from "@/lib/api";

// ── Literal union (与 backend Literal["workspace_owner","developer","viewer"] 1:1) ──

export type WorkspaceMemberRoleKey =
  | "workspace_owner"
  | "developer"
  | "viewer";

// ── Response DTOs (与 backend schema.py WorkspaceMemberView 等字段名 1:1) ──

export interface WorkspaceMemberView {
  user_id: string; // backend: uuid.UUID → 前端 string
  email: string;
  display_name: string | null;
  // 响应里用 str（不用 Literal），允许 service 回显 platform_admin 等用于显示
  role_key: string;
  role_name: string; // 例如 "Workspace Owner"
  granted_at: string; // backend: datetime → 前端 ISO 字符串
  is_current_user: boolean; // 后端按 session user_id 比对填充
}

export interface WorkspaceMemberListResponse {
  items: WorkspaceMemberView[];
}

export interface UserSearchHit {
  user_id: string;
  email: string;
  display_name: string | null;
  is_member: boolean; // 通常 false（搜索时已排除已是成员的）
}

export interface UserSearchResponse {
  items: UserSearchHit[];
}

// ── Request DTOs ──

export interface WorkspaceMemberAddRequest {
  user_id: string;
  role_key: WorkspaceMemberRoleKey;
}

export interface WorkspaceMemberUpdateRequest {
  role_key: WorkspaceMemberRoleKey;
}

// ── 内部 helper：拼 members base 路径 ──

function membersBase(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/members`;
}

// ── 6 个 export async function ──

/**
 * 列出 workspace 的所有成员（含 user 信息 + role）。
 * 权限：WORKSPACE_READ（任何成员可见）。
 * 返回时剥掉 `items` 包装，调用方拿到干净数组。
 */
export async function listMembers(
  workspaceId: string,
): Promise<WorkspaceMemberView[]> {
  try {
    const resp = await apiFetch<WorkspaceMemberListResponse>(
      membersBase(workspaceId),
    );
    return resp.items;
  } catch (err) {
    // 保留 try/catch 作为 telemetry hook 预留位置（见 design §5.2 / task-06 §2.3）。
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 模糊搜索 users（display_name / email ILIKE），排除已是该 ws 成员的。
 * 权限：WORKSPACE_MEMBER_MANAGE。
 * 返回时剥掉 `items` 包装。
 */
export async function searchUsersForInvite(
  workspaceId: string,
  q: string,
  limit?: number,
): Promise<UserSearchHit[]> {
  try {
    const resp = await apiFetch<UserSearchResponse>(
      `${membersBase(workspaceId)}/search`,
      { query: { q, limit } },
    );
    return resp.items;
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 添加成员（已成员则改 role，幂等）。
 * 权限：WORKSPACE_MEMBER_MANAGE。
 */
export async function addMember(
  workspaceId: string,
  payload: WorkspaceMemberAddRequest,
): Promise<WorkspaceMemberView> {
  try {
    return await apiFetch<WorkspaceMemberView>(membersBase(workspaceId), {
      method: "POST",
      json: payload,
    });
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 修改成员角色。
 * 权限：WORKSPACE_MEMBER_MANAGE。
 */
export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  payload: WorkspaceMemberUpdateRequest,
): Promise<WorkspaceMemberView> {
  try {
    return await apiFetch<WorkspaceMemberView>(
      `${membersBase(workspaceId)}/${encodeURIComponent(userId)}`,
      { method: "PATCH", json: payload },
    );
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 移除成员（拒绝移除最后一个 owner）。
 * 权限：WORKSPACE_MEMBER_MANAGE。
 */
export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  try {
    await apiFetch<void>(
      `${membersBase(workspaceId)}/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}

/**
 * 把目标升 owner，当前用户降 developer（单事务）。
 * 权限：WORKSPACE_MEMBER_MANAGE。
 */
export async function transferOwnership(
  workspaceId: string,
  userId: string,
): Promise<void> {
  try {
    await apiFetch<void>(
      `${membersBase(workspaceId)}/${encodeURIComponent(userId)}/transfer-ownership`,
      { method: "POST" },
    );
  } catch (err) {
    // eslint-disable-next-line no-useless-catch
    throw err;
  }
}
