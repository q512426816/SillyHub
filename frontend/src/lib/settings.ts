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

export async function listUsers(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<UserListResponse> {
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
