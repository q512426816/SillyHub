// tests/agent-log/liveness/derive-claude.test.ts —— claude-code transcript deriver 单测。
//
// task-11（2026-09-07-agent-liveness-states / FR-04 + D-002@v1）：E-01 已证伪定稿
// （spike-02：160 个最近 transcript 无「等待审批」事件类型）——只实现 working/idle：
// assistant 含 tool_use 无配对 tool_result → working；末 assistant 纯文本 → idle；
// 全部 fixture 断言无 blocked 输出（证伪定稿回归）。
import { describe, expect, it } from 'vitest';

import { deriveClaudeCode } from '../../../src/agent-log/liveness/derive-claude-code.js';
import { getDeriver } from '../../../src/agent-log/liveness/registry.js';

const NOW = 1_785_000_000_000;

function userResult(callId: string): string {
  return JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: callId }] } });
}

function assistantToolUse(callId: string): string {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: callId, name: 'Bash' }] } });
}

function assistantText(): string {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } });
}

describe('deriveClaudeCode（task-11，E-01 证伪定稿）', () => {
  it('末 assistant 含 tool_use 无配对 tool_result → working（tooluse_pending）', () => {
    const tail = [assistantToolUse('c1'), userResult('c1'), assistantToolUse('c2')].join('\n') + '\n';
    const out = deriveClaudeCode({ tail, prev: null, now: NOW });
    expect(out.state).toBe('working');
    expect(out.evidence).toBe('tooluse_pending');
  });

  it('tool_use 已配对且末 assistant 纯文本 → idle（assistant_text）', () => {
    const tail = [assistantToolUse('c1'), userResult('c1'), assistantText()].join('\n') + '\n';
    expect(deriveClaudeCode({ tail, prev: null, now: NOW }).state).toBe('idle');
  });

  it('坏行跳过；空尾部/无 assistant 事件 → unknown；attach/mode 等辅助行不参与', () => {
    expect(deriveClaudeCode({ tail: '{broken\n' + assistantToolUse('c9') + '\n', prev: null, now: NOW }).state).toBe('working');
    expect(deriveClaudeCode({ tail: '', prev: null, now: NOW }).state).toBe('unknown');
    expect(deriveClaudeCode({ tail: JSON.stringify({ type: 'attachment' }) + '\n', prev: null, now: NOW }).state).toBe('unknown');
  });

  it('证伪定稿回归：全部场景永不产 blocked（E-01 无等待审批事件类型）', () => {
    for (const tail of [assistantToolUse('c1') + '\n', assistantText() + '\n', '']) {
      expect(deriveClaudeCode({ tail, prev: null, now: NOW }).state).not.toBe('blocked');
    }
  });

  it('注册行生效：getDeriver("claude-code-jsonl") 返回本 deriver', () => {
    expect(getDeriver('claude-code-jsonl')).toBe(deriveClaudeCode);
  });
});
