/**
 * Daemon runtime API client.
 */
import { apiFetch } from "@/lib/api";

export interface DaemonRuntimeRead {
  id: string;
  name: string | null;
  provider: string | null;
  version: string | null;
  status: string | null; // online, offline, maintenance
  last_heartbeat_at: string | null;
  capabilities: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export async function listDaemonRuntimes(): Promise<DaemonRuntimeRead[]> {
  return apiFetch<DaemonRuntimeRead[]>("/api/daemon/runtimes");
}

export async function getDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(`/api/daemon/runtimes/${runtimeId}`);
}
