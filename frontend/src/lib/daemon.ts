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
