/**
 * 网络错误分类纯函数（task-07 / FR-04）。
 *
 * 来源：design.md §5 Phase2 / §7 接口定义；plan.md Wave2 task-07。
 * 本质：
 *   - `isRetryable(err)` 判断网络错误是否值得退避重试——可重试=fetch failed
 *     (TypeError) / AbortSignal.timeout (TimeoutError/DOMException) /
 *     HubHttpError 5xx+429；不可重试=HubHttpError 4xx（业务错误 fail-fast）/
 *     AbortError（主动停止）/ 未知错误（保守不重试）。
 *   - `toCauseInfo(err)` 把错误压平为稳定的 `{ message, code?, status? }`，
 *     与 hub-client.extractCause（task-01）语义一致，供 ResilienceService 日志用。
 *
 * 纯函数，只读不修改入参。
 *
 * @module resilience/error-classify
 */

import { HubHttpError } from '../hub-client.js';

/** HubHttpError 可重试状态码：限流 + 5xx 服务端错误。 */
const RETRYABLE_STATUS = new Set<number>([429, 500, 502, 503, 504]);

/** cause 信息：message 必有，code/status 按错误类型可选。 */
export interface CauseInfo {
  message: string;
  code?: string;
  status?: number;
}

/**
 * 判断错误是否可重试（FR-04）。
 *
 * 规则：
 *   - TypeError（undici fetch failed）→ true（网络层错误，可恢复）
 *   - name === 'TimeoutError'（AbortSignal.timeout 抛的 DOMException）→ true
 *   - HubHttpError：status ∈ {429,500,502,503,504} → true；其余 4xx → false
 *   - 其他（含 AbortError、普通 Error、非 Error 值）→ false（保守）
 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // AbortError 是主动停止信号，绝不重试（必须先于 TimeoutError 判断，
  // 因为某些 abort 场景 name 也可能含 timeout 字样，但 AbortError 优先排除）。
  if (err.name === 'AbortError') return false;
  if (err instanceof TypeError) return true; // fetch failed
  if (err.name === 'TimeoutError') return true; // AbortSignal.timeout
  if (err instanceof HubHttpError) {
    return RETRYABLE_STATUS.has(err.status);
  }
  return false; // 未知错误保守不重试
}

/**
 * 从错误中提取稳定 cause 信息（与 task-01 extractCause 等价）。
 *
 * 规则：
 *   - HubHttpError → { message, status }
 *   - Error 带 cause（{code,name,message}）→ 取 cause.code ?? cause.name + cause.message
 *   - 其他 Error → { message: err.message, code: err.name }
 *   - 非 Error → { message: String(err) }
 */
export function toCauseInfo(err: unknown): CauseInfo {
  if (err instanceof HubHttpError) {
    return { message: err.message, status: err.status };
  }
  const e = err as { message?: string; name?: string; cause?: unknown } | null;
  const message =
    e && typeof e.message === 'string' && e.message ? e.message : String(err);
  const cause = e?.cause as
    | { code?: string; name?: string; message?: string }
    | undefined;
  if (cause && (cause.code || cause.name)) {
    return { message: cause.message ?? message, code: cause.code ?? cause.name };
  }
  return { message, code: e?.name };
}

/**
 * 为单条 flat message 生成稳定 dedup_key（task-16 / FR-08 / D-001@v2）。
 *
 * 规则：
 *   - `msg.id`（Claude SDK assistant message 带 id，字符串）存在且非空 → 用之。
 *   - 否则 → `${runId}:${turnSeq}:${flatSeq}`（Codex flat message 无 id，确定性）。
 *   - turnSeq/flatSeq 缺失（极端，不应常态）→ `${runId}:${Date.now()}`。
 *
 * 明确不用 content-hash：相同内容不同 turn/seq 不去重（R-01 误去重）。
 * 确定性：同输入同输出，重发命中 backend ON CONFLICT DO NOTHING。
 */
export function dedupKeyFor(
  msg: Record<string, unknown>,
  runId: string,
  turnSeq?: number,
  flatSeq?: number,
): string {
  const id = typeof msg['id'] === 'string' && msg['id'] ? msg['id'] : '';
  if (id) return id;
  if (turnSeq !== undefined && flatSeq !== undefined) {
    return `${runId}:${turnSeq}:${flatSeq}`;
  }
  // 极端兜底：缺 seq 信息时用时间戳（非常态，仅防 undefined 崩）。
  return `${runId}:${Date.now()}`;
}
