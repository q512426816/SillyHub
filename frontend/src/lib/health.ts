import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/health/schema.py。
export type HealthResponse = components["schemas"]["HealthResponse"];
export type SystemStatus = components["schemas"]["SystemStatusResponse"];

// 从生成类型推导的子类型，保持 health-card.tsx 等 import 向后兼容。
export type DependencyStatus = HealthResponse["db"];
export type OverallStatus = HealthResponse["status"];

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return apiFetch<SystemStatus>("/api/system-status");
}
