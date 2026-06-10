/**
 * API client for platform settings & user management.
 */
import { apiFetch } from "@/lib/api";

// ── Settings ──────────────────────────────────────────────────────────

export interface SettingRead {
  key: string;
  value: string;
  updated_at: string | null;
}

export interface SettingsBulkRead {
  settings: SettingRead[];
}

export interface SettingsUpdateResponse {
  updated: string[];
}

export async function listSettings(): Promise<SettingsBulkRead> {
  return apiFetch<SettingsBulkRead>("/api/settings");
}

export async function updateSettings(
  settings: Record<string, string>,
): Promise<SettingsUpdateResponse> {
  return apiFetch<SettingsUpdateResponse>("/api/settings", {
    method: "PUT",
    json: { settings },
  });
}

// ── Users ─────────────────────────────────────────────────────────────

export interface UserRead {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  is_platform_admin: boolean;
  last_login_at: string | null;
  created_at: string;
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
}

export interface UserUpdateRequest {
  display_name?: string;
  is_platform_admin?: boolean;
  status?: string;
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

export async function listUsers(
  params?: UserListParams,
): Promise<UserListResponse> {
  return apiFetch<UserListResponse>("/api/users", {
    query: params as Record<string, string | number>,
  });
}

export async function createUser(data: UserCreateRequest): Promise<UserRead> {
  return apiFetch<UserRead>("/api/users", {
    method: "POST",
    json: data,
  });
}

export async function updateUser(
  userId: string,
  data: UserUpdateRequest,
): Promise<UserRead> {
  return apiFetch<UserRead>(`/api/users/${userId}`, {
    method: "PATCH",
    json: data,
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await apiFetch(`/api/users/${userId}`, { method: "DELETE" });
}

// ── User detail endpoints ─────────────────────────────────────────────

export interface UserSessionRead {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
}

export interface UserWorkspaceRead {
  workspace_name: string;
  workspace_slug: string;
  role_name: string;
}

export interface RevokeAllResponse {
  revoked_count: number;
}

export interface AuditLogRead {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  details_json: string | null;
  timestamp: string;
}

export async function listUserSessions(
  userId: string,
): Promise<UserSessionRead[]> {
  return apiFetch<UserSessionRead[]>(`/api/users/${userId}/sessions`);
}

export async function listUserAudit(
  userId: string,
): Promise<AuditLogRead[]> {
  return apiFetch<AuditLogRead[]>(`/api/users/${userId}/audit`);
}

export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  await apiFetch(`/api/users/${userId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function revokeAllSessions(
  userId: string,
): Promise<RevokeAllResponse> {
  return apiFetch<RevokeAllResponse>(
    `/api/users/${userId}/sessions/revoke-all`,
    { method: "POST" },
  );
}

export async function listUserWorkspaces(
  userId: string,
): Promise<UserWorkspaceRead[]> {
  return apiFetch<UserWorkspaceRead[]>(`/api/users/${userId}/workspaces`);
}

export async function resetUserPassword(
  userId: string,
  forceChangeOnNextLogin: boolean = false,
): Promise<{ plaintext_password: string }> {
  return apiFetch(`/api/users/${userId}/reset-password`, {
    method: "POST",
    json: {
      force_change_on_next_login: forceChangeOnNextLogin,
    },
  });
}
