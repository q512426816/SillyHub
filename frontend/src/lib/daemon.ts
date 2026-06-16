/**
 * Daemon runtime API client.
 */
import { apiFetch, getApiBaseUrl } from "@/lib/api";
import { useSession } from "@/stores/session";

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

export interface QuickChatResponse {
  id: string;
  agent_type: string;
  status: string;
}

export async function quickChat(
  prompt: string,
  provider: string,
  prevRunId?: string,
): Promise<QuickChatResponse> {
  let url = `/api/daemon-chat?prompt=${encodeURIComponent(prompt)}&provider=${encodeURIComponent(provider)}`;
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
  started_at: string | null;
  finished_at: string | null;
}

export async function getQuickChatResult(
  runId: string,
): Promise<QuickChatResult> {
  return apiFetch<QuickChatResult>(`/api/daemon-chat/${runId}`);
}

/* ---------- Quick chat SSE stream ---------- */

/**
 * 后端 submit_messages 在 Redis 推送的 message payload 结构。
 * 对齐 backend/app/modules/daemon/service.py:621-633 submit_messages 发布格式。
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

export interface QuickChatStreamDone {
  status?: string;
  exit_code?: number | null;
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
      const parsed = JSON.parse(e.data) as QuickChatStreamMessage;
      onMessage(parsed);
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
