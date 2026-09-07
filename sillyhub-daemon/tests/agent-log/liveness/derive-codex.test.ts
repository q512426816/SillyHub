// tests/agent-log/liveness/derive-codex.test.ts —— codex rollout deriver 单测。
//
// task-10（2026-09-07-agent-liveness-states / FR-01）：E-02 实证词汇表规则
// （136 文件/13822 event_msg：task_complete→idle、function_call 配对差分→working、
// token_count 高频心跳跳过；无 approval 类事件——本机 policy=never，不承诺 blocked）。
import { describe, expect, it } from 'vitest';

import { deriveCodexRollout } from '../../../src/agent-log/liveness/derive-codex-rollout.js';
import { getDeriver } from '../../../src/agent-log/liveness/registry.js';

const NOW = 1_785_000_000_000;

/** response_item 行（call/output 配对语义）。 */
function ri(payloadType: string, callId?: string): string {
  return JSON.stringify({ timestamp: 't', type: 'response_item', payload: { type: payloadType, ...(callId ? { call_id: callId } : {}) } });
}

/** event_msg 行。 */
function ev(payloadType: string): string {
  return JSON.stringify({ timestamp: 't', type: 'event_msg', payload: { type: payloadType } });
}

describe('deriveCodexRollout（task-10，E-02 词汇表）', () => {
  it('末 function_call 无配对 function_call_output → working（toolcall_pending）', () => {
    const tail = [ri('function_call', 'c1'), ri('message'), ri('function_call', 'c2')].join('\n') + '\n';
    const out = deriveCodexRollout({ tail, prev: null, now: NOW });
    expect(out.state).toBe('working');
    expect(out.evidence).toBe('toolcall_pending');
  });

  it('function_call 已配对 output 且其后无新调用 → 继续看更末事件', () => {
    const tail = [ri('function_call', 'c1'), ri('function_call_output', 'c1'), ev('task_complete')].join('\n') + '\n';
    expect(deriveCodexRollout({ tail, prev: null, now: NOW }).state).toBe('idle');
  });

  it('event_msg task_complete → idle（task_complete）', () => {
    const tail = [ri('function_call', 'c1'), ri('function_call_output', 'c1'), ev('task_complete'), ev('token_count')].join('\n') + '\n';
    const out = deriveCodexRollout({ tail, prev: null, now: NOW });
    expect(out.state).toBe('idle');
    expect(out.evidence).toBe('task_complete');
  });

  it('token_count 心跳不参与判定（纯心跳尾部 → unknown，等 L0）', () => {
    const tail = [ev('token_count'), ev('token_count')].join('\n') + '\n';
    expect(deriveCodexRollout({ tail, prev: null, now: NOW }).state).toBe('unknown');
  });

  it('末事件为 assistant message（纯文本回合结束）→ idle', () => {
    const tail = [ri('function_call', 'c1'), ri('function_call_output', 'c1'), ri('message')].join('\n') + '\n';
    const out = deriveCodexRollout({ tail, prev: null, now: NOW });
    expect(out.state).toBe('idle');
    expect(out.evidence).toBe('assistant_text');
  });

  it('turn_aborted → idle；task_started/user_message 后续 → working', () => {
    expect(deriveCodexRollout({ tail: ev('turn_aborted') + '\n', prev: null, now: NOW }).state).toBe('idle');
    expect(deriveCodexRollout({ tail: ev('user_message') + '\n', prev: null, now: NOW }).state).toBe('working');
    expect(deriveCodexRollout({ tail: ev('task_started') + '\n', prev: null, now: NOW }).state).toBe('working');
  });

  it('custom_tool_call 同款配对语义；坏行/空尾部跳过与 unknown；永不 blocked', () => {
    const pendingCustom = ['{"broken', ri('custom_tool_call', 'x9')].join('\n') + '\n';
    const out = deriveCodexRollout({ tail: pendingCustom, prev: null, now: NOW });
    expect(out.state).toBe('working');
    expect(deriveCodexRollout({ tail: '', prev: null, now: NOW }).state).toBe('unknown');
    for (const tail of [pendingCustom, ev('task_complete') + '\n', '']) {
      expect(deriveCodexRollout({ tail, prev: null, now: NOW }).state).not.toBe('blocked');
    }
  });

  it('注册行生效：getDeriver("codex-rollout-jsonl") 返回本 deriver', () => {
    expect(getDeriver('codex-rollout-jsonl')).toBe(deriveCodexRollout);
  });
});
