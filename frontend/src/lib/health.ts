import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/health/schema.py。
export type HealthResponse = components["schemas"]["HealthResponse"];

// 2026-10-14-admin-server-status task-02：恢复被 2026-07-24 死代码清理删除的
// getSystemStatus（展示层重建，接口自始在线）。鉴权由 D-001@v2 收紧为
// system_status:read——apiFetch 自动携带 Bearer，403 抛 ApiError、401 走全局拦截。
export type SystemStatusResponse = components["schemas"]["SystemStatusResponse"];

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return apiFetch<SystemStatusResponse>("/api/system-status");
}
