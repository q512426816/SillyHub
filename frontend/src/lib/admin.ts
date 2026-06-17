/**
 * Admin API client for `/api/admin/{users,organizations,roles}`.
 *
 * Mirrors backend task-04/05/06 endpoints. Uses the shared
 * `apiFetch` wrapper (auto-attaches bearer token from the session store,
 * 401 retry with refresh, structured ApiError envelope) — same pattern
 * as `lib/settings.ts`.
 */
import { apiFetch } from "@/lib/api";

// ── Permissions ───────────────────────────────────────────────────────

export type PermissionGroup =
  | "PLATFORM"
  | "ADMIN"
  | "WORKSPACE"
  | "AGENT"
  | "CHANGE"
  | "AUDIT";

export interface PermissionWithGroup {
  key: string;
  name: string;
  group: PermissionGroup;
  description?: string;
}

export const PERMISSION_GROUPS: {
  group: PermissionGroup;
  permissions: PermissionWithGroup[];
}[] = [
  {
    group: "PLATFORM",
    permissions: [
      { key: "platform:admin", name: "平台超级管理员", group: "PLATFORM" },
      { key: "platform:billing", name: "平台计费", group: "PLATFORM" },
      { key: "platform:audit:read", name: "平台审计读取", group: "PLATFORM" },
    ],
  },
  {
    group: "ADMIN",
    permissions: [
      { key: "user:read", name: "用户查看", group: "ADMIN" },
      { key: "user:write", name: "用户编辑", group: "ADMIN" },
      { key: "user:login:manage", name: "登录权限管理", group: "ADMIN" },
      { key: "organization:read", name: "组织查看", group: "ADMIN" },
      { key: "organization:write", name: "组织编辑", group: "ADMIN" },
      { key: "role:read", name: "角色查看", group: "ADMIN" },
      { key: "role:write", name: "角色编辑", group: "ADMIN" },
    ],
  },
  {
    group: "WORKSPACE",
    permissions: [
      { key: "workspace:read", name: "Workspace 查看", group: "WORKSPACE" },
      { key: "workspace:write", name: "Workspace 编辑", group: "WORKSPACE" },
      { key: "workspace:admin", name: "Workspace 管理", group: "WORKSPACE" },
      {
        key: "workspace:member:manage",
        name: "Workspace 成员管理",
        group: "WORKSPACE",
      },
    ],
  },
  {
    group: "AGENT",
    permissions: [
      { key: "task:read", name: "任务查看", group: "AGENT" },
      { key: "task:create", name: "任务创建", group: "AGENT" },
      { key: "task:assign", name: "任务分配", group: "AGENT" },
      { key: "task:run_agent", name: "任务执行", group: "AGENT" },
      { key: "task:cancel", name: "任务取消", group: "AGENT" },
      { key: "task:approve", name: "任务审批", group: "AGENT" },
      { key: "code:read", name: "代码查看", group: "AGENT" },
      { key: "code:write", name: "代码编辑", group: "AGENT" },
      { key: "code:review", name: "代码审查", group: "AGENT" },
      { key: "code:merge", name: "代码合并", group: "AGENT" },
      { key: "deploy:staging", name: "预发部署", group: "AGENT" },
      { key: "deploy:production", name: "生产部署", group: "AGENT" },
      { key: "deploy:rollback", name: "回滚", group: "AGENT" },
      { key: "tool:shell_exec", name: "Shell 工具", group: "AGENT" },
      { key: "tool:network", name: "网络工具", group: "AGENT" },
      { key: "tool:database", name: "数据库工具", group: "AGENT" },
      { key: "tool:secret:read", name: "密钥读取", group: "AGENT" },
    ],
  },
  {
    group: "CHANGE",
    permissions: [
      { key: "change:create", name: "变更创建", group: "CHANGE" },
      { key: "change:read", name: "变更查看", group: "CHANGE" },
      { key: "change:update", name: "变更更新", group: "CHANGE" },
      { key: "change:approve", name: "变更审批", group: "CHANGE" },
      { key: "change:archive", name: "变更归档", group: "CHANGE" },
    ],
  },
  {
    group: "AUDIT",
    permissions: [
      {
        key: "platform:audit:read",
        name: "平台审计读取",
        group: "AUDIT",
        description: "跨工作空间的平台级审计日志访问",
      },
    ],
  },
];

// ── Users ─────────────────────────────────────────────────────────────

export interface OrganizationBrief {
  id: string;
  name: string;
  code: string;
}

export interface RoleBrief {
  id: string;
  key: string;
  name: string;
}

export interface UserRead {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  is_platform_admin: boolean;
  login_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  organizations: OrganizationBrief[];
  roles: RoleBrief[];
}

export interface UserListResponse {
  items: UserRead[];
  total: number;
}

export interface UserCreateRequest {
  email: string;
  password: string;
  display_name?: string;
  is_platform_admin?: boolean;
  login_enabled?: boolean;
  organization_ids?: string[];
  role_ids?: string[];
}

export interface UserUpdateRequest {
  display_name?: string;
  is_platform_admin?: boolean;
  status?: string;
  login_enabled?: boolean;
  organization_ids?: string[];
  role_ids?: string[];
}

export interface UserListParams {
  q?: string;
  status?: string;
  role?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export interface UserSessionRead {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface AuditLogRead {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface UserWorkspaceRead {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  role: string;
}

export interface ResetPasswordRequest {
  new_password?: string;
  force_change_on_next_login?: boolean;
}

export interface ResetPasswordResponse {
  password: string;
  message: string;
}

export interface RevokeAllResponse {
  revoked_count: number;
}

export async function listUsers(
  params?: UserListParams,
): Promise<UserListResponse> {
  return apiFetch<UserListResponse>("/api/admin/users", {
    query: params as Record<string, string | number | undefined>,
  });
}

export async function getUser(userId: string): Promise<UserRead> {
  return apiFetch<UserRead>(`/api/admin/users/${userId}`);
}

export async function createUser(
  body: UserCreateRequest,
): Promise<UserRead> {
  return apiFetch<UserRead>("/api/admin/users", {
    method: "POST",
    json: body,
  });
}

export async function updateUser(
  userId: string,
  body: UserUpdateRequest,
): Promise<UserRead> {
  return apiFetch<UserRead>(`/api/admin/users/${userId}`, {
    method: "PATCH",
    json: body,
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
}

export async function listUserSessions(
  userId: string,
): Promise<UserSessionRead[]> {
  return apiFetch<UserSessionRead[]>(`/api/admin/users/${userId}/sessions`);
}

export async function revokeUserSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  await apiFetch(`/api/admin/users/${userId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function revokeAllUserSessions(
  userId: string,
): Promise<RevokeAllResponse> {
  return apiFetch<RevokeAllResponse>(
    `/api/admin/users/${userId}/sessions/revoke-all`,
    { method: "POST" },
  );
}

export async function listUserAudit(
  userId: string,
  params?: { limit?: number },
): Promise<AuditLogRead[]> {
  return apiFetch<AuditLogRead[]>(`/api/admin/users/${userId}/audit`, {
    query: params as Record<string, number | undefined>,
  });
}

export async function listUserWorkspaces(
  userId: string,
): Promise<UserWorkspaceRead[]> {
  return apiFetch<UserWorkspaceRead[]>(`/api/admin/users/${userId}/workspaces`);
}

export async function resetUserPassword(
  userId: string,
  body?: ResetPasswordRequest,
): Promise<ResetPasswordResponse> {
  return apiFetch<ResetPasswordResponse>(
    `/api/admin/users/${userId}/reset-password`,
    {
      method: "POST",
      json: body ?? {},
    },
  );
}

export async function disableUserLogin(userId: string): Promise<UserRead> {
  return apiFetch<UserRead>(`/api/admin/users/${userId}/disable-login`, {
    method: "POST",
  });
}

export async function enableUserLogin(userId: string): Promise<UserRead> {
  return apiFetch<UserRead>(`/api/admin/users/${userId}/enable-login`, {
    method: "POST",
  });
}

// ── Organizations ─────────────────────────────────────────────────────

export type OrganizationStatus = "active" | "disabled";

export interface OrganizationRead {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parent_id: string | null;
  status: OrganizationStatus;
  sort_order: number;
  member_count: number;
  children_count: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationDetail extends OrganizationRead {
  children: OrganizationRead[];
}

export interface OrganizationCreateRequest {
  name: string;
  code: string;
  description?: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface OrganizationUpdateRequest {
  name?: string;
  code?: string;
  description?: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface OrganizationListParams {
  parent_id?: string;
  is_active?: boolean;
}

export async function listOrganizations(
  params?: OrganizationListParams,
): Promise<OrganizationRead[]> {
  return apiFetch<OrganizationRead[]>("/api/admin/organizations", {
    query: params as Record<string, string | boolean | undefined>,
  });
}

export async function getOrganization(
  orgId: string,
): Promise<OrganizationDetail> {
  return apiFetch<OrganizationDetail>(`/api/admin/organizations/${orgId}`);
}

export async function createOrganization(
  body: OrganizationCreateRequest,
): Promise<OrganizationRead> {
  return apiFetch<OrganizationRead>("/api/admin/organizations", {
    method: "POST",
    json: body,
  });
}

export async function updateOrganization(
  orgId: string,
  body: OrganizationUpdateRequest,
): Promise<OrganizationRead> {
  return apiFetch<OrganizationRead>(`/api/admin/organizations/${orgId}`, {
    method: "PATCH",
    json: body,
  });
}

export async function disableOrganization(
  orgId: string,
): Promise<OrganizationRead> {
  return apiFetch<OrganizationRead>(
    `/api/admin/organizations/${orgId}/disable`,
    { method: "POST" },
  );
}

export async function enableOrganization(
  orgId: string,
): Promise<OrganizationRead> {
  return apiFetch<OrganizationRead>(
    `/api/admin/organizations/${orgId}/enable`,
    { method: "POST" },
  );
}

export async function deleteOrganization(orgId: string): Promise<void> {
  await apiFetch(`/api/admin/organizations/${orgId}`, { method: "DELETE" });
}

// ── Roles ─────────────────────────────────────────────────────────────

export type Permission = string;

export interface RoleRead {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permissions: Permission[];
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface RoleListResponse {
  items: RoleRead[];
  total: number;
}

export interface RoleCreateRequest {
  key: string;
  name: string;
  description?: string;
  permission_keys: Permission[];
}

export interface RoleUpdateRequest {
  name?: string;
  description?: string;
  permission_keys?: Permission[];
  is_active?: boolean;
}

export interface RoleListParams {
  search?: string;
  is_active?: boolean;
  page?: number;
  size?: number;
}

export type RoleUserBindingType = "platform" | "workspace";

export interface RoleUserRead {
  id: string;
  email: string;
  display_name: string | null;
  is_platform_admin: boolean;
  status: string;
  login_enabled: boolean;
  binding_type: RoleUserBindingType;
  workspace_id: string | null;
  workspace_name: string | null;
}

export interface RoleUserListResponse {
  items: RoleUserRead[];
  total: number;
}

export async function listRoles(
  params?: RoleListParams,
): Promise<RoleListResponse> {
  return apiFetch<RoleListResponse>("/api/admin/roles", {
    query: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getRole(roleId: string): Promise<RoleRead> {
  return apiFetch<RoleRead>(`/api/admin/roles/${roleId}`);
}

export async function createRole(
  body: RoleCreateRequest,
): Promise<RoleRead> {
  return apiFetch<RoleRead>("/api/admin/roles", {
    method: "POST",
    json: body,
  });
}

export async function updateRole(
  roleId: string,
  body: RoleUpdateRequest,
): Promise<RoleRead> {
  return apiFetch<RoleRead>(`/api/admin/roles/${roleId}`, {
    method: "PATCH",
    json: body,
  });
}

export async function disableRole(roleId: string): Promise<RoleRead> {
  return apiFetch<RoleRead>(`/api/admin/roles/${roleId}/disable`, {
    method: "POST",
  });
}

export async function enableRole(roleId: string): Promise<RoleRead> {
  return apiFetch<RoleRead>(`/api/admin/roles/${roleId}/enable`, {
    method: "POST",
  });
}

export async function deleteRole(roleId: string): Promise<void> {
  await apiFetch(`/api/admin/roles/${roleId}`, { method: "DELETE" });
}

export async function listRoleUsers(
  roleId: string,
): Promise<RoleUserListResponse> {
  return apiFetch<RoleUserListResponse>(`/api/admin/roles/${roleId}/users`);
}

// ── Permissions catalogue ─────────────────────────────────────────────

export async function listPermissions(): Promise<PermissionWithGroup[]> {
  return PERMISSION_GROUPS.flatMap((g) => g.permissions);
}
