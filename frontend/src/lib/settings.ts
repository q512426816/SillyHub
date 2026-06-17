/**
 * API client for platform settings (key/value config only).
 *
 * User management moved to `/api/admin/users` (see `@/lib/admin`).
 */
import { apiFetch } from "@/lib/api";

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
