/**
 * Daemon runtime API client.
 */
import { apiFetch, getApiBaseUrl } from "@/lib/api";
import { useSession } from "@/stores/session";
import type { AgentRunLogEntry } from "@/lib/agent";

export interface DaemonRuntimeRead {
  id: string;
  name: string | null;
  provider: string | null;
  version: string | null;
  status: string | null; // online, offline, maintenance, disabled
  last_heartbeat_at: string | null;
  capabilities: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export async function listDaemonRuntimes(): Promise<DaemonRuntimeRead[]> {
  return apiFetch<DaemonRuntimeRead[]>("/api/daemon/runtimes");
}

/**
 * 在线 daemon runtime 列表（task-10/11，2026-06-18-workspace-client-path）。
 * 用于 daemon-client workspace 创建时选择目标 daemon。
 */
export async function listOnlineRuntimes(): Promise<DaemonRuntimeRead[]> {
  const all = await listDaemonRuntimes();
  return all.filter((r) => r.status === "online");
}

/**
 * 目录条目（task-11 list_dir RPC 响应，FR-03 / D-005@v1）。
 */
export interface DirEntry {
  name: string;
  type: "dir" | "file";
}

export interface ListDirResponse {
  entries: DirEntry[];
}

/**
 * 经 backend 转发的 daemon list_dir RPC（task-04 端点）。
 * 受 daemon allowed_roots 白名单限制（D-002@v1），越界 403。
 */
export async function listDir(
  runtimeId: string,
  path: string,
): Promise<ListDirResponse> {
  return apiFetch<ListDirResponse>(
    `/api/daemon/runtimes/${runtimeId}/list-dir`,
    { method: "POST", json: { path } },
  );
}

export async function getDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(`/api/daemon/runtimes/${runtimeId}`);
}

export async function disableDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(
    `/api/daemon/runtimes/${runtimeId}/disable`,
    { method: "POST" },
  );
}

export async function enableDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(
    `/api/daemon/runtimes/${runtimeId}/enable`,
    { method: "POST" },
  );
}

export interface QuickChatResponse {
  id: string;
  agent_type: string;
  provider: string | null;
  model: string | null;
  status: string;
}

export async function quickChat(
  prompt: string,
  provider: string,
  prevRunId?: string,
  model?: string | null,
): Promise<QuickChatResponse> {
  let url = `/api/daemon-chat?prompt=${encodeURIComponent(prompt)}&provider=${encodeURIComponent(provider)}`;
  if (model) {
    url += `&model=${encodeURIComponent(model)}`;
  }
  if (prevRunId) {
    url += `&prev_run_id=${encodeURIComponent(prevRunId)}`;
  }
  return apiFetch<QuickChatResponse>(url, { method: "POST" });
}

export interface QuickChatResult {
  id: string;
  status: string;
  output_redacted: string | null;
  agent_type: string | null;
  provider: string | null;
  model: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export async function getQuickChatResult(
  runId: string,
): Promise<QuickChatResult> {
  return apiFetch<QuickChatResult>(`/api/daemon-chat/${runId}`);
}

/* ---------- Quick chat logs ---------- */

/**
 * ql-20260618-001：返回 quick-chat agent run 的完整日志条目（AgentRunLogEntry）。
 * 与 workspace-scoped /agent/runs/{run_id}/logs 同源（同一 service 方法）。
 */
export async function getQuickChatLogs(
  runId: string,
): Promise<AgentRunLogEntry[]> {
  return apiFetch<AgentRunLogEntry[]>(`/api/daemon-chat/${runId}/logs`);
}

/* ---------- Quick chat SSE stream ---------- */

/**
 * 后端 submit_messages 在 Redis 推送的 message payload 结构。
 * 对齐 backend/app/modules/daemon/service.py:709-725 submit_messages 发布格式。
 *
 * ql-20260618-005：backend 实际发**两种** payload，本接口统一识别：
 *   1. 扁平 StreamLogEvent（每条 AgentRunLog 一条 publish）：
 *      `{ log_id, channel, content, timestamp }`
 *   2. 聚合 messages（保留兼容，backend 还会发一条 summary）：
 *      `{ event:"messages", lease_id, count, agent_run_status?, messages?: [...] }`
 *
 * streamQuickChat 内部把扁平形态包装成聚合（messages 数组单元素）传给 onMessage，
 * 上层调用方无需感知差异，renderStreamMessage 仍按 messages[i].event_type 渲染。
 *
 * 扁平 payload 没有 event_type 字段，按 channel 反推：
 *   - stdout → text
 *   - stderr → error
 *   - tool_call → tool_use
 */
export interface QuickChatStreamMessage {
  event: "messages";
  lease_id: string;
  count: number;
  agent_run_status?: string;
  messages: Array<{
    event_type: string;
    content?: string;
    tool_name?: string;
    call_id?: string;
    status?: string;
    level?: string;
    session_id?: string;
  }>;
}

/** backend 扁平 StreamLogEvent（每条日志单独 publish）。 */
export interface QuickChatStreamFlatLog {
  log_id?: string;
  channel?: string;
  content?: string;
  timestamp?: string;
}

export interface QuickChatStreamDone {
  status?: string;
  exit_code?: number | null;
}

/** 把 channel 映射回 event_type（与 backend _channel_from_event_type 反向一致）。 */
function _eventTypeFromChannel(channel: string | undefined): string {
  switch (channel) {
    case "stderr":
      return "error";
    case "tool_call":
      return "tool_use";
    default:
      return "text";
  }
}

/**
 * 订阅 quick-chat 实时消息流（SSE）。
 *
 * 浏览器走 nextjs route handler proxy（避免 nextjs rewrite 缓冲 SSE）。
 * 用 query 传 accessToken —— EventSource 不支持自定义 header。
 *
 * onMessage: 每条 Redis pub/sub message 触发一次（含多条 agent event）
 * onDone:    agent 终态时触发（completed/failed/cancelled/timeout）
 * onError:   连接异常（含 404/401 等业务错误会通过 onerror 触发）
 *
 * 返回 EventSource 句柄，调用方负责 .close()。
 */
export function streamQuickChat(
  runId: string,
  onMessage: (_msg: QuickChatStreamMessage) => void,
  onDone: (_data: QuickChatStreamDone) => void,
  onError?: (_error: Error) => void,
): EventSource {
  const base = getApiBaseUrl();
  const { accessToken } = useSession.getState();
  const url = new URL(`${base}/api/daemon-chat/${runId}/stream`);
  if (accessToken) url.searchParams.set("token", accessToken);

  const es = new EventSource(url.toString());

  es.onmessage = (e: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      // 扁平 StreamLogEvent：包装成聚合 messages（单元素）
      if (
        parsed &&
        typeof parsed === "object" &&
        "content" in parsed &&
        !("messages" in parsed)
      ) {
        const flat = parsed as unknown as QuickChatStreamFlatLog;
        // summary payload（event="messages" 但无 content）跳过
        if (!flat.content) return;
        onMessage({
          event: "messages",
          lease_id: "",
          count: 1,
          messages: [
            {
              event_type: _eventTypeFromChannel(flat.channel),
              content: flat.content,
            },
          ],
        });
        return;
      }
      // 聚合 messages payload（旧格式兼容）
      if (
        parsed &&
        typeof parsed === "object" &&
        "messages" in parsed &&
        Array.isArray((parsed as { messages: unknown }).messages)
      ) {
        onMessage(parsed as unknown as QuickChatStreamMessage);
        return;
      }
      // summary payload（仅 event/count，无 messages/content）跳过
    } catch {
      onError?.(new Error(`Failed to parse SSE data: ${e.data}`));
    }
  };

  es.addEventListener("done", (e: MessageEvent<string>) => {
    es.close();
    let data: QuickChatStreamDone = {};
    try {
      data = JSON.parse(e.data);
    } catch {
      // empty done data is valid
    }
    onDone(data);
  });

  es.onerror = () => {
    // readyState 2 = CLOSED，说明连接已彻底关闭（404/401/网络中断都会到这里）
    const error = new Error("EventSource connection error");
    onError?.(error);
    // 不在这里 close —— 让 onerror 自然触发后浏览器会自动重连。
    // 业务侧 onDone/onMessage 不来时，调用方应设超时兜底。
    // 显式 close 在 onDone 已触发；如果只 onerror，让调用方决定。
  };

  return es;
}

/* ---------- Provider display metadata ---------- */

/** Provider display name, icon emoji, and Tailwind color classes. */
export const PROVIDER_META: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  claude: { label: "Claude Code", icon: "🟣", color: "bg-purple-100 text-purple-800" },
  codex: { label: "Codex", icon: "🟢", color: "bg-green-100 text-green-800" },
  copilot: { label: "Copilot", icon: "🔵", color: "bg-blue-100 text-blue-800" },
  opencode: { label: "OpenCode", icon: "🔷", color: "bg-teal-100 text-teal-800" },
  openclaw: { label: "OpenClaw", icon: "🟠", color: "bg-orange-100 text-orange-800" },
  hermes: { label: "Hermes", icon: "🟣", color: "bg-indigo-100 text-indigo-800" },
  gemini: { label: "Gemini", icon: "💎", color: "bg-cyan-100 text-cyan-800" },
  pi: { label: "Pi", icon: "🩷", color: "bg-pink-100 text-pink-800" },
  cursor: { label: "Cursor", icon: "🟡", color: "bg-amber-100 text-amber-800" },
  kimi: { label: "Kimi", icon: "🔴", color: "bg-red-100 text-red-800" },
  kiro: { label: "Kiro", icon: "🟩", color: "bg-emerald-100 text-emerald-800" },
  antigravity: { label: "Antigravity", icon: "⚫", color: "bg-slate-100 text-slate-800" },
};

/** Frontend-known minimum version requirements (UI warning only). */
export const MIN_VERSIONS: Record<string, string> = {
  claude: "2.0.0",
  codex: "0.100.0",
  copilot: "1.0.0",
};

/**
 * Simple semver comparison.
 * Returns true when `version` is strictly less than `minVersion`.
 * Handles optional "v" prefix and non-standard suffixes (e.g. "v2.1.0-beta").
 */
export function isVersionBelow(version: string, minVersion: string): boolean {
  const parse = (v: string): number[] => {
    const stripped = v.replace(/^v/, "");
    const parts = stripped.split(".");
    const nums: number[] = [];
    for (let i = 0; i < 3; i++) {
      const segment = (parts[i] ?? "").replace(/\D.*$/, "");
      nums.push(Number.parseInt(segment, 10) || 0);
    }
    return nums;
  };
  const v = parse(version);
  const m = parse(minVersion);
  for (let i = 0; i < 3; i++) {
    if ((v[i] ?? 0) < (m[i] ?? 0)) return true;
    if ((v[i] ?? 0) > (m[i] ?? 0)) return false;
  }
  return false; // equal
}

/* ---------- Session permission approval (task-08 / FR-07 / D-007@v1) ---------- */

/**
 * task-08：canUseTool 远程人审请求事件（SSE event=permission_request）。
 * 对齐 backend permission_service.handle_permission_request publish 的 payload。
 */
export interface SessionPermissionRequest {
  session_id: string;
  run_id: string;
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id?: string;
}

/**
 * task-08：审批已 resolve 事件（SSE event=permission_resolved）。
 * reason: 'manual'（用户操作） | 'timeout'（5min 超时 deny）。
 */
export interface SessionPermissionResolved {
  session_id: string;
  request_id: string;
  decision: "allow" | "deny";
  reason?: string;
}

/**
 * task-08：POST /api/daemon/sessions/{id}/permissions/{request_id}/response。
 * 用户对一条 permission_request 给 allow/deny，backend 转发 daemon + 取消 5min 定时器。
 *
 * 成功返回 {accepted: true}；失败抛 ApiError（404 已超时/未知 / 504 daemon 离线 / 409 manual=false）。
 */
export async function respondSessionPermission(
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny",
  message?: string,
): Promise<{ accepted: boolean }> {
  return apiFetch<{ accepted: boolean }>(
    `/api/daemon/sessions/${sessionId}/permissions/${requestId}/response`,
    {
      method: "POST",
      json: { decision, ...(message !== undefined ? { message } : {}) },
    },
  );
}

/**
 * task-08：解析 SSE 事件数据为 SessionPermissionRequest / SessionPermissionResolved。
 *
 * backend 在 agent_session:{session_id} channel publish 的 payload 形如：
 *   { event: "permission_request", session_id, run_id, request_id, tool_name, input, tool_use_id? }
 *   { event: "permission_resolved", session_id, request_id, decision, reason? }
 *   { event: "session_ended", ... }
 *
 * 非 permission_* 事件返回 null（让上层 SSE 订阅按其它事件类型自行处理）。
 */
export function parseSessionPermissionEvent(
  data: unknown,
): SessionPermissionRequest | SessionPermissionResolved | null {
  if (!data || typeof data !== "object") return null;
  const evt = data as Record<string, unknown>;
  if (evt.event === "permission_request") {
    return {
      session_id: String(evt.session_id ?? ""),
      run_id: String(evt.run_id ?? ""),
      request_id: String(evt.request_id ?? ""),
      tool_name: String(evt.tool_name ?? ""),
      input:
        evt.input && typeof evt.input === "object"
          ? (evt.input as Record<string, unknown>)
          : {},
      ...(typeof evt.tool_use_id === "string"
        ? { tool_use_id: evt.tool_use_id }
        : {}),
    };
  }
  if (evt.event === "permission_resolved") {
    const decision = evt.decision === "allow" ? "allow" : "deny";
    return {
      session_id: String(evt.session_id ?? ""),
      request_id: String(evt.request_id ?? ""),
      decision,
      ...(typeof evt.reason === "string" ? { reason: evt.reason } : {}),
    };
  }
  return null;
}

/* ---------- Interactive session REST + SSE (task-11 / FR-10 / D-006@v1) ----------
 *
 * 接口签名对齐 design.md §7.4 + task-05 REST 契约，签名固化为搬砖契约。
 * SSE envelope 对齐 task-06 session channel 聚合（事件含 run_id 区分 turn）。
 */

export type InteractiveProvider = "claude" | "codex";

export interface SessionCreateRequest {
  provider: InteractiveProvider;
  prompt: string;
  model?: string | null;
  manual_approval?: boolean;
}

export interface SessionCreateResponse {
  session_id: string;
  run_id: string;
  lease_id: string;
  status: string;
  stream_url: string;
}

export interface SessionInjectResponse {
  session_id: string;
  run_id: string;
  status: string;
}

export interface SessionControlResponse {
  session_id: string;
  status: string;
  current_run_id: string | null;
}

/**
 * POST /api/daemon/sessions — 创建交互式会话（首 turn）。
 * 对齐 task-05 create_session REST。
 */
export async function createSession(
  input: SessionCreateRequest,
): Promise<SessionCreateResponse> {
  const body: Record<string, unknown> = {
    provider: input.provider,
    prompt: input.prompt,
    model: input.model ?? null,
  };
  if (input.manual_approval !== undefined) {
    body.manual_approval = input.manual_approval;
  }
  return apiFetch<SessionCreateResponse>("/api/daemon/sessions", {
    method: "POST",
    json: body,
  });
}

/**
 * POST /api/daemon/sessions/{id}/inject — 同一 session 下创建下一 turn（新 AgentRun）。
 * 业务含义是"新一轮追问"，不是写入长驻进程 stdin。
 */
export async function injectSession(
  sessionId: string,
  prompt: string,
): Promise<SessionInjectResponse> {
  return apiFetch<SessionInjectResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/inject`,
    { method: "POST", json: { prompt } },
  );
}

/**
 * POST /api/daemon/sessions/{id}/interrupt — 只收敛 currentRun，session 保持 active。
 * 返回 current_run_id（null 表示当前无可打断 run）。
 */
export async function interruptSession(
  sessionId: string,
): Promise<SessionControlResponse> {
  return apiFetch<SessionControlResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/interrupt`,
    { method: "POST" },
  );
}

/**
 * POST /api/daemon/sessions/{id}/end — 结束整个 session。
 */
export async function endSession(
  sessionId: string,
): Promise<SessionControlResponse> {
  return apiFetch<SessionControlResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: "POST" },
  );
}

/* ---------- session SSE (streamSession) ---------- */

export type SessionEventKind =
  | "turn_started"
  | "log"
  | "turn_completed"
  | "session_status"
  | "session_ended";

export interface SessionStreamEnvelope {
  event: SessionEventKind;
  session_id: string;
  run_id: string | null;
  turn: number | null;
  log_id: string | null;
  timestamp: string | null;
  channel: string | null;
  content: string | null;
  status: string | null;
  exit_code: number | null;
  reason: string | null;
}

export interface SessionStreamHandlers {
  onTurnStarted(event: SessionStreamEnvelope): void;
  onLog(event: SessionStreamEnvelope, cursor: string | null): void;
  onTurnCompleted(event: SessionStreamEnvelope): void;
  onSessionEnded(event: SessionStreamEnvelope): void;
  onError(error: Error): void;
}

export interface SessionStreamConnection {
  close(): void;
  getLastEventId(): string | null;
}

/**
 * 订阅 session 级 SSE（贯穿整个会话多 turn）。
 *
 * - URL 走 Next route handler proxy（/api/daemon/sessions/{id}/stream），token 走 query。
 * - backend 对 turn_started/log/turn_completed/session_status/session_ended/permission_*
 *   统一发**默认 data 帧**（无 `event:` 行），payload 内 `event` 字段标识类型。
 *   故前端必须用 `es.onmessage` 接收并按 `parsed.event` dispatch —— 命名事件
 *   （addEventListener）只会收到带 `event:` 行的 done/error，收不到上述 turn 事件，
 *   会导致 InteractiveSessionPanel 的 onTurnStarted/onLog/onTurnCompleted 收不到事件。
 * - 校验 session_id 匹配；turn_started/log/turn_completed 必须有 run_id。
 * - turn_completed 不 close；session_ended close + 回调幂等。
 * - onerror 不立即 close，允许浏览器携 Last-Event-ID 自动重连。
 *
 * P0-1（2026-06-18）：从 addEventListener(kind) 改为 onmessage 单通道 dispatch，
 * 与 backend stream_session_logs 的 default data: 帧对齐。done/error 仍走命名事件
 * （backend 发 `event: done`/`event: error`），permission_request/permission_resolved
 * 兼容旧 task-08 onmessage 通道，已统一进 onmessage 解析。
 */
export function streamSession(
  sessionId: string,
  handlers: SessionStreamHandlers,
  options?: { cursor?: string },
): SessionStreamConnection {
  const base = getApiBaseUrl();
  const { accessToken } = useSession.getState();
  const url = new URL(
    `${base}/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  if (accessToken) url.searchParams.set("token", accessToken);
  if (options?.cursor) url.searchParams.set("cursor", options.cursor);

  const es = new EventSource(url.toString());
  let lastEventId: string | null = null;
  let sessionEndedFired = false;

  const dispatch = (raw: { data: string; lastEventId?: string }): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.data);
    } catch {
      // 不泄露原始 payload（可能含敏感内容）
      handlers.onError(new Error("Failed to parse session SSE event"));
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      handlers.onError(new Error("Invalid session SSE payload"));
      return;
    }
    const env = parsed as Partial<SessionStreamEnvelope>;
    const kind = env.event;
    if (!kind) {
      // 无 event 字段：非 session channel 事件（如 backend summary 帧），忽略。
      return;
    }
    // 校验 session_id（permission_* 等同样携带 session_id，统一校验）
    if (env.session_id !== undefined && env.session_id !== sessionId) {
      handlers.onError(new Error(`Session id mismatch on ${kind} event`));
      return;
    }
    // turn 类事件必须有 run_id
    if (
      (kind === "turn_started" || kind === "log" || kind === "turn_completed") &&
      !env.run_id
    ) {
      handlers.onError(new Error(`Missing run_id on ${kind} event`));
      return;
    }
    if (kind === "log" && raw.lastEventId) {
      lastEventId = raw.lastEventId;
    }
    const envelope = env as SessionStreamEnvelope;
    switch (kind) {
      case "turn_started":
        handlers.onTurnStarted(envelope);
        break;
      case "log":
        handlers.onLog(envelope, raw.lastEventId ?? null);
        break;
      case "turn_completed":
        handlers.onTurnCompleted(envelope);
        break;
      case "session_status":
        // session_status 不进入专门 handler（无 status 变更时静默），可选扩展。
        break;
      case "session_ended":
        if (!sessionEndedFired) {
          sessionEndedFired = true;
          handlers.onSessionEnded(envelope);
          es.close();
        }
        break;
      default:
        // permission_request / permission_resolved / done / error 等其它事件：
        // 这些事件不在本 handlers 契约内（permission 走 task-08 parseSessionPermissionEvent，
        // done/error 不经 streamSession）。统一忽略，避免误触发 onTurnStarted 等。
        break;
    }
  };

  // backend turn/log/permission_* 走默认 data 帧（无 event: 行）→ 必须用 onmessage 接。
  es.onmessage = (e: MessageEvent<string>) => {
    dispatch({ data: e.data, lastEventId: e.lastEventId || undefined });
  };

  es.onerror = () => {
    // 不立即 close：浏览器会携 Last-Event-ID 自动重连。
    // 仅通知组件（可选显示 reconnecting），不收口 session。
  };

  return {
    close: () => es.close(),
    getLastEventId: () => lastEventId,
  };
}

/* ---------- Session list + history (task-12 / FR-10 / D-005@v1) ----------
 *
 * 只读查询：GET /api/daemon/sessions（当前用户所有会话）+ GET /sessions/{id}/logs
 * （跨 AgentRun 历史回看，聚合键为 agent_runs.agent_session_id，见后端 service）。
 * permission 通道复用 task-08（respondSessionPermission / parseSessionPermissionEvent
 * 已在上方），本文件不新增第二套。
 */

import { z } from "zod";

export type AgentSessionStatus =
  | "pending"
  | "active"
  | "reconnecting"
  | "ended"
  | "failed";

export interface AgentSessionRead {
  id: string;
  runtime_id: string | null;
  lease_id: string | null;
  provider: string;
  status: AgentSessionStatus;
  agent_session_id: string | null;
  config: { manual_approval?: boolean; model?: string | null } | null;
  turn_count: number;
  created_at: string;
  last_active_at: string | null;
  ended_at: string | null;
}

export interface AgentSessionListResponse {
  items: AgentSessionRead[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * GET /api/daemon/sessions — 列出当前用户的会话（active/历史）。
 * 越权隔离在后端 SQL 层（user_id），前端只展示。
 */
export async function listAgentSessions(
  options?: {
    limit?: number;
    offset?: number;
    status?: AgentSessionStatus;
  },
): Promise<AgentSessionListResponse> {
  const query: Record<string, string | number> = {};
  if (options?.limit !== undefined) query.limit = options.limit;
  if (options?.offset !== undefined) query.offset = options.offset;
  if (options?.status) query.status = options.status;
  return apiFetch<AgentSessionListResponse>("/api/daemon/sessions", { query });
}

/** DELETE /api/daemon/sessions/{id} — 删除已结束的会话记录。 */
export async function deleteAgentSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/daemon/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

/* ---------- Session reopen + detail (task-09 / FR-2 / D-002@v1) ---------- */

/**
 * task-09：reopen 返回体。status 通常为 "active"（已恢复）。
 * 409 业务码（ApiError.code）：
 *   DAEMON_SESSION_RESUME_UNSUPPORTED / DAEMON_SESSION_NO_AGENT_SESSION
 *   / DAEMON_SESSION_NOT_ACTIVE / DAEMON_OFFLINE
 */
export interface SessionReopenResponse {
  session_id: string;
  status: string;
}

/**
 * POST /api/daemon/sessions/{id}/reopen — 恢复已结束的会话（task-05/06 端点）。
 * 错误统一走 apiFetch → ApiError（含 409 业务码）。
 */
export async function reopenSession(
  sessionId: string,
): Promise<SessionReopenResponse> {
  return apiFetch<SessionReopenResponse>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/reopen`,
    { method: "POST" },
  );
}

/**
 * GET /api/daemon/sessions/{id} — 单会话详情（task-06 端点）。
 * reopen 后用于轮询 status，确认会话已恢复 active。
 */
export async function getAgentSession(
  sessionId: string,
): Promise<AgentSessionRead> {
  return apiFetch<AgentSessionRead>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/**
 * GET /api/daemon/sessions/{id}/logs — 跨 AgentRun 的只读历史回看。
 * 日志按 run 分组返回，run_id 完整保留以便前端区分 turn 边界（D-005@v1）。
 */
export async function getAgentSessionLogs(
  sessionId: string,
): Promise<AgentRunLogEntry[]> {
  return apiFetch<AgentRunLogEntry[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/logs`,
  );
}

// 内部 dev-time 校验（不暴露给业务层，避免与 backend DTO 双重维护）。
export const AgentSessionListResponseSchema = z.object({
  items: z.array(z.object({}).passthrough()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

