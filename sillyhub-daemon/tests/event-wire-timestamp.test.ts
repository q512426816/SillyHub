/**
 * tests/event-wire-timestamp.test.ts —— F2a（2026-10-12-session-defects
 * task-01 / FR-02）消息级事件时间戳专项测试。
 *
 * 守护点：
 *  1. 两轨（eventToReportWireDict / eventToSubmitMessages）每条消息携带
 *     ISO-8601 timestamp（事件到达时刻，逐事件捕获）；
 *  2. 同批不同事件的时间戳互异可达（不再整批共享单值——生产同毫秒
 *     8~31 行聚集的 daemon 侧根因消除）；
 *  3. tool_call JSON content 内嵌 ts 展示值不受影响（既有语义保持）。
 */

import { describe, expect, it } from 'vitest';

import {
  eventToReportWireDict,
  eventToSubmitMessages,
} from '../src/event-wire.js';
import type { AgentEvent } from '../src/types.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('eventToReportWireDict 消息级 timestamp', () => {
  it('每条 dict 携带 ISO-8601 timestamp', () => {
    const dict = eventToReportWireDict({ type: 'text', content: 'hi' }, 1);
    expect(typeof dict['timestamp']).toBe('string');
    expect(dict['timestamp']).toMatch(ISO_RE);
  });

  it('逐事件捕获：先后两事件时间戳单调不回退', async () => {
    const a = eventToReportWireDict({ type: 'text', content: 'a' }, 1);
    await new Promise((r) => setTimeout(r, 5));
    const b = eventToReportWireDict({ type: 'text', content: 'b' }, 2);
    expect(String(b['timestamp']) >= String(a['timestamp'])).toBe(true);
  });
});

describe('eventToSubmitMessages 消息级 timestamp', () => {
  it('assistant 文本行携带 ISO-8601 timestamp', () => {
    const ev: AgentEvent = { type: 'text', content: '正文', metadata: {} };
    const msgs = eventToSubmitMessages(ev);
    expect(msgs).not.toBeNull();
    for (const m of msgs!) {
      expect(typeof m['timestamp']).toBe('string');
      expect(m['timestamp']).toMatch(ISO_RE);
    }
  });

  it('tool_use 双行（stdout + tool_call JSON）都携带 timestamp', () => {
    const ev: AgentEvent = {
      type: 'tool_use',
      content: '{"command":"ls"}',
      tool_name: 'Bash',
      call_id: 'call_1',
    };
    const msgs = eventToSubmitMessages(ev);
    expect(msgs).not.toBeNull();
    expect(msgs!.length).toBe(2);
    for (const m of msgs!) {
      expect(m['timestamp']).toMatch(ISO_RE);
    }
    // tool_call JSON content 内嵌 ts 展示值不受消息级字段影响。
    const tc = msgs!.find((m) => m['channel'] === 'tool_call');
    expect(tc).toBeDefined();
    const parsed = JSON.parse(String(tc!['content']));
    expect(parsed.timestamp).toMatch(ISO_RE);
  });
});
