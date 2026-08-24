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
  // task-12 / P3 driver gate pilot：gate 客观核验态与结果（后端 task-04 加列，nullable，
  // brownfield 老 run 无值。gate_status: pending/running/decided/failed）
  gate_status: string | null;
  gate_result: {
    exit_code: number;
    errors: string[];
    raw_envelope: Record<string, unknown>;
  } | null;
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
  // 2026-06-28-daemon-subagent-transcript task-10 / FR-08 / D-005@v1：子代理归属三列。
  // 后端 AgentRunLog 落库（task-07/09）+ _extract_sdk_messages 透传（task-08）+
  // SSE 实时流（task-09 published_logs）。主 agent / 历史日志（未升级 daemon）→
  // null/undefined，viewer 按主 agent 渲染（design §9 brownfield / G5）。
  parent_tool_use_id?: string | null;
  subagent_type?: string | null;
  depth?: number | null;
  // task-07 / FR-09 / D-001@v1 / D-002@v1：工具种类打标（14 枚举 + null）。
  // backend TOOL_KIND_VALUES 落库兜底（submit_messages）+ daemon _extract_sdk_messages
  // 透传。非工具调用 / 主 agent 历史日志（未升级 daemon）→ null/undefined，
  // viewer 按通用「工具」徽标渲染（toolKindMeta 灰色兜底）。
  tool_kind?: string | null;
  // ql-20260824-020：Edit 工具结果 structuredPatch JSON 串（hunks 含 oldStart/
  // newStart 真实文件行号）。仅 Edit tool_result 行有值；旧数据 / 其他工具 →
  // null/undefined，进度视图 Edit 展开区回退 LCS 自算行号。
  edit_patch?: string | null;
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
  // task-12 / 2026-08-02-agent-profile-layer：用户指定的 AgentProfile（软约束兜底）。
  // null/省略 → 后端走 workspace.default_agent_profile_id → 平台默认 → 原路径（不阻断）。
  agent_profile_id?: string | null;
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

// ── Agent File Artifacts（2026-08-23-agent-file-upload-mcp task-09）──

/**
 * agent 文件制品元数据（GET /api/agent/file-artifacts 响应 files 条目）。
 *
 * 对齐 backend file/schema.py FileMetaResp（含 task-01 扩展的 description /
 * created_at，旧数据 description 可为 null）。类型本卡本地声明，api-types.ts
 * 生成对齐归 task-10，本卡不手改生成文件。
 */
export interface AgentFileArtifactMeta {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  owner_type: string;
  owner_id: string | null;
  description: string | null;
  created_at: string;
}

interface AgentFileArtifactListResp {
  files: AgentFileArtifactMeta[];
}

/**
 * 按执行记录（run）列 agent 上传的产出文件（design §7.2 / D-010@v1）。
 *
 * 端点路径无 workspace 前缀（/api/agent/file-artifacts），鉴权为 JWT 用户
 * WORKSPACE_READ + run 锚 workspace 复核（apiFetch 自动带 Bearer）。不复用
 * /api/file/list（其非 admin owner 分支把 owner_id 当 workspace id 鉴权会
 * 404，D-010@v1）。响应 { files: [...] } 在此拆包，调用方直接拿数组（服务端
 * 已按 created_at 倒序）。
 */
export function listAgentFileArtifacts(runId: string) {
  return apiFetch<AgentFileArtifactListResp>("/api/agent/file-artifacts", {
    query: { run_id: runId },
  }).then((resp) => resp.files);
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
  // task-10 / FR-08：SSE 实时流归属（backend published_logs / session payload 透传，
  // task-09）。实时流与 DB 查询路径都有归属，viewer 统一渲染。历史/主 agent → undefined。
  parent_tool_use_id?: string | null;
  subagent_type?: string | null;
  depth?: number | null;
  // task-07 / FR-09 / D-001@v1 / D-002@v1：工具种类打标（14 枚举 + null），与
  // AgentRunLogEntry.tool_kind 同语义。SSE 实时流由 daemon _extract_sdk_messages
  // 注入；非工具调用 / 历史流 → undefined（viewer 灰色兜底）。
  tool_kind?: string | null;
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
/*  Mission — team progress（task-13 / D-011：create/list 入口已删，  */
/*  仅保留 team-progress / change 详情消费的 getMission/cancelMission） */
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

/**
 * team 模式下用户预设的 Worker（D-002@v2：用户预设，非主 agent 自动拆解）。
 * schema 对齐 backend AgentMission.worker_preset（task-02）：
 * 每条 `{agent_type, model, objective, role}`。
 */
export interface WorkerPresetItem {
  agent_type: string;
  model: string;
  objective: string;
  role: string;
}

/**
 * team 模式下主 agent（orchestrator）配置（D-003@v2：自由组合 agent 类型 + provider + model）。
 * schema 对齐 backend AgentMission.main_agent_config（task-02）：
 * `{agent_type, provider, model}`。
 */
export interface MainAgentConfig {
  agent_type: string;
  provider: string;
  model: string;
}

/**
 * Read a Mission (derived status + workers; lazily reaps completed Artifacts).
 * task-13（D-011）：创建入口归一会话触发（lib/daemon.ts triggerSessionTeamMission），
 * 本文件仅保留读/取消 client。
 */
export function getMission(missionId: string) {
  return apiFetch<Mission>(`/api/missions/${missionId}`);
}

/** Cancel a Mission: marks cancelled_at + kills active worker Runs. */
export function cancelMission(workspaceId: string, missionId: string) {
  return apiFetch<Mission>(
    `/api/workspaces/${workspaceId}/missions/${missionId}/cancel`,
    { method: "POST" },
  );
}
