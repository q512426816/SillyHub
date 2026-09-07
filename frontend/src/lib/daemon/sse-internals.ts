/**
 * Daemon API client —— SSE 流内部共享工具（模块私有，不进 ./index 再导出：
 * isPermanentRestError / RESYNC_REST_TIMEOUT_MS / timeoutSignal 仅被
 * ./session-stream 与 ./group-shadow-stream 消费；进 index 会污染
 * @/lib/daemon 的 188 导出面）。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 原样搬移，
 * 函数体零改动（原为模块私有，入独立文件后补 export 供同目录消费）。
 */
import { ApiError } from "@/lib/api";
import { PERMANENT_SSE_ERROR_STATUSES } from "./session-sse";
/**
 * ql-20260904-H2（R7 补口）：resync 阶段 REST 错误的永久性判别——与上方
 * SSE onerror 的 ev.status 同口径。es.onerror 的停连分支只在建连后可达；
 * 断连重连时 resync 快照（runs/logs）先跑，若会话已被删/权限收回（401/403/
 * 404），ApiError 落进 resyncAndReconnect 的 catch 与网络错误无差别退避
 * 重试 → 每 30s 重打必败请求的永久循环（面板存活期间不停）。命中即由
 * 调用方停订阅终态。
 */
export function isPermanentRestError(err: unknown): boolean {
  return err instanceof ApiError && PERMANENT_SSE_ERROR_STATUSES.has(err.status);
}

/**
 * resync REST 快照拉取默认超时（F7 / 2026-08-25）：重连前的 runs/logs 拉取无
 * 超时时，TCP 半开 / 后端挂起会让 resync 流程停摆数分钟（退避循环卡死在
 * await）。10s 足够覆盖正常快照拉取；超时视为 resync 失败走既有 catch 退避
 * 分支（直接进入下一轮重连），不动 apiFetch 全局默认。测试可经
 * streamSession options.resyncTimeoutMs 注入毫秒级超时。
 */
export const RESYNC_REST_TIMEOUT_MS = 10_000;

/** 超时信号（AbortSignal.timeout 缺失环境（旧 jsdom）退化为手动 AbortController）。 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}
