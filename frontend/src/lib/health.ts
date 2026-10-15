import { ApiError, apiFetch, safeUUID } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/health/schema.py。
export type HealthResponse = components["schemas"]["HealthResponse"];

// 2026-10-14-admin-server-status task-02：恢复被 2026-07-24 死代码清理删除的
// getSystemStatus（展示层重建，接口自始在线）。鉴权由 D-001@v2 收紧为
// system_status:read——apiFetch 自动携带 Bearer，403 抛 ApiError、401 走全局拦截。
export type SystemStatusResponse = components["schemas"]["SystemStatusResponse"];

// 2026-10-15-server-logs-panel task-03 / D-002@v1：服务器日志数据层
// （类型经 gen:types 生成物引用，规则 21 禁手写）。
export type ServerLogsResponse = components["schemas"]["ServerLogsResponse"];
export type LogEntry = components["schemas"]["LogEntry"];

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return apiFetch<SystemStatusResponse>("/api/system-status");
}

export async function getServerLogs(lines = 200): Promise<ServerLogsResponse> {
  return apiFetch<ServerLogsResponse>("/api/server-logs", { query: { lines } });
}

/**
 * 下载日志文件（当前 + 轮转归档）——裸 fetch 带 Bearer 取 Blob，
 * 401 单飞刷新重试一次，返回后转 objectURL 触发浏览器下载。
 * 链路与 frontend/src/lib/explorer.ts 的 fetchDownload 同型（JWT 裸 URL 会 401）。
 */
export async function downloadLogFile(name: string): Promise<void> {
  const url = `/api/server-logs/download?file=${encodeURIComponent(name)}`;
  const doFetch = (token: string | null) =>
    fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

  let token = useSession.getState().accessToken ?? null;
  let resp = await doFetch(token);
  if (resp.status === 401) {
    // 单飞刷新（并发 401 由 token-refresh 模块级 inflight 保证只发一次）。
    const fresh = await ensureFreshAccessToken();
    if (fresh) {
      token = fresh;
      resp = await doFetch(token);
    }
  }
  if (!resp.ok) {
    throw new ApiError(resp.status, {
      code: "log_download_failed",
      message: `日志下载失败（HTTP ${resp.status}）`,
      request_id: safeUUID(),
      details: null,
    });
  }
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
