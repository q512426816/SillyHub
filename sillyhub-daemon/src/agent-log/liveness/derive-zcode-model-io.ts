/**
 * `agent-log/liveness/derive-zcode-model-io.ts` —— zcode model-io 日志 L1 推导器。
 *
 * task-02（2026-09-07-agent-liveness-states / FR-01 + D-003@v1）：E-03 实证
 * （2026-09-07）规则落地——zcode rollout 记录 `type` 仅 `model_io` 一种，每行
 * 为一次完整模型请求/响应对（`startedAt`/`completedAt`/`response{finishReason,
 * toolCalls,usage}`），**无任何 CLI 交互层记录类型**（permission/dialog 关键词
 * 命中全部来自对话载荷）→ 本 deriver 只产 working/idle/unknown，**永不产
 * blocked**（R-01：无正向证据；design §5.1 zcode 行「永久 L0+working/idle」）。
 *
 * schema 词汇与 parse-zcode-model-io.ts 同源（实证自同一日志格式），但不
 * import 其私有解析函数（task-02 constraints）——本层只做尾部增量的事件级
 * 判定，完整解析归既有 parser。
 *
 * @module agent-log/liveness/derive-zcode-model-io
 */

import type { LivenessDeriver } from './types.js';

/** 新鲜窗口：末次模型事件距今 ≤120s 视为 working（design §5.1，与 L0 QUIET_MS 同值）。 */
const QUIET_MS = 120_000;

/** 尾部行解析结果（只取 liveness 判定所需字段，坏行/缺字段跳过）。 */
interface ZcodeTailRecord {
  completedAt: string;
  toolCalls: unknown[] | null;
}

function parseTailRecord(raw: string): ZcodeTailRecord | null {
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    if (r['type'] !== 'model_io') return null;
    const completedAt = r['completedAt'];
    if (typeof completedAt !== 'string') return null;
    const response = r['response'];
    const toolCalls =
      response && typeof response === 'object' && Array.isArray((response as Record<string, unknown>)['toolCalls'])
        ? ((response as Record<string, unknown>)['toolCalls'] as unknown[])
        : null;
    return { completedAt, toolCalls };
  } catch {
    return null;
  }
}

/** 取 tail 中最后一条可解析的 model_io 记录（坏行跳过，E-03 大文件单行场景兼容）。 */
function lastRecord(tail: string): ZcodeTailRecord | null {
  let last: ZcodeTailRecord | null = null;
  for (const line of tail.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseTailRecord(trimmed);
    if (parsed) last = parsed;
  }
  return last;
}

/** zcode L1 推导：末行 completedAt 新鲜或 toolCalls 未配对 → working；静默 → idle；无事件 → unknown。 */
export const deriveZcodeModelIo: LivenessDeriver = ({ tail, now }) => {
  const last = lastRecord(tail);
  if (!last) {
    return { state: 'unknown', evidence: 'empty_tail' };
  }
  // 工具执行中：末条响应带 toolCalls 且无后续记录（结果会出现在下一条的 request 里）
  if (last.toolCalls !== null && last.toolCalls.length > 0) {
    return { state: 'working', evidence: 'toolcalls_pending' };
  }
  const completedMs = Date.parse(last.completedAt);
  if (Number.isNaN(completedMs)) {
    return { state: 'unknown', evidence: 'bad_completed_at' };
  }
  const age = now - completedMs;
  if (age <= QUIET_MS) {
    return { state: 'working', evidence: 'last_event=model_io' };
  }
  return { state: 'idle', evidence: 'quiet>120s' };
};
