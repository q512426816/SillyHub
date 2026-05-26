import { apiFetch } from "@/lib/api";

export type DependencyStatus = "ok" | "down";
export type OverallStatus = "ok" | "degraded";

export interface HealthResponse {
  status: OverallStatus;
  db: DependencyStatus;
  redis: DependencyStatus;
  version: string;
  commit_sha: string;
  server_time: string;
  environment: string;
}

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}
