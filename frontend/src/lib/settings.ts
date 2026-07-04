/**
 * API client for platform settings (key/value config only).
 *
 * User management moved to `/api/admin/users` (see `@/lib/admin`).
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/settings/schema.py。
export type SettingRead = components["schemas"]["SettingRead"];
export type SettingsBulkRead = components["schemas"]["SettingsBulkRead"];
export type SettingsUpdateResponse = components["schemas"]["SettingsUpdateResponse"];

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
