import { apiFetch } from "./api";

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
  provider: string | null;
  model: string | null;
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
  // AgentSession 表 id（fetchPendingDialogs 用它，区别于 session_id=daemon 内部 id）
  agent_session_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  // Cache token tracking（prompt cache read/creation；Claude 命中缓存维度，codex 无缓存→null）
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
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
  // ql-20260616-002：后端 schema 字段是 str | None（model.py:238 / schema.py:93），
  // 之前前端错声明为 string,导致 normalize.ts 直接 content.split 崩溃。
  content_redacted: string | null;
}

export interface CreateAgentRunInput {
  task_id: string;
  lease_id: string;
  agent_type: string;
  preferred_backend?: "server" | "daemon";
  // Explicit agent provider override; omitted/empty falls through to
  // workspace.default_agent (FR-02, 2026-06-14-agent-runtime-selection).
  provider?: string | null;
  model?: string | null;
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

/** 运行列表/详情展示用：优先 provider+model，回退 agent_type（内部 adapter id）。 */
export function formatRunProviderLabel(
  run: Pick<AgentRun, "provider" | "model" | "agent_type">,
): string {
  const provider = run.provider?.trim();
  if (!provider) return run.agent_type;
  const model = run.model?.trim();
  return model ? `${provider} · ${model}` : provider;
}

export interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
  log_id: string | null;
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

/**
 * scan 真阻塞（改造点 E）：workspace 维度 active AgentSession 列表。
 * GET /api/workspaces/{id}/agent-sessions?mode=scan。
 * 供 approvals 审批中心页聚合 scan 歧义 AskUserQuestion 决策（订阅各 session SSE）。
 */
export interface WorkspaceAgentSession {
  id: string;
  status: string;
  mode: string | null;
  provider: string | null;
}

export function listWorkspaceAgentSessions(
  workspaceId: string,
  mode?: string,
): Promise<WorkspaceAgentSession[]> {
  const qs = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return apiFetch<WorkspaceAgentSession[]>(
    `/api/workspaces/${workspaceId}/agent-sessions${qs}`,
  );
}

/* ================================================================== */
/*  Mission — multi-agent orchestration (2026-06-19-multi-agent)       */
/* ================================================================== */

export interface MissionArtifact {
  id: string;
  kind: string;
  content_ref: string | null;
  created_at: string;
}

export interface MissionWorkerRun {
  id: string;
  role: string | null;
  objective: string | null;
  status: AgentRunStatus;
  total_cost_usd: number | null;
  started_at: string | null;
  finished_at: string | null;
  artifacts: MissionArtifact[];
}

export interface Mission {
  id: string;
  workspace_id: string;
  change_id: string | null;
  objective: string;
  status: string; // derived: planning | running | degraded | done | failed | cancelled
  budget_usd: number | null;
  cost_so_far: number;
  constraints: Record<string, unknown> | null;
  cancelled_at: string | null;
  created_at: string;
  workers: MissionWorkerRun[];
}

export interface CreateMissionInput {
  objective: string;
  change_id?: string | null;
  budget_usd?: number | null;
  constraints?: Record<string, unknown> | null;
}

/** Create a Mission: GLM plans Worker delegations, dispatched to a daemon. */
export function createMission(workspaceId: string, input: CreateMissionInput) {
  return apiFetch<Mission>(`/api/workspaces/${workspaceId}/missions`, {
    method: "POST",
    json: input,
  });
}

/** Read a Mission (derived status + workers; lazily reaps completed Artifacts). */
export function getMission(missionId: string) {
  return apiFetch<Mission>(`/api/missions/${missionId}`);
}

/** Cancel a Mission: marks cancelled_at + kills active worker Runs. */
export function cancelMission(missionId: string) {
  return apiFetch<Mission>(`/api/missions/${missionId}/cancel`, {
    method: "POST",
  });
}
