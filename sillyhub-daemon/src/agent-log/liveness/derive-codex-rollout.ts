/**
 * `agent-log/liveness/derive-codex-rollout.ts` —— codex rollout 日志 L1 推导器。
 *
 * task-10（2026-09-07-agent-liveness-states / FR-01 + D-003@v1）：E-02 实证
 * （2026-09-07，136 文件/13822 条 event_msg 全清单）规则落地——
 *   - `event_msg` `task_complete`（380 次）→ 回合完成 → idle；
 *   - `response_item` `function_call`（7071）无配对 `function_call_output`
 *     （7069，call_id 配对差分）→ 工具执行中 → working；`custom_tool_call`
 *     （1280）/`custom_tool_call_output`（1280）同款语义；
 *   - `token_count`（6674，高频心跳）不参与判定（纯心跳尾部 → unknown 交 L0）；
 *   - **不承诺 blocked**：清单无 approval 类事件（本机 approval_policy=never，
 *     会话结构性不等人；policy≠never 场景未验证，D-012 亦不依赖此路径）。
 *
 * 判定自尾向首扫：第一条「有判定力」的事件即返回（call 已消解则继续向旧
 * 走，直到 unresolved call 或回合边界事件）。纯函数约束同 types.ts。
 *
 * @module agent-log/liveness/derive-codex-rollout
 */

import type { LivenessDeriver } from './types.js';

/** call 型 response_item（发起）与配对 output 型（消解）。 */
const CALL_TYPES = new Set(['function_call', 'custom_tool_call']);
const OUTPUT_TYPES = new Set(['function_call_output', 'custom_tool_call_output']);
/** 回合边界事件：完成/中止 → idle；新任务/新输入 → working。 */
const IDLE_EVENTS = new Set(['task_complete', 'turn_aborted']);
const WORKING_EVENTS = new Set(['task_started', 'user_message']);

/** codex deriver：E-02 词汇表规则（working/idle/unknown，永不 blocked）。 */
export const deriveCodexRollout: LivenessDeriver = ({ tail }) => {
  const lines = tail.split('\n');
  /** 已见（更末位置的）output 消解掉的 call_id 集合。 */
  const resolvedCallIds = new Set<string>();
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    let r: { type?: unknown; payload?: { type?: unknown; call_id?: unknown } };
    try {
      r = JSON.parse(trimmed) as typeof r;
    } catch {
      continue; // 坏行跳过
    }
    if (r?.type !== 'event_msg' && r?.type !== 'response_item') continue;
    const payloadType = r.payload?.type;
    if (typeof payloadType !== 'string') continue;
    if (r.type === 'response_item') {
      const callId = typeof r.payload?.call_id === 'string' ? r.payload.call_id : null;
      if (OUTPUT_TYPES.has(payloadType)) {
        if (callId) resolvedCallIds.add(callId);
        continue;
      }
      if (CALL_TYPES.has(payloadType)) {
        if (callId === null || !resolvedCallIds.has(callId)) {
          return { state: 'working', evidence: 'toolcall_pending' };
        }
        continue; // 已消解，向旧走
      }
      if (payloadType === 'message') {
        return { state: 'idle', evidence: 'assistant_text' };
      }
      continue; // reasoning / web_search_call 等：无判定力
    }
    // event_msg
    if (payloadType === 'token_count') continue; // 高频心跳不参与判定
    if (IDLE_EVENTS.has(payloadType)) {
      return { state: 'idle', evidence: payloadType };
    }
    if (WORKING_EVENTS.has(payloadType)) {
      return { state: 'working', evidence: payloadType };
    }
    // agent_message 等其余 event_msg：无判定力，继续向旧
  }
  return { state: 'unknown', evidence: 'empty_tail' };
};
