import { apiFetch, getApiBaseUrl } from "./api";
import { useSession } from "@/stores/session";

export type AgentRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "killed";

export interface AgentRun {
  id: string;
  task_id: string;
  lease_id: string;
  agent_type: string;
  status: AgentRunStatus;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  output_redacted: string | null;
  spec_strategy: string | null;
  profile_version: string | null;
  diff_summary: string | null;
  change_id: string | null;
  created_at: string;
  total_cost_usd: number | null;
  duration_ms: number | null;
  duration_api_ms: number | null;
  num_turns: number | null;
  session_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  // Post-scan validation fields
  post_scan_status: string | null;
  source_commit: string | null;
  is_resume: boolean | null;
  resumed_from_step: number | null;
}

export type AgentRunLogChannel =
  | "stdout"
  | "stderr"
  | "tool_call"
  | "pending_input"
  | "user_input";

export interface AgentRunLogEntry {
  id: string;
  run_id: string;
  timestamp: string;
  channel: AgentRunLogChannel;
  content_redacted: string;
}

export interface CreateAgentRunInput {
  task_id: string;
  lease_id: string;
  agent_type: string;
  preferred_backend?: "server" | "daemon";
  // Explicit agent provider override; omitted/empty falls through to
  // workspace.default_agent (FR-02, 2026-06-14-agent-runtime-selection).
  provider?: string | null;
}

export function createAgentRun(workspaceId: string, input: CreateAgentRunInput) {
  return apiFetch<AgentRun>(`/api/workspaces/${workspaceId}/agent/runs`, {
    method: "POST",
    json: input,
  });
}

export function getAgentRun(workspaceId: string, runId: string) {
  return apiFetch<AgentRun>(`/api/workspaces/${workspaceId}/agent/runs/${runId}`);
}

export function listAgentRuns(workspaceId: string, taskId?: string) {
  const qs = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  return apiFetch<AgentRun[]>(
    `/api/workspaces/${workspaceId}/agent/runs${qs}`,
  );
}

export function getAgentRunLogs(workspaceId: string, runId: string, after?: string) {
  const qs = after ? `?after=${encodeURIComponent(after)}` : "";
  return apiFetch<AgentRunLogEntry[]>(
    `/api/workspaces/${workspaceId}/agent/runs/${runId}/logs${qs}`,
  );
}

export interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
  log_id: string | null;
}

export interface DoneEventData {
  status?: string;
  exit_code?: number | null;
}

export function streamAgentRunLogs(
  workspaceId: string,
  runId: string,
  onMessage: (_event: StreamLogEvent) => void,
  onDone: (_data: DoneEventData) => void,
  onError?: (_error: Error) => void,
): EventSource {
  // Use Next.js Route Handler proxy (avoids CORS + auth issues with direct backend access)
  const base = getApiBaseUrl();
  const { accessToken } = useSession.getState();
  const url = new URL(`${base}/api/workspaces/${workspaceId}/agent/runs/${runId}/stream`);
  if (accessToken) url.searchParams.set("token", accessToken);
  const es = new EventSource(url.toString());

  es.onmessage = (e: MessageEvent<string>) => {
    try {
      const parsed: StreamLogEvent = JSON.parse(e.data);
      onMessage(parsed);
    } catch {
      onError?.(new Error(`Failed to parse SSE data: ${e.data}`));
    }
  };

  es.addEventListener("done", (e: MessageEvent<string>) => {
    es.close();
    let data: DoneEventData = {};
    try {
      data = JSON.parse(e.data);
    } catch {
      // empty done data is valid
    }
    onDone(data);
  });

  es.onerror = () => {
    const error = new Error("EventSource connection error");
    onError?.(error);
    es.close();
  };

  return es;
}

// ── Agent Run User Input ──

export interface AgentRunInputRequest {
  content: string;
}

export interface AgentRunInputResponse {
  run_id: string;
  accepted: boolean;
}

export function killAgentRun(workspaceId: string, runId: string) {
  return apiFetch<{ id: string; status: AgentRunStatus }>(
    `/api/workspaces/${workspaceId}/agent/runs/${runId}/kill`,
    { method: "POST" },
  );
}

export function submitAgentRunInput(
  workspaceId: string,
  runId: string,
  input: AgentRunInputRequest,
): Promise<AgentRunInputResponse> {
  return apiFetch<AgentRunInputResponse>(
    `/api/workspaces/${workspaceId}/agent/runs/${runId}/input`,
    { method: "POST", json: input },
  );
}

// ── Daemon Runtimes ──

export interface DaemonRuntime {
  id: string;
  name: string | null;
  provider: string | null;
  version: string | null;
  status: string | null;
  last_heartbeat_at: string | null;
  capabilities: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export function listDaemonRuntimes() {
  return apiFetch<DaemonRuntime[]>("/api/daemon/runtimes");
}
