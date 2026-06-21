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

export interface SystemStatus {
  server_time: string;
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  tasks: number;
  projects: number;
  milestones: number;
  users: number;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return apiFetch<SystemStatus>("/api/system-status");
}
